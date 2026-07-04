from scripts.camera_lab_setup.hardware import detect_hardware
from scripts.camera_lab_setup.hardware import HardwareProfile
from scripts.camera_lab_setup.modules import MODULES, ModelRef, get_module, module_ids, selected_modules
from scripts.camera_lab_setup.resolver import resolve_module
from scripts.camera_lab_setup.visibility import model_visible, node_visible, visibility_from_object_info
from scripts.camera_lab_setup.visibility import ComfyVisibility
from scripts.camera_lab_common import workflow_sources


def test_module_registry_contains_user_facing_workspaces():
    assert module_ids() == ["camera", "director", "edit", "casting", "motion"]
    assert get_module("director").label == "Director"
    assert get_module("director").frontend_workspace == "director"
    assert len(MODULES) == 5


def test_director_profile_is_v2_drop_in():
    director = get_module("director")
    profile_ids = {profile.id for profile in director.model_profiles}
    assert profile_ids == {"director-v2-distilled-fp8"}  # v1 retired with the MVP workflow
    v2 = next(profile for profile in director.model_profiles if profile.id == "director-v2-distilled-fp8")
    assert v2.compatibility == "drop_in"
    assert v2.compatible_workflows == ("ltx_director_2.json",)
    assert any(
        model.folder == "diffusion_models"
        and model.name == "ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors"
        for model in v2.required_models
    )


def test_selected_modules_preserves_registry_order_and_rejects_unknown_ids():
    assert [module.id for module in selected_modules(["motion", "camera"])] == ["camera", "motion"]
    try:
        selected_modules(["camera", "unknown"])
    except ValueError as exc:
        assert "unknown module: unknown" in str(exc)
    else:
        raise AssertionError("unknown module id should fail")


def test_detect_hardware_parses_nvidia_smi_csv():
    def fake_nvidia_smi():
        return "NVIDIA GeForce RTX 4090, 24564\n"

    profile = detect_hardware(
        nvidia_smi=fake_nvidia_smi,
        disk_usage=lambda path: (100, 40, 60),
        platform_name="Windows",
        python_version="3.12.7",
    )

    assert profile.gpu_name == "NVIDIA GeForce RTX 4090"
    assert profile.vram_gb == 24
    assert profile.os_name == "Windows"
    assert profile.python_version == "3.12.7"


def test_detect_hardware_keeps_unknown_gpu_as_warning():
    profile = detect_hardware(
        nvidia_smi=lambda: "",
        disk_usage=lambda path: (100, 40, 60),
        platform_name="Linux",
        python_version="3.11",
    )

    assert profile.gpu_name is None
    assert "GPU VRAM could not be detected" in profile.warnings


def test_visibility_reads_combo_options_from_object_info():
    visibility = visibility_from_object_info(
        {
            "UNETLoader": {"input": {"required": {"unet_name": ["COMBO", {"options": ["model-a.safetensors"]}]}}},
            "VAELoader": {"input": {"required": {"vae_name": [["vae-a.safetensors"], {}]}}},
            "LTXDirector": {"input": {"required": {}}},
        }
    )

    assert node_visible(visibility, "LTXDirector")
    assert model_visible(visibility, ModelRef("diffusion_models", "model-a.safetensors"))
    assert model_visible(visibility, ModelRef("vae", "vae-a.safetensors"))
    assert not model_visible(visibility, ModelRef("loras", "missing.safetensors"))


def test_model_visibility_normalizes_path_separators():
    visibility = ComfyVisibility(
        nodes=frozenset(),
        models={"diffusion_models": frozenset({"kijai-WAN2.2\\Wan22_Bernini_HIGH_fp8_e4m3fn_scaled.safetensors"})},
        source="test",
    )

    assert model_visible(
        visibility,
        ModelRef("diffusion_models", "kijai-WAN2.2/Wan22_Bernini_HIGH_fp8_e4m3fn_scaled.safetensors"),
    )


