import subprocess
import sys
from pathlib import Path

from server import camera_lab_server as server
from server import workflow_graph


ROOT = Path(__file__).resolve().parents[1]


def test_workflow_graph_module_exports_existing_public_helpers():
    assert workflow_graph.workflow_to_api is server.workflow_to_api
    assert workflow_graph.expand_subgraphs is server.expand_subgraphs
    assert workflow_graph.fill_widget_inputs_from_object_info is server.fill_widget_inputs_from_object_info


def test_camera_lab_server_can_be_loaded_by_script_path():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from pathlib import Path; import runpy, sys; "
                "root = Path.cwd().resolve(); "
                "sys.path = [str(root / 'server')] + [p for p in sys.path if p and Path(p).resolve() != root]; "
                "runpy.run_path(str(root / 'server' / 'camera_lab_server.py'), run_name='camera_lab_server_script_probe')"
            ),
        ],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )

    assert result.returncode == 0, result.stderr


def test_workflow_to_api_still_converts_basic_workflow_through_facade():
    workflow = {
        "nodes": [
            {
                "id": 1,
                "type": "LoadImage",
                "inputs": [{"name": "image", "widget": {"name": "image"}}],
                "widgets_values": ["example.png"],
            }
        ],
        "links": [],
    }

    assert server.workflow_to_api(workflow) == {
        "1": {"class_type": "LoadImage", "inputs": {"image": "example.png"}, "_meta": {"title": ""}}
    }


def test_workflow_to_api_facade_uses_current_server_object_info(monkeypatch):
    monkeypatch.setattr(
        server,
        "object_info",
        lambda: {
            "TestNode": {
                "input_order": {"required": ["value"]},
                "input": {"required": {"value": ["INT", {}]}},
            }
        },
    )
    workflow = {
        "nodes": [
            {"id": 1, "type": "TestNode", "inputs": [], "widgets_values": [42]},
        ],
        "links": [],
    }

    assert server.workflow_to_api(workflow)["1"]["inputs"] == {"value": 42}


def test_workflow_to_api_keeps_dynamic_combo_widget_values(monkeypatch):
    monkeypatch.setattr(
        server,
        "object_info",
        lambda: {
            "SaveVideo": {
                "input_order": {
                    "required": ["video", "filename_prefix", "format", "codec"],
                },
                "input": {
                    "required": {
                        "video": ["VIDEO", {}],
                        "filename_prefix": ["STRING", {}],
                        "format": ["COMBO", {"options": ["auto", "mp4"]}],
                        "codec": ["COMFY_DYNAMICCOMBO_V3", {"options": [{"key": "auto"}]}],
                    },
                },
            },
        },
    )
    workflow = {
        "nodes": [
            {
                "id": 1,
                "type": "SaveVideo",
                "inputs": [],
                "widgets_values": ["video/CameraLab", "auto", "auto"],
            },
        ],
        "links": [],
    }

    assert server.workflow_to_api(workflow)["1"]["inputs"] == {
        "filename_prefix": "video/CameraLab",
        "format": "auto",
        "codec": "auto",
    }
