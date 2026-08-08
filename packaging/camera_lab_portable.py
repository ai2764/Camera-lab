from __future__ import annotations

import argparse
import sys
import threading
import time
import webbrowser


def _port_from_args(args: list[str]) -> int:
    for index, value in enumerate(args):
        if value in {"--port", "-p"} and index + 1 < len(args):
            try:
                return int(args[index + 1])
            except ValueError:
                return 1234
        if value.startswith("--port="):
            try:
                return int(value.split("=", 1)[1])
            except ValueError:
                return 1234
    return 1234


def _open_browser_later(port: int) -> None:
    time.sleep(1.5)
    webbrowser.open(f"http://127.0.0.1:{port}")


def main() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--open", action="store_true", dest="open_browser")
    known, remaining = parser.parse_known_args()

    if known.open_browser:
        port = _port_from_args(remaining)
        threading.Thread(target=_open_browser_later, args=(port,), daemon=True).start()

    sys.argv = [sys.argv[0], *remaining]

    from server.camera_lab_server import main as server_main

    server_main()


if __name__ == "__main__":
    main()
