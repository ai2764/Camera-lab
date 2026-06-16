import server.camera_lab_server as s


def motion_run(**overrides):
    run = {
        "prompt": "A person walks forward, stops, and waves.",
        "duration": 4.0,
        "seed": 123,
        "cfg_scale": 4.5,
        "width": 480,
        "height": 832,
        "steps": 6,
        "pose_strength": 0.85,
        "prefix": "motion/test_guide",
    }
    run.update(overrides)
    return run


def test_rewrite_motion_prompt_happy_path(monkeypatch):
    monkeypatch.setattr(s, "llm_chat", lambda *_args, **_kwargs: '{"duration": 120, "short_caption": "X walks."}')

    result = s.rewrite_motion_prompt("anything")

    assert result == ("X walks.", 4.0)


def test_rewrite_motion_prompt_malformed_reply_falls_back(monkeypatch):
    monkeypatch.setattr(s, "llm_chat", lambda *_args, **_kwargs: "not json at all")

    result = s.rewrite_motion_prompt("orig text")

    assert result == ("orig text", 4.0)


def test_rewrite_motion_prompt_llm_unavailable_falls_back(monkeypatch):
    def raise_error(*_args, **_kwargs):
        raise RuntimeError("LLM unavailable")

    monkeypatch.setattr(s, "llm_chat", raise_error)

    result = s.rewrite_motion_prompt("orig text")

    assert result == ("orig text", 4.0)


def test_build_hymotion_api_uses_literal_prompt_and_manual_duration_when_rewrite_false(monkeypatch):
    def fail_rewrite(*_args, **_kwargs):
        raise AssertionError("rewrite should not be called when disabled")

    monkeypatch.setattr(s, "rewrite_motion_prompt", fail_rewrite)

    api = s.build_hymotion_api(motion_run(rewrite=False), template_path=s.ROOT / "workflows" / "app" / "hymotion_guide.api.json")

    assert api["10"]["inputs"]["text"] == "A person walks forward, stops, and waves."
    assert api["5"]["inputs"]["duration"] == 4.0
    assert api["5"]["inputs"]["seed"] == 123
    assert api["5"]["inputs"]["cfg_scale"] == 4.5
    assert api["31"]["inputs"]["filename_prefix"] == "motion/test_guide"


def test_build_scail_api_patches_guide_and_video_settings():
    api = s.build_scail_api(
        motion_run(prefix="motion/test_scail"),
        guide_name="hymotion_walk_wave_guide.mp4",
        length=89,
        template_path=s.ROOT / "workflows" / "app" / "scail2_video.api.json",
    )

    assert api["11"]["inputs"]["file"] == "hymotion_walk_wave_guide.mp4"
    assert api["13"]["inputs"]["width"] == 480
    assert api["13"]["inputs"]["height"] == 832
    assert api["13"]["inputs"]["length"] == 89
    assert api["13"]["inputs"]["pose_strength"] == 0.85
    assert api["14"]["inputs"]["seed"] == 123
    assert api["14"]["inputs"]["steps"] == 6
    assert api["14"]["inputs"]["cfg"] == 1
    assert api["17"]["inputs"]["filename_prefix"] == "motion/test_scail"


def test_build_hymotion_api_defaults_rewrite_off(monkeypatch):
    def fail_rewrite(*_args, **_kwargs):
        raise AssertionError("rewrite should not be called by default")

    monkeypatch.setattr(s, "rewrite_motion_prompt", fail_rewrite)

    api = s.build_hymotion_api(motion_run(), template_path=s.ROOT / "workflows" / "app" / "hymotion_guide.api.json")

    assert api["10"]["inputs"]["text"] == "A person walks forward, stops, and waves."
    assert api["5"]["inputs"]["duration"] == 4.0


def test_build_hymotion_api_uses_rewrite_when_enabled(monkeypatch):
    monkeypatch.setattr(s, "rewrite_motion_prompt", lambda text, default_duration: ("REWRITTEN", 6.5))

    api = s.build_hymotion_api(motion_run(rewrite=True), template_path=s.ROOT / "workflows" / "app" / "hymotion_guide.api.json")

    assert api["10"]["inputs"]["text"] == "REWRITTEN"
    assert api["5"]["inputs"]["duration"] == 6.5
    assert api["5"]["inputs"]["seed"] == 123
    assert api["5"]["inputs"]["cfg_scale"] == 4.5
    assert api["31"]["inputs"]["filename_prefix"] == "motion/test_guide"
