import json
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path

from PIL import Image

from server import camera_lab_server as server


class _ScriptSrcParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []

    def handle_starttag(self, tag, attrs):
        if tag != "script":
            return
        source = dict(attrs).get("src")
        if source:
            self.sources.append(source)


class DirectorReferenceTests(unittest.TestCase):
    def test_main_page_references_existing_3dmotion_bundle(self):
        parser = _ScriptSrcParser()
        parser.feed((server.WEB_DIR / "index.html").read_text(encoding="utf-8"))
        sources = [source for source in parser.sources if source.startswith("/static/3dmotion/")]

        self.assertTrue(sources)
        for source in sources:
            path = server.WEB_DIR / source.removeprefix("/static/")
            self.assertTrue(path.exists(), f"{source} is referenced by frontend/index.html but missing")

    def test_comfy_config_auto_detects_existing_default_comfyui_root(self):
        env = {}

        config = server.comfy_config_from_env(env)

        self.assertTrue(config["root"].exists() or config["root"] == Path("ComfyUI"))

    def test_comfy_status_keeps_online_when_port_is_open_but_stats_is_slow(self):
        def probe(_path, timeout=0):
            raise TimeoutError(f"timed out after {timeout}s")

        status = server.comfy_status(probe=probe, port_probe=lambda _url: True, timeout=2)

        self.assertTrue(status["ok"])
        self.assertIn("system_stats is slow", status["reason"])
        self.assertEqual(status["url"], server.COMFY_URL)

    def test_comfy_status_reports_offline_when_port_is_closed(self):
        status = server.comfy_status(probe=lambda *_args, **_kwargs: {}, port_probe=lambda _url: False)

        self.assertFalse(status["ok"])
        self.assertIn("port is not reachable", status["reason"])
        self.assertEqual(status["url"], server.COMFY_URL)

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

    def test_bernini_workflows_are_registered(self):
        workflows = {workflow["id"]: workflow for workflow in server.WORKFLOWS}
        expected = {
            "bernini_t2v": "bernini_t2v",
            "bernini_t2i": "bernini_t2i",
            "bernini_i2v": "bernini_i2v",
            "bernini_i2i": "bernini_i2i",
            "bernini_v2v": "bernini_v2v",
            "bernini_mv2v": "bernini_mv2v",
            "bernini_vi2v": "bernini_vi2v",
            "bernini_vrc2v": "bernini_vrc2v",
            "bernini_r2v": "bernini_r2v",
            "bernini_r2i": "bernini_r2i",
            "bernini_rv2v": "bernini_rv2v",
            "bernini_ads2v": "bernini_ads2v",
        }

        for workflow_id, mode in expected.items():
            self.assertIn(workflow_id, workflows)
            self.assertEqual(workflows[workflow_id]["mode"], mode)
            self.assertTrue(workflows[workflow_id]["path"].endswith(f"wan22_{workflow_id}.ui.json"))
        self.assertNotIn("bernini_default", workflows)

    def test_inpaint_workflow_is_registered(self):
        workflow = next(item for item in server.WORKFLOWS if item["id"] == "wan_vace_inpaint")

        self.assertEqual(workflow["mode"], "wan_vace_inpaint")
        self.assertTrue(workflow["path"].endswith("wan_vace_inpainting.ui.json"))
        self.assertTrue(Path(workflow["path"]).exists())

    def test_bernini_required_inputs_map(self):
        self.assertEqual(
            server.bernini_required_inputs("bernini_t2v"),
            {
                "source_image": False,
                "reference_image": False,
                "source_video": False,
                "reference_video": False,
            },
        )
        self.assertEqual(server.bernini_required_inputs("bernini_t2i"), server.bernini_required_inputs("bernini_t2v"))
        self.assertTrue(server.bernini_required_inputs("bernini_i2v")["source_image"])
        self.assertTrue(server.bernini_required_inputs("bernini_i2i")["source_image"])
        self.assertTrue(server.bernini_required_inputs("bernini_v2v")["source_video"])
        self.assertTrue(server.bernini_required_inputs("bernini_mv2v")["source_video"])
        self.assertTrue(server.bernini_required_inputs("bernini_vi2v")["source_video"])
        self.assertTrue(server.bernini_required_inputs("bernini_vi2v")["reference_image"])
        self.assertTrue(server.bernini_required_inputs("bernini_vrc2v")["source_video"])
        self.assertTrue(server.bernini_required_inputs("bernini_r2v")["reference_image"])
        self.assertTrue(server.bernini_required_inputs("bernini_r2i")["reference_image"])
        self.assertEqual(
            server.bernini_required_inputs("bernini_rv2v"),
            {
                "source_image": False,
                "reference_image": True,
                "source_video": True,
                "reference_video": False,
            },
        )
        self.assertEqual(
            server.bernini_required_inputs("bernini_ads2v"),
            {
                "source_image": False,
                "reference_image": False,
                "source_video": True,
                "reference_video": True,
            },
        )

    def test_video_upload_suffix_validation(self):
        self.assertTrue(server.is_supported_video_upload("clip.mp4"))
        self.assertTrue(server.is_supported_video_upload("clip.webm"))
        self.assertTrue(server.is_supported_video_upload("clip.mov"))
        self.assertTrue(server.is_supported_video_upload("clip.mkv"))
        self.assertTrue(server.is_supported_video_upload("clip.avi"))
        self.assertFalse(server.is_supported_video_upload("clip.png"))

    def test_validate_bernini_media_paths_requires_expected_media(self):
        image = Path(tempfile.gettempdir()) / "camera_lab_ref.png"
        video = Path(tempfile.gettempdir()) / "camera_lab_source.mp4"

        def fake_safe_media_path(value):
            return Path(value)

        with unittest.mock.patch.object(server, "safe_media_path", side_effect=fake_safe_media_path):
            self.assertEqual(
                server.validate_bernini_media_paths("bernini_t2v", {}),
                {
                    "source": {"path": ""},
                    "reference_image": {"path": ""},
                    "source_video": {"path": ""},
                    "reference_video": {"path": ""},
                },
            )
            with self.assertRaisesRegex(ValueError, "source video is required"):
                server.validate_bernini_media_paths("bernini_v2v", {})
            with self.assertRaisesRegex(ValueError, "reference image is required"):
                server.validate_bernini_media_paths("bernini_r2v", {})
            with self.assertRaisesRegex(ValueError, "reference image is required"):
                server.validate_bernini_media_paths("bernini_vi2v", {"source_video_path": str(video)})
            paths = server.validate_bernini_media_paths(
                "bernini_rv2v",
                {"source_video_path": str(video), "reference_image_path": str(image)},
            )

        self.assertEqual(paths["source_video"]["path"], str(video))
        self.assertEqual(paths["reference_image"]["path"], str(image))

    def test_patch_bernini_api_updates_conditioning_prompt_and_media(self):
        api = {
            "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "old positive"}},
            "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "old negative"}},
            "34": {
                "class_type": "BerniniConditioning",
                "inputs": {
                    "positive": ["3", 0],
                    "negative": ["4", 0],
                    "width": 480,
                    "height": 832,
                    "length": 121,
                    "source_video": ["52", 0],
                    "reference_video": ["53", 0],
                },
            },
            "52": {"class_type": "VHS_LoadVideo", "inputs": {"video": "old.mp4", "frame_load_cap": 121}},
            "53": {"class_type": "VHS_LoadVideo", "inputs": {"video": "old_ref.mp4", "frame_load_cap": 121}},
        }
        run = {"prompt": "new positive", "negative_prompt": "new negative", "width": 720, "height": 1280, "duration": 2}

        server.patch_bernini_api(
            api,
            "bernini_ads2v",
            run,
            {"source_video": "source.mp4", "reference_video": "reference.mp4"},
        )

        self.assertEqual(api["3"]["inputs"]["text"], "You are a helpful assistant specialized in ads insertion. new positive")
        self.assertEqual(api["4"]["inputs"]["text"], "new negative")
        self.assertEqual(api["34"]["inputs"]["width"], 720)
        self.assertEqual(api["34"]["inputs"]["height"], 1280)
        self.assertEqual(api["34"]["inputs"]["length"], 49)
        self.assertEqual(api["52"]["inputs"]["video"], "source.mp4")
        self.assertEqual(api["52"]["inputs"]["frame_load_cap"], 49)
        self.assertEqual(api["53"]["inputs"]["video"], "reference.mp4")
        self.assertEqual(api["53"]["inputs"]["frame_load_cap"], 49)

    def test_patch_bernini_api_keeps_task_prompt_prefix_and_default_negative(self):
        api = {
            "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "old positive"}},
            "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "old negative"}},
        }
        run = {"prompt": "A cat walking through a sunny garden, cinematic", "negative_prompt": "", "width": 480, "height": 832, "duration": 1}

        server.patch_bernini_api(api, "bernini_t2v", run, {})

        self.assertEqual(
            api["3"]["inputs"]["text"],
            "You are a helpful assistant specialized in text-to-video generation. A cat walking through a sunny garden, cinematic",
        )
        self.assertEqual(api["4"]["inputs"]["text"], "bad video")

    def test_patch_bernini_image_modes_use_single_frame_length(self):
        for mode in ("bernini_t2i", "bernini_i2i", "bernini_r2i"):
            with self.subTest(mode=mode):
                api = {
                    "34": {"class_type": "BerniniConditioning", "inputs": {"width": 0, "height": 0, "length": 0}},
                }
                run = {"prompt": "make an image", "negative_prompt": "", "width": 512, "height": 512, "duration": 9}

                server.patch_bernini_api(api, mode, run, {})

                self.assertEqual(api["34"]["inputs"]["length"], 1)

    def test_patch_bernini_video_modes_keep_duration_length(self):
        api = {
            "34": {"class_type": "BerniniConditioning", "inputs": {"width": 0, "height": 0, "length": 0}},
        }
        run = {"prompt": "make a video", "negative_prompt": "", "width": 512, "height": 512, "duration": 4}

        server.patch_bernini_api(api, "bernini_t2v", run, {})

        self.assertEqual(api["34"]["inputs"]["length"], 97)

    def test_bernini_prompt_prefixes_match_workflow_task_notes(self):
        cases = {
            "bernini_mv2v": (
                "change the lighting to warm golden hour",
                "You are a helpful assistant for editing. You might need to adjust the video's style, lighting, colors, textures, and the subject's pose or action. change the lighting to warm golden hour",
            ),
            "bernini_vi2v": (
                "propagate the edit consistently across the whole clip",
                "You are a helpful assistant specialized in video editing on content propagation. propagate the edit consistently across the whole clip",
            ),
            "bernini_vrc2v": (
                "make the subject raise their right hand",
                "You are a helpful assistant for editing. You may need to adjust the subject's action or position. make the subject raise their right hand",
            ),
        }
        for mode, (prompt, expected) in cases.items():
            with self.subTest(mode=mode):
                self.assertEqual(server.bernini_prompt_text(mode, prompt), expected)

    def test_patch_bernini_api_uses_autogrow_reference_image_input(self):
        workflow = next(item for item in server.WORKFLOWS if item["id"] == "bernini_rv2v")
        api = server.workflow_to_api(json.loads(Path(workflow["path"]).read_text(encoding="utf-8")))
        run = {
            "prompt": "replace actor",
            "negative_prompt": "",
            "width": 480,
            "height": 832,
            "duration": 4,
            "bernini_ref_max_size": 1024,
        }

        server.patch_bernini_api(
            api,
            "bernini_rv2v",
            run,
            {"source_video": "source.mp4", "reference_image": "ref.png"},
        )

        bernini_inputs = api["34"]["inputs"]
        self.assertNotIn("reference_images", bernini_inputs)
        self.assertEqual(bernini_inputs["reference_images.reference_image_0"], ["53", 0])
        self.assertEqual(bernini_inputs["ref_max_size"], 1024)
        self.assertEqual(api["53"]["inputs"]["image"], "ref.png")

    def test_patch_bernini_r2v_uses_autogrow_reference_image_input(self):
        workflow = next(item for item in server.WORKFLOWS if item["id"] == "bernini_r2v")
        api = server.workflow_to_api(json.loads(Path(workflow["path"]).read_text(encoding="utf-8")))
        run = {"prompt": "subject dancing", "negative_prompt": "", "width": 480, "height": 832, "duration": 4}

        server.patch_bernini_api(
            api,
            "bernini_r2v",
            run,
            {"reference_image": "ref.png"},
        )

        bernini_inputs = api["34"]["inputs"]
        self.assertNotIn("reference_images", bernini_inputs)
        self.assertEqual(bernini_inputs["reference_images.reference_image_0"], ["52", 0])
        self.assertEqual(api["52"]["inputs"]["image"], "ref.png")

    def test_patch_bernini_vi2v_adds_reference_image_input(self):
        workflow = next(item for item in server.WORKFLOWS if item["id"] == "bernini_vi2v")
        api = server.workflow_to_api(json.loads(Path(workflow["path"]).read_text(encoding="utf-8")))
        run = {"prompt": "propagate edit", "negative_prompt": "", "width": 480, "height": 832, "duration": 4}

        server.patch_bernini_api(
            api,
            "bernini_vi2v",
            run,
            {"source_video": "source.mp4", "reference_image": "guide.png"},
        )

        bernini_inputs = api["34"]["inputs"]
        self.assertEqual(api["55"]["inputs"]["video"], "source.mp4")
        self.assertIn("reference_images.reference_image_0", bernini_inputs)
        image_node = api[str(bernini_inputs["reference_images.reference_image_0"][0])]
        self.assertEqual(image_node["class_type"], "LoadImage")
        self.assertEqual(image_node["inputs"]["image"], "guide.png")

    def test_patch_bernini_api_sets_reference_strength_when_node_supports_it(self):
        api = {
            "34": {
                "class_type": "BerniniConditioning",
                "inputs": {
                    "width": 480,
                    "height": 832,
                    "length": 121,
                    "reference_strength": 0.35,
                },
            },
        }
        run = {
            "prompt": "subject dancing",
            "negative_prompt": "",
            "width": 480,
            "height": 832,
            "duration": 4,
            "global_reference_strength": 0.7,
        }

        server.patch_bernini_api(api, "bernini_r2v", run, {})

        self.assertEqual(api["34"]["inputs"]["reference_strength"], 0.7)

    def test_patch_bernini_api_updates_sampler_noise_seed(self):
        workflow = next(item for item in server.WORKFLOWS if item["id"] == "bernini_rv2v")
        api = server.workflow_to_api(json.loads(Path(workflow["path"]).read_text(encoding="utf-8")))
        run = {
            "prompt": "replace actor",
            "negative_prompt": "",
            "width": 480,
            "height": 832,
            "duration": 4,
            "seed": 123456,
        }

        server.patch_bernini_api(api, "bernini_rv2v", run, {"source_video": "source.mp4", "reference_image": "ref.png"})

        sampler_seeds = [
            node["inputs"]["noise_seed"]
            for node in api.values()
            if node["class_type"] == "SamplerCustom" and "noise_seed" in node["inputs"]
        ]
        self.assertTrue(sampler_seeds)
        self.assertTrue(all(seed == 123456 for seed in sampler_seeds))

    def test_workflow_to_api_expands_nested_subgraphs(self):
        workflow = next(item for item in server.WORKFLOWS if item["id"] == "wan_vace_inpaint")

        api = server.workflow_to_api(json.loads(Path(workflow["path"]).read_text(encoding="utf-8")))
        class_types = {node["class_type"] for node in api.values()}

        self.assertNotIn("bd7f73a0-ec67-4f46-8671-17088d8e31b7", class_types)
        self.assertNotIn("17df2eeb-d89e-46ee-9480-a4ca2494b207", class_types)
        self.assertIn("WanVaceToVideo", class_types)

    def test_patch_inpaint_api_uses_uploaded_mask_and_reference(self):
        workflow = next(item for item in server.WORKFLOWS if item["id"] == "wan_vace_inpaint")
        api = server.workflow_to_api(json.loads(Path(workflow["path"]).read_text(encoding="utf-8")))
        run = {
            "prompt": "Place the product in the painted area.",
            "negative_prompt": "bad video",
            "width": 320,
            "height": 320,
            "duration": 1,
            "seed": 123,
            "batch_id": "batch",
            "run_id": "run",
        }

        server.patch_inpaint_api(
            api,
            run,
            {"source_video": "source.mp4", "reference_image": "ref.png", "mask_image": "mask.png"},
        )

        def node_id_by_type_and_input(class_type, key, value):
            return next(
                node_id
                for node_id, node in api.items()
                if node["class_type"] == class_type and node["inputs"].get(key) == value
            )

        ref_id = node_id_by_type_and_input("LoadImage", "image", "ref.png")
        mask_id = node_id_by_type_and_input("LoadImage", "image", "mask.png")
        image_to_mask_id = next(node_id for node_id, node in api.items() if node["class_type"] == "ImageToMask")
        repeated_mask_id = next(node_id for node_id, node in api.items() if node["class_type"] == "RepeatImageBatch")
        load_video = next(node for node in api.values() if node["class_type"] == "LoadVideo")
        video_components_id = next(node_id for node_id, node in api.items() if node["class_type"] == "GetVideoComponents")
        source_range_id = next(
            node_id
            for node_id, node in api.items()
            if node["class_type"] == "ImageFromBatch" and node["inputs"].get("image") == [video_components_id, 0]
            and node["inputs"].get("batch_index") == 0
            and node["inputs"].get("length") == 25
        )
        source_resize_id = next(
            node_id
            for node_id, node in api.items()
            if node["class_type"] == "ImageScale" and node["inputs"].get("image") == [source_range_id, 0]
        )
        source_masked_id = next(
            node_id
            for node_id, node in api.items()
            if node["class_type"] == "ImageCompositeMasked" and node["inputs"].get("destination") == [source_resize_id, 0]
        )
        image_to_mask = api[image_to_mask_id]
        vace = next(node for node in api.values() if node["class_type"] == "WanVaceToVideo")
        sampler = next(node for node in api.values() if node["class_type"] == "KSampler")
        trim = next(node for node in api.values() if node["class_type"] == "TrimVideoLatent")
        vace_id = next(node_id for node_id, node in api.items() if node["class_type"] == "WanVaceToVideo")

        self.assertEqual(load_video["inputs"]["file"], "source.mp4")
        self.assertEqual(api[repeated_mask_id]["inputs"]["image"], [mask_id, 0])
        self.assertEqual(api[repeated_mask_id]["inputs"]["amount"], 25)
        self.assertEqual(image_to_mask["inputs"]["image"], [repeated_mask_id, 0])
        self.assertEqual(vace["inputs"]["reference_image"], [ref_id, 0])
        self.assertEqual(vace["inputs"]["control_masks"], [image_to_mask_id, 0])
        self.assertEqual(api[source_range_id]["inputs"]["batch_index"], 0)
        self.assertEqual(api[source_range_id]["inputs"]["length"], 25)
        self.assertEqual(api[source_resize_id]["inputs"]["width"], 320)
        self.assertEqual(api[source_resize_id]["inputs"]["height"], 320)
        self.assertEqual(api[source_resize_id]["inputs"]["crop"], "center")
        self.assertEqual(api[source_masked_id]["inputs"]["mask"], [image_to_mask_id, 0])
        self.assertEqual(vace["inputs"]["control_video"], [source_masked_id, 0])
        self.assertEqual(vace["inputs"]["width"], 320)
        self.assertEqual(vace["inputs"]["height"], 320)
        self.assertEqual(vace["inputs"]["length"], 25)
        self.assertEqual(sampler["inputs"]["sampler_name"], "uni_pc")
        self.assertEqual(sampler["inputs"]["scheduler"], "simple")
        self.assertEqual(sampler["inputs"]["denoise"], 1.0)
        self.assertEqual(trim["inputs"]["trim_amount"], [vace_id, 3])

    def test_patch_inpaint_api_allows_prompt_only_without_reference(self):
        workflow = next(item for item in server.WORKFLOWS if item["id"] == "wan_vace_inpaint")
        api = server.workflow_to_api(json.loads(Path(workflow["path"]).read_text(encoding="utf-8")))
        run = {
            "prompt": "Remove the object and rebuild the background.",
            "negative_prompt": "bad video",
            "width": 320,
            "height": 320,
            "duration": 1,
            "seed": 123,
            "batch_id": "batch",
            "run_id": "run",
        }

        server.patch_inpaint_api(
            api,
            run,
            {"source_video": "source.mp4", "mask_image": "mask.png"},
        )

        vace = next(node for node in api.values() if node["class_type"] == "WanVaceToVideo")
        mask_id = next(
            node_id
            for node_id, node in api.items()
            if node["class_type"] == "LoadImage" and node["inputs"].get("image") == "mask.png"
        )
        image_to_mask_id = next(node_id for node_id, node in api.items() if node["class_type"] == "ImageToMask")
        repeated_mask_id = next(node_id for node_id, node in api.items() if node["class_type"] == "RepeatImageBatch")

        self.assertNotIn("reference_image", vace["inputs"])
        self.assertEqual(vace["inputs"]["control_masks"], [image_to_mask_id, 0])
        self.assertEqual(api[repeated_mask_id]["inputs"]["image"], [mask_id, 0])
        self.assertEqual(api[image_to_mask_id]["inputs"]["image"], [repeated_mask_id, 0])

    def test_validate_inpaint_media_paths_reference_is_optional(self):
        source_video = Path(tempfile.gettempdir()) / "camera_lab_source.mp4"
        mask_image = Path(tempfile.gettempdir()) / "camera_lab_mask.png"

        def fake_safe_media_path(value):
            return Path(value)

        with unittest.mock.patch.object(server, "safe_media_path", side_effect=fake_safe_media_path):
            paths = server.validate_inpaint_media_paths(
                {"source_video_path": str(source_video), "mask_image_path": str(mask_image)}
            )

        self.assertEqual(paths["source_video"]["path"], str(source_video))
        self.assertEqual(paths["mask_image"]["path"], str(mask_image))
        self.assertEqual(paths["reference_image"]["path"], "")

    def test_stage_inpaint_inputs_copies_video_reference_and_mask(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_video = root / "source clip.mp4"
            source_video.write_bytes(b"video")
            reference_image = root / "reference.png"
            Image.new("RGB", (64, 64), "red").save(reference_image)
            mask_image = root / "mask.png"
            Image.new("RGB", (64, 64), "white").save(mask_image)
            comfy_input = root / "comfy_input"
            run_dir = root / "run"
            run_dir.mkdir()
            run = {
                "run_id": "01_inpaint",
                "source_video": str(source_video),
                "reference_image": str(reference_image),
                "mask_image": str(mask_image),
            }

            with unittest.mock.patch.object(server, "COMFY_INPUT", comfy_input):
                input_names = server.stage_inpaint_inputs(run, 320, 320, run_dir)

            self.assertEqual(input_names["source_video"], "01_inpaint_source_clip.mp4")
            self.assertEqual(input_names["reference_image"], "01_inpaint_reference.png")
            self.assertEqual(input_names["mask_image"], "01_inpaint_mask.png")
            self.assertTrue((comfy_input / input_names["source_video"]).exists())
            self.assertTrue((comfy_input / input_names["reference_image"]).exists())
            self.assertTrue((comfy_input / input_names["mask_image"]).exists())

    def test_stage_inpaint_inputs_allows_missing_reference(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_video = root / "source clip.mp4"
            source_video.write_bytes(b"video")
            mask_image = root / "mask.png"
            Image.new("RGB", (64, 64), "white").save(mask_image)
            comfy_input = root / "comfy_input"
            run_dir = root / "run"
            run_dir.mkdir()
            run = {
                "run_id": "01_inpaint",
                "source_video": str(source_video),
                "reference_image": "",
                "mask_image": str(mask_image),
            }

            with unittest.mock.patch.object(server, "COMFY_INPUT", comfy_input):
                input_names = server.stage_inpaint_inputs(run, 320, 320, run_dir)

            self.assertEqual(input_names["source_video"], "01_inpaint_source_clip.mp4")
            self.assertEqual(input_names["mask_image"], "01_inpaint_mask.png")
            self.assertNotIn("reference_image", input_names)
            self.assertTrue((comfy_input / input_names["source_video"]).exists())
            self.assertTrue((comfy_input / input_names["mask_image"]).exists())

    def test_history_runs_skips_done_video_runs_when_video_file_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            batch_dir = root / "missing_video_batch"
            batch_dir.mkdir()
            missing_video = batch_dir / "01" / "missing.mp4"
            batch = {
                "batch_id": "missing_video_batch",
                "status": "done",
                "runs": [
                    {
                        "batch_id": "missing_video_batch",
                        "run_id": "01",
                        "workflow_id": "ltx_director_2",
                        "workflow_mode": "director_ref",
                        "workflow_label": "LTX Director Reference V2",
                        "status": "done",
                        "video": str(missing_video),
                        "copied": [str(missing_video)],
                        "finished_at": 1,
                    }
                ],
            }
            (batch_dir / "batch.json").write_text(json.dumps(batch), encoding="utf-8")
            original_run_root = server.RUN_ROOT
            original_history_state = server.HISTORY_STATE
            try:
                server.RUN_ROOT = root
                server.HISTORY_STATE = root / "_history_state.json"
                self.assertEqual(server.history_runs(), [])
            finally:
                server.RUN_ROOT = original_run_root
                server.HISTORY_STATE = original_history_state

    def test_stage_bernini_inputs_copies_images_and_videos(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source_video = root / "source clip.mp4"
            source_video.write_bytes(b"video")
            reference_image = root / "reference.png"
            Image.new("RGB", (64, 64), "red").save(reference_image)
            comfy_input = root / "comfy_input"
            run_dir = root / "run"
            run_dir.mkdir()
            run = {
                "run_id": "01_bernini",
                "workflow_mode": "bernini_rv2v",
                "source_video": str(source_video),
                "reference_image": str(reference_image),
            }

            with unittest.mock.patch.object(server, "COMFY_INPUT", comfy_input):
                input_names = server.stage_bernini_inputs(run, 48, 80, run_dir)

            self.assertEqual(input_names["source_video"], "01_bernini_source_clip.mp4")
            self.assertEqual(input_names["reference_image"], "01_bernini_reference.png")
            self.assertTrue((comfy_input / input_names["source_video"]).exists())
            self.assertTrue((comfy_input / input_names["reference_image"]).exists())

    def test_bernini_segment_specs_cover_full_duration(self):
        specs = server.bernini_segment_specs(total_duration=10.5, segment_duration=4)

        self.assertEqual(
            specs,
            [
                {"index": 1, "start": 0.0, "duration": 4.0},
                {"index": 2, "start": 4.0, "duration": 4.0},
                {"index": 3, "start": 8.0, "duration": 2.5},
            ],
        )

    def test_split_video_segments_uses_exact_trim_commands(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "long.mp4"
            source.write_bytes(b"video")
            out_dir = root / "segments"
            commands: list[list[str]] = []

            def fake_runner(command, **_kwargs):
                commands.append(command)
                Path(command[-1]).write_bytes(b"segment")
                return unittest.mock.Mock(returncode=0)

            with unittest.mock.patch.object(server, "video_duration_seconds", return_value=8.5):
                segments = server.split_video_segments(source, out_dir, 4, runner=fake_runner)

            self.assertEqual([path.name for path in segments], ["segment_001.mp4", "segment_002.mp4", "segment_003.mp4"])
            self.assertEqual(commands[0][0], "ffmpeg")
            self.assertIn("-ss", commands[0])
            self.assertIn("-t", commands[0])
            self.assertEqual(commands[0][commands[0].index("-ss") + 1], "0.000")
            self.assertEqual(commands[0][commands[0].index("-t") + 1], "4.000")
            self.assertEqual(commands[2][commands[2].index("-ss") + 1], "8.000")
            self.assertEqual(commands[2][commands[2].index("-t") + 1], "0.500")

    def test_merge_segment_videos_writes_concat_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "one.mp4"
            second = root / "two.mp4"
            first.write_bytes(b"one")
            second.write_bytes(b"two")
            merged = root / "merged.mp4"
            commands: list[list[str]] = []

            def fake_runner(command, **_kwargs):
                commands.append(command)
                merged.write_bytes(b"merged")
                return unittest.mock.Mock(returncode=0)

            out = server.merge_segment_videos([first, second], merged, runner=fake_runner)

            self.assertEqual(out, merged)
            concat_list = root / "merged.txt"
            self.assertTrue(concat_list.exists())
            self.assertIn("one.mp4", concat_list.read_text(encoding="utf-8"))
            self.assertEqual(commands[0][:5], ["ffmpeg", "-y", "-f", "concat", "-safe"])
            self.assertNotIn("copy", commands[0])
            self.assertIn("libx264", commands[0])
            self.assertIn("+faststart", commands[0])

    def test_trim_video_clip_uses_precise_ffmpeg_range(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source.mp4"
            source.write_bytes(b"video")
            output_dir = root / "clips"
            commands: list[list[str]] = []

            def fake_runner(command, **_kwargs):
                commands.append(command)
                Path(command[-1]).write_bytes(b"clip")
                return unittest.mock.Mock(returncode=0)

            out = server.trim_video_clip(source, output_dir, 1.25, 3.75, runner=fake_runner)

            self.assertTrue(out.exists())
            self.assertEqual(out.parent, output_dir)
            self.assertEqual(commands[0][0], "ffmpeg")
            self.assertEqual(commands[0][commands[0].index("-ss") + 1], "1.250")
            self.assertEqual(commands[0][commands[0].index("-t") + 1], "2.500")
            self.assertEqual(commands[0][commands[0].index("-vf") + 1], "scale=trunc(iw/2)*2:trunc(ih/2)*2")
            self.assertIn("-movflags", commands[0])
            self.assertIn("+faststart", commands[0])

    def test_trim_video_clip_rejects_invalid_range(self):
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "source.mp4"
            source.write_bytes(b"video")

            with self.assertRaisesRegex(ValueError, "end must be after start"):
                server.trim_video_clip(source, Path(tmp) / "clips", 2, 2)

    def test_preserve_video_audio_muxes_source_audio_into_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            generated = root / "generated.mp4"
            source = root / "source.mp4"
            generated.write_bytes(b"generated")
            source.write_bytes(b"source")
            commands: list[list[str]] = []

            def fake_runner(command, **_kwargs):
                commands.append(command)
                Path(command[-1]).write_bytes(b"muxed")
                return unittest.mock.Mock(returncode=0)

            out = server.preserve_video_audio(generated, source, runner=fake_runner)

            self.assertTrue(out.exists())
            self.assertEqual(out.name, "generated_preserve_audio.mp4")
            self.assertEqual(commands[0][0], "ffmpeg")
            self.assertEqual(commands[0][commands[0].index("-map") + 1], "0:v:0")
            self.assertIn("1:a:0?", commands[0])
            self.assertIn("-shortest", commands[0])

    def test_apply_bernini_preserve_audio_updates_run_video(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            generated = root / "generated.mp4"
            source = root / "source.mp4"
            generated.write_bytes(b"generated")
            source.write_bytes(b"source")
            run = {
                "workflow_mode": "bernini_v2v",
                "source_video": str(source),
                "bernini_preserve_audio": True,
                "copied": [str(generated)],
            }

            def fake_preserve(video, audio_source):
                self.assertEqual(video, generated)
                self.assertEqual(audio_source, source)
                muxed = root / "muxed.mp4"
                muxed.write_bytes(b"muxed")
                return muxed

            with unittest.mock.patch.object(server, "preserve_video_audio", side_effect=fake_preserve):
                out = server.apply_bernini_preserve_audio(run, generated)

            self.assertEqual(out.name, "muxed.mp4")
            self.assertEqual(run["video"], str(out))
            self.assertTrue(run["bernini_audio_preserved"])
            self.assertIn(str(out), run["copied"])

    def test_apply_bernini_preserve_audio_keeps_generated_video_when_source_audio_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            generated = root / "generated.mp4"
            missing_source = root / "missing_source.mp4"
            generated.write_bytes(b"generated")
            run = {
                "workflow_mode": "bernini_v2v",
                "source_video": str(missing_source),
                "bernini_preserve_audio": True,
                "copied": [str(generated)],
            }

            out = server.apply_bernini_preserve_audio(run, generated)

            self.assertEqual(out, generated)
            self.assertEqual(run["video"], str(generated))
            self.assertFalse(run["bernini_audio_preserved"])
            self.assertIn("source video is missing", run["bernini_audio_warning"])

    def test_record_run_media_outputs_sets_image_for_image_only_results(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "first.png"
            second = root / "second.webp"
            first.write_bytes(b"first")
            second.write_bytes(b"second")
            run = {
                "variant_name": "prompt",
                "camera_move": "R2I",
            }

            server.record_run_media_outputs(run, [first, second], "bernini_r2i", root)

            self.assertEqual(run["copied"], [str(first), str(second)])
            self.assertEqual(run["image"], str(first))
            self.assertEqual(run["images"], [str(first), str(second)])
            self.assertNotIn("video", run)

    def test_history_runs_hydrates_image_from_existing_copied_outputs(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            batch_dir = root / "batch"
            run_dir = batch_dir / "01_prompt"
            run_dir.mkdir(parents=True)
            image = run_dir / "output.png"
            image.write_bytes(b"image")
            (batch_dir / "batch.json").write_text(
                json.dumps(
                    {
                        "status": "done",
                        "runs": [
                            {
                                "batch_id": "batch",
                                "run_id": "01_prompt",
                                "workflow_id": "bernini_r2i",
                                "workflow_mode": "bernini_r2i",
                                "workflow_label": "WAN2.2 Bernini R2I",
                                "status": "done",
                                "copied": [str(image)],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with unittest.mock.patch.object(server, "RUN_ROOT", root):
                runs = server.history_runs()

            self.assertEqual(runs[0]["image"], str(image))
            self.assertEqual(runs[0]["images"], [str(image)])

    def test_record_3dmotion_guide_run_writes_history_visible_motion_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "recorded.webm"
            source.write_bytes(b"webm")

            commands: list[list[str]] = []

            def fake_runner(command, **_kwargs):
                commands.append(command)
                Path(command[-1]).write_bytes(b"mp4")
                return unittest.mock.Mock(returncode=0)

            with unittest.mock.patch.object(server, "RUN_ROOT", root):
                batch = server.record_3dmotion_guide_run(source, duration=1.75, prompt="face focus orbit", runner=fake_runner)
                runs = server.history_runs()

            run = batch["runs"][0]
            copied = Path(run["video"])
            self.assertEqual(commands[0][0], "ffmpeg")
            self.assertEqual(commands[0][commands[0].index("-vf") + 1], "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=24")
            self.assertEqual(run["workflow_id"], "motion_3d_to_scail")
            self.assertEqual(run["workflow_mode"], "motion_3d")
            self.assertEqual(run["workflow_label"], "3D Motion")
            self.assertEqual(run["status"], "guide_done")
            self.assertEqual(run["duration"], 1.75)
            self.assertEqual(run["prompt"], "face focus orbit")
            self.assertEqual(run["guide_video"], str(copied))
            self.assertEqual(copied.suffix, ".mp4")
            self.assertTrue(copied.exists())
            self.assertEqual(runs[0]["history_key"], f"{run['batch_id']}:{run['run_id']}")
            self.assertEqual(runs[0]["video"], str(copied))
            self.assertEqual(runs[0]["guide_video"], str(copied))

    def test_bernini_split_options_only_enable_for_rv2v(self):
        options = server.bernini_split_options(
            "bernini_rv2v",
            {"bernini_split_enabled": True, "bernini_split_duration": "4.5", "bernini_split_merge": True},
        )

        self.assertEqual(options, {"enabled": True, "duration": 4.5, "merge": True})
        self.assertEqual(server.bernini_split_options("bernini_v2v", {"bernini_split_enabled": True})["enabled"], False)

    def test_prepare_bernini_split_runs_expands_source_video(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            batch_dir = root / "batch"
            batch_dir.mkdir()
            source = root / "long.mp4"
            source.write_bytes(b"video")
            reference = root / "ref.png"
            Image.new("RGB", (64, 64), "red").save(reference)
            seg1 = batch_dir / "_segments" / "segment_001.mp4"
            seg2 = batch_dir / "_segments" / "segment_002.mp4"
            seg1.parent.mkdir()
            seg1.write_bytes(b"one")
            seg2.write_bytes(b"two")
            base_run = {
                "batch_id": "batch",
                "run_id": "01_prompt",
                "run_dir": str(batch_dir / "01_prompt"),
                "workflow_id": "bernini_rv2v",
                "workflow_mode": "bernini_rv2v",
                "workflow_label": "WAN2.2 Bernini RV2V",
                "source_video": str(source),
                "reference_image": str(reference),
                "duration": 8.0,
                "variant_name": "prompt",
                "prompt": "replace actor",
                "status": "queued",
            }

            with unittest.mock.patch.object(server, "video_duration_seconds", return_value=8.0), unittest.mock.patch.object(
                server, "split_video_segments", return_value=[seg1, seg2]
            ):
                runs = server.prepare_bernini_split_runs(base_run, batch_dir, 4.0)

            self.assertEqual([run["run_id"] for run in runs], ["01_prompt_seg001", "01_prompt_seg002"])
            self.assertEqual([Path(run["source_video"]).name for run in runs], ["segment_001.mp4", "segment_002.mp4"])
            self.assertEqual([run["duration"] for run in runs], [4.0, 4.0])
            self.assertEqual([run["segment_index"] for run in runs], [1, 2])
            self.assertTrue(runs[0]["run_dir"].endswith("01_prompt_seg001"))

    def test_merge_bernini_split_batch_appends_final_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "seg1.mp4"
            second = root / "seg2.mp4"
            first.write_bytes(b"one")
            second.write_bytes(b"two")
            merged = root / "merged.mp4"
            batch = {
                "batch_id": "batch",
                "batch_dir": str(root),
                "bernini_split": {"enabled": True, "merge": True},
                "runs": [
                    {
                        "run_id": "01_prompt_seg001",
                        "run_dir": str(root / "seg001"),
                        "status": "done",
                        "video": str(first),
                        "segment_index": 1,
                        "workflow_id": "bernini_rv2v",
                        "workflow_mode": "bernini_rv2v",
                        "workflow_label": "WAN2.2 Bernini RV2V",
                        "prompt": "replace actor",
                        "negative_prompt": "bad video",
                        "seed": 123,
                        "duration": 4.0,
                        "width": 1280,
                        "height": 720,
                    },
                    {
                        "run_id": "01_prompt_seg002",
                        "run_dir": str(root / "seg002"),
                        "status": "done",
                        "video": str(second),
                        "segment_index": 2,
                        "workflow_id": "bernini_rv2v",
                        "workflow_mode": "bernini_rv2v",
                        "workflow_label": "WAN2.2 Bernini RV2V",
                        "prompt": "replace actor",
                        "negative_prompt": "bad video",
                        "seed": 123,
                        "duration": 4.0,
                        "width": 1280,
                        "height": 720,
                    },
                ],
            }

            def fake_merge(_videos, output, **_kwargs):
                output.write_bytes(b"merged")
                return output

            with unittest.mock.patch.object(server, "merge_segment_videos", side_effect=fake_merge):
                final_run = server.merge_bernini_split_batch(batch)

            self.assertIsNotNone(final_run)
            self.assertEqual(final_run["run_id"], "merged")
            self.assertEqual(final_run["status"], "done")
            self.assertTrue(Path(final_run["video"]).exists())
            self.assertEqual(batch["runs"][-1]["run_id"], "merged")

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
            "ltx_director_2": "ltx_director_2.json",
            "bernini_t2v": "wan22_bernini_t2v.ui.json",
            "bernini_t2i": "wan22_bernini_t2i.ui.json",
            "bernini_i2v": "wan22_bernini_i2v.ui.json",
            "bernini_i2i": "wan22_bernini_i2i.ui.json",
            "bernini_v2v": "wan22_bernini_v2v.ui.json",
            "bernini_mv2v": "wan22_bernini_mv2v.ui.json",
            "bernini_vi2v": "wan22_bernini_vi2v.ui.json",
            "bernini_vrc2v": "wan22_bernini_vrc2v.ui.json",
            "bernini_r2v": "wan22_bernini_r2v.ui.json",
            "bernini_r2i": "wan22_bernini_r2i.ui.json",
            "bernini_rv2v": "wan22_bernini_rv2v.ui.json",
            "bernini_ads2v": "wan22_bernini_ads2v.ui.json",
            "wan_vace_inpaint": "wan_vace_inpainting.ui.json",
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

        self.assertEqual(timeline["local_prompts"], "")
        self.assertEqual(timeline["segment_lengths"], "36")
        self.assertEqual(timeline["segments"][0]["image_path"], "fixtures/keyframe.png")
        self.assertEqual(timeline["segments"][0]["start_frame"], 0)
        guide_segments = server.director_reference_timeline_segments(timeline, {}, {1: "keyframe.png"})
        self.assertEqual(guide_segments[0]["start"], 24)
        self.assertEqual(guide_segments[0]["imageFile"], "keyframe.png")

    def test_director_timeline_segments_match_original_gap_absorption(self):
        payload = {
            "timeline_segments": [
                {
                    "id": "img_start",
                    "type": "image",
                    "prompt": "first image prompt",
                    "duration": 1.0,
                    "start": 0,
                    "image_path": "fixtures/start.png",
                    "strength": 0.8,
                },
                {
                    "id": "txt_mid",
                    "type": "text",
                    "prompt": "middle text prompt",
                    "duration": 1.0,
                    "start": 2.0,
                },
                {
                    "id": "img_end",
                    "type": "image",
                    "prompt": "final image prompt",
                    "duration": 1.0,
                    "start": 3.0,
                    "image_path": "fixtures/end.png",
                    "strength": 0.6,
                },
            ],
            "duration": 4.0,
        }

        timeline = server.director_timeline_from_payload(payload, fps=24)
        guide_segments = server.director_reference_timeline_segments(
            timeline,
            {},
            {1: "start.png", 3: "end.png"},
        )

        self.assertEqual(timeline["local_prompts"], "first image prompt | middle text prompt | final image prompt")
        self.assertEqual(timeline["segment_lengths"], "48,24,24")
        self.assertEqual(timeline["duration_frames"], 96)
        self.assertEqual([segment["type"] for segment in guide_segments], ["image", "text", "image"])
        self.assertEqual(guide_segments[0]["imageFile"], "start.png")
        self.assertEqual(guide_segments[0]["start"], 0)
        self.assertEqual(guide_segments[0]["length"], 24)
        self.assertEqual(guide_segments[1]["start"], 48)
        self.assertNotIn("imageFile", guide_segments[1])
        self.assertEqual(guide_segments[2]["imageFile"], "end.png")
        self.assertEqual(guide_segments[2]["start"], 72)

    def test_director_timeline_respects_explicit_duration_after_last_segment(self):
        payload = {
            "timeline_segments": [
                {
                    "id": "img_start",
                    "type": "image",
                    "prompt": "first image prompt",
                    "duration": 1.0,
                    "start": 0,
                    "image_path": "fixtures/start.png",
                    "strength": 0.8,
                },
                {
                    "id": "img_end",
                    "type": "image",
                    "prompt": "final image prompt",
                    "duration": 1.0,
                    "start": 3.0,
                    "image_path": "fixtures/end.png",
                    "strength": 0.6,
                },
            ],
            "duration": 6.0,
        }

        timeline = server.director_timeline_from_payload(payload, fps=24)

        self.assertEqual(timeline["duration_frames"], 144)
        self.assertEqual(timeline["local_prompts"], "first image prompt | final image prompt")
        self.assertEqual(timeline["segment_lengths"], "72,72")

    def test_director_timeline_audio_segments_are_independent_from_image_segments(self):
        payload = {
            "timeline_segments": [
                {"id": "img_1", "type": "image", "prompt": "image prompt", "duration": 1.0, "start": 0},
            ],
            "audio_segments": [
                {
                    "id": "aud_1",
                    "audio_path": "fixtures/line.wav",
                    "start": 1.5,
                    "duration": 2.5,
                    "trim_start": 12,
                }
            ],
        }

        timeline = server.director_timeline_from_payload(payload, fps=24)

        self.assertEqual(timeline["duration_frames"], 96)
        self.assertEqual(timeline["segment_lengths"], "96")
        self.assertEqual(
            timeline["audio_segments"],
            [
                {
                    "id": "aud_1",
                    "audio_path": "fixtures/line.wav",
                    "start": 36,
                    "length": 60,
                    "trimStart": 12,
                    "volume": 1.0,
                }
            ],
        )

    def test_director_retake_timeline_does_not_segment_global_prompt(self):
        timeline = server.director_timeline_from_payload(
            {
                "duration": 6,
                "global_prompt": "keep the existing scene continuous",
                "retake_mode": True,
                "retake_video": {
                    "video_path": "tasks/camera_lab_uploads/videos/base.mp4",
                    "file_name": "base.mp4",
                    "duration": 6,
                },
                "retake_start": 2,
                "retake_length": 1.5,
                "retake_prompt": "replace the middle action",
            },
            fps=24,
        )

        self.assertEqual(timeline["local_prompts"], "")
        self.assertEqual(timeline["segment_lengths"], "")
        self.assertEqual(timeline["retake_start"], 48)
        self.assertEqual(timeline["retake_length"], 36)
        self.assertEqual(timeline["retake_prompt"], "replace the middle action")

    def test_director_retake_prompt_summary_uses_retake_prompt_for_output_display(self):
        prompt = server.build_director_prompt_summary({
            "global_prompt": "keep the existing scene continuous",
            "retake_mode": True,
            "retake_video": {"video_path": "tasks/camera_lab_uploads/videos/base.mp4"},
            "retake_start": 2,
            "retake_length": 1.5,
            "retake_prompt": "replace the middle action",
        })

        self.assertEqual(prompt, "replace the middle action")

    def test_director_default_empty_timeline_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "add a segment, guide, or retake video"):
            server.build_director_prompt_summary({
                "global_prompt": "A continuous cinematic video with coherent subject identity, consistent lighting, natural motion, and smooth visual continuity across the full timeline.",
                "timeline_segments": [],
                "motion_segments": [],
            })

    def test_director_v2_global_reference_images_are_placeholder_only(self):
        run = {
            "batch_id": "dry",
            "run_id": "01_director",
            "workflow_id": "ltx_director_2",
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
        original_timeline = server.copy_director_timeline_media
        original_workflow_to_api = server.workflow_to_api
        original_object_info = server.object_info
        original_workflow_path = server.DIRECTOR_V2_WORKFLOW_PATH
        server.copy_director_reference_images = lambda *_args, **_kwargs: self.fail(
            "Block 0 must not stage global reference images"
        )
        server.copy_director_timeline_media = lambda _run, _timeline, _width, _height: {1: {"type": "image", "name": "dry_timeline.png"}}
        server.object_info = lambda: {
            "LTXDirector": {
                "input": {
                    "required": {
                        "global_reference_images": ["STRING"],
                        "global_reference_strength": ["FLOAT"],
                    }
                }
            }
        }
        server.workflow_to_api = lambda _workflow: {
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
                    "global_reference_images": "stale",
                    "global_reference_strength": 1.0,
                },
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            server.DIRECTOR_V2_WORKFLOW_PATH = Path(tmp) / "director.json"
            server.DIRECTOR_V2_WORKFLOW_PATH.write_text("{}", encoding="utf-8")
            try:
                api = server.build_ltx_director_v2_api(run)
            finally:
                server.copy_director_reference_images = original_refs
                server.copy_director_timeline_media = original_timeline
                server.workflow_to_api = original_workflow_to_api
                server.object_info = original_object_info
                server.DIRECTOR_V2_WORKFLOW_PATH = original_workflow_path

        director_inputs = api["131"]["inputs"]
        timeline = json.loads(director_inputs["timeline_data"])
        self.assertEqual(len(timeline["segments"]), 1)
        self.assertEqual(timeline["segments"][0]["id"], "camera-lab-segment-1")
        self.assertEqual(timeline["segments"][0]["imageFile"], "dry_timeline.png")
        self.assertEqual(timeline["segments"][0]["strength"], 0.75)
        self.assertEqual(director_inputs["guide_strength"], "0.75")
        self.assertEqual(director_inputs["global_reference_images"], "")
        self.assertEqual(director_inputs["global_reference_strength"], 0.0)
        self.assertFalse(any(node["class_type"] == "LTXVAddGuideMulti" for node in api.values()))

    def test_director_build_api_includes_independent_audio_segments(self):
        original_input = server.COMFY_INPUT
        original_timeline = server.copy_director_timeline_images
        original_workflow_to_api = server.workflow_to_api
        original_object_info = server.object_info
        original_workflow_path = server.DIRECTOR_V2_WORKFLOW_PATH
        server.copy_director_timeline_images = lambda _run, _timeline, _width, _height: {1: "dry_timeline.png"}
        server.object_info = lambda: {"LTXDirector": {"input": {"required": {}}}}
        server.workflow_to_api = lambda _workflow: {
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
                    "use_custom_audio": False,
                },
            },
        }
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            audio = tmp_path / "line.wav"
            audio.write_bytes(b"audio")
            server.COMFY_INPUT = tmp_path / "comfy_input"
            server.DIRECTOR_V2_WORKFLOW_PATH = tmp_path / "director.json"
            server.DIRECTOR_V2_WORKFLOW_PATH.write_text("{}", encoding="utf-8")
            run = {
                "batch_id": "dry",
                "run_id": "01_director",
                "workflow_id": "ltx_director_2",
                "global_prompt": "",
                "segments": [
                    {
                        "id": "img_1",
                        "type": "image",
                        "prompt": "image prompt",
                        "duration": 1,
                        "start": 0,
                        "image_path": "fixtures/timeline.png",
                        "strength": 0.75,
                    },
                ],
                "audio_segments": [
                    {
                        "id": "aud_1",
                        "audio_path": str(audio),
                        "start": 0.5,
                        "duration": 1.5,
                        "trim_start": 12,
                    },
                ],
                "reference_images": [],
                "width": 512,
                "height": 512,
                "seed": "123",
                "prompt": "image prompt",
                "negative_prompt": "",
            }
            try:
                api = server.build_ltx_director_v2_api(run)
                copied = server.COMFY_INPUT / "01_director_segaudio_01_line.wav"
                copied_bytes = copied.read_bytes()
            finally:
                server.COMFY_INPUT = original_input
                server.copy_director_timeline_images = original_timeline
                server.workflow_to_api = original_workflow_to_api
                server.object_info = original_object_info
                server.DIRECTOR_V2_WORKFLOW_PATH = original_workflow_path

        director_inputs = api["131"]["inputs"]
        timeline = json.loads(director_inputs["timeline_data"])
        self.assertTrue(director_inputs["use_custom_audio"])
        self.assertEqual(
            timeline["audioSegments"],
            [
                {
                    "audioFile": "01_director_segaudio_01_line.wav",
                    "fileName": "line.wav",
                    "start": 12,
                    "length": 36,
                    "trimStart": 12,
                }
            ],
        )
        self.assertEqual(copied_bytes, b"audio")

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

    def test_director_timeline_image_names_are_unique_per_batch(self):
        original_input = server.COMFY_INPUT
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            src = tmp_path / "guide.png"
            Image.new("RGB", (64, 64), (200, 20, 30)).save(src)
            server.COMFY_INPUT = tmp_path / "comfy_input"
            timeline = {
                "segments": [
                    {
                        "image_path": str(src),
                    },
                ],
            }
            try:
                first = server.copy_director_timeline_images(
                    {"batch_id": "batch_one", "run_id": "01_director", "run_dir": str(tmp_path / "run_one")},
                    timeline,
                    64,
                    64,
                )
                second = server.copy_director_timeline_images(
                    {"batch_id": "batch_two", "run_id": "01_director", "run_dir": str(tmp_path / "run_two")},
                    timeline,
                    64,
                    64,
                )
            finally:
                server.COMFY_INPUT = original_input

            self.assertNotEqual(first[1], second[1])
            self.assertTrue((tmp_path / "comfy_input" / first[1]).exists())
            self.assertTrue((tmp_path / "comfy_input" / second[1]).exists())

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
