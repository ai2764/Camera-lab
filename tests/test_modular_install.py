from scripts.camera_lab_setup.hardware import detect_hardware
from scripts.camera_lab_setup.modules import MODULES, ModelRef, get_module, module_ids, selected_modules
from scripts.camera_lab_setup.visibility import model_visible, node_visible, visibility_from_object_info


def test_module_registry_contains_user_facing_workspaces():
    assert module_ids() == ["camera", "director", "edit", "casting", "motion"]
    assert get_module("director").label == "Director"
    assert get_module("director").frontend_workspace == "director"
    assert len(MODULES) == 5


def test_director_profiles_include_v1_and_v2_models():
    director = get_module("director")
    profile_ids = {profile.id for profile in director.model_profiles}
    assert {"director-v1-ltx23-fp8", "director-v2-distilled-fp8"} <= profile_ids
    v2 = next(profile for profile in director.model_profiles if profile.id == "director-v2-distilled-fp8")
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
