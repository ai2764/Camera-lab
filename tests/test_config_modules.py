import server.camera_lab_server as server


def test_public_module_statuses_are_config_serializable(monkeypatch):
    monkeypatch.setattr(
        server,
        "object_info",
        lambda: {
            "LTXDirector": {"input": {"required": {}}},
            "LTXDirectorGuide": {"input": {"required": {}}},
        },
    )

    modules = server.public_modules()

    assert "director" in modules
    assert modules["director"]["id"] == "director"
    assert "enabled" in modules["director"]
    assert "ready" in modules["director"]
    assert "missing" in modules["director"]


def test_public_modules_tolerates_missing_comfy_root(monkeypatch, tmp_path):
    monkeypatch.setattr(
        server,
        "object_info",
        lambda: {
            "LTXDirector": {"input": {"required": {}}},
            "LTXDirectorGuide": {"input": {"required": {}}},
        },
    )
    monkeypatch.setitem(server.COMFY_CONFIG, "root", tmp_path / "missing-comfy")

    modules = server.public_modules()

    assert modules["director"]["id"] == "director"
