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


def test_copy_output_records_preserve_bucket_and_type(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    motion_output = tmp_path / "motion_output"
    motion_input = tmp_path / "motion_input"
    motion_output.mkdir()
    motion_input.mkdir()
    (motion_output / "guide_from_images.mp4").write_bytes(b"guide")
    (motion_output / "guide_from_gifs.mp4").write_bytes(b"gif-guide")
    (motion_input / "preview_temp.mp4").write_bytes(b"temp")
    monkeypatch.setattr(s, "COMFY_URL", "http://main-comfy")
    monkeypatch.setattr(s, "MOTION_COMFY_URL", "http://motion-comfy")
    monkeypatch.setattr(s, "COMFY_OUTPUT", tmp_path / "main_output")
    monkeypatch.setattr(s, "MOTION_COMFY_OUTPUT", motion_output)
    monkeypatch.setattr(s, "COMFY_INPUT", tmp_path / "main_input")
    monkeypatch.setattr(s, "MOTION_COMFY_INPUT", motion_input)

    def fake_http_json(path, payload=None, timeout=30, base_url=None):
        assert base_url == "http://motion-comfy"
        return {
            "prompt-guide": {
                "outputs": {
                    "31": {
                        "images": [
                            {"filename": "guide_from_images.mp4", "subfolder": "", "type": "output"},
                            {"filename": "preview_temp.mp4", "subfolder": "", "type": "temp"},
                        ],
                        "gifs": [{"filename": "guide_from_gifs.mp4", "subfolder": "", "type": "output"}],
                    },
                },
            },
        }

    monkeypatch.setattr(s, "http_json", fake_http_json)

    records = s.copy_output_records(run_dir, "prompt-guide", base_url="http://motion-comfy")

    assert [record["path"] for record in records] == [
        str(run_dir / "guide_from_images.mp4"),
        str(run_dir / "preview_temp.mp4"),
        str(run_dir / "guide_from_gifs.mp4"),
    ]
    assert [record["bucket"] for record in records] == ["images", "images", "gifs"]
    assert [record["type"] for record in records] == ["output", "temp", "output"]
    assert [record["media_type"] for record in records] == ["video", "video", "video"]


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


def test_motion_guide_stage_records_all_output_videos(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    guide_a = run_dir / "motion" / "guide_a.mp4"
    guide_b = run_dir / "motion" / "guide_b.webm"
    temp = run_dir / "motion" / "preview_temp.mp4"
    guide_a.parent.mkdir()
    for path in [guide_a, guide_b, temp]:
        path.write_bytes(path.name.encode("utf-8"))
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
    monkeypatch.setattr(s, "MOTION_COMFY_URL", "http://motion-comfy")
    monkeypatch.setattr(s, "build_hymotion_api", lambda motion_run: {"stage": "motion", "prefix": motion_run["prefix"]})
    monkeypatch.setattr(s, "http_json", lambda *_args, **_kwargs: {"prompt_id": "prompt-guide"})
    monkeypatch.setattr(s, "wait_for_completion", lambda prompt_id, run, base_url=None, timeout_s=1800: None)
    monkeypatch.setattr(s, "video_frame_count", lambda path: 90)
    monkeypatch.setattr(
        s,
        "copy_output_records",
        lambda stage_dir, prompt_id, base_url=None: [
            {"path": str(guide_a), "bucket": "images", "type": "output", "media_type": "video"},
            {"path": str(temp), "bucket": "images", "type": "temp", "media_type": "video"},
            {"path": str(guide_b), "bucket": "gifs", "type": "output", "media_type": "video"},
        ],
    )

    s.run_motion_guide_stage(run)

    assert run["guide_video"] == str(guide_a)
    assert run["guide_videos"] == [str(guide_a), str(guide_b)]
    assert [record["type"] for record in run["guide_outputs"]] == ["output", "temp", "output"]
    assert run["copied"] == [str(guide_a), str(temp), str(guide_b)]


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

    def fake_copy_output_records(stage_dir, prompt_id, base_url=None):
        path = guide if prompt_id == "prompt-1" else final
        return [{"path": str(path), "bucket": "images", "type": "output", "media_type": "video"}]

    monkeypatch.setattr(s, "copy_output_records", fake_copy_output_records)
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
    monkeypatch.setattr(
        s,
        "copy_output_records",
        lambda stage_dir, prompt_id, base_url=None: [
            {"path": str(guide), "bucket": "images", "type": "output", "media_type": "video"}
        ],
    )
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
    s.Image.new("RGB", (4, 4), "red").save(reference)
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
    monkeypatch.setattr(
        s,
        "copy_output_records",
        lambda stage_dir, prompt_id, base_url=None: [
            {"path": str(final), "bucket": "images", "type": "output", "media_type": "video"}
        ],
    )
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
    assert run["workflow_mode"] == "motion_scail"
    assert run["workflow_label"] == "SCAIL2"
    assert run["use_pose_video_mask"] is True
    assert run["pose_video_mask_prompt"] == "person"


def test_create_motion_video_batch_can_disable_pose_video_mask(monkeypatch, tmp_path):
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
        "use_pose_video_mask": "false",
    })

    run = batch["runs"][0]
    assert run["use_pose_video_mask"] is False


