import scripts.check_setup as cs


def test_env_check_passes_from_file(monkeypatch, tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text("COMFYUI_ROOT=/tmp/ComfyUI\n")
    monkeypatch.setattr(cs, "ENV_PATH", env_file)
    monkeypatch.delenv("COMFYUI_URL", raising=False)
    monkeypatch.delenv("COMFYUI_ROOT", raising=False)
    assert cs.env_config_present() is True


def test_env_check_passes_from_environment(monkeypatch, tmp_path):
    # No .env file, but COMFYUI_URL is set in the environment (container case).
    monkeypatch.setattr(cs, "ENV_PATH", tmp_path / "does-not-exist.env")
    monkeypatch.setenv("COMFYUI_URL", "http://comfyui:8188")
    monkeypatch.delenv("COMFYUI_ROOT", raising=False)
    assert cs.env_config_present() is True


def test_env_check_fails_without_file_or_env(monkeypatch, tmp_path):
    # Force the file-absent branch by pointing ENV_PATH at a path that does not exist,
    # rather than trying to monkeypatch `exists` on the Path instance itself (which
    # doesn't work since Path instances don't allow arbitrary attribute assignment
    # to override bound methods in a way that affects the class-level lookup).
    monkeypatch.setattr(cs, "ENV_PATH", tmp_path / "does-not-exist.env")
    monkeypatch.delenv("COMFYUI_URL", raising=False)
    monkeypatch.delenv("COMFYUI_ROOT", raising=False)
    assert cs.env_config_present() is False
