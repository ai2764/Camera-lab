from __future__ import annotations

import argparse
import sys

from camera_lab_common import install_workflows


def main() -> int:
    parser = argparse.ArgumentParser(description="Install Camera Lab workflows into ComfyUI.")
    parser.add_argument("--include-experimental", action="store_true", help="Also install workflows/experimental.")
    args = parser.parse_args()
    try:
        install_workflows(include_experimental=args.include_experimental)
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

