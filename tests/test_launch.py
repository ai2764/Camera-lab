import pytest

from scripts.launch import MODES, feasibility_for, mode_command, recommended_mode
from scripts.launch import assess, probe_comfy
from scripts.launch import choose_mode, launch, main


def test_recommended_mode_matrix():
    assert recommended_mode(has_comfy=True, want_docker=False) == "no-docker"
    assert recommended_mode(has_comfy=True, want_docker=True) == "cam-lab-only-docker"
    assert recommended_mode(has_comfy=False, want_docker=True) == "full-docker"
    # no comfy and no docker: nothing to launch -> sentinel
    assert recommended_mode(has_comfy=False, want_docker=False) == "none"


def test_feasibility_for():
    assert feasibility_for(None, None, 24) == "any"
    assert feasibility_for(16, 24, None) == "vram-unknown"
    assert feasibility_for(16, 24, 24) == "fits"
    assert feasibility_for(16, 24, 18) == "tight"
    assert feasibility_for(16, 24, 12) == "insufficient"
    assert feasibility_for(16, None, 20) == "fits"
    assert feasibility_for(16, None, 12) == "insufficient"


def test_mode_command_maps_each_mode():
    assert mode_command("no-docker") == [["python", "scripts/start_camera_lab.py", "--open"]]
    assert mode_command("full-docker") == [
        [
            "docker",
            "compose",
            "-f",
            "docker-compose.yml",
            "--env-file",
            "docker/compose.env",
            "up",
            "-d",
            "--build",
        ]
    ]
    assert mode_command("cam-lab-only-docker") == [
        [
            "docker",
            "compose",
            "-f",
            "docker-compose.camera-lab-only.yml",
            "--env-file",
            "docker/compose.camera-lab-only.env",
            "up",
            "-d",
            "--build",
        ]
    ]
    cmds = mode_command("comfy-only-docker")
    assert cmds[0] == [
        "docker",
        "compose",
        "-f",
        "docker-compose.comfy-only.yml",
        "--env-file",
        "docker/compose.comfy-only.env",
        "up",
        "-d",
        "--build",
    ]
    assert cmds[1] == ["python", "scripts/start_camera_lab.py", "--open"]
    assert all(m in MODES for m in ("no-docker", "full-docker", "comfy-only-docker", "cam-lab-only-docker"))
    with pytest.raises(ValueError):
        mode_command("bogus")


class _FakeHW:
    gpu_name = "RTX 4090"
    vram_gb = 24
    os_name = "Linux"
    warnings = ()


def test_probe_comfy_returns_first_reachable():
    calls = []

    def opener(url, timeout=0):
        calls.append(url)
        if "8188" in url:
            import io
            import json

            return io.BytesIO(json.dumps({"UNETLoader": {}}).encode())
        raise OSError("refused")

    base, oi = probe_comfy(
        ["http://127.0.0.1:8000/object_info", "http://127.0.0.1:8188/object_info"],
        opener=opener,
    )
    assert base == "http://127.0.0.1:8188"
    assert oi == {"UNETLoader": {}}


def test_probe_comfy_none_when_all_refused():
    def opener(url, timeout=0):
        raise OSError("refused")

    assert probe_comfy(["http://127.0.0.1:8188/object_info"], opener=opener) == (None, None)


def test_assess_reports_modules():
    a = assess(_FakeHW(), object_info={"UNETLoader": {}})
    assert a["has_comfy"] is True
    assert isinstance(a["modules"], list) and a["modules"]
    row = a["modules"][0]
    assert set(row) == {"id", "ready", "profile", "feasibility", "missing"}


def test_assess_no_comfy():
    a = assess(_FakeHW(), object_info=None)
    assert a["has_comfy"] is False


def test_choose_mode_uses_answers():
    answers = iter(["y", "n"])
    assert choose_mode({"has_comfy": True}, input_fn=lambda _: next(answers)) == "no-docker"


def test_choose_mode_uses_defaults_on_eof():
    def input_fn(_prompt):
        raise EOFError

    assert choose_mode({"has_comfy": True}, input_fn=input_fn) == "no-docker"


def test_launch_runs_commands_and_reports_exit():
    ran = []

    class R:
        def __init__(self, code):
            self.returncode = code

    def runner(cmd, **kw):
        ran.append(cmd)
        return R(0)

    rc = launch("full-docker", runner=runner)
    assert rc == 0
    assert ran and ran[0][0] == "docker"


