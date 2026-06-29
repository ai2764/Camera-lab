import json
from copy import deepcopy
from pathlib import Path

import pytest

import server.camera_lab_server as server


def _director_node(api):
    return next(n for n in api.values() if n["class_type"] == "LTXDirector")


def _stub_builder_graph(monkeypatch):
    api = {
        "35": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": "ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors"},
        },
        "131": {
            "class_type": "LTXDirector",
            "inputs": {
                "global_prompt": "",
                "duration_frames": 0,
                "duration_seconds": 0,
                "timeline_data": "",
                "local_prompts": "",
                "segment_lengths": "",
                "guide_strength": "",
                "frame_rate": 0,
                "custom_width": 0,
                "custom_height": 0,
                "resize_method": "",
                "divisible_by": 0,
                "img_compression": 0,
                "display_mode": 0,
                "use_custom_audio": False,
            },
        },
        "132": {"class_type": "LTXDirectorGuide", "inputs": {"ic_lora_name": "None", "model": ["131", 0]}},
        "133": {"class_type": "LTXDirectorGuide", "inputs": {"ic_lora_name": "None", "model": ["131", 0]}},
        "200": {"class_type": "SaveVideo", "inputs": {"filename_prefix": ""}},
        "201": {"class_type": "KSampler", "inputs": {"noise_seed": 0}},
    }
    monkeypatch.setattr(server, "workflow_to_api", lambda _workflow: deepcopy(api))


@pytest.fixture
def sample_run():
    return {
        "batch_id": "b1",
        "run_id": "r1",
        "seed": 7,
        "width": 768,
        "height": 512,
        "global_prompt": "a calm seaside town",
        "timeline_segments": [
            {
                "id": "s1",
                "type": "text",
                "prompt": "wide establishing shot",
                "duration": 2.0,
                "start": 0.0,
                "strength": 0.0,
            },
        ],
        "audio_segments": [],
    }


def test_v2_workflow_is_bundled_with_expected_nodes():
    path = Path(server.DIRECTOR_V2_WORKFLOW_PATH)

    assert path.exists(), "v2 workflow must be bundled in workflows/app"
    data = json.loads(path.read_text(encoding="utf-8"))
    types = {n.get("type") for n in data["nodes"]}
    assert "LTXDirector" in types
    assert "UNETLoader" in types
    assert "LTXDirectorCropGuides" in types
    assert "CheckpointLoaderSimple" not in types
    assert "LoraLoaderModelOnly" not in types


def test_v2_workflow_is_registered_and_v1_retired():
    ids = {w["id"] for w in server.WORKFLOWS}

    assert "ltx_director_2" in ids
    assert "ltx_director_reference_mvp" not in ids
    v2 = next(w for w in server.WORKFLOWS if w["id"] == "ltx_director_2")
    assert v2["mode"] == "director_ref"
    assert v2["builder"] == "ltx_director_2"


def test_v2_builder_patches_director_node_and_audio_flags(monkeypatch, sample_run):
    _stub_builder_graph(monkeypatch)
    monkeypatch.setattr(server, "object_info", lambda: {"LTXDirector": {"input": {"required": {}}}})

    api = server.build_ltx_director_v2_api(sample_run)

    director = _director_node(api)
    assert director["inputs"]["overrideAudio"] is False
    assert director["inputs"]["inpaint_audio"] is True
    assert director["inputs"]["use_custom_audio"] is False
    assert director["inputs"]["global_prompt"] == "a calm seaside town"
    assert director["inputs"]["custom_width"] == 768
    assert director["inputs"]["display_mode"] == "seconds"
    timeline = json.loads(director["inputs"]["timeline_data"])
    assert "segments" in timeline
    assert "audioSegments" in timeline
    assert "motionSegments" not in timeline


def test_v2_builder_wires_ic_lora_into_guide_nodes(monkeypatch, sample_run):
    _stub_builder_graph(monkeypatch)
    monkeypatch.setattr(server, "object_info", lambda: {"LTXDirector": {"input": {"required": {}}}})
    run = {**sample_run, "ic_lora_name": "ltxv/ltx2/ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors"}

    api = server.build_ltx_director_v2_api(run)

    guides = [n for n in api.values() if n["class_type"] == "LTXDirectorGuide"]
    assert len(guides) == 2
    assert all(
        g["inputs"]["ic_lora_name"] == "ltxv/ltx2/ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors"
        for g in guides
    )