def test_create_motion_video_batch_records_3d_motion_type(monkeypatch, tmp_path):
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
        "motion_type": "3d",
    })

    run = batch["runs"][0]
    assert run["workflow_id"] == "motion_3d_to_scail"
    assert run["workflow_mode"] == "motion_3d"
    assert run["workflow_label"] == "3D Motion"


def test_create_motion_video_batch_records_guide_trim(monkeypatch, tmp_path):
    guide = tmp_path / "uploads" / "guide.mp4"
    reference = tmp_path / "uploads" / "ref.png"
    guide.parent.mkdir()
    guide.write_bytes(b"guide")
    reference.write_bytes(b"ref")
    monkeypatch.setattr(s, "ROOT", tmp_path)
    monkeypatch.setattr(s, "COMFY_OUTPUT", tmp_path / "comfy_output")
    monkeypatch.setattr(s, "RUN_ROOT", tmp_path / "runs")
    monkeypatch.setattr(s, "write_batch", lambda _batch: None)
    monkeypatch.setattr(s, "video_frame_count", lambda path: 240)

    batch = s.create_motion_video_batch({
        "guide_video_path": str(guide),
        "reference_path": str(reference),
        "guide_trim_start": 1.25,
        "guide_trim_end": 4.75,
        "width": 480,
        "height": 832,
        "seed": 123,
    })

    run = batch["runs"][0]
    assert run["guide_trim_start"] == 1.25
    assert run["guide_trim_end"] == 4.75


def test_text_to_motion_final_randomizes_blank_seed(monkeypatch, tmp_path):
    run = {
        "batch_id": "motion_existing",
        "run_id": "01_motion",
        "run_dir": str(tmp_path / "runs" / "01_motion"),
        "workflow_id": "text_to_motion",
        "workflow_mode": "motion_text",
        "workflow_label": "Motion Guide",
        "guide_video": str(tmp_path / "guide.mp4"),
        "reference_image": str(tmp_path / "ref.png"),
        "width": 480,
        "height": 832,
        "seed": 123,
        "steps": 8,
        "pose_strength": 1.0,
        "cfg_scale": 5.0,
        "duration": 4,
    }
    batch = {"batch_id": "motion_existing", "batch_dir": str(tmp_path), "runs": [run]}
    monkeypatch.setattr(s, "ROOT", tmp_path)
    monkeypatch.setattr(s, "COMFY_OUTPUT", tmp_path / "comfy_output")
    monkeypatch.setattr(s, "BATCHES", {"motion_existing": batch})
    monkeypatch.setattr(s, "write_batch", lambda _batch: None)
    monkeypatch.setattr(s, "validate_seed", lambda value: 987654321 if value in {None, ""} else int(value))

    class NoopThread:
        def __init__(self, *args, **kwargs):
            pass

        def start(self):
            pass

    monkeypatch.setattr(s.threading, "Thread", NoopThread)

    class FakeHandler:
        def read_json(self):
            return {
                "batch_id": "motion_existing",
                "run_id": "01_motion",
                "seed": "",
                "reference_path": str(tmp_path / "ref.png"),
            }

        def send_json(self, payload, status=200):
            self.payload = payload
            self.status = status

    handler = FakeHandler()
    s.Handler.handle_text_to_motion_final(handler)

    assert run["seed"] == 987654321


def test_run_motion_final_stage_trims_guide_before_scail(monkeypatch, tmp_path):
    run_dir = tmp_path / "run"
    guide = run_dir / "motion" / "guide.mp4"
    final = run_dir / "video" / "final.mp4"
    reference = tmp_path / "ref.png"
    guide.parent.mkdir(parents=True)
    final.parent.mkdir()
    guide.write_bytes(b"guide")
    final.write_bytes(b"final")
    s.Image.new("RGB", (4, 4), "red").save(reference)
    run = {
        "batch_id": "motion_test",
        "run_id": "01_motion",
        "run_dir": str(run_dir),
        "guide_video": str(guide),
        "guide_trim_start": 1.0,
        "guide_trim_end": 2.5,
        "reference_image": str(reference),
        "prompt": "walk and wave",
        "duration": 1.5,
        "rewrite": False,
        "seed": 123,
        "cfg_scale": 5.0,
        "width": 480,
        "height": 832,
        "steps": 6,
        "pose_strength": 1.0,
        "status": "guide_done",
    }
    calls = {"ffmpeg": None, "guide_name": None, "length": None}
    monkeypatch.setattr(s, "MOTION_COMFY_INPUT", tmp_path / "motion_input")
    monkeypatch.setattr(s, "MOTION_COMFY_URL", "http://motion-comfy")
    monkeypatch.setattr(s, "video_frame_count", lambda path: 36 if "trim" in str(path) else 240)
    monkeypatch.setattr(s, "wait_for_completion", lambda prompt_id, run, base_url=None, timeout_s=1800: None)
    monkeypatch.setattr(
        s,
        "copy_output_records",
        lambda stage_dir, prompt_id, base_url=None: [
            {"path": str(final), "bucket": "images", "type": "output", "media_type": "video"}
        ],
    )
    monkeypatch.setattr(s, "make_contact_sheet", lambda *_args, **_kwargs: None)

    def fake_run(cmd, **kwargs):
        calls["ffmpeg"] = cmd
        s.Path(cmd[-1]).write_bytes(b"trimmed")
        return None

    monkeypatch.setattr(s.subprocess, "run", fake_run)
    monkeypatch.setattr(s, "http_json", lambda *_args, **_kwargs: {"prompt_id": "prompt-final"})

    def fake_build_scail_api(motion_run, guide_name, length):
        calls["guide_name"] = guide_name
        calls["length"] = length
        return {"stage": "video"}

    monkeypatch.setattr(s, "build_scail_api", fake_build_scail_api)

    s.run_motion_final_stage(run)

    assert calls["ffmpeg"][0] == "ffmpeg"
    assert "-ss" in calls["ffmpeg"]
    assert "-t" in calls["ffmpeg"]
    assert calls["guide_name"].endswith("_guide_trim.mp4")
    assert calls["length"] == 33
    assert run["guide_trimmed_video"].endswith("guide_trim.mp4")


