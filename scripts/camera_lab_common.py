from __future__ import annotations

import json
import os
import signal
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
TASKS_DIR = REPO_ROOT / "tasks"
ENV_PATH = REPO_ROOT / ".env"
ENV_EXAMPLE_PATH = REPO_ROOT / ".env.example"
PLACEHOLDER_COMFY_ROOT = "<path-to-your-ComfyUI>"

REQUIRED_MODELS = [
    "checkpoints/ltx-2.3-22b-dev-fp8.safetensors",
    "text_encoders/gemma_3_12B_it_fp4_mixed.safetensors",
    "loras/ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors",
    "latent_upscale_models/ltx-2.3-spatial-upscaler-x2-1.1.safetensors",
]


def load_env(path: Path = ENV_PATH, override: bool = False) -> dict[str, str]:
    loaded: dict[str, str] = {}
    if not path.exists():
        return loaded
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        if not name:
            continue
        loaded[name] = value
        if override or name not in os.environ:
            os.environ[name] = value
    return loaded


def comfy_root_from_env() -> Path | None:
    value = os.environ.get("COMFYUI_ROOT", "").strip()
    if not value or value == PLACEHOLDER_COMFY_ROOT:
        return None
    return Path(value).expanduser()


def comfy_url_from_env() -> str:
    return os.environ.get("COMFYUI_URL", "http://127.0.0.1:8000").strip() or "http://127.0.0.1:8000"


def installed_workflow_root(comfy_root: Path) -> Path:
    return comfy_root / "user" / "default" / "workflows" / "camera-lab"


def workflow_sources(include_experimental: bool = False) -> list[tuple[str, Path]]:
    sources = [("app", REPO_ROOT / "workflows" / "app")]
    if include_experimental:
        sources.append(("experimental", REPO_ROOT / "workflows" / "experimental"))
    return sources


def install_workflows(include_experimental: bool = False) -> int:
    load_env()
    comfy_root = comfy_root_from_env()
    if not comfy_root:
        raise RuntimeError("COMFYUI_ROOT is not set. Copy .env.example to .env and set COMFYUI_ROOT first.")
    if not comfy_root.exists():
        raise RuntimeError(f"COMFYUI_ROOT does not exist: {comfy_root}")

    target_root = installed_workflow_root(comfy_root)
    target_root.mkdir(parents=True, exist_ok=True)

    copied = 0
    for name, source in workflow_sources(include_experimental):
        if not source.exists():
            continue
        target = target_root / name
        target.mkdir(parents=True, exist_ok=True)
        for workflow in sorted(source.glob("*.json")):
            shutil.copy2(workflow, target / workflow.name)
            copied += 1
            print(f"Installed {name}/{workflow.name}")
    print()
    print(f"Installed {copied} workflow file(s) to:")
    print(target_root)
    print()
    print("Restart or refresh ComfyUI if the workflow browser does not show the new files.")
    return copied


def http_json(url: str, timeout: float = 5.0) -> Any:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def is_port_open(port: int, host: str = "127.0.0.1", timeout: float = 0.5) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(timeout)
        return sock.connect_ex((host, port)) == 0


def pid_file(port: int) -> Path:
    return TASKS_DIR / f"camera_lab_server_{port}.pid"


def is_pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            import ctypes

            process_query_limited_information = 0x1000
            handle = ctypes.windll.kernel32.OpenProcess(process_query_limited_information, False, pid)
            if handle:
                ctypes.windll.kernel32.CloseHandle(handle)
                return True
            return False
        except Exception:
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}"],
                capture_output=True,
                text=True,
                check=False,
            )
            return str(pid) in result.stdout
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def terminate_pid(pid: int) -> None:
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        os.kill(pid, signal.SIGTERM)


def wait_for_config(url: str, timeout_s: float = 5.0) -> dict[str, Any]:
    deadline = time.time() + timeout_s
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            data = http_json(f"{url}/api/config", timeout=3.0)
            if isinstance(data, dict) and "workflows" in data:
                return data
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
        time.sleep(0.25)
    if last_error:
        raise RuntimeError(str(last_error))
    raise RuntimeError("Camera Lab health check timed out.")


def python_executable() -> str:
    return sys.executable or "python"