def test_v2_builder_defaults_ic_lora_to_none(monkeypatch, sample_run):
    _stub_builder_graph(monkeypatch)
    monkeypatch.setattr(server, "object_info", lambda: {"LTXDirector": {"input": {"required": {}}}})

    api = server.build_ltx_director_v2_api(sample_run)

    guides = [n for n in api.values() if n["class_type"] == "LTXDirectorGuide"]
    assert guides and all(g["inputs"]["ic_lora_name"] == "None" for g in guides)


def test_director_ic_loras_filters_to_ic_lora_weights(monkeypatch):
    monkeypatch.setattr(
        server,
        "object_info",
        lambda: {
            "LTXDirectorGuide": {
                "input": {
                    "required": {
                        "ic_lora_name": [
                            [
                                "None",
                                "ltxv/ltx2/ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors",
                                "some_other_lora.safetensors",
                            ],
                            {},
                        ]
                    }
                }
            }
        },
    )

    loras = server.director_ic_loras()

    assert loras[0] == "None"
    assert "ltxv/ltx2/ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors" in loras
    assert "some_other_lora.safetensors" not in loras


def test_director_ic_loras_handles_missing_object_info(monkeypatch):
    def boom():
        raise RuntimeError("comfy down")

    monkeypatch.setattr(server, "object_info", boom)

    assert server.director_ic_loras() == ["None"]


def test_director_ic_loras_reads_optional_input_combo(monkeypatch):
    monkeypatch.setattr(
        server,
        "object_info",
        lambda: {
            "LTXDirectorGuide": {
                "input": {
                    "required": {},
                    "optional": {
                        "ic_lora_name": [
                            [
                                "None",
                                "ltxv\\ltx2\\ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors",
                                "Wan21_CausVid_14B_T2V_lora_rank32.safetensors",
                            ]
                        ]
                    },
                }
            }
        },
    )

    assert server.director_ic_loras() == [
        "None",
        "ltxv\\ltx2\\ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors",
    ]


def test_director_audio_segments_carry_volume():
    segs = server.director_audio_segments_from_payload(
        {
            "audio_segments": [
                {"audio_path": "a.wav", "start": 0, "duration": 1.0, "volume": 0.4},
                {"audio_path": "b.wav", "start": 1.0, "duration": 1.0},
                {"audio_path": "c.wav", "start": 2.0, "duration": 1.0, "volume": 0},
            ]
        }
    )
    assert segs[0]["volume"] == 0.4
    assert segs[1]["volume"] == 1.0  # default when omitted
    assert segs[2]["volume"] == 0.0  # explicit mute is preserved


def test_director_audio_segments_preserve_source_for_video_audio_restore():
    segs = server.director_audio_segments_from_payload(
        {
            "audio_segments": [
                {
                    "id": "video_audio_seg_1",
                    "source": "video",
                    "audio_path": "tasks/camera_lab_uploads/videos/guide.mp4",
                    "start": 0,
                    "duration": 1.0,
                },
                {
                    "id": "aud_dialogue_1",
                    "audio_path": "tts/library/current/line.wav",
                    "start": 1,
                    "duration": 1.0,
                },
            ]
        }
    )

    assert segs[0]["source"] == "video"
    assert "source" not in segs[1]


def test_stage_director_audio_copies_at_unity_gain(tmp_path):
    src = tmp_path / "in.wav"
    src.write_bytes(b"RIFFdata")
    dst = tmp_path / "out.wav"
    calls = []

    server.stage_director_audio(src, dst, 1.0, runner=lambda *a, **k: calls.append(a))

    assert dst.read_bytes() == b"RIFFdata"
    assert calls == []  # no ffmpeg at unity gain


def test_stage_director_audio_applies_ffmpeg_gain(tmp_path):
    src = tmp_path / "in.wav"
    src.write_bytes(b"RIFFdata")
    dst = tmp_path / "out.wav"
    captured = {}

    def fake_runner(cmd, **kwargs):
        captured["cmd"] = cmd
        dst.write_bytes(b"gained")

    server.stage_director_audio(src, dst, 0.5, runner=fake_runner)

    assert "-vn" in captured["cmd"]
    assert any("volume=0.500" in str(part) for part in captured["cmd"])
    assert dst.read_bytes() == b"gained"


def test_v2_builder_keeps_distilled_unet_and_no_lora(monkeypatch, sample_run):
    _stub_builder_graph(monkeypatch)
    monkeypatch.setattr(server, "object_info", lambda: {"LTXDirector": {"input": {"required": {}}}})

    api = server.build_ltx_director_v2_api(sample_run)

    unet = next(n for n in api.values() if n["class_type"] == "UNETLoader")
    assert unet["inputs"]["unet_name"] == "ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors"
    assert not any(n["class_type"] == "LoraLoaderModelOnly" for n in api.values())


