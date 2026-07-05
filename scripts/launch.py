"""Camera Lab launcher: assess hardware, recommend, and start a deployment mode."""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from camera_lab_setup.hardware import detect_hardware  # noqa: E402
from camera_lab_setup.modules import MODULES  # noqa: E402
from camera_lab_setup.resolver import resolve_modules  # noqa: E402
from camera_lab_setup.visibility import visibility_from_object_info  # noqa: E402

MODES = ("no-docker", "full-docker", "comfy-only-docker", "cam-lab-only-docker")


def recommended_mode(has_comfy: bool, want_docker: bool) -> str:
    if has_comfy and not want_docker:
        return "no-docker"
    if has_comfy and want_docker:
        return "cam-lab-only-docker"
    if not has_comfy and want_docker:
        return "full-docker"
    return "none"


def feasibility_for(min_vram_gb, recommended_vram_gb, vram_gb) -> str:
    if min_vram_gb is None and recommended_vram_gb is None:
        return "any"
    if vram_gb is None:
        return "vram-unknown"
    if min_vram_gb is not None and vram_gb < min_vram_gb:
        return "insufficient"
    if recommended_vram_gb is not None and vram_gb < recommended_vram_gb:
        return "tight"
    return "fits"


def mode_command(mode: str) -> list[list[str]]:
    native = ["python", "scripts/start_camera_lab.py", "--open"]
    if mode == "no-docker":
        return [native]
    if mode == "full-docker":
        return [
            [
                "docker",
                "compose",
                "-f",
                "docker-compose.yml",
                "--env-file",
                "docker/compose.env",
                "up",
                "-d",
                "--build",
            ]
        ]
    if mode == "cam-lab-only-docker":
        return [
            [
                "docker",
                "compose",
                "-f",
                "docker-compose.camera-lab-only.yml",
                "--env-file",
                "docker/compose.camera-lab-only.env",
                "up",
                "-d",
                "--build",
            ]
        ]
    if mode == "comfy-only-docker":
        return [
            [
                "docker",
                "compose",
                "-f",
                "docker-compose.comfy-only.yml",
                "--env-file",
                "docker/compose.comfy-only.env",
                "up",
                "-d",
                "--build",
            ],
            native,
        ]
    raise ValueError(f"unknown mode: {mode}")


def probe_comfy(candidate_urls, opener=urllib.request.urlopen):
    for url in candidate_urls:
        try:
            with opener(url, timeout=5) as resp:
                data = json.load(resp)
        except (OSError, ValueError):
            continue
        base = url[: -len("/object_info")] if url.endswith("/object_info") else url
        return base, data
    return None, None


def _profile_by_id(module, profile_id):
    for profile in module.model_profiles:
        if profile.id == profile_id:
            return profile
    return None


def assess(hardware, object_info):
    has_comfy = object_info is not None
    visibility = visibility_from_object_info(object_info) if has_comfy else None
    rows = []
    statuses = resolve_modules(MODULES, hardware, visibility) if visibility is not None else {}
    for module in MODULES:
        status = statuses.get(module.id)
        profile = _profile_by_id(module, status.profile) if status and status.profile else None
        feas = (
            feasibility_for(profile.min_vram_gb, profile.recommended_vram_gb, hardware.vram_gb)
            if profile
            else "vram-unknown"
        )
        rows.append(
            {
                "id": module.id,
                "ready": bool(status.ready) if status else False,
                "profile": status.profile if status else None,
                "feasibility": feas,
                "missing": list(status.missing) if status else [],
            }
        )
    return {"hardware": hardware, "has_comfy": has_comfy, "modules": rows}


def print_assessment(assessment) -> None:
    hw = assessment["hardware"]
    print(f"Hardware: GPU={hw.gpu_name or 'unknown'}, VRAM={hw.vram_gb or 'unknown'} GiB, OS={hw.os_name}")
    for warning in hw.warnings:
        print(f"  warning: {warning}")
    print(f"ComfyUI detected: {'yes' if assessment['has_comfy'] else 'no'}")
    print("Modules:")
    for module in assessment["modules"]:
        line = f"  {module['id']:8} ready={module['ready']!s:5} feasibility={module['feasibility']}"
        if module["missing"]:
            line += f" missing={len(module['missing'])}"
        print(line)
