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