def test_prepare_scail_reference_preserves_alpha_as_mask(tmp_path):
    reference = tmp_path / "ref.png"
    image = s.Image.new("RGBA", (4, 4), (255, 255, 255, 0))
    for x in range(1, 3):
        for y in range(1, 3):
            image.putpixel((x, y), (20, 40, 80, 255))
    image.save(reference)

    input_dir = tmp_path / "motion_input"
    prepared = s.prepare_scail_reference_assets(reference, input_dir, "01_motion_ref.png")

    assert prepared["reference_name"] == "01_motion_ref.png"
    assert prepared["reference_mask_name"] == "01_motion_ref_mask.png"
    ref_rgb = s.Image.open(input_dir / prepared["reference_name"]).convert("RGB")
    mask_rgb = s.Image.open(input_dir / prepared["reference_mask_name"]).convert("RGB")
    assert ref_rgb.getpixel((0, 0)) == (127, 127, 127)
    assert ref_rgb.getpixel((1, 1)) == (20, 40, 80)
    assert mask_rgb.getpixel((0, 0)) == (0, 0, 0)
    assert mask_rgb.getpixel((1, 1)) == (255, 255, 255)


def test_motion_guide_upload_suffixes_include_gif_and_webp():
    assert ".gif" in s.MOTION_GUIDE_UPLOAD_SUFFIXES
    assert ".webp" in s.MOTION_GUIDE_UPLOAD_SUFFIXES
    assert ".mp4" in s.MOTION_GUIDE_UPLOAD_SUFFIXES
    assert ".gif" not in s.VIDEO_UPLOAD_SUFFIXES


def test_upload_video_motion_guide_flag_reads_query():
    assert s.upload_video_motion_guide_flag("/api/upload-video?motion_guide=1") is True
    assert s.upload_video_motion_guide_flag("/api/upload-video?motion_guide=true") is True
    assert s.upload_video_motion_guide_flag("/api/upload-video") is False


def test_request_path_strips_query_string():
    assert s.request_path("/api/upload-video?motion_guide=1") == "/api/upload-video"
    assert s.request_path("/api/upload-video") == "/api/upload-video"


def test_normalize_motion_guide_video_converts_gif(tmp_path, monkeypatch):
    guide = tmp_path / "walk.gif"
    guide.write_bytes(b"gif")
    output = tmp_path / "converted" / "walk_guide.mp4"
    calls = {}

    def fake_convert(source, dest, *, runner=None):
        calls["source"] = source
        calls["dest"] = dest
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"mp4")
        return dest

    monkeypatch.setattr(s, "convert_motion_guide_image_to_mp4", fake_convert)

    converted = s.normalize_motion_guide_video(guide, tmp_path / "converted")

    assert converted == output
    assert calls["source"] == guide


def test_normalize_motion_guide_video_passthrough_for_mp4(tmp_path):
    guide = tmp_path / "walk.mp4"
    guide.write_bytes(b"mp4")
    assert s.normalize_motion_guide_video(guide, tmp_path / "converted") == guide


def test_convert_motion_guide_image_to_mp4_runs_ffmpeg(tmp_path, monkeypatch):
    source = tmp_path / "pose.webp"
    output = tmp_path / "pose.mp4"
    source.write_bytes(b"webp")
    calls = {}

    def fake_run(cmd, **kwargs):
        calls["cmd"] = cmd
        output.write_bytes(b"mp4")
        return None

    result = s.convert_motion_guide_image_to_mp4(source, output, runner=fake_run)

    assert result == output
    assert calls["cmd"][0] == "ffmpeg"
    assert str(source) in calls["cmd"]
    assert str(output) in calls["cmd"]


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