def test_resolver_marks_director_ready_when_drop_in_profile_is_visible():
    director = get_module("director")
    visibility = ComfyVisibility(
        nodes=frozenset({"LTXDirector", "LTXDirectorGuide", "LTXDirectorCropGuides"}),
        models={
            "diffusion_models": frozenset({"ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors"}),
            "latent_upscale_models": frozenset({"ltx-2.3-spatial-upscaler-x2-1.1.safetensors"}),
            "vae": frozenset({"LTX23_audio_vae_bf16.safetensors", "LTX23_video_vae_bf16.safetensors", "taeltx2_3.safetensors"}),
            "text_encoders": frozenset({"gemma_3_12B_it_fp4_mixed.safetensors", "ltx-2.3_text_projection_bf16.safetensors"}),
        },
        source="test",
    )

    status = resolve_module(director, HardwareProfile(vram_gb=24), visibility)

    assert status.ready is True
    assert status.profile == "director-v2-distilled-fp8"
    assert status.recommendation == "recommended"
    assert status.missing == ()


def test_resolver_selects_workflow_variant_when_it_is_the_only_ready_profile():
    # A workflow_variant counts as ready only when one of its compatible workflows is bundled.
    # camera's GGUF ladder targets ltx23_gguf_ia2v_nag_extend.json, which ships with the module,
    # so a visible GGUF tier is a legitimate ready profile even with no drop-in models present.
    camera = get_module("camera")
    visibility = ComfyVisibility(
        nodes=frozenset({"LTXVConditioning", "UnetLoaderGGUF", "DualCLIPLoaderGGUF"}),
        models={
            "diffusion_models": frozenset({"LTX-2.3-distilled-Q4_K_S.gguf"}),
            "text_encoders": frozenset({"gemma-3-12b-it-qat-UD-Q4_K_XL.gguf", "ltx-2.3-22b-dev_embeddings_connectors.safetensors"}),
            "loras": frozenset({"ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"}),
            "latent_upscale_models": frozenset({"ltx-2.3-spatial-upscaler-x2-1.1.safetensors"}),
        },
        source="test",
    )

    status = resolve_module(camera, HardwareProfile(vram_gb=12), visibility)

    assert status.ready is True
    assert status.profile == "camera-ltx23-gguf-q4s"
    assert status.recommendation == "recommended"


def test_resolver_reports_risky_when_hardware_is_below_profile():
    camera = get_module("camera")
    visibility = ComfyVisibility(
        nodes=frozenset({"LTXVConditioning"}),
        models={
            "checkpoints": frozenset({"ltx-2.3-22b-dev-fp8.safetensors"}),
            "loras": frozenset({"ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"}),
            "latent_upscale_models": frozenset({"ltx-2.3-spatial-upscaler-x2-1.1.safetensors"}),
            "text_encoders": frozenset({"gemma_3_12B_it_fp4_mixed.safetensors", "ltx-2.3_text_projection_bf16.safetensors"}),
        },
        source="test",
    )

    status = resolve_module(camera, HardwareProfile(vram_gb=8), visibility)

    assert status.ready is True
    assert status.recommendation == "risky"
    assert any("8 GiB VRAM" in warning for warning in status.warnings)


def test_workflow_sources_can_filter_by_module():
    sources = workflow_sources(module_ids=["director"])

    assert len(sources) == 1
    assert sources[0][0] == "app"
    assert sources[0][2] == ("ltx_director_2.json",)


def test_workflow_variant_profiles_are_visible_for_installer_guidance():
    camera = get_module("camera")
    profile = next(item for item in camera.model_profiles if item.id == "camera-ltx23-gguf-q4s")

    assert profile.compatibility == "workflow_variant"
    assert profile.quantization == "GGUF Q4_K_S"
    assert "ComfyUI-GGUF" in profile.notes


def test_camera_has_ltx_gguf_ladder_with_ascending_vrams():
    camera = get_module("camera")
    ladder = [p for p in camera.model_profiles if p.id.startswith("camera-ltx23-gguf")]
    ids = [p.id for p in ladder]
    assert ids == ["camera-ltx23-gguf-q2", "camera-ltx23-gguf-q4s", "camera-ltx23-gguf-q4m", "camera-ltx23-gguf-q8"]
    vrams = [p.min_vram_gb for p in ladder]
    assert vrams == sorted(vrams)
    q2 = ladder[0]
    assert q2.min_vram_gb <= 8
    # GGUF diffusion + Gemma encoder are both required, both via GGUF loaders
    assert any(m.name == "LTX-2.3-distilled-Q2_K.gguf" and m.source_url for m in q2.required_models)
    assert any(m.folder == "text_encoders" and m.name.endswith(".gguf") and m.source_url for m in q2.required_models)
    assert "UnetLoaderGGUF" in q2.required_nodes
    assert "DualCLIPLoaderGGUF" in q2.required_nodes


