import json
from pathlib import Path

from scripts.docker_node_check import (
    assert_object_info_has,
    custom_classes_in_workflows,
    nodes_lock_dirs,
)


def _write_wf(tmp_path: Path, name: str, types: list[str]) -> None:
    nodes = [{"type": t} for t in types]
    (tmp_path / name).write_text(json.dumps({"nodes": nodes}), encoding="utf-8")


def test_custom_classes_filters_by_provider_map(tmp_path):
    _write_wf(tmp_path, "a.json", ["LTXDirector", "KSampler", "b8-uuid-1234"])
    provider = {"LTXDirector": "WhatDreamsCost-ComfyUI"}  # KSampler builtin, uuid absent
    result = custom_classes_in_workflows(tmp_path, provider)
    assert result == {"LTXDirector": "WhatDreamsCost-ComfyUI"}


def test_assert_object_info_has_reports_missing():
    oi = {"LTXDirector": {}, "KSampler": {}}
    assert assert_object_info_has({"LTXDirector"}, oi) == []
    assert assert_object_info_has({"LTXDirector", "HYMotionGenerate"}, oi) == ["HYMotionGenerate"]


def test_nodes_lock_dirs_parses_tab_rows(tmp_path):
    lock = tmp_path / "nodes.lock"
    lock.write_text(
        "# comment\n"
        "ComfyUI-GGUF\thttps://github.com/city96/ComfyUI-GGUF\tabc123\n"
        "\n"
        "comfyui-kjnodes\thttps://github.com/kijai/ComfyUI-KJNodes\tdef456\n",
        encoding="utf-8",
    )
    assert nodes_lock_dirs(lock) == {"ComfyUI-GGUF", "comfyui-kjnodes"}


def test_every_workflow_custom_class_has_a_lock_entry():
    """Guard: nodes.lock must cover every custom-node dir the workflows depend on."""
    repo = Path(__file__).resolve().parents[1]
    lock = repo / "docker" / "nodes.lock"
    map_path = repo / "docker" / "provider_map.json"  # written alongside nodes.lock in Step 5
    if not (lock.exists() and map_path.exists()):
        import pytest
        pytest.skip("docker/nodes.lock or provider_map.json not present yet")
    provider = json.loads(map_path.read_text(encoding="utf-8"))
    used = custom_classes_in_workflows(repo / "workflows" / "app", provider)
    lock_dirs = nodes_lock_dirs(lock)
    vendored = {"workflow_compat_nodes"}  # copied from repo, not cloned
    missing = sorted({d for d in used.values() if d not in lock_dirs and d not in vendored})
    assert missing == [], f"custom-node dirs used by workflows but absent from nodes.lock: {missing}"
