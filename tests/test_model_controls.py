import pytest

import server.camera_lab_server as server


def test_workflow_model_controls_extracts_main_model_and_lora(monkeypatch, tmp_path):
    workflow_path = tmp_path / "workflow.json"
    workflow_path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(server, "WORKFLOWS", [{"id": "sample", "path": str(workflow_path), "mode": "i2v"}])
    monkeypatch.setattr(
        server,
        "workflow_to_api",
        lambda _workflow: {
            "35": {
                "class_type": "UNETLoader",
                "inputs": {"unet_name": "model-a.safetensors"},
                "_meta": {"title": "Base model"},
            },
            "293": {
                "class_type": "LoraLoaderModelOnly",
                "inputs": {"lora_name": "lora-a.safetensors"},
                "_meta": {"title": "Style LoRA"},
            },
        },
    )
    monkeypatch.setattr(
        server,
        "object_info",
        lambda: {
            "UNETLoader": {"input": {"required": {"unet_name": [["model-a.safetensors", "model-b.safetensors"], {}]}}},
            "LoraLoaderModelOnly": {"input": {"required": {"lora_name": [["lora-a.safetensors", "lora-b.safetensors"], {}]}}},
        },
    )

    result = server.workflow_model_controls("sample")

    controls = {item["id"]: item for item in result["controls"]}
    assert controls["35:unet_name"]["category"] == "main_model"
    assert controls["35:unet_name"]["label"] == "Base model"
    assert controls["35:unet_name"]["options"] == ["model-a.safetensors", "model-b.safetensors"]
    assert controls["293:lora_name"]["category"] == "lora"
    assert controls["293:lora_name"]["options"] == ["lora-a.safetensors", "lora-b.safetensors"]


def test_workflow_model_controls_extracts_director_ic_lora(monkeypatch):
    monkeypatch.setattr(server, "DIRECTOR_V2_WORKFLOW_PATH", server.ROOT / "workflows" / "app" / "ltx_director_2.json")
    monkeypatch.setattr(
        server,
        "WORKFLOWS",
        [{"id": "ltx_director_2", "path": str(server.DIRECTOR_V2_WORKFLOW_PATH), "mode": "director_ref", "builder": "ltx_director_2"}],
    )
    monkeypatch.setattr(
        server,
        "workflow_to_api",
        lambda _workflow: {
            "35": {"class_type": "UNETLoader", "inputs": {"unet_name": "model-a.safetensors"}},
            "132": {"class_type": "LTXDirectorGuide", "inputs": {"ic_lora_name": "None"}},
        },
    )
    monkeypatch.setattr(
        server,
        "object_info",
        lambda: {
            "UNETLoader": {"input": {"required": {"unet_name": [["model-a.safetensors"], {}]}}},
            "LTXDirectorGuide": {"input": {"required": {"ic_lora_name": [["None", "ingredients.safetensors"], {}]}}},
        },
    )

    result = server.workflow_model_controls("ltx_director_2")

    controls = {item["id"]: item for item in result["controls"]}
    assert controls["35:unet_name"]["category"] == "main_model"
    assert controls["132:ic_lora_name"]["category"] == "director_ic_lora"
    assert controls["132:ic_lora_name"]["options"] == ["None", "ingredients.safetensors"]


def test_workflow_model_controls_rejects_unknown_workflow():
    with pytest.raises(ValueError, match="unknown workflow"):
        server.workflow_model_controls("missing")