def test_edit_has_bernini_gguf_ladder_with_high_and_low_experts():
    edit = get_module("edit")
    ladder = [p for p in edit.model_profiles if p.id.startswith("edit-bernini-gguf")]
    ids = [p.id for p in ladder]
    assert ids == ["edit-bernini-gguf-q4m", "edit-bernini-gguf-q5m", "edit-bernini-gguf-q8"]
    q4 = ladder[0]
    names = {m.name for m in q4.required_models}
    assert "bernini_r_high_noise_14B-Q4_K_M.gguf" in names
    assert "bernini_r_low_noise_14B-Q4_K_M.gguf" in names
    assert any(m.folder == "text_encoders" and m.name.endswith(".gguf") for m in q4.required_models)
    assert "UnetLoaderGGUF" in q4.required_nodes


def test_motion_scail2_small_is_marked_unavailable_not_faked():
    motion = get_module("motion")
    small = next(p for p in motion.model_profiles if p.id == "motion-scail2-small")
    assert small.required_models == ()  # no public GGUF exists
    assert "no" in small.notes.lower() and "gguf" in small.notes.lower()


def _ltx_visibility_all_tiers():
    from scripts.camera_lab_setup.visibility import ComfyVisibility
    diff = frozenset({
        "LTX-2.3-distilled-Q2_K.gguf", "LTX-2.3-distilled-Q4_K_S.gguf",
        "LTX-2.3-distilled-Q4_K_M.gguf", "LTX-2.3-distilled-Q8_0.gguf",
    })
    texts = frozenset({"gemma-3-12b-it-qat-UD-Q4_K_XL.gguf", "ltx-2.3-22b-dev_embeddings_connectors.safetensors"})
    return ComfyVisibility(
        nodes=frozenset({"LTXVConditioning", "UnetLoaderGGUF", "DualCLIPLoaderGGUF"}),
        models={
            "diffusion_models": diff,
            "text_encoders": texts,
            "loras": frozenset({"ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"}),
            "latent_upscale_models": frozenset({"ltx-2.3-spatial-upscaler-x2-1.1.safetensors"}),
        },
        source="test",
    )


def test_resolver_picks_highest_fitting_gguf_tier_by_vram():
    from scripts.camera_lab_setup.hardware import HardwareProfile
    from scripts.camera_lab_setup.resolver import resolve_module
    camera = get_module("camera")
    vis = _ltx_visibility_all_tiers()
    assert resolve_module(camera, HardwareProfile(vram_gb=8), vis).profile == "camera-ltx23-gguf-q2"
    assert resolve_module(camera, HardwareProfile(vram_gb=12), vis).profile == "camera-ltx23-gguf-q4s"
    assert resolve_module(camera, HardwareProfile(vram_gb=16), vis).profile == "camera-ltx23-gguf-q4m"
    s24 = resolve_module(camera, HardwareProfile(vram_gb=24), vis)
    assert s24.profile == "camera-ltx23-gguf-q8"
    assert s24.recommendation == "recommended"


def test_resolver_marks_risky_when_only_oversized_tier_is_ready():
    from scripts.camera_lab_setup.hardware import HardwareProfile
    from scripts.camera_lab_setup.resolver import resolve_module
    from scripts.camera_lab_setup.visibility import ComfyVisibility
    camera = get_module("camera")
    vis = ComfyVisibility(
        nodes=frozenset({"LTXVConditioning", "UnetLoaderGGUF", "DualCLIPLoaderGGUF"}),
        models={
            "diffusion_models": frozenset({"LTX-2.3-distilled-Q8_0.gguf"}),
            "text_encoders": frozenset({"gemma-3-12b-it-qat-UD-Q4_K_XL.gguf", "ltx-2.3-22b-dev_embeddings_connectors.safetensors"}),
            "loras": frozenset({"ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"}),
            "latent_upscale_models": frozenset({"ltx-2.3-spatial-upscaler-x2-1.1.safetensors"}),
        },
        source="test",
    )
    status = resolve_module(camera, HardwareProfile(vram_gb=8), vis)
    assert status.profile == "camera-ltx23-gguf-q8"
    assert status.recommendation == "risky"