def test_comfy_only_launch_passes_container_comfy_env_to_native_command(monkeypatch, tmp_path):
    docker_dir = tmp_path / "docker"
    docker_dir.mkdir()
    (docker_dir / "compose.comfy-only.env").write_text("COMFY_PORT=9199\nCOMFY_DATA_DIR=C:/camera-lab/comfy-data\n")
    monkeypatch.setattr("scripts.launch.ROOT", tmp_path)
    monkeypatch.setenv("COMFYUI_URL", "http://127.0.0.1:8000")
    monkeypatch.setenv("COMFYUI_ROOT", "C:/wrong/root")
    ran = []

    class R:
        returncode = 0

    def runner(cmd, **kw):
        ran.append((cmd, kw))
        return R()

    assert launch("comfy-only-docker", runner=runner) == 0
    assert ran[0][0] == ["docker", "info"]
    assert ran[1][0][0:2] == ["docker", "compose"]
    assert "env" not in ran[1][1]
    assert ran[2][0] == ["python", "scripts/start_camera_lab.py", "--open"]
    native_env = ran[2][1]["env"]
    assert native_env["COMFYUI_URL"] == "http://127.0.0.1:9199"
    assert native_env["COMFYUI_ROOT"] == "C:/camera-lab/comfy-data"


def test_assess_only_launches_nothing(monkeypatch, capsys):
    monkeypatch.setattr("scripts.launch.probe_comfy", lambda *a, **k: (None, None))
    monkeypatch.setattr(
        "scripts.launch.detect_hardware",
        lambda **k: type("H", (), {"gpu_name": None, "vram_gb": None, "os_name": "Linux", "warnings": ()})(),
    )
    called = []
    monkeypatch.setattr("scripts.launch.launch", lambda *a, **k: called.append(a))
    rc = main(["--assess-only"])
    assert rc == 0
    assert called == []


def test_main_warns_when_native_modes_need_existing_comfy(monkeypatch, capsys):
    monkeypatch.setattr("scripts.launch.probe_comfy", lambda *a, **k: (None, None))
    monkeypatch.setattr(
        "scripts.launch.detect_hardware",
        lambda **k: type("H", (), {"gpu_name": None, "vram_gb": None, "os_name": "Linux", "warnings": ()})(),
    )
    monkeypatch.setattr("scripts.launch.launch", lambda *_a, **_k: 0)

    assert main(["--mode", "cam-lab-only-docker"]) == 0

    output = capsys.readouterr().out
    assert "ComfyUI was not detected" in output
    assert "0.0.0.0" in output


def test_modelref_has_page_url_and_hf_page_helper():
    import sys, pathlib
    sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "scripts"))
    from camera_lab_setup.modules import ModelRef, _hf_page

    # positional construction (no page_url) still works
    r = ModelRef("vae", "x.safetensors", "https://example/resolve/main/x")
    assert r.page_url == ""
    r2 = ModelRef("vae", "x.safetensors", page_url="https://huggingface.co/org/repo")
    assert r2.page_url == "https://huggingface.co/org/repo"
    assert _hf_page("Lightricks/LTX-Video") == "https://huggingface.co/Lightricks/LTX-Video"


from scripts.launch import model_guide_rows


def _fake_module(mid, profile_id, models):
    class _P:
        id = profile_id
        required_models = models
    class _M:
        id = mid
        model_profiles = [_P()]
    return _M()


def test_model_guide_rows_paths_and_presence():
    class _R:
        def __init__(self, folder, name, page):
            self.folder, self.name, self.page_url = folder, name, page
    mods = [
        _fake_module("camera", "camera-ltx23-fp8", [_R("checkpoints", "a.safetensors", "https://huggingface.co/org/repo")]),
    ]
    assessment = {
        "has_comfy": True,
        "modules": [{"id": "camera", "profile": "camera-ltx23-fp8", "missing": ["a.safetensors"]}],
    }
    rows = model_guide_rows(assessment, modules=mods)
    assert rows == [
        {
            "module": "camera",
            "name": "a.safetensors",
            "folder": "checkpoints",
            "install_path": "models/checkpoints/a.safetensors",
            "page_url": "https://huggingface.co/org/repo",
            "present": False,
        }
    ]


def test_model_guide_rows_present_none_when_no_comfy():
    class _R:
        folder, name, page_url = "vae", "v.safetensors", ""
    mods = [_fake_module("edit", "edit-x", [_R()])]
    rows = model_guide_rows({"has_comfy": False, "modules": [{"id": "edit", "profile": "edit-x", "missing": []}]}, modules=mods)
    assert rows[0]["present"] is None
    assert rows[0]["page_url"] == ""
