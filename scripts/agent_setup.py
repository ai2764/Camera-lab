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


def run(command: list[str]) -> None:
    subprocess.run(command, cwd=REPO_ROOT, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap Camera Lab repo-side dependencies for coding agents.")
    parser.add_argument("--skip-node", action="store_true", help="Skip npm install.")
    parser.add_argument("--install-playwright-browser", action="store_true", help="Install Playwright Chromium.")
    parser.add_argument("--skip-workflow-install", action="store_true", help="Do not install workflows into ComfyUI.")
    parser.add_argument("--include-experimental-workflows", action="store_true", help="Also install workflows/experimental.")
    args = parser.parse_args()

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
                if not npx:
                    print("npx was not found. Skipping Playwright browser install.", file=sys.stderr)
                else:
                    print("Installing Playwright Chromium...")
                    run([npx, "playwright", "install", "chromium"])
        else:
            print("npm was not found. Skipping Node dependencies and browser smoke-test setup.", file=sys.stderr)

    load_env()
    comfy_root = comfy_root_from_env()
    if not args.skip_workflow_install and comfy_root and comfy_root.exists():
        install_workflows(include_experimental=args.include_experimental_workflows)
    elif not args.skip_workflow_install:
        print("COMFYUI_ROOT is not configured or does not exist. Skipping workflow install.", file=sys.stderr)

    print()
    print("Agent setup finished.")
    print("Next: edit .env if needed, start ComfyUI, then run python scripts/check_setup.py.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

