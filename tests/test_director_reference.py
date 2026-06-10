import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from server import camera_lab_server as server


class DirectorReferenceTests(unittest.TestCase):
    def test_comfy_config_auto_detects_existing_default_comfyui_root(self):
        env = {}

        config = server.comfy_config_from_env(env)

        self.assertTrue(config["root"].exists() or config["root"] == Path("ComfyUI"))

    def test_comfy_config_uses_comfyui_root_and_url_from_environment(self):
        root = Path(tempfile.gettempdir()) / "camera_lab_test_comfy"
        env = {
            "COMFYUI_ROOT": str(root),
            "COMFYUI_URL": "http://127.0.0.1:8188",
        }

        config = server.comfy_config_from_env(env)

        self.assertEqual(config["url"], "http://127.0.0.1:8188")
        self.assertEqual(config["input"], root / "input")
        self.assertEqual(config["output"], root / "output")
        self.assertEqual(config["models"], root / "models")
        self.assertEqual(config["workflows"], root / "user" / "default" / "workflows")
        self.assertEqual(
            config["template_workflows"],
            root
            / ".venv"
            / "Lib"
            / "site-packages"
            / "comfyui_workflow_templates_media_video"
            / "templates",
        )
        self.assertEqual(config["ttp_toolset"], root / "custom_nodes" / "Comfyui_TTP_Toolset")

    def test_dotenv_loader_does_not_override_existing_environment(self):
        with tempfile.TemporaryDirectory() as tmp:
            dotenv = Path(tmp) / ".env"
            dotenv.write_text(
                "\n".join(
                    [
                        "COMFYUI_ROOT=ComfyUIFromFile",
                        "COMFYUI_URL=http://127.0.0.1:8188",
                    ]
                ),
                encoding="utf-8",
            )
            env = {"COMFYUI_ROOT": "ExistingComfyUI"}

            loaded = server.load_env_file(dotenv, env)

            self.assertEqual(loaded["COMFYUI_ROOT"], "ExistingComfyUI")
            self.assertEqual(loaded["COMFYUI_URL"], "http://127.0.0.1:8188")

    def test_runexx_length_primitive_stays_in_seconds(self):
        workflow = next(item for item in server.WORKFLOWS if item["id"] == "fml_runexx_guider_local")
        api = server.workflow_to_api(json.loads(server.Path(workflow["path"]).read_text(encoding="utf-8")))
        run = {
            "prompt": "walks",
            "negative_prompt": "",
            "duration": 4,
            "width": 1280,
            "height": 720,
            "batch_id": "dry",
            "run_id": "01_runexx",
            "seed": "123",
        }

        server.patch_api(api, workflow, run, {"source": "source.png", "middle": "middle.png", "end": "end.png"})

        self.assertEqual(api["2078"]["class_type"], "INTConstant")
        self.assertEqual(api["2078"]["_meta"]["title"], "LENGTH (in seconds)")
        self.assertEqual(api["2078"]["inputs"]["value"], 4)

    def test_camera_lab_i2v_uses_nag_extendcrop_workflow(self):
        workflow = next(item for item in server.WORKFLOWS if item["id"] == "i2v_official_local")

        path = server.Path(workflow["path"])

        self.assertEqual(workflow["mode"], "i2v")
        self.assertEqual(path.parent.name, "app")
        self.assertEqual(path.name, "ltx23_i2v_subtitle_cleaner_nag_extend.json")

    def test_dropdown_json_workflows_are_checked_in_app_workflows(self):
        expected_paths = {
            "i2v_official_local": "ltx23_i2v_subtitle_cleaner_nag_extend.json",
            "flf_ttp_control": "ltx23_flf_subtitle_cleaner_nag_extend.json",
            "fml_two_segment_flf": "ltx23_flf_subtitle_cleaner_nag_extend.json",
            "fml_runexx_guider_local": "LTX-2.3_FML2V_RuneXX_guider.local.json",
            "ia2v_extendcrop": "ltx23_nag_ia2v_extendcrop_general.json",
            "flf_ia2v": "ltx23_flf_ia2v_nag_extend.json",
            "ltx_director_reference_mvp": "ltx_director_reference_mvp.json",
        }
        expected_builders: dict[str, str] = {}

        for workflow in server.WORKFLOWS:
            if workflow["id"] in expected_paths:
                path = server.Path(workflow["path"])
                self.assertEqual(path.parent, server.APP_WORKFLOW_ROOT)
                self.assertEqual(path.name, expected_paths[workflow["id"]])
                self.assertTrue(path.exists())
            elif workflow["id"] in expected_builders:
                self.assertEqual(workflow.get("builder"), expected_builders[workflow["id"]])
                self.assertNotIn("path", workflow)
            else:
                self.fail(f"Unexpected workflow in dropdown: {workflow['id']}")

    def test_dependency_manifest_matches_dropdown_workflows(self):
        manifest = json.loads((server.ROOT / "dependency-manifest.json").read_text(encoding="utf-8"))
        manifest_workflows = {item["id"]: item for item in manifest["workflow_dropdown"]}

        self.assertEqual(set(manifest_workflows), {workflow["id"] for workflow in server.WORKFLOWS})
        for workflow in server.WORKFLOWS:
            item = manifest_workflows[workflow["id"]]
            self.assertEqual(item["label"], workflow["label"])
            self.assertEqual(item["mode"], workflow["mode"])
            if workflow.get("path"):
                relative_path = str(server.Path(workflow["path"]).relative_to(server.ROOT)).replace("\\", "/")
                self.assertEqual(item["source"], relative_path)
            else:
                self.assertEqual(item["source"], f"server builder: {workflow['builder']}")

    def test_dependency_manifest_setup_scripts_exist(self):
        manifest = json.loads((server.ROOT / "dependency-manifest.json").read_text(encoding="utf-8"))
        script_commands = [
            "agent_setup",
            "check_setup",
            "install_workflows",
            "start",
            "stop",
            "windows_agent_setup",
            "windows_check_setup",
            "windows_install_workflows",
            "windows_start",
            "windows_stop",
        ]

        for key in script_commands:
            command = manifest["commands"][key]
            script = next(part for part in command.split() if part.startswith("scripts/") or part.startswith(".\\scripts\\"))
            normalized = script.removeprefix(".\\").replace("\\", "/")
            self.assertTrue((server.ROOT / normalized).exists(), f"{key} points to missing script {script}")

    def test_nag_i2v_keeps_fixed_anti_text_prompt_and_inplace_strengths(self):
        workflow = next(item for item in server.WORKFLOWS if item["id"] == "i2v_official_local")
        api = server.workflow_to_api(json.loads(server.Path(workflow["path"]).read_text(encoding="utf-8")))
        fixed_nag_prompt = api["340"]["inputs"]["text"]
        strengths = {
            node_id: node["inputs"].get("strength")
            for node_id, node in api.items()
            if node["class_type"] == "LTXVImgToVideoInplace"
        }
        run = {
            "prompt": "cinematic shot",
            "negative_prompt": "custom negative",
            "duration": 4,
            "width": 1280,
            "height": 720,
            "batch_id": "dry",
            "run_id": "01_i2v",
            "seed": "123",
        }

        server.patch_api(api, workflow, run, {"source": "source.png"})

        self.assertEqual(api["340"]["inputs"]["text"], fixed_nag_prompt)
        self.assertEqual(
            {
                node_id: node["inputs"].get("strength")
                for node_id, node in api.items()
                if node["class_type"] == "LTXVImgToVideoInplace"
            },
            strengths,
        )

    def test_director_timeline_normalizes_segments_and_references(self):
        payload = {
            "global_prompt": "same white mecha, same hangar",
            "segments": [
                {
                    "prompt": "walks toward the ship",
                    "duration": 2.0,
                    "reference": "character",
                    "guide_frame": 0,
                    "strength": 0.8,
                },
                {
                    "prompt": "sits in cockpit",
                    "duration": 3.0,
                    "reference": "prop",
                    "guide_frame": 48,
                    "strength": 0.45,
                },
            ],
            "reference_images": {
                "character": "fixtures/character.png",
                "prop": "fixtures/ship.png",
            },
        }

        timeline = server.director_timeline_from_payload(payload, fps=24)

        self.assertEqual(timeline["global_prompt"], "same white mecha, same hangar")
        self.assertEqual(timeline["local_prompts"], "walks toward the ship | sits in cockpit")
        self.assertEqual(timeline["segment_lengths"], "48,72")
        self.assertEqual(timeline["duration_seconds"], 5.0)
        self.assertEqual(timeline["duration_frames"], 120)
        self.assertEqual(timeline["segments"][0]["image_path"], "")
        self.assertEqual(timeline["segments"][0]["reference"], "")
        self.assertEqual(timeline["segments"][1]["reference"], "")
        self.assertEqual(timeline["guide_frames"], [])
        self.assertEqual(timeline["guide_strengths"], [])
        self.assertEqual(timeline["guide_roles"], [])

    def test_director_timeline_keeps_image_guides_without_local_prompt(self):
        payload = {
            "segments": [
                {
                    "prompt": "",
                    "duration": 1.5,
                    "image_path": "fixtures/keyframe.png",
                    "guide_frame": 24,
                    "strength": 0.6,
                },
            ],
        }

        timeline = server.director_timeline_from_payload(payload, fps=24)

        self.assertEqual(timeline["local_prompts"], "visual guide")
        self.assertEqual(timeline["segments"][0]["image_path"], "fixtures/keyframe.png")
        self.assertEqual(timeline["segments"][0]["start_frame"], 0)
        guide_segments = server.director_reference_timeline_segments(timeline, {}, {1: "keyframe.png"})
        self.assertEqual(guide_segments[0]["start"], 24)
        self.assertEqual(guide_segments[0]["imageFile"], "keyframe.png")

    def test_director_global_reference_images_are_encoded_as_global_guides(self):
        run = {
            "batch_id": "dry",
            "run_id": "01_director",
            "workflow_id": "ltx_director_reference_mvp",
            "global_prompt": "same character",
            "segments": [
                {
                    "prompt": "walks",
                    "duration": 1.0,
                    "reference": "character",
                    "image_path": "fixtures/timeline.png",
                    "guide_frame": 0,
                    "strength": 0.75,
                },
            ],
            "reference_images": ["fixtures/character_front.png", "fixtures/character_side.png"],
            "width": 512,
            "height": 512,
            "seed": "123",
            "prompt": "same character | walks",
            "negative_prompt": "",
        }
        original_refs = server.copy_director_reference_images
        original_timeline = server.copy_director_timeline_images
        original_workflow_to_api = server.workflow_to_api
        original_workflow_path = server.DIRECTOR_WORKFLOW_PATH
        server.copy_director_reference_images = lambda _run, _timeline, _width, _height: [
            "dry_reference_01.png",
            "dry_reference_02.png",
        ]
        server.copy_director_timeline_images = lambda _run, _timeline, _width, _height: {1: "dry_timeline.png"}
        server.workflow_to_api = lambda _workflow: {
            "3": {"class_type": "VAELoader", "inputs": {}},
            "46": {
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
                },
            },
            "58": {"class_type": "LTXDirectorGuide", "inputs": {}},
            "77": {
                "class_type": "CFGGuider",
                "inputs": {
                    "model": ["46", 0],
                    "positive": ["58", 0],
                    "negative": ["58", 1],
                    "cfg": 1.0,
                },
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            server.DIRECTOR_WORKFLOW_PATH = Path(tmp) / "director.json"
            server.DIRECTOR_WORKFLOW_PATH.write_text("{}", encoding="utf-8")
            try:
                api = server.build_ltx_director_reference_api(run)
            finally:
                server.copy_director_reference_images = original_refs
                server.copy_director_timeline_images = original_timeline
                server.workflow_to_api = original_workflow_to_api
                server.DIRECTOR_WORKFLOW_PATH = original_workflow_path

        director_inputs = api["46"]["inputs"]
        timeline = json.loads(director_inputs["timeline_data"])
        self.assertEqual(len(timeline["segments"]), 1)
        self.assertEqual(timeline["segments"][0]["id"], "camera-lab-segment-1")
        self.assertEqual(timeline["segments"][0]["imageFile"], "dry_timeline.png")
        self.assertEqual(timeline["segments"][0]["strength"], 0.75)
        self.assertEqual(director_inputs["guide_strength"], "0.75")
        self.assertEqual(api["9001"]["class_type"], "LTXVAddGuideMulti")
        self.assertEqual(api["9001"]["inputs"]["num_guides"], "2")
        self.assertEqual(api["9001"]["inputs"]["num_guides.image_1"], ["9002", 0])
        self.assertEqual(api["9001"]["inputs"]["num_guides.image_2"], ["9003", 0])
        self.assertEqual(api["9001"]["inputs"]["num_guides.frame_idx_1"], 0)
        self.assertEqual(api["9001"]["inputs"]["num_guides.frame_idx_2"], 0)
        self.assertEqual(api["9001"]["inputs"]["num_guides.strength_1"], 0.35)
        self.assertEqual(api["9001"]["inputs"]["num_guides.strength_2"], 0.35)
        self.assertEqual(api["9002"]["inputs"]["image"], "dry_reference_01.png")
        self.assertEqual(api["9003"]["inputs"]["image"], "dry_reference_02.png")
        self.assertEqual(api["77"]["inputs"]["positive"], ["9001", 0])
        self.assertEqual(api["77"]["inputs"]["negative"], ["9001", 1])

    def test_director_custom_audio_patches_concat_audio_latent(self):
        api = {
            "4": {"class_type": "VAELoaderKJ", "inputs": {"vae_name": "audio_vae.safetensors"}},
            "46": {
                "class_type": "LTXDirector",
                "inputs": {
                    "audio_vae": ["4", 0],
                    "duration_seconds": 5.0,
                },
            },
            "7": {
                "class_type": "LTXVConcatAVLatent",
                "inputs": {
                    "video_latent": ["8", 2],
                    "audio_latent": ["46", 3],
                },
            },
        }
        run = {"comfy_audio_name": "dialogue.wav"}

        server.patch_director_custom_audio(api, run)

        load = api["9001"]
        trim = api["9002"]
        encode = api["9003"]
        self.assertEqual(load["class_type"], "LoadAudio")
        self.assertEqual(load["inputs"]["audio"], "dialogue.wav")
        self.assertEqual(trim["class_type"], "TrimAudioDuration")
        self.assertEqual(trim["inputs"]["audio"], ["9001", 0])
        self.assertEqual(trim["inputs"]["start_index"], 0)
        self.assertEqual(trim["inputs"]["duration"], 5.0)
        self.assertEqual(encode["class_type"], "LTXVAudioVAEEncode")
        self.assertEqual(encode["inputs"]["audio"], ["9002", 0])
        self.assertEqual(encode["inputs"]["audio_vae"], ["4", 0])
        self.assertEqual(api["7"]["inputs"]["audio_latent"], ["9003", 0])

    def test_director_without_custom_audio_does_not_patch_concat_audio_latent(self):
        api = {
            "46": {
                "class_type": "LTXDirector",
                "inputs": {
                    "audio_vae": ["4", 0],
                    "duration_seconds": 5.0,
                },
            },
            "7": {
                "class_type": "LTXVConcatAVLatent",
                "inputs": {
                    "video_latent": ["8", 2],
                    "audio_latent": ["46", 3],
                },
            },
        }

        server.patch_director_custom_audio(api, {})

        self.assertEqual(api["7"]["inputs"]["audio_latent"], ["46", 3])
        self.assertNotIn("9001", api)

    def test_global_reference_resize_preserves_full_wide_image_with_padding(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "wide_ref.png"
            dst = Path(tmp) / "wide_ref_out.png"
            img = Image.new("RGB", (300, 100), (0, 200, 0))
            for x in range(0, 100):
                for y in range(100):
                    img.putpixel((x, y), (220, 0, 0))
            for x in range(200, 300):
                for y in range(100):
                    img.putpixel((x, y), (0, 0, 220))
            img.save(src)

            server.resize_contain_pad(src, dst, width=100, height=100)

            out = Image.open(dst).convert("RGB")
            self.assertEqual(out.size, (100, 100))
            self.assertLess(sum(out.getpixel((50, 5))), 10)
            self.assertGreater(out.getpixel((5, 50))[0], 150)
            self.assertGreater(out.getpixel((50, 50))[1], 120)
            self.assertGreater(out.getpixel((95, 50))[2], 150)


def _resolve_latent_dims(api):
    """Evaluate the EmptyLTXVLatentVideo width/height through the SimpleMath graph."""
    node = next(n for n in api.values() if n["class_type"] == "EmptyLTXVLatentVideo")

    def val(ref):
        if not isinstance(ref, list):
            return ref
        target = api[ref[0]]
        ct = target["class_type"]
        ins = target["inputs"]
        if ct in {"PrimitiveInt", "PrimitiveFloat", "INTConstant", "PrimitiveBoolean"}:
            return ins.get("value")
        if ct == "SimpleMath+":
            return eval(ins["value"], {"max": max, "round": round}, {"a": val(ins.get("a")), "b": val(ins.get("b"))})
        if ct == "ComfySwitchNode":
            branch = "on_true" if val(ins.get("switch")) else "on_false"
            return val(ins.get(branch))
        raise AssertionError(f"unexpected dim source {ct}")

    return val(node["inputs"]["width"]), val(node["inputs"]["height"])


class ImageExtensionBypassTests(unittest.TestCase):
    def _patch(self, workflow_id, width, height):
        workflow = next(w for w in server.WORKFLOWS if w["id"] == workflow_id)
        api = server.workflow_to_api(json.loads(Path(workflow["path"]).read_text(encoding="utf-8")))
        run = {
            "width": width,
            "height": height,
            "duration": 4,
            "seed": 1,
            "prompt": "p",
            "negative_prompt": "n",
            "batch_id": "B",
            "run_id": "R",
        }
        names = {"source": "src.png"}
        if workflow["mode"] == "ia2v":
            names["audio"] = "a.mp3"
        else:
            names["end"] = "end.png"
        server.patch_api(api, workflow, run, names)
        return api

    def test_ia2v_latent_dims_follow_requested_size(self):
        api = self._patch("ia2v_extendcrop", 1280, 720)
        lat_w, lat_h = _resolve_latent_dims(api)
        # latent space is half the output resolution on both axes
        self.assertEqual((lat_w, lat_h), (640, 360))

    def test_flf_latent_dims_follow_requested_size(self):
        api = self._patch("flf_ttp_control", 1280, 720)
        lat_w, lat_h = _resolve_latent_dims(api)
        self.assertEqual((lat_w, lat_h), (640, 360))


class FlfAudioTemplateTests(unittest.TestCase):
    def _flf_workflow(self):
        return next(w for w in server.WORKFLOWS if w["id"] == "flf_ttp_control")

    def test_flf_workflow_uses_audio_template_path(self):
        workflow = self._flf_workflow()
        self.assertNotIn("builder", workflow)
        self.assertTrue(workflow["path"].endswith("ltx23_flf_subtitle_cleaner_nag_extend.json"))
        self.assertTrue(Path(workflow["path"]).exists())

    def test_flf_template_adds_last_frame_guides_and_keeps_audio(self):
        workflow = self._flf_workflow()
        api = server.workflow_to_api(json.loads(Path(workflow["path"]).read_text(encoding="utf-8")))
        run = {
            "width": 1280,
            "height": 720,
            "duration": 4,
            "seed": 123,
            "prompt": "a cat",
            "negative_prompt": "bad",
            "batch_id": "B1",
            "run_id": "R1",
        }
        server.patch_api(api, workflow, run, {"source": "src.png", "end": "end.png"})

        add_guides = [n for n in api.values() if n["class_type"] == "LTXVAddGuide"]
        self.assertEqual(len(add_guides), 2)
        # last-frame keyframes
        self.assertTrue(all(n["inputs"].get("frame_idx") == -1 for n in add_guides))
        # both ConcatAVLatent stages now consume an AddGuide latent output
        concat = [n for n in api.values() if n["class_type"] == "LTXVConcatAVLatent"]
        self.assertEqual(len(concat), 2)
        for node in concat:
            origin = node["inputs"]["video_latent"][0]
            self.assertEqual(api[origin]["class_type"], "LTXVAddGuide")
        # audio chain preserved end-to-end
        create_video = next(n for n in api.values() if n["class_type"] == "CreateVideo")
        audio_origin = create_video["inputs"]["audio"][0]
        self.assertEqual(api[audio_origin]["class_type"], "LTXVAudioVAEDecode")

    def test_flf_end_image_is_injected_into_end_loader(self):
        workflow = self._flf_workflow()
        api = server.workflow_to_api(json.loads(Path(workflow["path"]).read_text(encoding="utf-8")))
        run = {
            "width": 1280,
            "height": 720,
            "duration": 4,
            "seed": 1,
            "prompt": "p",
            "negative_prompt": "n",
            "batch_id": "B",
            "run_id": "R",
        }
        server.patch_api(api, workflow, run, {"source": "src.png", "end": "end.png"})

        loaders = {
            str(n.get("_meta", {}).get("title") or "").lower(): n["inputs"].get("image")
            for n in api.values()
            if n["class_type"] == "LoadImage"
        }
        self.assertEqual(loaders.get("upload image"), "src.png")
        self.assertEqual(loaders.get("upload end image"), "end.png")


class FlfIa2vTemplateTests(unittest.TestCase):
    def _workflow(self):
        return next(w for w in server.WORKFLOWS if w["id"] == "flf_ia2v")

    def test_workflow_uses_path_and_combined_mode(self):
        workflow = self._workflow()
        self.assertEqual(workflow["mode"], "flf_ia2v")
        self.assertTrue(workflow["path"].endswith("ltx23_flf_ia2v_nag_extend.json"))
        self.assertTrue(Path(workflow["path"]).exists())

    def test_template_has_last_frame_guides_and_uploaded_audio(self):
        workflow = self._workflow()
        api = server.workflow_to_api(json.loads(Path(workflow["path"]).read_text(encoding="utf-8")))
        run = {
            "width": 1280,
            "height": 720,
            "duration": 4,
            "seed": 1,
            "prompt": "p",
            "negative_prompt": "n",
            "batch_id": "B",
            "run_id": "R",
        }
        server.patch_api(api, workflow, run, {"source": "src.png", "end": "end.png", "audio": "voice.wav"})

        # first+last keyframes
        self.assertEqual(len([n for n in api.values() if n["class_type"] == "LTXVAddGuide"]), 2)
        # uploaded audio drives the chain, not generated SFX
        self.assertEqual([n for n in api.values() if n["class_type"] == "LTXVEmptyLatentAudio"], [])
        load_audio = next(n for n in api.values() if n["class_type"] == "LoadAudio")
        self.assertEqual(load_audio["inputs"]["audio"], "voice.wav")
        # both images injected
        loaders = {
            str(n.get("_meta", {}).get("title") or "").lower(): n["inputs"].get("image")
            for n in api.values()
            if n["class_type"] == "LoadImage"
        }
        self.assertEqual(loaders.get("upload image"), "src.png")
        self.assertEqual(loaders.get("upload end image"), "end.png")

    def test_missing_audio_is_rejected(self):
        workflow = self._workflow()
        api = server.workflow_to_api(json.loads(Path(workflow["path"]).read_text(encoding="utf-8")))
        run = {
            "width": 1280, "height": 720, "duration": 4, "seed": 1,
            "prompt": "p", "negative_prompt": "n", "batch_id": "B", "run_id": "R",
        }
        with self.assertRaises(ValueError):
            server.patch_api(api, workflow, run, {"source": "src.png", "end": "end.png"})


class ByteRangeServeFileTests(unittest.TestCase):
    def _make_handler(self, range_header=None):
        handler = server.Handler.__new__(server.Handler)
        handler.headers = {} if range_header is None else {"Range": range_header}
        captured = {"status": None, "headers": {}, "body": b""}

        class FakeWFile:
            def write(self, data):
                captured["body"] += data

        handler.send_response = lambda status: captured.__setitem__("status", status)
        handler.send_header = lambda key, value: captured["headers"].__setitem__(key, value)
        handler.end_headers = lambda: None
        handler.send_error = lambda status: captured.__setitem__("status", status)
        handler.wfile = FakeWFile()
        return handler, captured

    def test_parse_byte_range_handles_common_specs(self):
        self.assertEqual(server.parse_byte_range("bytes=2-5", 10), (2, 5))
        self.assertEqual(server.parse_byte_range("bytes=4-", 10), (4, 9))
        self.assertEqual(server.parse_byte_range("bytes=-3", 10), (7, 9))
        self.assertEqual(server.parse_byte_range(None, 10), (None, None))
        self.assertEqual(server.parse_byte_range("bytes=20-30", 10), (None, None))

    def test_serve_file_advertises_byte_range_support(self):
        with tempfile.TemporaryDirectory() as tmp:
            clip = Path(tmp) / "clip.mp4"
            clip.write_bytes(b"0123456789")
            handler, captured = self._make_handler()

            handler.serve_file(clip)

            self.assertEqual(captured["status"], 200)
            self.assertEqual(captured["headers"].get("Accept-Ranges"), "bytes")
            self.assertEqual(captured["body"], b"0123456789")

    def test_serve_file_returns_partial_content_for_range_request(self):
        with tempfile.TemporaryDirectory() as tmp:
            clip = Path(tmp) / "clip.mp4"
            clip.write_bytes(b"0123456789")
            handler, captured = self._make_handler("bytes=2-5")

            handler.serve_file(clip)

            self.assertEqual(captured["status"], 206)
            self.assertEqual(captured["headers"].get("Accept-Ranges"), "bytes")
            self.assertEqual(captured["headers"].get("Content-Range"), "bytes 2-5/10")
            self.assertEqual(captured["headers"].get("Content-Length"), "4")
            self.assertEqual(captured["body"], b"2345")


if __name__ == "__main__":
    unittest.main()
