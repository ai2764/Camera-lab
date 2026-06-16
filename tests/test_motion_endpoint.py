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


def test_copy_outputs_uses_motion_output_root(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    motion_output = tmp_path / "motion_output"
    motion_output.mkdir()
    (motion_output / "guide.mp4").write_bytes(b"guide")
    monkeypatch.setattr(s, "COMFY_URL", "http://main-comfy")
    monkeypatch.setattr(s, "MOTION_COMFY_URL", "http://motion-comfy")
    monkeypatch.setattr(s, "COMFY_OUTPUT", tmp_path / "main_output")
    monkeypatch.setattr(s, "MOTION_COMFY_OUTPUT", motion_output)
    monkeypatch.setattr(s, "COMFY_INPUT", tmp_path / "main_input")
    monkeypatch.setattr(s, "MOTION_COMFY_INPUT", tmp_path / "motion_input")

    def fake_http_json(path, payload=None, timeout=30, base_url=None):
        assert base_url == "http://motion-comfy"
        return {
            "prompt-guide": {
                "outputs": {
                    "31": {
                        "videos": [{"filename": "guide.mp4", "subfolder": "", "type": "output"}],
                    },
                },
            },
        }

    monkeypatch.setattr(s, "http_json", fake_http_json)

    copied = s.copy_outputs(run_dir, "prompt-guide", base_url="http://motion-comfy")

    assert copied == [run_dir / "guide.mp4"]
    assert copied[0].read_bytes() == b"guide"


def test_public_workflows_marks_status_errors_unavailable(monkeypatch):
    monkeypatch.setattr(s, "WORKFLOWS", [{"id": "broken", "label": "Broken", "path": "missing.json"}])
    monkeypatch.setattr(s, "workflow_status", lambda workflow: (_ for _ in ()).throw(RuntimeError("Comfy offline")))

    workflows = s.public_workflows()

    assert workflows[0]["id"] == "broken"
    assert workflows[0]["available"] is False
    assert workflows[0]["reason"] == "Comfy offline"


def test_public_workflows_can_skip_status_checks(monkeypatch):
    monkeypatch.setattr(s, "WORKFLOWS", [{"id": "offline", "label": "Offline", "path": "missing.json"}])
    monkeypatch.setattr(s, "workflow_status", lambda workflow: (_ for _ in ()).throw(AssertionError("should not probe")))

    workflows = s.public_workflows(unavailable_reason="ComfyUI port is not reachable")

    assert workflows[0]["available"] is False
    assert workflows[0]["reason"] == "ComfyUI port is not reachable"


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


def test_motion_guide_worker_stops_after_guide(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    guide = run_dir / "motion" / "guide.mp4"
    guide.parent.mkdir()
    guide.write_bytes(b"guide")
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
    batch = {"batch_id": "motion_test", "batch_dir": str(tmp_path), "runs": [run], "status": "queued"}
    calls = {"build_scail": 0, "submits": []}

    monkeypatch.setattr(s, "MOTION_COMFY_URL", "http://motion-comfy")
    monkeypatch.setattr(s, "build_hymotion_api", lambda motion_run: {"stage": "motion", "prefix": motion_run["prefix"]})

    def fail_build_scail(*_args, **_kwargs):
        calls["build_scail"] += 1
        raise AssertionError("guide-only worker should not build SCAIL")

    monkeypatch.setattr(s, "build_scail_api", fail_build_scail)

    def fake_http_json(path, payload=None, timeout=30, base_url=None):
        calls["submits"].append((path, payload, base_url))
        return {"prompt_id": "prompt-guide"}

    monkeypatch.setattr(s, "http_json", fake_http_json)
    monkeypatch.setattr(s, "wait_for_completion", lambda prompt_id, run, base_url=None, timeout_s=1800: None)
    monkeypatch.setattr(s, "video_frame_count", lambda path: 90)
    monkeypatch.setattr(s, "copy_outputs", lambda stage_dir, prompt_id, base_url=None: [guide])
    monkeypatch.setattr(s, "write_batch", lambda _batch: None)

    s.motion_guide_worker(run, batch)

    assert calls["build_scail"] == 0
    assert calls["submits"][0][2] == "http://motion-comfy"
    assert run["status"] == "guide_done"
    assert run["guide_video"] == str(guide)
    assert run["scail_length"] == 89
    assert "video" not in run
    assert batch["status"] == "done"


def test_motion_final_worker_reuses_existing_guide(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    guide = run_dir / "motion" / "guide.mp4"
    final = run_dir / "video" / "final.mp4"
    reference = tmp_path / "ref.png"
    guide.parent.mkdir(parents=True)
    final.parent.mkdir()
    guide.write_bytes(b"guide")
    final.write_bytes(b"final")
    reference.write_bytes(b"ref")
    run = {
        "batch_id": "motion_test",
        "run_id": "01_motion",
        "run_dir": str(run_dir),
        "guide_video": str(guide),
        "reference_image": str(reference),
        "prompt": "walk and wave",
        "duration": 4.0,
        "rewrite": False,
        "seed": 123,
        "cfg_scale": 5.0,
        "width": 480,
        "height": 832,
        "steps": 6,
        "pose_strength": 1.0,
        "scail_length": 89,
        "status": "guide_done",
    }
    batch = {"batch_id": "motion_test", "batch_dir": str(tmp_path), "runs": [run], "status": "done"}
    calls = {"guide_name": None, "length": None, "submits": []}

    monkeypatch.setattr(s, "MOTION_COMFY_URL", "http://motion-comfy")

    def fake_build_scail_api(motion_run, guide_name, length):
        calls["guide_name"] = guide_name
        calls["length"] = length
        return {"stage": "video", "prefix": motion_run["prefix"]}

    monkeypatch.setattr(s, "build_scail_api", fake_build_scail_api)

    def fake_http_json(path, payload=None, timeout=30, base_url=None):
        calls["submits"].append((path, payload, base_url))
        return {"prompt_id": "prompt-final"}

    monkeypatch.setattr(s, "http_json", fake_http_json)
    monkeypatch.setattr(s, "wait_for_completion", lambda prompt_id, run, base_url=None, timeout_s=1800: None)
    monkeypatch.setattr(s, "copy_outputs", lambda stage_dir, prompt_id, base_url=None: [final])
    motion_input = tmp_path / "motion_input"
    copy_dests = []
    monkeypatch.setattr(s, "MOTION_COMFY_INPUT", motion_input)

    def fake_copy2(src, dst):
        copy_dests.append(s.Path(dst))
        s.Path(dst).write_bytes(s.Path(src).read_bytes())

    monkeypatch.setattr(s.shutil, "copy2", fake_copy2)
    monkeypatch.setattr(s, "make_contact_sheet", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(s, "write_batch", lambda _batch: None)

    s.motion_final_worker(run, batch)

    assert calls["guide_name"] == "01_motion_guide.mp4"
    assert calls["length"] == 89
    assert calls["submits"][0][2] == "http://motion-comfy"
    assert copy_dests == [motion_input / "01_motion_guide.mp4", motion_input / "01_motion_ref.png"]
    assert run["status"] == "done"
    assert run["video"] == str(final)
    assert batch["status"] == "done"


def test_create_motion_video_batch_uses_uploaded_guide(monkeypatch, tmp_path):
    guide = tmp_path / "uploads" / "guide.mp4"
    reference = tmp_path / "uploads" / "ref.png"
    run_root = tmp_path / "runs"
    guide.parent.mkdir()
    guide.write_bytes(b"guide")
    reference.write_bytes(b"ref")
    monkeypatch.setattr(s, "ROOT", tmp_path)
    monkeypatch.setattr(s, "COMFY_OUTPUT", tmp_path / "comfy_output")
    monkeypatch.setattr(s, "RUN_ROOT", run_root)
    monkeypatch.setattr(s, "write_batch", lambda _batch: None)
    monkeypatch.setattr(s, "video_frame_count", lambda path: 94)

    batch = s.create_motion_video_batch({
        "guide_video_path": str(guide),
        "reference_path": str(reference),
        "width": 480,
        "height": 832,
        "steps": 8,
        "pose_strength": 0.7,
        "seed": 123,
    })

    run = batch["runs"][0]
    assert run["guide_video"] == str(guide.resolve())
    assert run["reference_image"] == str(reference.resolve())
    assert run["scail_length"] == 93
    assert run["status"] == "guide_done"
    assert run["workflow_id"] == "uploaded_motion_to_scail"


def test_create_motion_guide_batch_allows_missing_reference(monkeypatch, tmp_path):
    monkeypatch.setattr(s, "RUN_ROOT", tmp_path / "runs")
    monkeypatch.setattr(s, "write_batch", lambda _batch: None)

    batch = s.Handler.create_motion_batch(object(), {
        "prompt": "walk forward",
        "duration": 4,
        "width": 480,
        "height": 832,
        "seed": 123,
    }, require_reference=False)

    run = batch["runs"][0]
    assert run["prompt"] == "walk forward"
    assert run["reference_image"] == ""
    assert run["status"] == "queued"
