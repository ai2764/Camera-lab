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
    compatibility: str = "drop_in"
    quantization: str = ""
    size: str = ""
    workflow_group: str = ""
    compatible_workflows: tuple[str, ...] = ()
    notes: str = ""


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
                quantization="FP8",
                size="large",
                workflow_group="LTX Camera",
                compatible_workflows=(
                    "LTX 2.3 checkpoint workflows",
                    "LTX 2.3 FLF/FML workflows",
                ),
                notes="Drop-in profile for checkpoint-based LTX 2.3 app workflows.",
            ),
            ModelProfile(
                id="camera-ltx23-gguf-q4",
                label="LTX 2.3 GGUF Q4",
                required_models=(
                    ModelRef("diffusion_models", "LTXvideo/LTX-2/quantstack/LTX-2.3-distilled-Q4_K_S.gguf"),
                    ModelRef("text_encoders", "gemma-3-12b-it-Q2_K.gguf"),
                    ModelRef("latent_upscale_models", "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"),
                ),
                min_vram_gb=8,
                recommended_vram_gb=12,
                disk_gb=20,
                compatibility="workflow_variant",
                quantization="GGUF Q4",
                size="small",
                workflow_group="LTX Camera",
                notes="Requires a GGUF loader workflow variant; not drop-in for bundled checkpoint/UNET workflows.",
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
                quantization="FP8",
                size="large",
                workflow_group="LTX Director",
                compatible_workflows=("ltx_director_reference_mvp.json",),
                notes="Drop-in profile for the bundled Director Reference MVP workflow.",
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
                compatibility="workflow_variant",
                quantization="FP8 scaled transformer",
                size="large",
                workflow_group="LTX Director v2",
                notes=(
                    "Requires a Director v2 workflow with UNET/text/VAE loader wiring and "
                    "LTXDirectorCropGuides; not drop-in for ltx_director_reference_mvp.json."
                ),
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
                id="edit-bernini-fp8",
                label="WAN2.2 Bernini FP8",
                required_models=(
                    ModelRef("diffusion_models", "kijai-WAN2.2/Wan22_Bernini_HIGH_fp8_e4m3fn_scaled.safetensors"),
                    ModelRef("diffusion_models", "kijai-WAN2.2/Wan22_Bernini_LOW_fp8_e4m3fn_scaled.safetensors"),
                    ModelRef("loras", "wan2.2 lora/wan2.2_t2v_A14b_high_noise_lora_rank64_lightx2v_4step_1217.safetensors"),
                    ModelRef("loras", "wan2.2 lora/wan2.2_t2v_A14b_low_noise_lora_rank64_lightx2v_4step_1217.safetensors"),
                    ModelRef("text_encoders", "ComfyUI-WAN/umt5_xxl_fp8_e4m3fn_scaled.safetensors"),
                    ModelRef("vae", "ComfyUI-WAN/wan_2.1_vae.safetensors"),
                ),
                min_vram_gb=16,
                recommended_vram_gb=24,
                disk_gb=42,
                quantization="FP8",
                size="large",
                workflow_group="WAN Bernini",
                notes="Bundled Bernini workflows require both HIGH and LOW FP8 models; LOW is not a standalone small profile.",
            ),
            ModelProfile(
                id="edit-vace14-fp16",
                label="WAN VACE 14B FP16 Inpaint",
                required_models=(
                    ModelRef("diffusion_models", "wan2.1_vace_14B_fp16.safetensors"),
                    ModelRef("loras", "Wan21_CausVid_14B_T2V_lora_rank32.safetensors"),
                    ModelRef("text_encoders", "umt5_xxl_fp8_e4m3fn_scaled.safetensors"),
                    ModelRef("vae", "wan_2.1_vae.safetensors"),
                    ModelRef("checkpoints", "sam3.1_multiplex_fp16.safetensors"),
                ),
                min_vram_gb=16,
                recommended_vram_gb=24,
                disk_gb=35,
                quantization="FP16 model, FP8 text encoder",
                size="large",
                workflow_group="WAN VACE Inpaint",
                compatible_workflows=("wan_vace_inpainting.ui.json",),
                notes="Drop-in profile for the bundled VACE inpaint workflow.",
            ),
            ModelProfile(
                id="edit-vace14-gguf",
                label="WAN VACE 14B GGUF",
                required_models=(ModelRef("diffusion_models", "Wan2.1_14B_VACE-Q4_K_M.gguf"),),
                min_vram_gb=8,
                recommended_vram_gb=12,
                disk_gb=12,
                compatibility="workflow_variant",
                quantization="GGUF Q4",
                size="small",
                workflow_group="WAN VACE Inpaint",
                notes="Requires a VACE GGUF loader workflow variant; not drop-in for the bundled FP16 VACE workflow.",
            ),
        ),
    ),
    CameraLabModule(
        id="casting",
        label="Casting",
        description="Script, voice library, and optional TTS preparation.",
        frontend_workspace="casting",
        workflows=(),
        model_profiles=(
            ModelProfile(
                id="casting-local",
                label="Local voice library",
                size="small",
                workflow_group="Casting",
                notes="No ComfyUI model is required for the voice library and script preparation tools.",
            ),
            ModelProfile(
                id="casting-cosyvoice3-05b",
                label="CosyVoice3 0.5B",
                min_vram_gb=6,
                recommended_vram_gb=8,
                disk_gb=3,
                quantization="native",
                size="small",
                workflow_group="Casting TTS",
                notes="Compatible with the local Python TTS path when COSYVOICE_MODEL_DIR points at the model directory.",
            ),
            ModelProfile(
                id="casting-cosyvoice3-mlx-4bit",
                label="CosyVoice3 0.5B MLX 4-bit",
                min_vram_gb=4,
                recommended_vram_gb=6,
                disk_gb=2,
                compatibility="backend_variant",
                quantization="MLX 4-bit",
                size="small",
                workflow_group="Casting TTS",
                notes="Requires an MLX backend; not compatible with the current Windows/Python TTS runner.",
            ),
        ),
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
                id="motion-scail2-wan14-fp8",
                label="SCAIL2 WAN 14B FP8",
                required_models=(
                    ModelRef("diffusion_models", "wan2.1_14B_SCAIL_2_fp8_scaled.safetensors"),
                    ModelRef("loras", "lightx2v_I2V_14B_480p_cfg_step_distill_rank64_bf16.safetensors"),
                    ModelRef("text_encoders", "umt5_xxl_fp8_e4m3fn_scaled.safetensors"),
                    ModelRef("vae", "wan_2.1_vae.safetensors"),
                ),
                min_vram_gb=16,
                recommended_vram_gb=24,
                disk_gb=24,
                quantization="FP8 model, BF16 LoRA",
                size="large",
                workflow_group="SCAIL2",
                compatible_workflows=("scail2_video.api.json",),
                notes="Drop-in profile for the bundled SCAIL2 workflow; CLIP Vision H is also required by the workflow.",
            ),
            ModelProfile(
                id="motion-scail2-small",
                label="SCAIL2 low VRAM variant",
                min_vram_gb=8,
                recommended_vram_gb=12,
                compatibility="workflow_variant",
                quantization="unconfirmed",
                size="small",
                workflow_group="SCAIL2",
                notes="No confirmed smaller drop-in SCAIL2 model is registered yet; use reduced frames/resolution until a compatible workflow variant is bundled.",
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