def test_v2_builder_sets_custom_audio_when_audio_present(monkeypatch, sample_run):
    _stub_builder_graph(monkeypatch)
    monkeypatch.setattr(server, "object_info", lambda: {"LTXDirector": {"input": {"required": {}}}})
    monkeypatch.setattr(
        server,
        "director_timeline_audio_segments",
        lambda run, timeline: [{"audioFile": "a.wav", "start": 0, "length": 48}],
    )

    api = server.build_ltx_director_v2_api(sample_run)

    director = _director_node(api)
    assert director["inputs"]["use_custom_audio"] is True
    timeline = json.loads(director["inputs"]["timeline_data"])
    assert timeline["audioSegments"] == [{"audioFile": "a.wav", "start": 0, "length": 48}]


def test_v2_builder_maps_main_track_video_guides(monkeypatch, sample_run):
    _stub_builder_graph(monkeypatch)
    monkeypatch.setattr(server, "object_info", lambda: {"LTXDirector": {"input": {"required": {}}}})
    monkeypatch.setattr(
        server,
        "copy_director_timeline_media",
        lambda run, timeline, width, height: {1: {"type": "video", "name": "guide_clip.mp4"}},
    )

    run = {
        **sample_run,
        "timeline_segments": [
            {
                "id": "video_guide",
                "type": "video",
                "prompt": "follow the blocking and camera motion",
                "duration": 2.0,
                "start": 0,
                "video_path": "tasks/camera_lab_uploads/videos/guide_clip.mp4",
                "strength": 0.8,
            }
        ],
    }
    api = server.build_ltx_director_v2_api(run)

    director = _director_node(api)
    timeline = json.loads(director["inputs"]["timeline_data"])
    assert timeline["segments"] == [
        {
            "id": "video_guide",
            "type": "video",
            "label": "segment 1",
            "start": 0,
            "length": 48,
            "prompt": "follow the blocking and camera motion",
            "imageFile": "guide_clip.mp4",
            "trimStart": 0,
            "strength": 0.8,
        }
    ]


def test_v2_builder_maps_ic_video_guides_to_motion_segments(monkeypatch, sample_run):
    _stub_builder_graph(monkeypatch)
    monkeypatch.setattr(server, "object_info", lambda: {"LTXDirector": {"input": {"required": {}}}})
    monkeypatch.setattr(
        server,
        "copy_director_motion_segments",
        lambda run, motion_segments: [
            {
                "id": "ic_ref",
                "type": "motion_video",
                "label": "IC video 1",
                "start": 0,
                "length": 48,
                "videoFile": "ic_reference.mp4",
                "trimStart": 0,
            }
        ],
    )

    run = {
        **sample_run,
        "motion_segments": [
            {
                "id": "ic_ref",
                "type": "motion_video",
                "start": 0,
                "duration": 2,
                "video_path": "tasks/camera_lab_uploads/videos/ic_reference.mp4",
            }
        ],
    }
    api = server.build_ltx_director_v2_api(run)

    director = _director_node(api)
    timeline = json.loads(director["inputs"]["timeline_data"])
    assert timeline["motionSegments"] == [
        {
            "id": "ic_ref",
            "type": "motion_video",
            "label": "IC video 1",
            "start": 0,
            "length": 48,
            "videoFile": "ic_reference.mp4",
            "trimStart": 0,
        }
    ]


