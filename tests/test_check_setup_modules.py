from scripts.camera_lab_setup.hardware import HardwareProfile
from scripts.camera_lab_setup.modules import get_module
from scripts.camera_lab_setup.resolver import resolve_module
from scripts.camera_lab_setup.visibility import visibility_from_object_info
from scripts import check_setup


def test_director_check_marks_ready_from_v2_object_info():
    visibility = visibility_from_object_info(
        {
            "LTXDirector": {"input": {"required": {}}},
            "LTXDirectorGuide": {"input": {"required": {}}},
            "LTXDirectorCropGuides": {"input": {"required": {}}},
            "UNETLoader": {
                "input": {
                    "required": {
                        "unet_name": ["COMBO", {"options": ["ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors"]}]
                    }
                }
            },
            "LatentUpscaleModelLoader": {
                "input": {"required": {"model_name": ["COMBO", {"options": ["ltx-2.3-spatial-upscaler-x2-1.1.safetensors"]}]}}
            },
            "VAELoader": {
                "input": {
                    "required": {
                        "vae_name": [["LTX23_audio_vae_bf16.safetensors", "LTX23_video_vae_bf16.safetensors", "taeltx2_3.safetensors"], {}]
                    }
                }
            },
            "DualCLIPLoader": {
                "input": {
                    "required": {
                        "clip_name1": [["gemma_3_12B_it_fp4_mixed.safetensors"], {}],
                        "clip_name2": [["ltx-2.3_text_projection_bf16.safetensors"], {}],
                    }
                }
            },
        }
    )

    status = resolve_module(get_module("director"), HardwareProfile(vram_gb=24), visibility)

    assert status.ready is True
    assert status.profile == "director-v2-distilled-fp8"
    assert status.recommendation == "recommended"
    assert status.missing == ()


def test_check_setup_filters_workflow_names_by_module():
    assert check_setup.workflow_names_for_modules(["director"]) == ["ltx_director_2.json"]
