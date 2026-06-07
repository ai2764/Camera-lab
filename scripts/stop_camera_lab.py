from __future__ import annotations

import argparse
import sys

from camera_lab_common import is_pid_alive, pid_file, terminate_pid, wait_for_config


def main() -> int:
    parser = argparse.ArgumentParser(description="Stop Camera Lab started by scripts/start_camera_lab.py.")
    parser.add_argument("-p", "--port", type=int, default=1234)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    pid_path = pid_file(args.port)
    url = f"http://127.0.0.1:{args.port}"
    if not pid_path.exists():
        print(f"No Camera Lab pid file found for {url}.")
        print("This script only stops servers started with scripts/start_camera_lab.py.")
        return 0

    try:
        pid = int(pid_path.read_text(encoding="utf-8").strip())
    except ValueError:
        print(f"Invalid pid file: {pid_path}", file=sys.stderr)
        return 1

    if not is_pid_alive(pid):
        pid_path.unlink(missing_ok=True)
        print(f"Removed stale pid file for {url}.")
        return 0

    try:
        wait_for_config(url, timeout_s=2)
    except RuntimeError:
        print(f"PID {pid} is alive, but {url} does not look like Camera Lab. Refusing to stop it.", file=sys.stderr)
        return 1

    if args.dry_run:
        print(f"Would stop Camera Lab PID {pid}.")
        return 0

    terminate_pid(pid)
    pid_path.unlink(missing_ok=True)
    print(f"Stopped Camera Lab PID {pid}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
