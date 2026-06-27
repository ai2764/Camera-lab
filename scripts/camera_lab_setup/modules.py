from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable


@dataclass(frozen=True)
class ModelRef:
    folder: str
    name: str


@dataclass(frozen=True)
class ModelProfile:
    id: str
    label: str
    required_models: tuple[ModelRef, ...] = ()
    required_nodes: tuple[str, ...] = ()
    min_vram_gb: float | None = None
    recommended_vram_gb: float | None = None
    disk_gb: float = 0.0
    features: tuple[str, ...] = ()


@dataclass(frozen=True)
class CameraLabModule:
    id: str
    label: str
    description: str
    workflows: tuple[str, ...]
    frontend_workspace: str
    required_nodes: tuple[str, ...] = ()
    model_profiles: tuple[ModelProfile, ...] = ()
    optional_nodes: tuple[str, ...] = ()
    optional_models: tuple[ModelRef, ...] = ()


LTX23_TEXT_MODELS = (
    ModelRef("text_encoders", "gemma_3_12B_it_fp4_mixed.safetensors"),
    ModelRef("text_encoders", "ltx-2.3_text_projection_bf16.safetensors"),
)

MODULES: tuple[CameraLabModule, ...] = (
    CameraLabModule(
        id="camera",
        label="Camera Lab",
        description="Standard LTX image/video generation workflows.",
        frontend_workspace="camera",
        workflows=(
            "ltx23_nag_i2v_extendcrop_general.json",
            "ltx23_nag_ia2v_extendcrop_general.json",
            "ltx23_flf_ia2v_nag_extend.json",
            "ltx23_flf_subtitle_cleaner_nag_extend.json",
            "ltx23_i2v_subtitle_cleaner_nag_extend.json",
            "LTX-2.3_FML2V_RuneXX_guider.local.json",
        ),
        required_nodes=("LTXVConditioning",),
        model_profiles=(
            ModelProfile(
                id="camera-ltx23-fp8",
                label="LTX 2.3 FP8",
                required_models=(
                    ModelRef("checkpoints", "ltx-2.3-22b-dev-fp8.safetensors"),
                    ModelRef("loras", "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"),
                    ModelRef("latent_upscale_models", "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"),
                    *LTX23_TEXT_MODELS,
                ),
                min_vram_gb=16,
                recommended_vram_gb=24,
                disk_gb=39,
            ),
        ),
    ),
    CameraLabModule(
        id="director",
        label="Director",
        description="Timeline assembly with LTX Director workflows.",
        frontend_workspace="director",
        workflows=("ltx_director_reference_mvp.json",),
        required_nodes=("LTXDirector", "LTXDirectorGuide"),
        model_profiles=(
            ModelProfile(
                id="director-v1-ltx23-fp8",
                label="Director v1 LTX 2.3 FP8",
                required_models=(
                    ModelRef("checkpoints", "ltx-2.3-22b-dev-fp8.safetensors"),
                    ModelRef("loras", "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"),
                    ModelRef("latent_upscale_models", "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"),
                    ModelRef("vae", "LTX23_audio_vae_bf16.safetensors"),
                    ModelRef("vae", "LTX23_video_vae_bf16.safetensors"),
                    ModelRef("vae", "taeltx2_3.safetensors"),
                    *LTX23_TEXT_MODELS,
                ),
                min_vram_gb=16,
                recommended_vram_gb=24,
                disk_gb=42,
            ),
            ModelProfile(
                id="director-v2-distilled-fp8",
                label="Director v2 Distilled FP8",
                required_nodes=("LTXDirectorCropGuides",),
                required_models=(
                    ModelRef("diffusion_models", "ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors"),
                    ModelRef("latent_upscale_models", "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"),
                    ModelRef("vae", "LTX23_audio_vae_bf16.safetensors"),
                    ModelRef("vae", "LTX23_video_vae_bf16.safetensors"),
                    ModelRef("vae", "taeltx2_3.safetensors"),
                    *LTX23_TEXT_MODELS,
                ),
                min_vram_gb=16,
                recommended_vram_gb=24,
                disk_gb=36,
                features=("timeline-video", "audio-inpaint"),
            ),
        ),
    ),
    CameraLabModule(
        id="edit",
        label="Edit",
        description="WAN Bernini and VACE Inpaint workflows.",
        frontend_workspace="edit",
        workflows=(
            "wan22_bernini_t2v.ui.json",
            "wan22_bernini_i2v.ui.json",
            "wan22_bernini_v2v.ui.json",
            "wan22_bernini_mv2v.ui.json",
            "wan22_bernini_vi2v.ui.json",
            "wan22_bernini_vrc2v.ui.json",
            "wan22_bernini_r2v.ui.json",
            "wan22_bernini_rv2v.ui.json",
            "wan22_bernini_ads2v.ui.json",
            "wan_vace_inpainting.ui.json",
        ),
        model_profiles=(
            ModelProfile(
                id="edit-existing-wan",
                label="Existing WAN models",
                min_vram_gb=16,
                recommended_vram_gb=24,
            ),
        ),
    ),
    CameraLabModule(
        id="casting",
        label="Casting",
        description="Script, voice library, and optional TTS preparation.",
        frontend_workspace="casting",
        workflows=(),
        model_profiles=(ModelProfile(id="casting-local", label="Local voice library"),),
    ),
    CameraLabModule(
        id="motion",
        label="Motion",
        description="Text to Motion, SCAIL2, and 3D Motion workflows.",
        frontend_workspace="motion",
        workflows=("hymotion_guide.api.json", "hymotion_guide.ui.json", "scail2_video.api.json"),
        required_nodes=("HYMotionGenerate",),
        model_profiles=(
            ModelProfile(
                id="motion-existing-scail",
                label="Existing HY-Motion/SCAIL2 models",
                min_vram_gb=16,
                recommended_vram_gb=24,
            ),
        ),
    ),
)


def module_ids() -> list[str]:
    return [module.id for module in MODULES]


def get_module(module_id: str) -> CameraLabModule:
    for module in MODULES:
        if module.id == module_id:
            return module
    raise ValueError(f"unknown module: {module_id}")


def selected_modules(ids: Iterable[str] | None = None) -> list[CameraLabModule]:
    if ids is None:
        return list(MODULES)
    requested = {str(item).strip() for item in ids if str(item).strip()}
    for module_id in requested:
        get_module(module_id)
    return [module for module in MODULES if module.id in requested]
