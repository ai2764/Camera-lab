import server.camera_lab_server as s


def test_motion_url_falls_back_to_comfy_url():
    assert s.motion_comfy_url(env={}) == s.COMFY_URL


def test_motion_url_uses_env_when_set():
    assert s.motion_comfy_url(env={"COMFYUI_MOTION_URL": "http://127.0.0.1:8188"}) == "http://127.0.0.1:8188"


def test_http_json_uses_base_url(monkeypatch):
    captured = {}

    class FakeResp:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def read(self): return b'{"ok": true}'

    def fake_urlopen(req, timeout=0):
        captured["url"] = req if isinstance(req, str) else req.full_url
        return FakeResp()

    monkeypatch.setattr(s.urllib.request, "urlopen", fake_urlopen)
    s.http_json("/system_stats", base_url="http://127.0.0.1:8188")
    assert captured["url"].startswith("http://127.0.0.1:8188")


def test_motion_worker_wires_guide_frame_count_into_scail_length(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    guide = run_dir / "motion" / "guide.mp4"
    final = run_dir / "video" / "final.mp4"
    guide.parent.mkdir()
    final.parent.mkdir()
    guide.write_bytes(b"guide")
    final.write_bytes(b"final")
    run = {
        "batch_id": "motion_test",
        "run_id": "01_motion",
        "run_dir": str(run_dir),
        "prompt": "walk and wave",
        "duration": 4.0,
        "rewrite": False,
        "seed": 123,
        "cfg_scale": 5.0,
        "width": 480,
        "height": 832,
        "steps": 6,
        "pose_strength": 1.0,
        "status": "queued",
    }
    calls = {"submits": [], "scail_length": None}

    monkeypatch.setattr(s, "MOTION_COMFY_URL", "http://motion-comfy")
    monkeypatch.setattr(s, "build_hymotion_api", lambda motion_run: {"stage": "motion", "prefix": motion_run["prefix"]})

    def fake_build_scail_api(motion_run, guide_name, length):
        calls["scail_length"] = length
        calls["guide_name"] = guide_name
        return {"stage": "video", "prefix": motion_run["prefix"]}

    monkeypatch.setattr(s, "build_scail_api", fake_build_scail_api)

    def fake_http_json(path, payload=None, timeout=30, base_url=None):
        calls["submits"].append((path, payload, base_url))
        return {"prompt_id": f"prompt-{len(calls['submits'])}"}

    monkeypatch.setattr(s, "http_json", fake_http_json)
    monkeypatch.setattr(s, "wait_for_completion", lambda prompt_id, run, base_url=None, timeout_s=1800: None)
    monkeypatch.setattr(s, "video_frame_count", lambda path: 90)

    def fake_copy_outputs(stage_dir, prompt_id, base_url=None):
        return [guide] if prompt_id == "prompt-1" else [final]

    monkeypatch.setattr(s, "copy_outputs", fake_copy_outputs)
    monkeypatch.setattr(s.shutil, "copy2", lambda src, dst: dst.write_bytes(s.Path(src).read_bytes()))

    s.motion_worker(run)

    assert calls["scail_length"] == 89
    assert calls["guide_name"] == "01_motion_guide.mp4"
    assert [call[2] for call in calls["submits"]] == ["http://motion-comfy", "http://motion-comfy"]
    assert run["status"] == "done"
    assert run["guide_video"] == str(guide)
    assert run["video"] == str(final)
