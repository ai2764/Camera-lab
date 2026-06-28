from __future__ import annotations

import argparse
import shutil
import subprocess
import sys

from camera_lab_common import (
    ENV_EXAMPLE_PATH,
    ENV_PATH,
    REPO_ROOT,
    comfy_root_from_env,
    install_workflows,
    load_env,
    python_executable,
)
from camera_lab_setup.hardware import detect_hardware
from camera_lab_setup.modules import MODULES, CameraLabModule, ModelProfile, module_ids, selected_modules


def run(command: list[str]) -> None:
    subprocess.run(command, cwd=REPO_ROOT, check=True)


def parse_modules(raw: str | None, all_modules: bool) -> list[str] | None:
    if all_modules:
        return module_ids()
    if not raw:
        return None
    return [item.strip() for item in raw.split(",") if item.strip()]


def _profile_vram(profile: ModelProfile) -> str:
    if profile.min_vram_gb is None and profile.recommended_vram_gb is None:
        return "VRAM: any"
    if profile.min_vram_gb is None:
        return f"VRAM: recommended {profile.recommended_vram_gb:g} GiB"
    if profile.recommended_vram_gb is None:
        return f"VRAM: min {profile.min_vram_gb:g} GiB"
    return f"VRAM: min {profile.min_vram_gb:g} GiB, recommended {profile.recommended_vram_gb:g} GiB"


def print_profile_plan(modules: list[CameraLabModule]) -> None:
    print("Model profiles:")
    for module in modules:
        print(f"  {module.id}: {module.label}")
        if not module.model_profiles:
            print("    - no model profile required")
            continue
        for profile in module.model_profiles:
            details = [
                f"compatibility={profile.compatibility}",
                _profile_vram(profile),
            ]
            if profile.quantization:
                details.append(f"quantization={profile.quantization}")
            if profile.size:
                details.append(f"size={profile.size}")
            if profile.disk_gb:
                details.append(f"disk~{profile.disk_gb:g} GB")
            print(f"    - {profile.id}: {profile.label} ({'; '.join(details)})")
            if profile.notes:
                print(f"      {profile.notes}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Install Camera Lab with optional modules.")
    parser.add_argument("--list-modules", action="store_true", help="List installable modules and exit.")
    parser.add_argument("--list-profiles", action="store_true", help="List workflow-compatible model profiles and exit.")
    parser.add_argument("--modules", help="Comma-separated module ids to install.")
    parser.add_argument("--all", action="store_true", help="Install all modules.")
    parser.add_argument("--skip-node", action="store_true", help="Skip npm install.")
    parser.add_argument("--install-playwright-browser", action="store_true", help="Install Playwright Chromium.")
    parser.add_argument("--skip-workflow-install", action="store_true", help="Do not install workflows into ComfyUI.")
    args = parser.parse_args()

    if args.list_modules:
        for module in MODULES:
            print(f"{module.id}: {module.label} - {module.description}")
        return 0

    selected = parse_modules(args.modules, args.all)
    modules_for_install = selected_modules(selected)

    if args.list_profiles:
        print_profile_plan(modules_for_install)
        return 0

    hardware = detect_hardware(repo_root=REPO_ROOT, comfy_root=comfy_root_from_env())
    print(
        f"Hardware: GPU={hardware.gpu_name or 'unknown'}, "
        f"VRAM={hardware.vram_gb or 'unknown'} GiB, OS={hardware.os_name}, Python={hardware.python_version}"
    )
    for warning in hardware.warnings:
        print(f"Warning: {warning}", file=sys.stderr)
    print_profile_plan(modules_for_install)

    if not ENV_PATH.exists():
        if not ENV_EXAMPLE_PATH.exists():
            print(".env.example is missing.", file=sys.stderr)
            return 1
        shutil.copy2(ENV_EXAMPLE_PATH, ENV_PATH)
        print("Created .env from .env.example. Edit COMFYUI_ROOT before running setup checks.")

    print("Installing Python dependencies...")
    run([python_executable(), "-m", "pip", "install", "-r", "requirements.txt"])

    if not args.skip_node and (REPO_ROOT / "package.json").exists():
        npm = shutil.which("npm")
        if npm:
            print("Installing Node dependencies...")
            run([npm, "install"])
            if args.install_playwright_browser:
                npx = shutil.which("npx")
                if npx:
                    run([npx, "playwright", "install", "chromium"])
                else:
                    print("npx was not found. Skipping Playwright browser install.", file=sys.stderr)
        else:
            print("npm was not found. Skipping Node dependencies.", file=sys.stderr)

    load_env()
    comfy_root = comfy_root_from_env()
    if not args.skip_workflow_install and comfy_root and comfy_root.exists():
        install_workflows(module_ids=selected)
    elif not args.skip_workflow_install:
        print("COMFYUI_ROOT is not configured or does not exist. Skipping workflow install.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
