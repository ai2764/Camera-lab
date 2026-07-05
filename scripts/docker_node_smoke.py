"""Assert the running ComfyUI exposes every custom node class the app's workflows need."""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.docker_node_check import assert_object_info_has, custom_classes_in_workflows  # noqa: E402

REPO = Path(__file__).resolve().parents[1]


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8188"
    provider = json.loads((REPO / "docker" / "provider_map.json").read_text(encoding="utf-8"))
    required = set(custom_classes_in_workflows(REPO / "workflows" / "app", provider))
    with urllib.request.urlopen(f"{url}/object_info", timeout=30) as resp:
        object_info = json.load(resp)
    missing = assert_object_info_has(required, object_info)
    if missing:
        print("MISSING custom node classes in ComfyUI:", ", ".join(missing), file=sys.stderr)
        return 1
    print(f"OK: all {len(required)} required custom node classes present.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
