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
MODE_CHOICES = (
    ("no-docker", "Existing ComfyUI + native Camera Lab"),
    ("cam-lab-only-docker", "Existing ComfyUI + Docker Camera Lab"),
    ("comfy-only-docker", "Docker ComfyUI + native Camera Lab"),
    ("full-docker", "Docker ComfyUI + Docker Camera Lab"),
)


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


def _module_by_id(modules, module_id):
    for module in modules:
        if module.id == module_id:
            return module
    return None


def model_guide_rows(assessment, modules=MODULES):
    rows = []
    for entry in assessment.get("modules", []):
        module = _module_by_id(modules, entry.get("id"))
        if module is None:
            continue
        profile = _profile_by_id(module, entry.get("profile")) if entry.get("profile") else None
        if profile is None:
            profile = module.model_profiles[0] if module.model_profiles else None
        required = list(getattr(profile, "required_models", ()) or ()) if profile else []
        missing = set(entry.get("missing", []))
        has_comfy = bool(assessment.get("has_comfy"))
        for ref in required:
            rows.append(
                {
                    "module": module.id,
                    "name": ref.name,
                    "folder": ref.folder,
                    "install_path": f"models/{ref.folder}/{ref.name}",
                    "page_url": getattr(ref, "page_url", "") or "",
                    "present": (ref.name not in missing) if has_comfy else None,
                }
            )
    return rows


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


def print_model_guide(assessment) -> None:
    rows = model_guide_rows(assessment)
    print("Model guide (download each missing file and place it at the listed path):")
    print("  Paths below are relative to your ComfyUI models folder.")
    current = None
    for row in rows:
        if row["module"] != current:
            current = row["module"]
            print(f"  {current}:")
        if row["present"] is True:
            tag = "[ok]     "
        elif row["present"] is False:
            tag = "[missing]"
        else:
            tag = "[needed]"
        print(f"    {tag} {row['install_path']}")
        source = row["page_url"] or "no public source - obtain manually"
        print(f"             {source}")


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


def _compose_env(mode: str) -> dict[str, str]:
    if mode == "comfy-only-docker":
        env_path = ROOT / "docker" / "compose.comfy-only.env"
        if not env_path.exists():
            env_path = ROOT / "docker" / "compose.comfy-only.env.example"
        return _read_env_file(env_path)
    if mode == "full-docker":
        return _read_env_file(ROOT / "docker" / "compose.env")
    if mode == "cam-lab-only-docker":
        return _read_env_file(ROOT / "docker" / "compose.camera-lab-only.env")
    return {}


def _comfy_only_native_env() -> dict[str, str]:
    values = _compose_env("comfy-only-docker")
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
    has_comfy = bool(assessment.get("has_comfy"))
    recommended = "no-docker" if has_comfy else "full-docker"
    recommended_index = next(i for i, item in enumerate(MODE_CHOICES, start=1) if item[0] == recommended)
    print("Choose install mode:")
    for index, (mode, label) in enumerate(MODE_CHOICES, start=1):
        suffix = " (recommended)" if mode == recommended else ""
        print(f"{index}. {label} [{mode}]{suffix}")
    try:
        answer = input_fn(f"Select 1-4 [{recommended_index}]: ").strip()
    except EOFError:
        answer = ""
    if not answer:
        return recommended
    try:
        index = int(answer)
    except ValueError:
        return recommended
    if 1 <= index <= len(MODE_CHOICES):
        return MODE_CHOICES[index - 1][0]
    return recommended


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
        env = _command_env(mode, command)
        if env:
            result = runner(command, env=env)
        else:
            result = runner(command)
        if result.returncode != 0:
            print(f"Command failed ({result.returncode}): {' '.join(command)}", file=sys.stderr)
            return result.returncode
    return 0


def _command_env(mode, command):
    if mode == "comfy-only-docker" and command == ["python", "scripts/start_camera_lab.py", "--open"]:
        return _comfy_only_native_env()
    return None


def _format_env_delta(env):
    if not env:
        return []
    return [f"{key}={env[key]}" for key in ("COMFYUI_URL", "COMFYUI_ROOT") if key in env]


def dry_run(mode) -> int:
    print(f"Dry run: {mode}")
    for command in mode_command(mode):
        env = _command_env(mode, command)
        print("  " + " ".join(command))
        for item in _format_env_delta(env):
            print(f"    env {item}")
    return 0


def _env_file_for_mode(mode: str) -> Path | None:
    if mode == "full-docker":
        return ROOT / "docker" / "compose.env"
    if mode == "cam-lab-only-docker":
        return ROOT / "docker" / "compose.camera-lab-only.env"
    if mode == "comfy-only-docker":
        path = ROOT / "docker" / "compose.comfy-only.env"
        return path if path.exists() else ROOT / "docker" / "compose.comfy-only.env.example"
    return None


