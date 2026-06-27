from __future__ import annotations

import argparse
import importlib.util
import sys
import urllib.error
from pathlib import Path

try:
    from camera_lab_common import (
        ENV_EXAMPLE_PATH,
        ENV_PATH,
        REPO_ROOT,
        comfy_root_from_env,
        comfy_url_from_env,
        http_json,
        installed_workflow_root,
        load_env,
    )
    from camera_lab_setup.hardware import detect_hardware
    from camera_lab_setup.modules import selected_modules
    from camera_lab_setup.resolver import resolve_modules
    from camera_lab_setup.visibility import ComfyVisibility, visibility_from_object_info
except ModuleNotFoundError:
    from scripts.camera_lab_common import (
        ENV_EXAMPLE_PATH,
        ENV_PATH,
        REPO_ROOT,
        comfy_root_from_env,
        comfy_url_from_env,
        http_json,
        installed_workflow_root,
        load_env,
    )
    from scripts.camera_lab_setup.hardware import detect_hardware
    from scripts.camera_lab_setup.modules import selected_modules
    from scripts.camera_lab_setup.resolver import resolve_modules
    from scripts.camera_lab_setup.visibility import ComfyVisibility, visibility_from_object_info


def add_check(checks: list[bool], name: str, ok: bool, detail: object) -> None:
    status = "OK" if ok else "MISSING"
    print(f"[{status}] {name} - {detail}")
    checks.append(ok)


def parse_module_ids(raw: str | None) -> list[str] | None:
    return [item.strip() for item in raw.split(",") if item.strip()] if raw else None


def workflow_names_for_modules(module_ids: list[str] | tuple[str, ...] | None = None) -> list[str]:
    names: list[str] = []
    for module in selected_modules(module_ids):
        names.extend(module.workflows)
    return list(dict.fromkeys(names))


def main() -> int:
    parser = argparse.ArgumentParser(description="Check Camera Lab local setup.")
    parser.add_argument("--modules", help="Comma-separated module ids to check.")
    args = parser.parse_args()
    module_ids = parse_module_ids(args.modules)

    load_env()
    checks: list[bool] = []
    comfy_root = comfy_root_from_env() or Path("ComfyUI")
    comfy_url = comfy_url_from_env()

    add_check(checks, ".env", ENV_PATH.exists(), "copy .env.example to .env and edit COMFYUI_ROOT if this is missing")
    add_check(checks, ".env.example", ENV_EXAMPLE_PATH.exists(), ENV_EXAMPLE_PATH)
    add_check(checks, "Python", sys.version_info >= (3, 10), sys.version.split()[0])
    pillow_ok = importlib.util.find_spec("PIL") is not None
    add_check(checks, "Pillow", pillow_ok, "installed" if pillow_ok else "run: python -m pip install -r requirements.txt")

    add_check(checks, "ComfyUI root", comfy_root.exists(), comfy_root)
    add_check(checks, "ComfyUI input", (comfy_root / "input").exists(), comfy_root / "input")
    add_check(checks, "ComfyUI output", (comfy_root / "output").exists(), comfy_root / "output")
    add_check(checks, "ComfyUI models", (comfy_root / "models").exists(), comfy_root / "models")
    add_check(
        checks,
        "ComfyUI workflows",
        (comfy_root / "user" / "default" / "workflows").exists(),
        comfy_root / "user" / "default" / "workflows",
    )

    try:
        stats = http_json(f"{comfy_url}/system_stats", timeout=5.0)
        add_check(checks, "ComfyUI server", stats is not None, comfy_url)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        add_check(checks, "ComfyUI server", False, f"start ComfyUI, then check {comfy_url}: {exc}")

    visibility = ComfyVisibility(nodes=frozenset(), models={}, source="offline")
    try:
        visibility = visibility_from_object_info(http_json(f"{comfy_url}/object_info", timeout=30.0))
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        print(f"[WARN] ComfyUI object_info unavailable - shared model paths cannot be confirmed: {exc}")

    hardware = detect_hardware(repo_root=REPO_ROOT, comfy_root=comfy_root if comfy_root.exists() else None)
    print(f"[INFO] Hardware - GPU={hardware.gpu_name or 'unknown'}, VRAM={hardware.vram_gb or 'unknown'} GiB")
    for warning in hardware.warnings:
        print(f"[WARN] Hardware - {warning}")

    statuses = resolve_modules(selected_modules(module_ids), hardware, visibility)
    for status in statuses.values():
        add_check(checks, f"Module {status.id}", status.ready, f"profile={status.profile or 'none'} recommendation={status.recommendation}")
        for missing in status.missing:
            add_check(checks, f"Module {status.id} dependency {missing}", False, missing)
        for warning in status.warnings:
            print(f"[WARN] Module {status.id} - {warning}")

    app_workflow_root = REPO_ROOT / "workflows" / "app"
    installed_app_workflow_root = installed_workflow_root(comfy_root) / "app"
    requested_workflows = set(workflow_names_for_modules(module_ids))
    workflows = sorted(app_workflow_root.glob("*.json"))
    if module_ids is not None:
        workflows = [workflow for workflow in workflows if workflow.name in requested_workflows]
    for workflow in workflows:
        installed = installed_app_workflow_root / workflow.name
        add_check(checks, f"Repo workflow {workflow.name}", workflow.exists(), workflow)
        add_check(checks, f"Installed ComfyUI workflow {workflow.name}", installed.exists(), installed)

    failed = len([ok for ok in checks if not ok])
    if failed:
        print()
        print(f"{failed} setup check(s) need attention.")
        return 1
    print()
    print("All setup checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
