from __future__ import annotations

import argparse
import importlib.util
import sys
import urllib.error
from pathlib import Path

from camera_lab_common import (
    ENV_EXAMPLE_PATH,
    ENV_PATH,
    REQUIRED_MODELS,
    REPO_ROOT,
    comfy_root_from_env,
    comfy_url_from_env,
    http_json,
    installed_workflow_root,
    load_env,
)


def add_check(checks: list[bool], name: str, ok: bool, detail: object) -> None:
    status = "OK" if ok else "MISSING"
    print(f"[{status}] {name} - {detail}")
    checks.append(ok)


def main() -> int:
    parser = argparse.ArgumentParser(description="Check Camera Lab local setup.")
    parser.parse_args()

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

    model_root = comfy_root / "models"
    for model in REQUIRED_MODELS:
        path = model_root / Path(model)
        add_check(checks, f"Model {model}", path.exists(), path)

    ttp_path = comfy_root / "custom_nodes" / "Comfyui_TTP_Toolset" / "LTXVFirstLastFrameControl_TTP.py"
    add_check(checks, "TTP custom node", ttp_path.exists(), ttp_path)

    app_workflow_root = REPO_ROOT / "workflows" / "app"
    installed_app_workflow_root = installed_workflow_root(comfy_root) / "app"
    for workflow in sorted(app_workflow_root.glob("*.json")):
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
