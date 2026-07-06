"""Pure helpers for deriving and verifying the Docker ComfyUI custom-node set."""
from __future__ import annotations

import json
from pathlib import Path


def _iter_node_types(data: object):
    if isinstance(data, dict):
        nodes = data.get("nodes")
        if isinstance(nodes, list):
            for n in nodes:
                if isinstance(n, dict):
                    t = n.get("type") or n.get("class_type")
                    if isinstance(t, str):
                        yield t
        else:  # API-format dict: {id: {"class_type": ...}}
            for n in data.values():
                if isinstance(n, dict) and isinstance(n.get("class_type"), str):
                    yield n["class_type"]


def custom_classes_in_workflows(workflows_dir: Path, provider_map: dict[str, str]) -> dict[str, str]:
    found: dict[str, str] = {}
    for path in sorted(Path(workflows_dir).glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        for t in _iter_node_types(data):
            if t in provider_map:
                found[t] = provider_map[t]
    return found


def assert_object_info_has(required: set[str], object_info: dict) -> list[str]:
    keys = set(object_info or {})
    return sorted(required - keys)


def nodes_lock_dirs(lock_path: Path) -> set[str]:
    dirs: set[str] = set()
    for line in Path(lock_path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        dirs.add(line.split("\t")[0].strip())
    return dirs