def _env_example_for_mode(mode: str) -> Path | None:
    if mode == "full-docker":
        return ROOT / "docker" / "compose.env.example"
    if mode == "cam-lab-only-docker":
        return ROOT / "docker" / "compose.camera-lab-only.env.example"
    if mode == "comfy-only-docker":
        return ROOT / "docker" / "compose.comfy-only.env.example"
    return None


def _display_path(path: Path) -> str:
    try:
        return path.relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def _print_missing_env_help(mode: str, env_file: Path) -> None:
    example = _env_example_for_mode(mode)
    print(f"Missing Docker env file: {env_file}", file=sys.stderr)
    if example:
        print(f"Next step: Copy {_display_path(example)} to {_display_path(env_file)}.", file=sys.stderr)
    print("Then set MODELS_DIR to your host ComfyUI models folder.", file=sys.stderr)


def _print_models_dir_help(mode: str, env_file: Path | None, models_dir: str | None) -> None:
    print("MODELS_DIR is missing or does not exist.", file=sys.stderr)
    if models_dir:
        print(f"Current MODELS_DIR: {models_dir}", file=sys.stderr)
    if env_file:
        print(f"Edit {_display_path(env_file)} and set MODELS_DIR to your host ComfyUI models folder.", file=sys.stderr)
    print("Docker will mount MODELS_DIR at /opt/ComfyUI/models inside the ComfyUI container.", file=sys.stderr)


def preflight(mode, assessment, runner=subprocess.run) -> int:
    if mode in ("no-docker", "cam-lab-only-docker") and not assessment.get("has_comfy"):
        _warn_if_missing_comfy(mode, assessment)
        return 1
    if mode != "no-docker" and not _docker_available(runner):
        print("Docker is not available/running. Start Docker Desktop and retry.", file=sys.stderr)
        return 1

    env_file = _env_file_for_mode(mode)
    if mode in ("full-docker", "cam-lab-only-docker") and env_file and not env_file.exists():
        _print_missing_env_help(mode, env_file)
        return 1
    values = _compose_env(mode)
    if mode in ("full-docker", "comfy-only-docker"):
        models_dir = values.get("MODELS_DIR")
        if not models_dir or not Path(models_dir).expanduser().exists():
            _print_models_dir_help(mode, env_file, models_dir)
            return 1
    if mode == "comfy-only-docker":
        data_dir = values.get("COMFY_DATA_DIR") or "./comfy-data"
        data_path = Path(data_dir).expanduser()
        if not data_path.is_absolute():
            data_path = ROOT / data_path
        try:
            (data_path / "input").mkdir(parents=True, exist_ok=True)
            (data_path / "output").mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            print(f"COMFY_DATA_DIR is not writable: {exc}", file=sys.stderr)
            return 1
    return 0


def _warn_if_missing_comfy(mode, assessment) -> None:
    if assessment.get("has_comfy") or mode not in ("no-docker", "cam-lab-only-docker"):
        return
    if mode == "cam-lab-only-docker":
        print("Warning: ComfyUI was not detected; cam-lab-only-docker needs your ComfyUI listening on 0.0.0.0.")
        print("If your ComfyUI uses a custom port, set COMFYUI_URL=http://host.docker.internal:<your-comfy-port> in docker/compose.camera-lab-only.env.")
    else:
        print("Warning: ComfyUI was not detected; no-docker needs an existing local ComfyUI.")
        print("If your ComfyUI uses a custom port, set COMFYUI_URL=http://127.0.0.1:<your-comfy-port> in .env.")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Assess hardware and launch Camera Lab.")
    parser.add_argument("--mode", choices=MODES, help="Skip prompts and launch this mode.")
    parser.add_argument("--assess-only", action="store_true", help="Print the assessment and exit.")
    parser.add_argument("--dry-run", action="store_true", help="Print what would run without launching.")
    args = parser.parse_args(argv)

    hardware = detect_hardware(repo_root=ROOT, comfy_root=ROOT)
    _base, object_info = probe_comfy(
        ["http://127.0.0.1:8188/object_info", "http://127.0.0.1:8000/object_info"]
    )
    assessment = assess(hardware, object_info)
    print_assessment(assessment)
    print_model_guide(assessment)
    if args.assess_only:
        return 0
    mode = args.mode or choose_mode(assessment)
    if args.dry_run:
        return dry_run(mode)
    if preflight(mode, assessment) != 0:
        return 1
    return launch(mode)


if __name__ == "__main__":
    raise SystemExit(main())
