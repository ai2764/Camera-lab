from server import camera_lab_server as server
from server import workflow_graph


def test_workflow_graph_module_exports_existing_public_helpers():
    assert workflow_graph.workflow_to_api is server.workflow_to_api
    assert workflow_graph.expand_subgraphs is server.expand_subgraphs
    assert workflow_graph.fill_widget_inputs_from_object_info is server.fill_widget_inputs_from_object_info


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
