"""Camera Lab launcher: assess hardware, recommend, and start a deployment mode."""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
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


def _read_env_file(path: Path) -> dict[str, str]:
    values = {}
    if not path.exists():
        return values
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def _comfy_only_native_env() -> dict[str, str]:
    env_path = ROOT / "docker" / "compose.comfy-only.env"
    if not env_path.exists():
        env_path = ROOT / "docker" / "compose.comfy-only.env.example"
    values = _read_env_file(env_path)
    port = values.get("COMFY_PORT") or "8188"
    data_dir = values.get("COMFY_DATA_DIR") or "./comfy-data"
    data_path = Path(data_dir).expanduser()
    if not data_path.is_absolute():
        data_dir = str((ROOT / data_path).resolve())

    env = os.environ.copy()
    env["COMFYUI_URL"] = f"http://127.0.0.1:{port}"
    env["COMFYUI_ROOT"] = data_dir
    return env


def _yes(input_fn, prompt, default):
    suffix = " [Y/n] " if default else " [y/N] "
    try:
        answer = input_fn(prompt + suffix).strip().lower()
    except EOFError:
        return default
    if not answer:
        return default
    return answer.startswith("y")


def choose_mode(assessment, input_fn=input) -> str:
    has_comfy = _yes(input_fn, "Do you already have a working ComfyUI?", bool(assessment.get("has_comfy")))
    want_docker = _yes(input_fn, "Run with Docker?", not has_comfy)
    mode = recommended_mode(has_comfy, want_docker)
    if mode == "none":
        print("No ComfyUI and no Docker: install ComfyUI first, or re-run and choose a Docker mode.")
    return mode


def _docker_available(runner) -> bool:
    if runner is subprocess.run and shutil.which("docker") is None:
        return False
    try:
        return runner(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    except OSError:
        return False


def launch(mode, runner=subprocess.run) -> int:
    if mode == "none":
        return 1
    if mode != "no-docker" and not _docker_available(runner):
        print("Docker is not available/running. Start Docker Desktop and retry.", file=sys.stderr)
        return 1
    for command in mode_command(mode):
        if mode == "comfy-only-docker" and command == ["python", "scripts/start_camera_lab.py", "--open"]:
            result = runner(command, env=_comfy_only_native_env())
        else:
            result = runner(command)
        if result.returncode != 0:
            print(f"Command failed ({result.returncode}): {' '.join(command)}", file=sys.stderr)
            return result.returncode
    return 0


def _warn_if_missing_comfy(mode, assessment) -> None:
    if assessment.get("has_comfy") or mode not in ("no-docker", "cam-lab-only-docker"):
        return
    if mode == "cam-lab-only-docker":
        print("Warning: ComfyUI was not detected; cam-lab-only-docker needs your ComfyUI listening on 0.0.0.0.")
    else:
        print("Warning: ComfyUI was not detected; no-docker needs an existing local ComfyUI.")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Assess hardware and launch Camera Lab.")
    parser.add_argument("--mode", choices=MODES, help="Skip prompts and launch this mode.")
    parser.add_argument("--assess-only", action="store_true", help="Print the assessment and exit.")
    args = parser.parse_args(argv)

    hardware = detect_hardware(repo_root=ROOT, comfy_root=ROOT)
    _base, object_info = probe_comfy(
        ["http://127.0.0.1:8188/object_info", "http://127.0.0.1:8000/object_info"]
    )
    assessment = assess(hardware, object_info)
    print_assessment(assessment)
    if args.assess_only:
        return 0
    mode = args.mode or choose_mode(assessment)
    _warn_if_missing_comfy(mode, assessment)
    return launch(mode)


if __name__ == "__main__":
    raise SystemExit(main())