def test_v2_builder_maps_retake_video_to_native_timeline_data(monkeypatch, sample_run):
    _stub_builder_graph(monkeypatch)
    monkeypatch.setattr(server, "object_info", lambda: {"LTXDirector": {"input": {"required": {}}}})
    monkeypatch.setattr(server, "copy_director_timeline_media", lambda run, timeline, width, height: {})
    monkeypatch.setattr(server, "director_timeline_audio_segments", lambda run, timeline: [])
    monkeypatch.setattr(server, "copy_director_motion_segments", lambda run, motion_segments: [])
    monkeypatch.setattr(server, "copy_director_retake_video", lambda run, retake_video: "base_retake.mp4")

    run = {
        **sample_run,
        "duration": 6,
        "global_prompt": "keep the existing scene continuous",
        "timeline_segments": [],
        "retake_mode": True,
        "retake_video": {
            "video_path": "tasks/camera_lab_uploads/videos/base.mp4",
            "file_name": "base.mp4",
            "duration": 6,
        },
        "retake_start": 2,
        "retake_length": 1.5,
        "retake_prompt": "replace the middle action",
        "retake_strength": 0.75,
    }

    api = server.build_ltx_director_v2_api(run)

    director = _director_node(api)
    assert director["inputs"]["duration_frames"] == 144
    assert director["inputs"]["segment_lengths"] == "48,36,60"
    assert director["inputs"]["local_prompts"] == (
        "keep the existing scene continuous | replace the middle action | keep the existing scene continuous"
    )
    timeline = json.loads(director["inputs"]["timeline_data"])
    assert timeline["segments"] == []
    assert timeline["audioSegments"] == []
    assert timeline["retakeMode"] is True
    assert timeline["retakeStart"] == 48
    assert timeline["retakeLength"] == 36
    assert timeline["retakePrompt"] == "replace the middle action"
    assert timeline["retakeStrength"] == 0.75
    assert timeline["retakeVideo"] == {
        "fileName": "base.mp4",
        "imageFile": "base_retake.mp4",
        "videoDurationFrames": 144,
    }


def test_director_timeline_from_payload_preserves_video_guides():
    timeline = server.director_timeline_from_payload(
        {
            "timeline_segments": [
                {
                    "id": "video_guide",
                    "type": "video",
                    "prompt": "",
                    "duration": 1.5,
                    "start": 1.0,
                    "video_path": "tasks/camera_lab_uploads/videos/guide_clip.mp4",
                    "strength": 0.6,
                }
            ]
        },
        fps=24,
    )

    assert timeline["segments"][0]["type"] == "video"
    assert timeline["segments"][0]["video_path"] == "tasks/camera_lab_uploads/videos/guide_clip.mp4"
    assert timeline["segments"][0]["image_path"] == ""
    assert timeline["segments"][0]["prompt"] == "visual guide"


def test_director_prompt_summary_allows_media_only_guides():
    summary = server.build_director_prompt_summary(
        {
            "global_prompt": "",
            "timeline_segments": [
                {
                    "id": "video_guide",
                    "prompt": "",
                    "video_path": "tasks/camera_lab_uploads/videos/guide_clip.mp4",
                }
            ],
        }
    )

    assert summary == "visual guide"


def test_director_prompt_summary_allows_ic_video_only_guides():
    summary = server.build_director_prompt_summary(
        {
            "global_prompt": "",
            "timeline_segments": [],
            "motion_segments": [
                {
                    "id": "ic_ref",
                    "type": "motion_video",
                    "video_path": "tasks/camera_lab_uploads/videos/ic_reference.mp4",
                }
            ],
        }
    )

    assert summary == "visual guide"


def test_v2_builder_leaves_global_references_as_placeholder(monkeypatch, sample_run):
    _stub_builder_graph(monkeypatch)
    monkeypatch.setattr(
        server,
        "object_info",
        lambda: {
            "LTXDirector": {
                "input": {
                    "required": {
                        "global_reference_images": ["STRING"],
                        "global_reference_strength": ["FLOAT"],
                    }
                }
            }
        },
    )
    monkeypatch.setattr(
        server,
        "copy_director_reference_images",
        lambda *_args, **_kwargs: pytest.fail("Block 0 must not stage global reference images"),
    )

    run = {**sample_run, "reference_images": ["fixtures/character_front.png"], "global_reference_strength": 0.7}
    api = server.build_ltx_director_v2_api(run)

    director = _director_node(api)
    assert director["inputs"]["global_reference_images"] == ""
    assert director["inputs"]["global_reference_strength"] == 0.0
    assert not any(n["class_type"] == "LTXVAddGuideMulti" for n in api.values())


def test_workflow_status_reports_v2_available_without_lora_patch(monkeypatch):
    monkeypatch.setattr(server, "object_info", lambda: {})
    monkeypatch.setattr(server, "available_models", lambda: {})
    monkeypatch.setattr(
        server,
        "patch_ltx23_local_loras",
        lambda _api: pytest.fail("v2 workflow_status must not patch local LoRAs"),
    )

    v2 = next(w for w in server.WORKFLOWS if w["id"] == "ltx_director_2")
    status = server.workflow_status(v2)

    assert status["available"] is True, status


def test_v1_builder_path_is_removed_from_dispatch():
    src = (server.ROOT / "server" / "camera_lab_server.py").read_text(encoding="utf-8")

    assert 'workflow.get("builder") == "ltx_director_reference_mvp"' not in src
    assert "build_ltx_director_reference_api(run)" not in src
