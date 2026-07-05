import pytest

from scripts.launch import MODES, feasibility_for, mode_command, recommended_mode
from scripts.launch import assess, probe_comfy


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
