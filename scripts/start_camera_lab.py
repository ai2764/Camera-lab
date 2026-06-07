from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
import webbrowser

from camera_lab_common import REPO_ROOT, TASKS_DIR, is_pid_alive, is_port_open, load_env, pid_file, terminate_pid, wait_for_config


def tail(path, limit: int = 80) -> str:
    if not path.exists():
        return ""
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return "\n".join(lines[-limit:])


def main() -> int:
    parser = argparse.ArgumentParser(description="Start Camera Lab.")
    parser.add_argument("-p", "--port", type=int, default=1234)
    parser.add_argument("--restart", action="store_true")
    parser.add_argument("--open", action="store_true", dest="open_browser")
    args = parser.parse_args()

    load_env()
    server_path = REPO_ROOT / "server" / "camera_lab_server.py"
    if not server_path.exists():
        print(f"Server not found: {server_path}", file=sys.stderr)
        return 1

    TASKS_DIR.mkdir(parents=True, exist_ok=True)
    stdout_log = TASKS_DIR / "camera_lab_server.log"
    stderr_log = TASKS_DIR / "camera_lab_server.log.err"
    url = f"http://127.0.0.1:{args.port}"
    pid_path = pid_file(args.port)

    if pid_path.exists():
        try:
            pid = int(pid_path.read_text(encoding="utf-8").strip())
        except ValueError:
            pid = 0
        if pid and is_pid_alive(pid):
            if not args.restart:
                print(f"Camera Lab already appears to be running on {url}")
                print(f"PID: {pid}")
                print("Use --restart to stop the current server and start a fresh one.")
                if args.open_browser:
                    webbrowser.open(url)
                return 0
            print(f"Stopping existing Camera Lab PID {pid}")
            terminate_pid(pid)
            time.sleep(1)
        else:
            pid_path.unlink(missing_ok=True)

    if is_port_open(args.port):
        print(f"Port {args.port} is already in use. Refusing to stop an unknown process.", file=sys.stderr)
        return 1

    print("Starting Camera Lab...")
    stdout_handle = stdout_log.open("w", encoding="utf-8")
    stderr_handle = stderr_log.open("w", encoding="utf-8")
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0
    proc = subprocess.Popen(
        [sys.executable, str(server_path), "--port", str(args.port)],
        cwd=REPO_ROOT,
        stdout=stdout_handle,
        stderr=stderr_handle,
        creationflags=creationflags,
        start_new_session=(os.name != "nt"),
    )
    pid_path.write_text(str(proc.pid), encoding="utf-8")

    time.sleep(2)
    if proc.poll() is not None:
        print("Camera Lab failed to start. stderr:", file=sys.stderr)
        print(tail(stderr_log), file=sys.stderr)
        return 1

    try:
        config = wait_for_config(url, timeout_s=5)
        comfy = "online" if config.get("comfy", {}).get("ok") else "offline"
        comfy_url = config.get("comfy", {}).get("url", "")
        print(f"Camera Lab: {url}")
        print(f"PID: {proc.pid}")
        print(f"ComfyUI: {comfy} ({comfy_url})")
        print("Logs:")
        print(f"  {stdout_log}")
        print(f"  {stderr_log}")
    except RuntimeError as exc:
        print(f"Camera Lab process started, but health check failed: {exc}", file=sys.stderr)
        print("Logs:", file=sys.stderr)
        print(f"  {stdout_log}", file=sys.stderr)
        print(f"  {stderr_log}", file=sys.stderr)
        return 1

    if args.open_browser:
        webbrowser.open(url)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
