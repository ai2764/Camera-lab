from __future__ import annotations

import argparse
import json
import mimetypes
import os
import random
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import base64
import copy
import ctypes
import warnings
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Mapping, MutableMapping

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
WEB_DIR = ROOT / "frontend"
RUN_ROOT = ROOT / "tasks" / "camera_lab_runs"
UPLOAD_ROOT = ROOT / "tasks" / "camera_lab_uploads"
SHOT_PACK_ROOT = ROOT / "tasks" / "camera_lab_shots"
HISTORY_STATE = RUN_ROOT / "_history_state.json"
VIDEO_UPLOAD_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
SUPPORTED_VIDEO_SUFFIXES = VIDEO_UPLOAD_SUFFIXES
MAX_VIDEO_UPLOAD_BYTES = 512 * 1024 * 1024
MAX_3DMOTION_DRIVE_BYTES = 512 * 1024 * 1024


def load_env_file(path: Path, env: MutableMapping[str, str] | None = None) -> MutableMapping[str, str]:
    target = env if env is not None else os.environ
    if not path.exists():
        return target
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in target:
            target[key] = value
    return target


def comfy_config_from_env(env: Mapping[str, str]) -> dict[str, Any]:
    root_value = env.get("COMFYUI_ROOT")
    if root_value:
        root = Path(root_value)
    else:
        candidates = [Path("ComfyUI")]
        root = next((candidate for candidate in candidates if candidate.exists()), candidates[-1])
    return {
        "url": env.get("COMFYUI_URL") or "http://127.0.0.1:8000",
        "root": root,
        "input": root / "input",
        "output": root / "output",
        "models": root / "models",
        "workflows": root / "user" / "default" / "workflows",
        "template_workflows": root
        / ".venv"
        / "Lib"
        / "site-packages"
        / "comfyui_workflow_templates_media_video"
        / "templates",
        "ttp_toolset": root / "custom_nodes" / "Comfyui_TTP_Toolset",
    }


load_env_file(ROOT / ".env")
COMFY_CONFIG = comfy_config_from_env(os.environ)
COMFY_URL = COMFY_CONFIG["url"]


def motion_comfy_url(env: Mapping[str, str] = os.environ) -> str:
    """ComfyUI endpoint for HY-Motion/SCAIL. Falls back to COMFY_URL so a future
    single-instance migration needs no code change — just unset COMFYUI_MOTION_URL."""
    return env.get("COMFYUI_MOTION_URL") or COMFY_URL


MOTION_COMFY_URL = motion_comfy_url()


COMFY_INPUT = COMFY_CONFIG["input"]
COMFY_OUTPUT = COMFY_CONFIG["output"]
COMFY_MODELS = COMFY_CONFIG["models"]
MOTION_COMFY_ROOT = Path(os.environ.get("COMFYUI_MOTION_ROOT") or COMFY_CONFIG["root"])
MOTION_COMFY_INPUT = MOTION_COMFY_ROOT / "input"
MOTION_COMFY_OUTPUT = MOTION_COMFY_ROOT / "output"
WORKFLOW_ROOT = COMFY_CONFIG["workflows"]
TEMPLATE_WORKFLOW_ROOT = COMFY_CONFIG["template_workflows"]
YEDP_WEB_JS = COMFY_CONFIG["root"] / "custom_nodes" / "ComfyUI-Yedp-Action-Director" / "web" / "js"
LOCAL_LTX23_DISTILLED_LORA = "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"
APP_WORKFLOW_ROOT = ROOT / "workflows" / "app"
TTP_TOOLSET_ROOT = COMFY_CONFIG["ttp_toolset"]
LTX23_CHECKPOINT = "ltx-2.3-22b-dev-fp8.safetensors"
LTX23_TEXT_ENCODER = "gemma_3_12B_it_fp4_mixed.safetensors"
LTX23_UPSCALER = "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"
DIRECTOR_V2_WORKFLOW_PATH = APP_WORKFLOW_ROOT / "ltx_director_2.json"
HYMOTION_GUIDE_TEMPLATE = APP_WORKFLOW_ROOT / "hymotion_guide.api.json"
SCAIL_VIDEO_TEMPLATE = APP_WORKFLOW_ROOT / "scail2_video.api.json"
PHOTOGRAPHY_WORKFLOW_NAME = "Photography_LTX-2.3_ICLoRA_Union_Control_Canny.local.json"
PHOTOGRAPHY_WORKFLOW_TEMPLATE = ROOT / "workflows" / "experimental" / PHOTOGRAPHY_WORKFLOW_NAME
PHOTOGRAPHY_WORKFLOW_PATH = WORKFLOW_ROOT / PHOTOGRAPHY_WORKFLOW_NAME


def tts_env_path(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def executable_available(value: str, resolver: Any = shutil.which) -> bool:
    path = Path(value)
    if path.is_absolute() or path.parent != Path("."):
        return path.exists()
    return resolver(value) is not None


def display_config_path(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(ROOT.resolve())).replace("\\", "/")
    except ValueError:
        return str(path)

# --- Casting: LLM dialogue analysis + on-demand CosyVoice TTS -----------------
# Provider-neutral OpenAI-compatible LLM endpoint (LM Studio / Ollama / vLLM / cloud).
# Ollama: set LLM_URL=http://127.0.0.1:11434/v1 and LLM_MODEL=gpt-oss:20b
def normalize_llm_url(value: str) -> str:
    raw = (value or "http://127.0.0.1:1234/v1").strip().rstrip("/")
    parsed = urllib.parse.urlparse(raw)
    if parsed.scheme and parsed.netloc and parsed.path in {"", "/"}:
        return raw + "/v1"
    return raw


LLM_URL = normalize_llm_url(os.environ.get("LLM_URL") or "http://127.0.0.1:1234/v1")
LLM_MODEL = os.environ.get("LLM_MODEL") or "gpt-oss-20b"
LLM_API_KEY = os.environ.get("LLM_API_KEY") or ""

# CosyVoice is loaded on demand via a one-shot subprocess in its own conda env.
COSYVOICE_PYTHON = os.environ.get("COSYVOICE_PYTHON") or "python"
COSYVOICE_MODEL_DIR = tts_env_path(os.environ.get("COSYVOICE_MODEL_DIR") or Path("tts") / "models" / "Fun-CosyVoice3-0.5B")
COSYVOICE_VENDOR = tts_env_path(os.environ.get("COSYVOICE_VENDOR") or Path("tts") / "cosyvoice")
CASTING_VOICES_DIR = tts_env_path(os.environ.get("CASTING_VOICES_DIR") or Path("tts") / "voices")
CASTING_LIBRARY_DIR = ROOT / "tts" / "library"
CASTING_TTS_SCRIPT = ROOT / "scripts" / "casting_tts.py"

# Voice roster (data-driven, extensible). ref_text is read from the sibling .txt.
CASTING_VOICES = [
    {"id": "laodao", "label": "Laodao (male)", "gender": "male", "ref_wav": "laodao_en_ref.wav", "ref_txt": "laodao_en_ref.txt"},
    {"id": "xiaomei", "label": "Xiaomei (female)", "gender": "female", "ref_wav": "xiaomei_en_ref.wav", "ref_txt": "xiaomei_en_ref.txt"},
]
CUSTOM_VOICE_PREFIX = "custom_"

# Emotion id -> full natural-language directive (officially-recommended CV3 form;
# the synth script wraps it per CV version). Easy to tune; add Chinese variants if needed.
CASTING_EMOTIONS: dict[str, str] = {
    "neutral": "",
    "warm": "Please speak in a warm, gentle and friendly tone.",
    "serious": "Please speak in a serious, composed and steady tone.",
    "excited": "Please speak in a very excited, energetic tone.",
    "sad": "Please speak in a sad, downcast tone.",
    "angry": "Please speak in an angry, forceful tone.",
    "gentle": "Please speak softly and tenderly.",
    "whisper": "Please say it in a soft, hushed whisper.",
}

REFERENCE_IMAGES: list[dict[str, str]] = []

BERNINI_INPUT_REQUIREMENTS = {
    "bernini_t2v": {"source_image": False, "reference_image": False, "source_video": False, "reference_video": False},
    "bernini_t2i": {"source_image": False, "reference_image": False, "source_video": False, "reference_video": False},
    "bernini_i2v": {"source_image": True, "reference_image": False, "source_video": False, "reference_video": False},
    "bernini_i2i": {"source_image": True, "reference_image": False, "source_video": False, "reference_video": False},
    "bernini_v2v": {"source_image": False, "reference_image": False, "source_video": True, "reference_video": False},
    "bernini_mv2v": {"source_image": False, "reference_image": False, "source_video": True, "reference_video": False},
    "bernini_vi2v": {"source_image": False, "reference_image": True, "source_video": True, "reference_video": False},
    "bernini_vrc2v": {"source_image": False, "reference_image": False, "source_video": True, "reference_video": False},
    "bernini_r2v": {"source_image": False, "reference_image": True, "source_video": False, "reference_video": False},
    "bernini_r2i": {"source_image": False, "reference_image": True, "source_video": False, "reference_video": False},
    "bernini_rv2v": {"source_image": False, "reference_image": True, "source_video": True, "reference_video": False},
    "bernini_ads2v": {"source_image": False, "reference_image": False, "source_video": True, "reference_video": True},
}
BERNINI_IMAGE_MODES = {"bernini_t2i", "bernini_i2i", "bernini_r2i"}
BERNINI_DEFAULT_NEGATIVE = "bad video"
VIDEO_OUTPUT_SUFFIXES = {".mp4", ".webm", ".mov"}
IMAGE_OUTPUT_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
BERNINI_PROMPT_PREFIXES = {
    "bernini_t2v": "You are a helpful assistant specialized in text-to-video generation.",
    "bernini_t2i": "You are a helpful assistant specialized in text-to-image generation.",
    "bernini_i2v": "You are a helpful assistant specialized in image-to-video generation.",
    "bernini_i2i": "You are a helpful assistant specialized in image editing.",
    "bernini_v2v": "You are a helpful assistant specialized in video editing.",
    "bernini_mv2v": "You are a helpful assistant for editing. You might need to adjust the video's style, lighting, colors, textures, and the subject's pose or action.",
    "bernini_vi2v": "You are a helpful assistant specialized in video editing on content propagation.",
    "bernini_vrc2v": "You are a helpful assistant for editing. You may need to adjust the subject's action or position.",
    "bernini_r2v": "You are a helpful assistant specialized in subject-to-video generation.",
    "bernini_r2i": "You are a helpful assistant specialized in subject-to-image generation.",
    "bernini_rv2v": "You are a helpful assistant specialized in video editing with reference.",
    "bernini_ads2v": "You are a helpful assistant specialized in ads insertion.",
}
INPAINT_MODE = "wan_vace_inpaint"
INPAINT_FPS = 24
INPAINT_DEFAULT_NEGATIVE = "bad video"


def is_bernini_mode(mode: str) -> bool:
    return mode in BERNINI_INPUT_REQUIREMENTS


def is_inpaint_mode(mode: str) -> bool:
    return mode == INPAINT_MODE


def bernini_required_inputs(mode: str) -> dict[str, bool]:
    return dict(BERNINI_INPUT_REQUIREMENTS.get(mode, {}))


def bernini_prompt_text(mode: str, prompt: str) -> str:
    text = str(prompt or "").strip()
    prefix = BERNINI_PROMPT_PREFIXES.get(mode, "").strip()
    if prefix and text and not text.startswith(prefix):
        return f"{prefix} {text}"
    return text


def is_supported_video_upload(name: str) -> bool:
    return Path(name).suffix.lower() in SUPPORTED_VIDEO_SUFFIXES


def validate_bernini_media_paths(mode: str, payload: Mapping[str, Any]) -> dict[str, dict[str, str]]:
    required = bernini_required_inputs(mode)
    paths = {
        "source": {"path": ""},
        "reference_image": {"path": ""},
        "source_video": {"path": ""},
        "reference_video": {"path": ""},
    }
    source_path = payload.get("source_path") or ""
    reference_image_path = payload.get("reference_image_path") or ""
    source_video_path = payload.get("source_video_path") or ""
    reference_video_path = payload.get("reference_video_path") or ""
    if required.get("source_image") and not source_path:
        raise ValueError("source image is required")
    if required.get("reference_image") and not reference_image_path:
        raise ValueError("reference image is required")
    if required.get("source_video") and not source_video_path:
        raise ValueError("source video is required")
    if required.get("reference_video") and not reference_video_path:
        raise ValueError("reference video is required")
    if source_path:
        paths["source"] = {"path": str(safe_media_path(source_path))}
    if reference_image_path:
        paths["reference_image"] = {"path": str(safe_media_path(reference_image_path))}
    if source_video_path:
        paths["source_video"] = {"path": str(safe_media_path(source_video_path))}
    if reference_video_path:
        paths["reference_video"] = {"path": str(safe_media_path(reference_video_path))}
    return paths


def validate_inpaint_media_paths(payload: Mapping[str, Any]) -> dict[str, dict[str, str]]:
    source_video_path = payload.get("source_video_path") or ""
    reference_image_path = payload.get("reference_image_path") or ""
    mask_image_path = payload.get("mask_image_path") or ""
    if not source_video_path:
        raise ValueError("source video is required")
    if not mask_image_path:
        raise ValueError("painted mask is required")
    return {
        "source_video": {"path": str(safe_media_path(source_video_path))},
        "reference_image": {"path": str(safe_media_path(reference_image_path)) if reference_image_path else ""},
        "mask_image": {"path": str(safe_media_path(mask_image_path))},
    }


WORKFLOWS = [
    {
        "id": "i2v_official_local",
        "label": "LTX 2.3 I2V Subtitle Cleaner",
        "mode": "i2v",
        "path": str(APP_WORKFLOW_ROOT / "ltx23_i2v_subtitle_cleaner_nag_extend.json"),
    },
    {
        "id": "flf_ttp_control",
        "label": "LTX 2.3 FLF (2 images, audio)",
        "mode": "flf",
        "path": str(APP_WORKFLOW_ROOT / "ltx23_flf_subtitle_cleaner_nag_extend.json"),
        # FLF pins both keyframes; skip the subtitle bottom-matte extend/crop so
        # the source and end frames get identical spatial treatment.
        "disable_image_extension": True,
        "disable_image_crop": True,
    },
    {
        "id": "fml_two_segment_flf",
        "label": "LTX 2.3 FML (3 images, 2-stage, audio)",
        "mode": "fml",
        "path": str(APP_WORKFLOW_ROOT / "ltx23_flf_subtitle_cleaner_nag_extend.json"),
        "disable_image_extension": True,
        "disable_image_crop": True,
    },
    {
        "id": "fml_runexx_guider_local",
        "label": "LTX 2.3 FML RuneXX Guider Local (3 images)",
        "mode": "fml_native",
        "path": str(APP_WORKFLOW_ROOT / "LTX-2.3_FML2V_RuneXX_guider.local.json"),
        "disable_prompt_enhance": True,
    },
    {
        "id": "ia2v_extendcrop",
        "label": "LTX 2.3 IA2V",
        "mode": "ia2v",
        "path": str(APP_WORKFLOW_ROOT / "ltx23_nag_ia2v_extendcrop_general.json"),
        # Same as i2v — turn off the 307px bottom matte add/crop pair.
        "disable_image_extension": True,
        "disable_image_crop": True,
    },
    {
        "id": "flf_ia2v",
        "label": "LTX 2.3 FLF IA2V (2 images + audio)",
        "mode": "flf_ia2v",
        "path": str(APP_WORKFLOW_ROOT / "ltx23_flf_ia2v_nag_extend.json"),
        # First+last keyframes driven by uploaded audio; skip the bottom matte.
        "disable_image_extension": True,
        "disable_image_crop": True,
    },
    {
        "id": "ltx_director_2",
        "label": "LTX Director 2",
        "mode": "director_ref",
        "path": str(DIRECTOR_V2_WORKFLOW_PATH),
        "builder": "ltx_director_2",
    },
    {
        "id": "bernini_t2v",
        "label": "WAN2.2 Bernini T2V",
        "mode": "bernini_t2v",
        "path": str(APP_WORKFLOW_ROOT / "wan22_bernini_t2v.ui.json"),
    },
    {
        "id": "bernini_t2i",
        "label": "WAN2.2 Bernini T2I",
        "mode": "bernini_t2i",
        "path": str(APP_WORKFLOW_ROOT / "wan22_bernini_t2i.ui.json"),
    },
    {
        "id": "bernini_i2v",
        "label": "WAN2.2 Bernini I2V",
        "mode": "bernini_i2v",
        "path": str(APP_WORKFLOW_ROOT / "wan22_bernini_i2v.ui.json"),
    },
    {
        "id": "bernini_i2i",
        "label": "WAN2.2 Bernini I2I",
        "mode": "bernini_i2i",
        "path": str(APP_WORKFLOW_ROOT / "wan22_bernini_i2i.ui.json"),
    },
    {
        "id": "bernini_v2v",
        "label": "WAN2.2 Bernini V2V",
        "mode": "bernini_v2v",
        "path": str(APP_WORKFLOW_ROOT / "wan22_bernini_v2v.ui.json"),
    },
    {
        "id": "bernini_mv2v",
        "label": "WAN2.2 Bernini MV2V",
        "mode": "bernini_mv2v",
        "path": str(APP_WORKFLOW_ROOT / "wan22_bernini_mv2v.ui.json"),
    },
    {
        "id": "bernini_vi2v",
        "label": "WAN2.2 Bernini VI2V",
        "mode": "bernini_vi2v",
        "path": str(APP_WORKFLOW_ROOT / "wan22_bernini_vi2v.ui.json"),
    },
    {
        "id": "bernini_vrc2v",
        "label": "WAN2.2 Bernini VRC2V",
        "mode": "bernini_vrc2v",
        "path": str(APP_WORKFLOW_ROOT / "wan22_bernini_vrc2v.ui.json"),
    },
    {
        "id": "bernini_r2v",
        "label": "WAN2.2 Bernini R2V",
        "mode": "bernini_r2v",
        "path": str(APP_WORKFLOW_ROOT / "wan22_bernini_r2v.ui.json"),
    },
    {
        "id": "bernini_r2i",
        "label": "WAN2.2 Bernini R2I",
        "mode": "bernini_r2i",
        "path": str(APP_WORKFLOW_ROOT / "wan22_bernini_r2i.ui.json"),
    },
    {
        "id": "bernini_rv2v",
        "label": "WAN2.2 Bernini RV2V",
        "mode": "bernini_rv2v",
        "path": str(APP_WORKFLOW_ROOT / "wan22_bernini_rv2v.ui.json"),
    },
    {
        "id": "bernini_ads2v",
        "label": "WAN2.2 Bernini ADS2V",
        "mode": "bernini_ads2v",
        "path": str(APP_WORKFLOW_ROOT / "wan22_bernini_ads2v.ui.json"),
    },
    {
        "id": INPAINT_MODE,
        "label": "WAN VACE Inpaint",
        "mode": INPAINT_MODE,
        "path": str(APP_WORKFLOW_ROOT / "wan_vace_inpainting.ui.json"),
    },
]

DEFAULT_NEGATIVE = (
    "subtitles, captions, text overlay, watermark, logo, title card, extra people, duplicate person, "
    "identity change, face morphing, deformed face, bad hands, extra fingers, missing fingers, camera roll, "
    "dutch angle, sudden cut, scene change, black frame, frozen frame, heavy blur, glitch, low quality"
)

CAMERA_MOVES = [
    {
        "id": "dolly_push_in",
        "name": "Dolly Push In",
        "prompts": {
            "base": "Slow dolly push in. The camera moves physically forward with smooth perspective change and subtle parallax. No cut.",
        },
    },
    {
        "id": "dolly_pull_back",
        "name": "Dolly Pull Back",
        "prompts": {
            "base": (
                "Use the first frame as the close-up and the last frame as the wide shot.\n"
                "Create a smooth continuous camera pull-out from close-up to wide shot.\n"
                "Keep the character frozen in pose, same identity, same clothing, same lighting.\n"
                "Only the camera moves backward, revealing more environment with realistic parallax."
            ),
        },
    },
    {
        "id": "truck_left",
        "name": "Truck Left",
        "prompts": {
            "base": (
                "Camera trucks left smoothly.\n"
                "The subject remains stationary and centered.\n"
                "Realistic horizontal parallax across foreground, midground and background.\n"
                "Environment stays consistent.\n"
                "No character movement.\n"
                "No camera rotation.\n"
                "Pure cinematic lateral movement."
            ),
        },
    },
    {
        "id": "truck_right",
        "name": "Truck Right",
        "prompts": {
            "base": (
                "Camera trucks right smoothly.\n"
                "The subject remains stationary and centered.\n"
                "Realistic horizontal parallax across foreground, midground and background.\n"
                "Environment stays consistent.\n"
                "No character movement.\n"
                "No camera rotation.\n"
                "Pure cinematic lateral movement."
            ),
        },
    },
    {
        "id": "pedestal_up",
        "name": "Pedestal Up",
        "prompts": {
            "base": "Camera cranes upward smoothly. The subject remains stationary. The environment gradually reveals from a higher angle. Stable cinematic motion.",
        },
    },
    {
        "id": "tilt_up",
        "name": "Tilt Up",
        "prompts": {
            "base": "Smooth tilt up. The camera pivots upward from a fixed position. No cut.",
        },
    },
    {
        "id": "pan_right",
        "name": "Pan Right",
        "prompts": {
            "base": "Smooth pan right. The camera rotates horizontally to the right from a fixed position. No cut.",
        },
    },
    {
        "id": "roll_clockwise",
        "name": "Roll Clockwise",
        "prompts": {
            "base": "Subtle camera orbit to the right. The viewpoint arcs smoothly with curved parallax and a small angle change. No cut.",
        },
    },
    {
        "id": "orbit_right",
        "name": "Orbit Right",
        "prompts": {
            "base": (
                "Use the first frame and last frame as keyframes. "
                "Create a smooth clockwise orbit around the subject. "
                "The camera moves in an arc to the right side of the subject. "
                "The subject remains stationary with the same pose, expression, clothing and identity. "
                "Maintain realistic spatial consistency. "
                "Strong cinematic parallax. "
                "Foreground and background rotate naturally around the subject. "
                "No body movement. "
                "No identity change. "
                "No scene change. "
                "Smooth professional cinematography."
            ),
        },
    },
    {
        "id": "foreground_pass",
        "name": "Foreground Pass",
        "prompts": {
            "base": "Slow lateral camera move with a close foreground {object} pass near the edge of frame, creating strong parallax. No cut.",
        },
    },
]

CAMERA_EXAMPLES = {
    "default": {
        "title": "CC0 camera movement reference",
        "url": "https://upload.wikimedia.org/wikipedia/commons/2/29/Movimientos_de_c%C3%A1mara.webm",
        "source_url": "https://commons.wikimedia.org/wiki/File:Movimientos_de_c%C3%A1mara.webm",
        "license": "CC0 1.0",
        "credit": "Blackkairi / Wikimedia Commons",
        "description": "Order in source video: Dolly, Pedestal, Truck, Tilt, Pan, Roll.",
    },
    "segments": {
        "dolly_push_in": {"label": "Dolly segment", "start": 0.0, "end": 4.17},
        "dolly_pull_back": {"label": "Dolly segment", "start": 0.0, "end": 4.17},
        "pedestal_up": {"label": "Pedestal segment", "start": 4.17, "end": 8.33},
        "truck_left": {"label": "Truck segment", "start": 8.33, "end": 12.5},
        "truck_right": {"label": "Truck segment", "start": 8.33, "end": 12.5},
        "tilt_up": {"label": "Tilt segment", "start": 12.5, "end": 16.67},
        "pan_right": {"label": "Pan segment", "start": 16.67, "end": 20.83},
        "roll_clockwise": {"label": "Roll segment", "start": 20.83, "end": 25.0},
        "orbit_right": {
            "type": "diagram",
            "label": "Orbit Right diagram",
            "license": "Original generated UI asset",
            "credit": "Camera Lab",
            "description": "A local diagram showing a rightward curved camera path around the subject.",
        },
        "foreground_pass": {
            "type": "diagram",
            "label": "Foreground Pass diagram",
            "license": "Original generated UI asset",
            "credit": "Camera Lab",
            "description": "A local diagram showing a close foreground element passing across frame with strong parallax.",
        },
    },
}

BATCHES: dict[str, dict[str, Any]] = {}
OBJECT_INFO: dict[str, Any] | None = None
TERMINAL_RUN_STATUSES = {"done", "error", "canceled"}


class RunCanceled(Exception):
    pass


def http_json(path: str, payload: dict | None = None, timeout: int = 30, base_url: str | None = None) -> dict:
    url = (base_url or COMFY_URL).rstrip("/") + path
    if payload is None:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"ComfyUI HTTP {exc.code}: {body}") from exc


def http_post(path: str, payload: dict | None = None, timeout: int = 30, base_url: str | None = None) -> None:
    url = (base_url or COMFY_URL).rstrip("/") + path
    data = json.dumps(payload or {}).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        response.read()


def comfy_port_open(url: str = COMFY_URL, timeout: float = 0.75) -> bool:
    parsed = urllib.parse.urlparse(url)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def comfy_status(probe: Any = http_json, port_probe: Any = comfy_port_open, timeout: int = 2) -> dict[str, Any]:
    if not port_probe(COMFY_URL):
        return {"url": COMFY_URL, "ok": False, "reason": "ComfyUI port is not reachable"}
    try:
        probe("/system_stats", timeout=timeout)
        return {"url": COMFY_URL, "ok": True, "reason": ""}
    except Exception as exc:
        return {
            "url": COMFY_URL,
            "ok": True,
            "reason": f"ComfyUI port is open, but /system_stats is slow: {exc.__class__.__name__}: {exc}",
        }


def object_info() -> dict[str, Any]:
    global OBJECT_INFO
    if OBJECT_INFO is None:
        OBJECT_INFO = http_json("/object_info", timeout=30)
    return OBJECT_INFO


# folder type -> (loader class_type, filename input field) pairs. The union of
# each loader's /object_info combo list is exactly what ComfyUI can load for that
# folder, already merged across the install dir + extra_model_paths + subfolders.
MODEL_FOLDER_LOADERS: dict[str, list[tuple[str, str]]] = {
    "checkpoints": [("CheckpointLoaderSimple", "ckpt_name")],
    "diffusion_models": [("UNETLoader", "unet_name"), ("UnetLoaderGGUF", "unet_name")],
    "vae": [("VAELoader", "vae_name"), ("VAELoaderKJ", "vae_name")],
    "latent_upscale_models": [("LatentUpscaleModelLoader", "model_name")],
    "loras": [("LoraLoaderModelOnly", "lora_name")],
    "text_encoders": [
        ("CLIPLoader", "clip_name"),
        ("DualCLIPLoader", "clip_name1"), ("DualCLIPLoader", "clip_name2"),
        ("DualCLIPLoaderGGUF", "clip_name1"), ("DualCLIPLoaderGGUF", "clip_name2"),
        ("LTXAVTextEncoderLoader", "text_encoder_name"), ("LTXAVTextEncoderLoader", "clip_name"),
    ],
}


def director_ic_loras() -> list[str]:
    """IC-LoRA options the LTXDirectorGuide node accepts, filtered to IC-LoRA
    weights with "None" first. Returns ["None"] when ComfyUI or the node is
    unavailable so the Director IC-LoRA dropdown always has a safe default."""
    try:
        node = object_info().get("LTXDirectorGuide", {})
        inputs = node.get("input", {}) or {}
        required = inputs.get("required", {}) or {}
        optional = inputs.get("optional", {}) or {}
        entry = required.get("ic_lora_name") or optional.get("ic_lora_name")
    except Exception:
        entry = None
    options: list[str] = []
    if isinstance(entry, list) and entry and isinstance(entry[0], list):
        options = [str(item) for item in entry[0]]
    ic = [
        name
        for name in options
        if name != "None" and any(token in name.lower() for token in ("ic-lora", "iclora", "ic_lora"))
    ]
    return ["None", *ic]


def available_models() -> dict[str, set[str]]:
    """Model files ComfyUI can actually load, per folder, read from /object_info
    loader combo lists. Location-agnostic: covers extra_model_paths and subfolders
    so the preflight no longer depends on COMFY_MODELS being the real model dir.

    A folder is omitted when its list is empty or unreachable, so callers treat it
    as "unknown" (never a false "missing") — this absorbs ComfyUI dropping a custom
    folder's combo list mid-session, and ComfyUI being down."""
    try:
        oi = object_info()
    except Exception:
        return {}
    out: dict[str, set[str]] = {}
    for folder, loaders in MODEL_FOLDER_LOADERS.items():
        names: set[str] = set()
        for node, field in loaders:
            spec = oi.get(node, {}).get("input", {}) or {}
            entry = {**spec.get("required", {}), **spec.get("optional", {})}.get(field)
            if isinstance(entry, list) and entry and isinstance(entry[0], list):
                names.update(str(x) for x in entry[0])
        if names:
            out[folder] = names
    return out


def model_listed(folder: str, name: str, avail: dict[str, set[str]] | None = None) -> bool:
    """True only when ComfyUI definitely offers this model. Use for positive
    overrides (apply the swap only when we are sure the target exists)."""
    if avail is None:
        avail = available_models()
    return name in avail.get(folder, set())


def model_missing(folder: str, name: str, avail: dict[str, set[str]] | None = None) -> bool:
    """True only when we are confident the model is absent (folder known and
    non-empty but the name is not in it). Unknown/empty folder -> False so we
    never block on uncertainty. Use for availability hints / warnings."""
    if avail is None:
        avail = available_models()
    bucket = avail.get(folder)
    return bool(bucket) and name not in bucket


def sync_photography_workflow(comfy_input_subdir: str, subject_image: str = "") -> Path:
    if not PHOTOGRAPHY_WORKFLOW_TEMPLATE.exists():
        raise FileNotFoundError(f"photography workflow template is missing: {PHOTOGRAPHY_WORKFLOW_TEMPLATE}")
    workflow = json.loads(PHOTOGRAPHY_WORKFLOW_TEMPLATE.read_text(encoding="utf-8"))
    dataset_node = next((node for node in workflow.get("nodes", []) if node.get("type") == "LoadImageDataSetFromFolder"), None)
    if not dataset_node:
        raise RuntimeError("photography workflow does not contain LoadImageDataSetFromFolder")
    folder = str(comfy_input_subdir).replace("\\", "/")
    dataset_node["widgets_values"] = [folder]
    if subject_image:
        subject_node = next((node for node in workflow.get("nodes", []) if node.get("id") == 2004 and node.get("type") == "LoadImage"), None)
        if not subject_node:
            raise RuntimeError("photography workflow does not contain subject LoadImage node 2004")
        subject_node["widgets_values"] = [str(subject_image).replace("\\", "/"), "image"]
    PHOTOGRAPHY_WORKFLOW_PATH.parent.mkdir(parents=True, exist_ok=True)
    PHOTOGRAPHY_WORKFLOW_PATH.write_text(json.dumps(workflow, ensure_ascii=False, indent=2), encoding="utf-8")
    return PHOTOGRAPHY_WORKFLOW_PATH


def resize_cover(src: Path, dst: Path, width: int = 1280, height: int = 720) -> None:
    img = Image.open(src).convert("RGB")
    scale = max(width / img.width, height / img.height)
    resized = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - width) // 2
    top = (resized.height - height) // 2
    cropped = resized.crop((left, top, left + width, top + height))
    dst.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(dst, quality=95)


def resize_contain_pad(src: Path, dst: Path, width: int = 1280, height: int = 720) -> None:
    img = Image.open(src).convert("RGB")
    scale = min(width / img.width, height / img.height)
    resized = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (width, height), (0, 0, 0))
    left = (width - resized.width) // 2
    top = (height - resized.height) // 2
    canvas.paste(resized, (left, top))
    dst.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dst, quality=95)


def build_link_map(workflow: dict) -> dict[int, tuple[int, int]]:
    return {int(link[0]): (int(link[1]), int(link[2])) for link in workflow.get("links", [])}


def resolve_link(link_id: int, nodes_by_id: dict[int, dict], links: dict[int, tuple[int, int]]) -> list:
    origin_id, slot = links[int(link_id)]
    origin = nodes_by_id[origin_id]
    if origin.get("type") == "Reroute":
        input_link = origin.get("inputs", [{}])[0].get("link")
        if input_link is None:
            raise RuntimeError(f"Broken reroute node {origin_id}")
        return resolve_link(int(input_link), nodes_by_id, links)
    return [str(origin_id), slot]


def workflow_to_api(workflow: dict) -> dict:
    workflow = expand_subgraphs_recursive(workflow)
    workflow = inline_set_get_nodes(workflow)
    nodes = workflow.get("nodes", [])
    nodes_by_id = {int(node["id"]): node for node in nodes}
    links = build_link_map(workflow)
    info = object_info()
    api: dict[str, dict] = {}

    for node in nodes:
        node_type = node.get("type")
        if node_type in {"Reroute", "Note", "MarkdownNote", "PreviewAny", "easy showAnything"}:
            continue
        if node_type == "LTXVImgToVideoInplaceKJ":
            api[str(node["id"])] = {"class_type": node_type, "inputs": kj_dynamic_inputs(node, nodes_by_id, links)}
            continue

        inputs = {}
        raw_widget_values = node.get("widgets_values") or []
        widget_map = raw_widget_values if isinstance(raw_widget_values, dict) else {}
        widget_values = [] if widget_map else list(raw_widget_values)
        widget_idx = 0
        for input_def in node.get("inputs", []):
            name = input_def.get("name")
            if not name:
                continue
            link = input_def.get("link")
            if link is not None:
                if int(link) not in links or links[int(link)][0] not in nodes_by_id:
                    widget_name = (input_def.get("widget") or {}).get("name")
                    if widget_name in widget_map:
                        inputs[name] = widget_map[widget_name]
                    elif input_def.get("widget") is not None and widget_idx < len(widget_values):
                        inputs[name] = widget_values[widget_idx]
                        widget_idx += 1
                    continue
                inputs[name] = resolve_link(int(link), nodes_by_id, links)
                if input_def.get("widget") is not None and widget_idx < len(widget_values):
                    widget_idx += 1
            elif input_def.get("widget") is not None and widget_idx < len(widget_values):
                widget_name = (input_def.get("widget") or {}).get("name")
                inputs[name] = widget_map.get(widget_name, widget_values[widget_idx])
                widget_idx += 1
        widget_idx = fill_widget_inputs_from_object_info(node_type, inputs, widget_values, widget_idx, info, widget_map)
        api[str(node["id"])] = {"class_type": node_type, "inputs": inputs, "_meta": {"title": node.get("title", "")}}
    return api


def workflow_subgraph_ids(workflow: dict) -> set[str]:
    return {str(sg.get("id")) for sg in workflow.get("definitions", {}).get("subgraphs", []) if sg.get("id")}


def workflow_has_subgraph_nodes(workflow: dict) -> bool:
    subgraph_ids = workflow_subgraph_ids(workflow)
    return bool(subgraph_ids) and any(str(node.get("type")) in subgraph_ids for node in workflow.get("nodes", []))


def expand_subgraphs_recursive(workflow: dict, max_passes: int = 8) -> dict:
    expanded = workflow
    for _ in range(max_passes):
        if not workflow_has_subgraph_nodes(expanded):
            return expanded
        expanded = expand_subgraphs(expanded)
    return expanded


def inline_set_get_nodes(workflow: dict) -> dict:
    nodes = workflow.get("nodes", [])
    set_links: dict[str, int | None] = {}
    for node in nodes:
        if node.get("type") != "SetNode":
            continue
        key = str((node.get("widgets_values") or [""])[0])
        inputs = node.get("inputs") or []
        set_links[key] = inputs[0].get("link") if inputs else None

    if not set_links:
        return workflow

    expanded = copy.deepcopy(workflow)
    nodes_by_link: dict[int, list[dict[str, Any]]] = {}
    for node in expanded.get("nodes", []):
        for input_def in node.get("inputs") or []:
            link = input_def.get("link")
            if link is not None:
                nodes_by_link.setdefault(int(link), []).append(input_def)

    links_by_origin: dict[int, list[int]] = {}
    for link in expanded.get("links", []):
        try:
            links_by_origin.setdefault(int(link[1]), []).append(int(link[0]))
        except Exception:
            continue

    for node in expanded.get("nodes", []):
        if node.get("type") != "GetNode":
            continue
        key = str((node.get("widgets_values") or [""])[0])
        replacement = set_links.get(key)
        link_ids = set(links_by_origin.get(int(node["id"]), []))
        for output in node.get("outputs") or []:
            for link in output.get("links") or []:
                link_ids.add(int(link))
        for link in link_ids:
            for input_def in nodes_by_link.get(int(link), []):
                input_def["link"] = replacement
    set_get_ids = {int(node["id"]) for node in expanded.get("nodes", []) if node.get("type") in {"GetNode", "SetNode"}}
    expanded["nodes"] = [node for node in expanded.get("nodes", []) if int(node["id"]) not in set_get_ids]
    expanded["links"] = [
        link
        for link in expanded.get("links", [])
        if int(link[1]) not in set_get_ids
    ]
    return expanded


def expand_subgraphs(workflow: dict) -> dict:
    subgraphs = {sg.get("id"): sg for sg in workflow.get("definitions", {}).get("subgraphs", [])}
    if not subgraphs:
        return workflow

    expanded = copy.deepcopy(workflow)
    nodes = expanded.get("nodes", [])
    links = expanded.get("links", [])
    all_link_ids = [int(link[0]) for link in links]
    for subgraph in subgraphs.values():
        all_link_ids.extend(int(link["id"]) for link in subgraph.get("links", []))
    next_link_id = max(all_link_ids + [0]) + 1
    output_links_by_node: dict[int, list[list[Any]]] = {}
    input_links_by_node: dict[int, list[list[Any]]] = {}
    for link in links:
        output_links_by_node.setdefault(int(link[1]), []).append(link)
        input_links_by_node.setdefault(int(link[3]), []).append(link)

    new_nodes: list[dict[str, Any]] = []
    new_links = [link for link in links if str(nodes_by_id(nodes, int(link[1])).get("type")) not in subgraphs and str(nodes_by_id(nodes, int(link[3])).get("type")) not in subgraphs]

    for node in nodes:
        subgraph = subgraphs.get(str(node.get("type")))
        if not subgraph:
            new_nodes.append(node)
            continue

        input_links = {int(link[4]): link for link in input_links_by_node.get(int(node["id"]), [])}
        output_links = output_links_by_node.get(int(node["id"]), [])
        internal_nodes = copy.deepcopy(subgraph.get("nodes", []))
        internal_links = copy.deepcopy(subgraph.get("links", []))

        for internal_link in internal_links:
            link_id = int(internal_link["id"])
            origin_id = int(internal_link["origin_id"])
            target_id = int(internal_link["target_id"])
            if origin_id == -10:
                external = input_links.get(int(internal_link["origin_slot"]))
                if external:
                    new_links.append([
                        next_link_id,
                        int(external[1]),
                        int(external[2]),
                        target_id,
                        int(internal_link["target_slot"]),
                        internal_link.get("type", external[5]),
                    ])
                    replace_node_input_link(internal_nodes, target_id, link_id, next_link_id)
                    next_link_id += 1
                else:
                    replace_node_input_link(internal_nodes, target_id, link_id, None)
                continue

            if target_id == -20:
                for external in output_links:
                    if int(external[2]) != int(internal_link["target_slot"]):
                        continue
                    new_links.append([
                        next_link_id,
                        origin_id,
                        int(internal_link["origin_slot"]),
                        int(external[3]),
                        int(external[4]),
                        internal_link.get("type", external[5]),
                    ])
                    replace_node_input_link(new_nodes, int(external[3]), int(external[0]), next_link_id)
                    next_link_id += 1
                continue

            new_links.append([
                link_id,
                origin_id,
                int(internal_link["origin_slot"]),
                target_id,
                int(internal_link["target_slot"]),
                internal_link.get("type", ""),
            ])

        new_nodes.extend(internal_nodes)

    expanded["nodes"] = new_nodes
    expanded["links"] = new_links
    return expanded


def nodes_by_id(nodes: list[dict[str, Any]], node_id: int) -> dict[str, Any]:
    for node in nodes:
        if int(node["id"]) == node_id:
            return node
    return {}


def replace_node_input_link(nodes: list[dict[str, Any]], node_id: int, old_link: int, new_link: int | None) -> None:
    for node in nodes:
        if int(node["id"]) != node_id:
            continue
        for input_def in node.get("inputs", []):
            if input_def.get("link") == old_link:
                input_def["link"] = new_link


def fill_widget_inputs_from_object_info(
    node_type: str,
    inputs: dict[str, Any],
    widget_values: list[Any],
    widget_idx: int,
    info: dict[str, Any],
    widget_map: dict[str, Any] | None = None,
) -> int:
    widget_map = widget_map or {}
    node_info = info.get(node_type) or {}
    input_order = node_info.get("input_order") or {}
    input_config = node_info.get("input") or {}
    input_defs = {**(input_config.get("required") or {}), **(input_config.get("optional") or {})}
    ordered_names = list(input_order.get("required") or []) + list(input_order.get("optional") or [])
    for name in ordered_names:
        if name in inputs:
            continue
        if name in widget_map:
            inputs[name] = widget_map[name]
            continue
        if not is_widget_input(input_defs.get(name)):
            continue
        if widget_idx >= len(widget_values):
            continue
        while (
            widget_idx < len(widget_values)
            and isinstance(widget_values[widget_idx], str)
            and widget_values[widget_idx] in {"fixed", "increment", "decrement", "randomize"}
        ):
            widget_idx += 1
        if widget_idx >= len(widget_values):
            break
        inputs[name] = widget_values[widget_idx]
        widget_idx += 1
    return widget_idx


def is_widget_input(input_def: Any) -> bool:
    if not isinstance(input_def, list) or not input_def:
        return True
    first = input_def[0]
    if isinstance(first, list):
        return True
    if first in {"INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"}:
        return True
    return False


def kj_dynamic_inputs(node: dict, nodes_by_id: dict[int, dict], links: dict[int, tuple[int, int]]) -> dict:
    inputs: dict[str, Any] = {"num_images": str((node.get("widgets_values") or ["2"])[0])}
    widget_values = list(node.get("widgets_values") or [])[1:]
    widget_idx = 0
    for input_def in node.get("inputs", []):
        name = input_def.get("name")
        if not name:
            continue
        link = input_def.get("link")
        if name in {"vae", "latent"} and link is not None:
            inputs[name] = resolve_link(int(link), nodes_by_id, links)
            continue
        if name.startswith("num_images."):
            if link is not None:
                inputs[name] = resolve_link(int(link), nodes_by_id, links)
            elif input_def.get("widget") is not None and widget_idx < len(widget_values):
                inputs[name] = widget_values[widget_idx]
                widget_idx += 1
    return inputs


def director_timeline_from_payload(payload: dict[str, Any], fps: int = 24) -> dict[str, Any]:
    raw_segments = payload.get("timeline_segments") or payload.get("segments") or []
    segments: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_segments, start=1):
        prompt = str(raw.get("prompt") or "").strip()
        duration = max(0.25, float(raw.get("duration") or raw.get("length_seconds") or 1.0))
        frames = max(1, round(duration * fps))
        start_seconds = raw.get("start")
        start_frame = raw.get("start_frame")
        if start_frame is None and start_seconds is not None:
            start_frame = round(float(start_seconds) * fps)
        role = ""
        image_path = str(raw.get("image_path") or "").strip()
        video_path = str(raw.get("video_path") or "").strip()
        seg_type = str(raw.get("type") or ("video" if video_path else ("image" if image_path else "text"))).strip() or "text"
        if video_path:
            seg_type = "video"
        elif image_path:
            seg_type = "image"
        elif seg_type not in {"text"}:
            seg_type = "text"
        if seg_type not in {"image", "video", "text"}:
            seg_type = "text"
        if not prompt and not image_path and not video_path:
            continue
        if not prompt:
            prompt = "visual guide"
        strength = max(0.0, min(10.0, float(raw.get("strength") or 0.0)))
        trim_start = raw.get("trimStart", raw.get("trim_start", 0))
        sequential_start = sum(s["frames"] for s in segments)
        guide_frame = int(raw.get("guide_frame") if raw.get("guide_frame") is not None else (start_frame if start_frame is not None else sequential_start))
        segments.append(
            {
                "id": str(raw.get("id") or f"camera-lab-segment-{index}"),
                "type": seg_type,
                "prompt": prompt,
                "duration": duration,
                "frames": frames,
                "reference": role,
                "image_path": image_path,
                "video_path": video_path,
                "audio_path": str(raw.get("audio_path") or "").strip(),
                "guide_frame": max(0, guide_frame),
                "strength": strength,
                "start_frame": max(0, int(start_frame if start_frame is not None else sequential_start)),
                "trimStart": max(0, int(trim_start or 0)),
            }
        )
    if not segments:
        segments = [
            {
                "prompt": str(payload.get("prompt") or "A continuous cinematic shot.").strip(),
                "duration": max(0.25, float(payload.get("duration") or 4.0)),
                "frames": max(1, round(float(payload.get("duration") or 4.0) * fps)),
                "reference": "",
                "image_path": "",
                "video_path": "",
                "audio_path": "",
                "guide_frame": 0,
                "strength": 0.0,
                "start_frame": 0,
            }
        ]
    duration_frames = sum(segment["frames"] for segment in segments)
    if payload.get("timeline_segments"):
        duration_frames = max(duration_frames, max(segment["start_frame"] + segment["frames"] for segment in segments))
    audio_segments = director_audio_segments_from_payload(payload, fps=fps)
    motion_segments = director_motion_segments_from_payload(payload, fps=fps)
    if motion_segments:
        duration_frames = max(duration_frames, max(segment["start"] + segment["length"] for segment in motion_segments))
    if audio_segments:
        duration_frames = max(duration_frames, max(segment["start"] + segment["length"] for segment in audio_segments))
    duration_seconds = round(duration_frames / fps, 3)
    local_prompts, segment_lengths = director_prompt_segments_from_timeline(segments, duration_frames)
    return {
        "global_prompt": str(payload.get("global_prompt") or "").strip(),
        "global_reference_strength": max(0.0, min(1.0, float(payload.get("global_reference_strength") or 0.35))),
        "local_prompts": local_prompts,
        "segment_lengths": segment_lengths,
        "duration_frames": duration_frames,
        "duration_seconds": duration_seconds,
        "fps": fps,
        "segments": segments,
        "audio_segments": audio_segments,
        "motion_segments": motion_segments,
        "guide_frames": [],
        "guide_strengths": [],
        "guide_roles": [],
    }


def director_audio_segments_from_payload(payload: dict[str, Any], fps: int = 24) -> list[dict[str, Any]]:
    raw_segments = payload.get("audio_segments") or []
    segments: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_segments, start=1):
        audio_path = str(raw.get("audio_path") or raw.get("file") or "").strip()
        if not audio_path:
            continue
        start_frame = raw.get("start_frame")
        if start_frame is None:
            start_frame = round(float(raw.get("start") or 0) * fps)
        length_frames = raw.get("length")
        if length_frames is None:
            length_frames = round(max(0.25, float(raw.get("duration") or 1.0)) * fps)
        trim_start = raw.get("trimStart", raw.get("trim_start", 0))
        raw_volume = raw.get("volume", 1.0)
        volume = 1.0 if raw_volume is None else max(0.0, min(4.0, float(raw_volume)))
        segment = {
            "id": str(raw.get("id") or f"camera-lab-audio-{index}"),
            "audio_path": audio_path,
            "start": max(0, int(start_frame)),
            "length": max(1, int(length_frames)),
            "trimStart": max(0, int(trim_start or 0)),
            "volume": volume,
        }
        source = str(raw.get("source") or "").strip()
        if source == "video":
            segment["source"] = source
        segments.append(segment)
    return segments


def stage_director_audio(src: Path, dst: Path, volume: float = 1.0, runner: Any = subprocess.run) -> None:
    """Stage one director audio clip into ComfyUI input, scaled by `volume`
    (1.0 = unchanged). Gained clips are re-rendered audio-only via ffmpeg so a
    video source contributes just its scaled audio track; the LTXDirector node
    then sums the already-scaled clips."""
    if abs(float(volume) - 1.0) < 1e-3:
        shutil.copy2(src, dst)
        return
    runner(
        ["ffmpeg", "-y", "-i", str(src), "-vn", "-filter:a", f"volume={float(volume):.3f}", str(dst)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def director_motion_segments_from_payload(payload: dict[str, Any], fps: int = 24) -> list[dict[str, Any]]:
    raw_segments = payload.get("motion_segments") or payload.get("motionSegments") or []
    segments: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_segments, start=1):
        video_path = str(raw.get("video_path") or raw.get("videoFile") or raw.get("file") or "").strip()
        if not video_path:
            continue
        start_frame = raw.get("start_frame")
        if start_frame is None:
            start_frame = round(float(raw.get("start") or 0) * fps)
        length_frames = raw.get("length")
        if length_frames is None:
            length_frames = round(max(0.25, float(raw.get("duration") or 1.0)) * fps)
        trim_start = raw.get("trimStart", raw.get("trim_start", 0))
        segments.append({
            "id": str(raw.get("id") or f"camera-lab-motion-{index}"),
            "type": "motion_video",
            "video_path": video_path,
            "start": max(0, int(start_frame)),
            "length": max(1, int(length_frames)),
            "trimStart": max(0, int(trim_start or 0)),
        })
    return segments


def director_prompt_segments_from_timeline(segments: list[dict[str, Any]], duration_frames: int) -> tuple[str, str]:
    sorted_segments = sorted(segments, key=lambda segment: segment["start_frame"])
    prompts: list[str] = []
    lengths: list[int] = []
    current_cursor = 0
    pending_gap = 0
    for segment in sorted_segments:
        start = int(segment["start_frame"])
        length = int(segment["frames"])
        if start >= duration_frames:
            break
        if start > current_cursor:
            gap_length = min(start, duration_frames) - current_cursor
            if lengths:
                lengths[-1] += gap_length
            else:
                pending_gap += gap_length
        clipped_end = min(start + length, duration_frames)
        clipped_length = max(0, clipped_end - start)
        prompts.append(str(segment.get("prompt") or ""))
        lengths.append(clipped_length + pending_gap)
        pending_gap = 0
        current_cursor = start + length
    clamped_cursor = min(current_cursor, duration_frames)
    if lengths and clamped_cursor < duration_frames:
        lengths[-1] += duration_frames - clamped_cursor
    return " | ".join(prompts), ",".join(str(length) for length in lengths)


def normalize_reference_image_paths(refs: Any) -> list[str]:
    if isinstance(refs, list):
        return [str(path) for path in refs if str(path or "").strip()]
    if isinstance(refs, dict):
        paths: list[str] = []
        for key in ("global", "character", "scene", "prop", "style"):
            value = refs.get(key)
            if isinstance(value, list):
                paths.extend(str(path) for path in value if str(path or "").strip())
            elif str(value or "").strip():
                paths.append(str(value))
        return paths
    if str(refs or "").strip():
        return [str(refs)]
    return []


def copy_director_reference_images(run: dict[str, Any], timeline: dict[str, Any], width: int, height: int) -> list[str]:
    COMFY_INPUT.mkdir(parents=True, exist_ok=True)
    refs = normalize_reference_image_paths(run.get("reference_images") or [])
    input_names: list[str] = []
    for index, raw_path in enumerate(refs, start=1):
        src = Path(raw_path)
        if not src.exists():
            continue
        frame = Path(run["run_dir"]) / f"reference_{index:02d}_{width}x{height}.png"
        resize_contain_pad(src, frame, width=width, height=height)
        name = f"{run['run_id']}_reference_{index:02d}.png"
        shutil.copy2(frame, COMFY_INPUT / name)
        input_names.append(name)
    return input_names


def copy_director_timeline_images(run: dict[str, Any], timeline: dict[str, Any], width: int, height: int) -> dict[int, str]:
    media = copy_director_timeline_media(run, timeline, width, height)
    return {index: item["name"] for index, item in media.items() if item.get("type") == "image"}


def copy_director_timeline_media(run: dict[str, Any], timeline: dict[str, Any], width: int, height: int) -> dict[int, dict[str, str]]:
    COMFY_INPUT.mkdir(parents=True, exist_ok=True)
    input_names: dict[int, dict[str, str]] = {}
    for index, segment in enumerate(timeline["segments"], start=1):
        raw_video_path = segment.get("video_path")
        if raw_video_path:
            src = Path(str(raw_video_path))
            if not src.exists():
                continue
            name = f"{safe_filename(str(run['batch_id']))}_{safe_filename(str(run['run_id']))}_timeline_{index:02d}{src.suffix or '.mp4'}"
            shutil.copy2(src, COMFY_INPUT / name)
            input_names[index] = {"type": "video", "name": name}
            continue
        raw_path = segment.get("image_path")
        if not raw_path:
            continue
        src = Path(str(raw_path))
        if not src.exists():
            continue
        frame = Path(run["run_dir"]) / f"timeline_{index}_{width}x{height}.png"
        resize_cover(src, frame, width=width, height=height)
        name = f"{safe_filename(str(run['batch_id']))}_{safe_filename(str(run['run_id']))}_timeline_{index:02d}.png"
        shutil.copy2(frame, COMFY_INPUT / name)
        input_names[index] = {"type": "image", "name": name}
    return input_names


def director_reference_timeline_segments(
    timeline: dict[str, Any],
    _global_input_names: Any,
    timeline_input_names: dict[int, Any],
) -> list[dict[str, Any]]:
    segments = []
    for index, segment in enumerate(timeline["segments"], start=1):
        seg_type = str(segment.get("type") or "image")
        start_frame = segment.get("guide_frame", segment["start_frame"])
        item = {
            "id": segment.get("id") or f"camera-lab-segment-{index}",
            "type": seg_type,
            "label": f"segment {index}",
            "start": max(0, int(start_frame)),
            "length": int(segment["frames"]),
            "prompt": segment.get("prompt") or "",
        }
        if seg_type != "text" and index in timeline_input_names:
            media = timeline_input_names[index]
            if isinstance(media, dict):
                item["type"] = "video" if media.get("type") == "video" else "image"
                item["imageFile"] = media.get("name") or ""
                if item["type"] == "video":
                    item["trimStart"] = int(segment.get("trimStart") or 0)
            else:
                item["type"] = "image"
                item["imageFile"] = media
            item["strength"] = float(segment.get("strength") or 0.7)
        segments.append(item)
    return segments


def director_timeline_audio_segments(run: dict[str, Any], timeline: dict[str, Any]) -> list[dict[str, Any]]:
    """Copy each segment's audio into ComfyUI input and build LTXDirector native
    `audioSegments` entries using independent timeline frame ranges."""
    COMFY_INPUT.mkdir(parents=True, exist_ok=True)
    audio_segments: list[dict[str, Any]] = []
    timeline_audio = timeline.get("audio_segments") or []
    source_segments = timeline_audio or [
        {
            "audio_path": segment.get("audio_path"),
            "start": int(segment["start_frame"]),
            "length": int(segment["frames"]),
            "trimStart": 0,
        }
        for segment in timeline["segments"]
    ]
    for index, segment in enumerate(source_segments, start=1):
        raw_path = segment.get("audio_path")
        if not raw_path:
            continue
        src = Path(str(raw_path))
        if not src.exists():
            raise FileNotFoundError(f"Director audio segment file is missing: {src}")
        raw_volume = segment.get("volume", 1.0)
        volume = 1.0 if raw_volume is None else float(raw_volume)
        gained = abs(volume - 1.0) >= 1e-3
        # Gained clips are re-rendered as audio-only WAV; at unity gain keep the
        # source container so an unscaled video source still decodes natively.
        ext = ".wav" if gained else (src.suffix or ".wav")
        name = f"{run['run_id']}_segaudio_{index:02d}_{safe_filename(src.stem)}{ext}"
        stage_director_audio(src, COMFY_INPUT / name, volume)
        audio_segments.append({
            "audioFile": name,
            "fileName": src.name,
            "start": int(segment["start"]),
            "length": int(segment["length"]),
            "trimStart": int(segment.get("trimStart") or 0),
        })
    return audio_segments


def copy_director_motion_segments(run: dict[str, Any], motion_segments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    COMFY_INPUT.mkdir(parents=True, exist_ok=True)
    copied: list[dict[str, Any]] = []
    for index, segment in enumerate(motion_segments, start=1):
        raw_path = segment.get("video_path")
        if not raw_path:
            continue
        src = Path(str(raw_path))
        if not src.exists():
            continue
        name = f"{safe_filename(str(run['batch_id']))}_{safe_filename(str(run['run_id']))}_ic_video_{index:02d}{src.suffix or '.mp4'}"
        shutil.copy2(src, COMFY_INPUT / name)
        copied.append({
            "id": segment.get("id") or f"camera-lab-motion-{index}",
            "type": "motion_video",
            "label": f"IC video {index}",
            "start": int(segment["start"]),
            "length": int(segment["length"]),
            "videoFile": name,
            "trimStart": int(segment.get("trimStart") or 0),
        })
    return copied


def build_ltx_director_v2_api(run: dict[str, Any]) -> dict[str, dict]:
    workflow_json = json.loads(DIRECTOR_V2_WORKFLOW_PATH.read_text(encoding="utf-8"))
    api = workflow_to_api(workflow_json)
    timeline = director_timeline_from_payload(run, fps=24)
    width = int(run["width"])
    height = int(run["height"])
    timeline_input_names = copy_director_timeline_media(run, timeline, width, height)

    director = next((node for node in api.values() if node.get("class_type") == "LTXDirector"), None)
    if not director:
        raise RuntimeError("Director v2 workflow does not contain an LTXDirector node")
    director["inputs"]["global_prompt"] = timeline["global_prompt"]
    director["inputs"]["duration_frames"] = timeline["duration_frames"]
    director["inputs"]["duration_seconds"] = timeline["duration_seconds"]
    # Block 0 placeholder: keep reference_images accepted but do not stage or
    # wire global references until the Ingredients/IC-LoRA plan.
    guide_segments = director_reference_timeline_segments(timeline, [], timeline_input_names)
    audio_segments = director_timeline_audio_segments(run, timeline)
    motion_segments = copy_director_motion_segments(run, timeline.get("motion_segments") or [])
    timeline_data = {"segments": guide_segments, "audioSegments": audio_segments}
    if motion_segments:
        timeline_data["motionSegments"] = motion_segments
    director["inputs"]["timeline_data"] = json.dumps(timeline_data, ensure_ascii=False)
    director["inputs"]["overrideAudio"] = False
    director["inputs"]["inpaint_audio"] = bool(run.get("inpaint_audio", True))
    director["inputs"]["use_custom_audio"] = False
    if audio_segments:
        director["inputs"]["use_custom_audio"] = True
    director["inputs"]["local_prompts"] = timeline["local_prompts"]
    director["inputs"]["segment_lengths"] = timeline["segment_lengths"]
    director["inputs"]["guide_strength"] = ",".join(
        str(segment["strength"]) for segment in guide_segments if segment.get("type") == "image" and "strength" in segment
    )
    director["inputs"]["frame_rate"] = timeline["fps"]
    director["inputs"]["custom_width"] = width
    director["inputs"]["custom_height"] = height
    director["inputs"]["display_mode"] = "seconds"
    director["inputs"]["resize_method"] = "maintain aspect ratio"
    director["inputs"]["divisible_by"] = 32
    director["inputs"]["img_compression"] = 18

    # IC-LoRA selection: drive both LTXDirectorGuide sampling stages. "None" keeps
    # the IC reference track inert (model input is already wired in the workflow).
    ic_lora_name = str(run.get("ic_lora_name") or "None")
    for node in api.values():
        if node.get("class_type") == "LTXDirectorGuide":
            node["inputs"]["ic_lora_name"] = ic_lora_name

    node_info = object_info().get("LTXDirector", {})
    declared_inputs = node_info.get("input", {}) or {}
    declared_keys = set(declared_inputs.get("required", {})) | set(declared_inputs.get("optional", {}))
    # If the running ComfyUI ships a LTXDirector with native global_reference_*
    # inputs (e.g. the ai2764 fork branch), widget-position drift can leak a
    # neighbouring `0` into global_reference_images — the node would then parse
    # it as filename "0", fall back to a black 512×512 placeholder, and that
    # placeholder becomes the first guide image, collapsing derived_w/h to a
    # square output. Clear those fields so camera-lab keeps using the
    # LTXVAddGuideMulti fallback regardless of which node version is installed.
    if "global_reference_images" in declared_keys:
        director["inputs"]["global_reference_images"] = ""
    if "global_reference_strength" in declared_keys:
        director["inputs"]["global_reference_strength"] = 0.0

    # The standalone-ComfyUI workflow wires a MultiReferenceImageLoader + 4
    # LoadImage nodes into LTXDirector.global_reference_image_batch. Camera-lab
    # doesn't use that path — it injects references via LTXVAddGuideMulti. Strip
    # the loader chain so empty-filename LoadImages don't fail ComfyUI validation.
    strip_director_image_loader_chain(api)

    for node in api.values():
        if "filename_prefix" in node["inputs"]:
            node["inputs"]["filename_prefix"] = f"camera_lab/{run['batch_id']}/{run['run_id']}"
        if "noise_seed" in node["inputs"]:
            node["inputs"]["noise_seed"] = run["seed"]
    patch_model_names(api, run)
    # v2 uses the pre-merged distilled UNET, with no separate LoRA patch.
    # Timeline audio uses the LTXDirector native audioSegments above; fall back to
    # the single whole-video custom-audio patch only when no per-shot audio is set.
    if not audio_segments:
        patch_director_custom_audio(api, run)
    bypass_sage_attention_patches(api)

    return api


def build_hymotion_api(run: dict[str, Any], template_path: Path | str = HYMOTION_GUIDE_TEMPLATE) -> dict[str, dict]:
    api = json.loads(Path(template_path).read_text(encoding="utf-8"))
    expected_nodes = {
        "5": "HYMotionGenerate",
        "10": "HYMotionEncodeText",
        "31": "SaveVideo",
    }
    for node_id, class_type in expected_nodes.items():
        if api.get(node_id, {}).get("class_type") != class_type:
            raise RuntimeError(f"HY-Motion workflow does not contain expected {class_type} node {node_id}")

    manual_duration = float(run["duration"])
    if run.get("rewrite"):
        text, seconds = rewrite_motion_prompt(str(run["prompt"]), default_duration=manual_duration)
    else:
        text, seconds = str(run["prompt"]), manual_duration

    api["10"]["inputs"]["text"] = text
    api["5"]["inputs"]["duration"] = float(seconds)
    api["5"]["inputs"]["seed"] = int(run["seed"])
    api["5"]["inputs"]["cfg_scale"] = float(run["cfg_scale"])
    api["31"]["inputs"]["filename_prefix"] = str(run["prefix"])
    return api


def build_scail_api(
    run: dict[str, Any],
    guide_name: str,
    length: int,
    template_path: Path | str = SCAIL_VIDEO_TEMPLATE,
) -> dict[str, dict]:
    api = json.loads(Path(template_path).read_text(encoding="utf-8"))
    expected_nodes = {
        "9": "LoadImage",
        "11": "LoadVideo",
        "13": "WanSCAILToVideo",
        "14": "KSampler",
        "17": "SaveVideo",
    }
    for node_id, class_type in expected_nodes.items():
        if api.get(node_id, {}).get("class_type") != class_type:
            raise RuntimeError(f"SCAIL workflow does not contain expected {class_type} node {node_id}")

    api["11"]["inputs"]["file"] = guide_name
    if run.get("reference_name"):
        api["9"]["inputs"]["image"] = str(run["reference_name"])
    if run.get("reference_mask_name"):
        mask_node_id = str(next_free_api_id(api, 18))
        api[mask_node_id] = {
            "class_type": "LoadImage",
            "inputs": {"image": str(run["reference_mask_name"])},
            "_meta": {"title": "SCAIL reference alpha mask"},
        }
        api["13"]["inputs"]["reference_image_mask"] = [mask_node_id, 0]
    if run.get("use_pose_video_mask"):
        add_scail_pose_video_mask(api, str(run.get("pose_video_mask_prompt") or "person"))
    api["13"]["inputs"]["width"] = int(run["width"])
    api["13"]["inputs"]["height"] = int(run["height"])
    api["13"]["inputs"]["length"] = int(length)
    api["13"]["inputs"]["pose_strength"] = float(run["pose_strength"])
    api["14"]["inputs"]["seed"] = int(run["seed"])
    api["14"]["inputs"]["steps"] = int(run["steps"])
    api["17"]["inputs"]["filename_prefix"] = str(run["prefix"])
    return api


def add_scail_pose_video_mask(api: dict[str, dict], prompt: str = "person") -> None:
    model_id = str(next_free_api_id(api, 18))
    text_id = str(next_free_api_id(api, int(model_id) + 1))
    track_id = str(next_free_api_id(api, int(text_id) + 1))
    color_mask_id = str(next_free_api_id(api, int(track_id) + 1))

    api[model_id] = {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {"ckpt_name": "sam3.1_multiplex_fp16.safetensors"},
        "_meta": {"title": "SCAIL SAM3 mask model"},
    }
    api[text_id] = {
        "class_type": "CLIPTextEncode",
        "inputs": {"clip": [model_id, 1], "text": prompt.strip() or "person"},
        "_meta": {"title": "SCAIL pose mask prompt"},
    }
    api[track_id] = {
        "class_type": "SAM3_VideoTrack",
        "inputs": {
            "images": ["12", 0],
            "model": [model_id, 0],
            "conditioning": [text_id, 0],
            "detection_threshold": 0.5,
            "max_objects": 1,
            "detect_interval": 2,
        },
        "_meta": {"title": "SCAIL pose video person track"},
    }
    api[color_mask_id] = {
        "class_type": "SCAIL2ColoredMask",
        "inputs": {
            "driving_track_data": [track_id, 0],
            "object_indices": "",
            "sort_by": "area",
            "replacement_mode": True,
        },
        "_meta": {"title": "SCAIL pose video replacement mask"},
    }
    api["13"]["inputs"]["pose_video_mask"] = [color_mask_id, 0]
    api["13"]["inputs"]["replacement_mode"] = True


def prepare_scail_reference_assets(reference: Path, input_dir: Path, reference_name: str) -> dict[str, str]:
    input_dir.mkdir(parents=True, exist_ok=True)
    destination = input_dir / reference_name
    image = Image.open(reference)
    result = {"reference_name": reference_name}

    if "A" not in image.getbands():
        shutil.copy2(reference, destination)
        return result

    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    if alpha.getextrema() == (255, 255):
        rgba.convert("RGB").save(destination)
        return result

    rgb = rgba.convert("RGB")
    gray = Image.new("RGB", rgba.size, (127, 127, 127))
    gray.paste(rgb, mask=alpha)
    gray.save(destination)

    mask_name = f"{Path(reference_name).stem}_mask.png"
    mask = Image.merge("RGB", (alpha, alpha, alpha))
    mask.save(input_dir / mask_name)
    result["reference_mask_name"] = mask_name
    return result


def patch_director_custom_audio(api: dict[str, dict], run: dict[str, Any]) -> None:
    audio_name = str(run.get("comfy_audio_name") or "").strip()
    if not audio_name:
        return

    director = next((node for node in api.values() if node.get("class_type") == "LTXDirector"), None)
    if not director:
        raise RuntimeError("Director workflow does not contain an LTXDirector node")
    audio_vae = director.get("inputs", {}).get("audio_vae")
    if not audio_vae:
        raise RuntimeError("Director workflow does not expose audio_vae for custom audio")

    duration = float(director.get("inputs", {}).get("duration_seconds") or run.get("duration") or 0)
    load_id = next_free_api_id(api, 9001)
    trim_id = next_free_api_id(api, load_id + 1)
    encode_id = next_free_api_id(api, trim_id + 1)

    api[str(load_id)] = {
        "class_type": "LoadAudio",
        "inputs": {"audio": audio_name},
        "_meta": {"title": "Director custom audio"},
    }
    api[str(trim_id)] = {
        "class_type": "TrimAudioDuration",
        "inputs": {"audio": [str(load_id), 0], "start_index": 0, "duration": duration},
        "_meta": {"title": "Trim director custom audio"},
    }
    api[str(encode_id)] = {
        "class_type": "LTXVAudioVAEEncode",
        "inputs": {"audio": [str(trim_id), 0], "audio_vae": audio_vae},
        "_meta": {"title": "Encode director custom audio"},
    }

    patched = False
    for node in api.values():
        if node.get("class_type") != "LTXVConcatAVLatent":
            continue
        inputs = node.get("inputs") or {}
        if "audio_latent" in inputs:
            inputs["audio_latent"] = [str(encode_id), 0]
            patched = True
    if not patched:
        raise RuntimeError("Director workflow does not contain LTXVConcatAVLatent.audio_latent")


def next_free_api_id(api: dict[str, dict], start: int) -> int:
    used = {int(key) for key in api if str(key).isdigit()}
    value = start
    while value in used:
        value += 1
    return value


def strip_director_image_loader_chain(api: dict[str, dict]) -> None:
    """Remove MultiReferenceImageLoader nodes and their LoadImage feeders from the API.

    The director workflow JSON wires these for standalone-ComfyUI use of the IMAGE
    batch path on LTXDirector. Camera-lab uses LTXVAddGuideMulti instead, so the
    loader chain is dead weight; leaving it in causes ComfyUI to validate the empty
    LoadImage filenames and fail.
    """
    loader_ids = [nid for nid, n in api.items() if n.get("class_type") == "MultiReferenceImageLoader"]
    if not loader_ids:
        return
    feeder_ids: set[str] = set()
    for loader_id in loader_ids:
        for value in api[loader_id]["inputs"].values():
            if isinstance(value, list) and len(value) == 2:
                source_id = str(value[0])
                if api.get(source_id, {}).get("class_type") == "LoadImage":
                    feeder_ids.add(source_id)
    drop_ids = set(loader_ids) | feeder_ids
    for node_id, node in api.items():
        if node_id in drop_ids:
            continue
        for input_name in list(node.get("inputs", {}).keys()):
            value = node["inputs"][input_name]
            if isinstance(value, list) and len(value) == 2 and str(value[0]) in drop_ids:
                del node["inputs"][input_name]
    for node_id in drop_ids:
        del api[node_id]


def insert_director_global_reference_guides(api: dict[str, dict], input_names: list[str], timeline: dict[str, Any]) -> None:
    if not input_names:
        return
    guide_roles = [f"global_reference_{index}" for index in range(1, len(input_names) + 1)]
    role_input_names = dict(zip(guide_roles, input_names))
    guide_timeline = dict(timeline)
    guide_timeline["guide_roles"] = guide_roles
    guide_timeline["guide_frames"] = [0] * len(guide_roles)
    guide_timeline["guide_strengths"] = [timeline["global_reference_strength"]] * len(guide_roles)
    insert_director_multi_guide(
        api,
        guide_roles,
        role_input_names,
        guide_timeline,
        title="Director global reference guides",
    )


def insert_director_multi_guide(
    api: dict[str, dict],
    guide_roles: list[str],
    input_names: dict[str, str],
    timeline: dict[str, Any],
    title: str = "Director reference guides",
) -> None:
    multi_id = str(next_free_api_id(api, 9001))
    next_id = int(multi_id) + 1
    # Restore commit 339355f's behaviour: anchor on LTXDirectorGuide id 58
    # (the Stage 2 post-upscale guide) using its OUTPUT latent (slot 2). This
    # matched what worked end-to-end yesterday; the WIP auto-detect path put
    # the multi-guide on either a raw or upsampler latent and produced visibly
    # different results.
    guide_source = "58"
    guide_inputs: dict[str, Any] = {
        "positive": [guide_source, 0],
        "negative": [guide_source, 1],
        "vae": ["3", 0],
        "latent": [guide_source, 2],
        "num_guides": str(len(guide_roles)),
    }
    frames_by_role: dict[str, int] = {}
    strengths_by_role: dict[str, float] = {}
    for role, frame, strength in zip(timeline["guide_roles"], timeline["guide_frames"], timeline["guide_strengths"]):
        frames_by_role.setdefault(role, int(frame))
        strengths_by_role.setdefault(role, float(strength))
    for index, role in enumerate(guide_roles, start=1):
        load_id = str(next_id)
        next_id += 1
        api[load_id] = {
            "class_type": "LoadImage",
            "inputs": {"image": input_names[role]},
            "_meta": {"title": f"Director reference {role}"},
        }
        guide_inputs[f"num_guides.image_{index}"] = [load_id, 0]
        guide_inputs[f"num_guides.frame_idx_{index}"] = frames_by_role.get(role, 0)
        guide_inputs[f"num_guides.strength_{index}"] = strengths_by_role.get(role, 0.7)
    api[multi_id] = {"class_type": "LTXVAddGuideMulti", "inputs": guide_inputs, "_meta": {"title": title}}

    for node_id, node in api.items():
        if str(node_id) == multi_id:
            continue
        if not isinstance(node, dict):
            continue
        for input_name, slot, expected in (
            ("positive", 0, [guide_source, 0]),
            ("negative", 1, [guide_source, 1]),
            ("conditioning", 0, [guide_source, 0]),
        ):
            if node.get("inputs", {}).get(input_name) == expected:
                node["inputs"][input_name] = [multi_id, slot]


def patch_api(api: dict, workflow: dict, run: dict, input_names: dict[str, str]) -> None:
    mode = workflow["mode"]
    if workflow.get("disable_crop_guides"):
        bypass_ltx_crop_guides(api)
    if workflow.get("disable_image_extension"):
        bypass_image_extension_nodes(api)
    if workflow.get("disable_image_crop"):
        bypass_image_crop_nodes(api)
    if workflow.get("disable_nag"):
        bypass_ltx_nag(api)
    if workflow.get("disable_prompt_enhance"):
        disable_prompt_enhancer(api)
    if "319" in api:
        api["319"]["inputs"]["value"] = run["prompt"]
    elif "6" in api:
        api["6"]["inputs"]["text"] = run["prompt"]
    else:
        patched_prompt = False
        for node in api.values():
            title = str(node.get("_meta", {}).get("title") or "").lower()
            if node["class_type"] == "PrimitiveStringMultiline" and "prompt" in title and node["inputs"].get("value") is not None:
                node["inputs"]["value"] = run["prompt"]
                patched_prompt = True
                break
        if not patched_prompt:
            for node in api.values():
                if node["class_type"] == "PrimitiveStringMultiline" and node["inputs"].get("value") is not None:
                    node["inputs"]["value"] = run["prompt"]
                    break
    if "314" in api:
        api["314"]["inputs"]["text"] = run["negative_prompt"]
    elif "7" in api:
        api["7"]["inputs"]["text"] = run["negative_prompt"]
    elif "11" in api and api["11"]["class_type"] == "CLIPTextEncode":
        api["11"]["inputs"]["text"] = run["negative_prompt"]
    if "340" in api and "fixed nag" not in str(api["340"].get("_meta", {}).get("title") or "").lower():
        api["340"]["inputs"]["text"] = run["negative_prompt"]
    if "999" in api:
        api["999"]["inputs"]["filename_prefix"] = f"camera_lab/{run['batch_id']}/{run['run_id']}"
    for node in api.values():
        if "filename_prefix" in node["inputs"]:
            node["inputs"]["filename_prefix"] = f"camera_lab/{run['batch_id']}/{run['run_id']}"
    if "920" in api:
        api["920"]["inputs"]["value"] = run["duration"]
    if "330" in api:
        api["330"]["inputs"]["value"] = run["width"]
    if "324" in api and api["324"]["class_type"] == "PrimitiveInt":
        api["324"]["inputs"]["value"] = run["height"]
    if "312" in api and api["312"]["class_type"] == "PrimitiveInt":
        api["312"]["inputs"]["value"] = run["width"]
    if "299" in api and api["299"]["class_type"] == "PrimitiveInt":
        api["299"]["inputs"]["value"] = run["height"]
    if "301" in api and api["301"]["class_type"] == "PrimitiveInt":
        api["301"]["inputs"]["value"] = int(float(run["duration"]))
    if "300" in api and api["300"]["class_type"] == "PrimitiveInt":
        api["300"]["inputs"]["value"] = 24
    for node in api.values():
        title = str(node.get("_meta", {}).get("title") or "").lower()
        if node["class_type"] in {"INTConstant", "PrimitiveInt"}:
            if title == "width":
                node["inputs"]["value"] = run["width"]
            elif title == "height":
                node["inputs"]["value"] = run["height"]
            elif "length" in title:
                node["inputs"]["value"] = int(float(run["duration"]))
    for node_id, node in api.items():
        if node["class_type"] == "LTXVImgToVideo":
            node["inputs"]["width"] = run["width"]
            node["inputs"]["height"] = run["height"]
            node["inputs"]["length"] = max(9, int(float(run["duration"]) * 24) + 1)
        if Path(str(workflow.get("path") or "")).name == "video_ltx2_3_i2v.json" and node["class_type"] == "LTXVImgToVideoInplace":
            node["inputs"]["strength"] = 1.0 if node_id == "288" else 0.7
        if node["class_type"] == "ResizeImageMaskNode" and "resize_type.width" in node["inputs"]:
            node["inputs"]["resize_type"] = "scale dimensions"
            node["inputs"]["resize_type.crop"] = "center"
            node["inputs"]["scale_method"] = "lanczos"
    patch_model_names(api, run)
    patch_ltx23_local_loras(api)
    bypass_sage_attention_patches(api)
    patch_ltx_dynamic_guides(api)
    for node in api.values():
        if "noise_seed" in node["inputs"]:
            node["inputs"]["noise_seed"] = run["seed"]
    patch_load_images(api, mode, input_names)
    if mode in {"ia2v", "flf_ia2v"}:
        if not input_names.get("audio"):
            raise ValueError("IA2V requires uploaded audio")
        for node in api.values():
            if node["class_type"] == "LoadAudio":
                node["inputs"]["audio"] = input_names["audio"]
                break


def bypass_ltx_crop_guides(api: dict) -> None:
    crop_nodes = {node_id: node for node_id, node in api.items() if node["class_type"] == "LTXVCropGuides"}
    for crop_id, crop_node in crop_nodes.items():
        replacement_by_slot = {
            0: crop_node["inputs"].get("positive"),
            1: crop_node["inputs"].get("negative"),
            2: crop_node["inputs"].get("latent"),
        }
        for node in api.values():
            for input_name, value in list(node["inputs"].items()):
                if not (isinstance(value, list) and len(value) == 2 and str(value[0]) == crop_id):
                    continue
                replacement = replacement_by_slot.get(int(value[1]))
                if replacement is not None:
                    node["inputs"][input_name] = replacement
        del api[crop_id]


def bypass_image_crop_nodes(api: dict) -> None:
    crop_ids = {
        node_id
        for node_id, node in api.items()
        if node["class_type"] == "ImageCrop" and isinstance(node["inputs"].get("image"), list)
    }
    for crop_id in crop_ids:
        replacement = api[crop_id]["inputs"]["image"]
        for node in api.values():
            for input_name, value in list(node["inputs"].items()):
                if isinstance(value, list) and str(value[0]) == crop_id:
                    node["inputs"][input_name] = replacement
    for crop_id in crop_ids:
        del api[crop_id]


def bypass_image_extension_nodes(api: dict) -> None:
    for extension_id, node in list(api.items()):
        title = str(node.get("_meta", {}).get("title") or "").lower()
        # Match only the padding-height node ("padded generation height = content
        # + matte"), not the latent-height divider ("latent height = padded
        # generation height / 2"), which also contains the phrase but must keep
        # its /2 so the output follows the requested size.
        if title.startswith("padded generation height") and isinstance(node["inputs"].get("a"), list):
            replacement = node["inputs"]["a"]
            for target in api.values():
                for input_name, value in list(target["inputs"].items()):
                    if isinstance(value, list) and str(value[0]) == extension_id:
                        target["inputs"][input_name] = replacement

    pad_ids = {
        node_id
        for node_id, node in api.items()
        if node["class_type"] == "ImagePadKJ" and isinstance(node["inputs"].get("image"), list)
    }
    for pad_id in pad_ids:
        replacement = api[pad_id]["inputs"]["image"]
        for node in api.values():
            for input_name, value in list(node["inputs"].items()):
                if isinstance(value, list) and str(value[0]) == pad_id:
                    node["inputs"][input_name] = replacement
    for pad_id in pad_ids:
        del api[pad_id]


def bypass_ltx_nag(api: dict) -> None:
    nag_ids = {
        node_id
        for node_id, node in api.items()
        if node["class_type"] == "LTX2_NAG" and isinstance(node["inputs"].get("model"), list)
    }
    for nag_id in nag_ids:
        replacement = api[nag_id]["inputs"]["model"]
        for node in api.values():
            for input_name, value in list(node["inputs"].items()):
                if isinstance(value, list) and str(value[0]) == nag_id:
                    node["inputs"][input_name] = replacement
    for nag_id in nag_ids:
        del api[nag_id]


def disable_prompt_enhancer(api: dict) -> None:
    prompt_node_id = next(
        (
            node_id
            for node_id, node in api.items()
            if node["class_type"] in {"PrimitiveStringMultiline", "CLIPTextEncode"}
            and node["inputs"].get("value") is not None
        ),
        "319" if "319" in api else None,
    )
    if prompt_node_id is None:
        return

    for node in api.values():
        if node["class_type"] == "PrimitiveBoolean":
            node["inputs"]["value"] = False
        if node["class_type"] == "ComfySwitchNode":
            node["inputs"]["on_false"] = [prompt_node_id, 0]
            node["inputs"]["on_true"] = [prompt_node_id, 0]

    remove_ids = {
        node_id
        for node_id, node in api.items()
        if node["class_type"] == "LoraLoader"
        and "gemma-3-12b-it-abliterated_lora_rank64_bf16.safetensors" in str(node["inputs"].get("lora_name", ""))
    }
    for node_id in remove_ids:
        del api[node_id]


def patch_ltx23_local_loras(api: dict) -> None:
    if not model_listed("loras", LOCAL_LTX23_DISTILLED_LORA):
        return
    for node in api.values():
        if node["class_type"] != "LoraLoaderModelOnly":
            continue
        lora_name = str(node["inputs"].get("lora_name", ""))
        lora_key = lora_name.replace("\\", "/").lower()
        if "ltx" in lora_key and "distilled" in lora_key and ("lora" in lora_key or "fro" in lora_key):
            node["inputs"]["lora_name"] = LOCAL_LTX23_DISTILLED_LORA


def patch_ltx_dynamic_guides(api: dict) -> None:
    for node in api.values():
        if node["class_type"] != "LTXVAddGuideMulti":
            continue
        inputs = node["inputs"]
        dynamic_keys = [key for key in inputs if key.startswith("num_guides.")]
        if dynamic_keys:
            guide_count = max(
                int(key.rsplit("_", 1)[-1])
                for key in dynamic_keys
                if key.rsplit("_", 1)[-1].isdigit()
            )
            inputs["num_guides"] = str(guide_count)
            inputs.setdefault("num_guides.frame_idx_1", 0)
            if guide_count >= 2:
                inputs.setdefault("num_guides.frame_idx_2", -1)
            if guide_count >= 3:
                inputs.setdefault("num_guides.frame_idx_3", -1)


def bypass_sage_attention_patches(api: dict) -> None:
    patch_ids = {
        node_id
        for node_id, node in api.items()
        if node["class_type"]
        in {
            "PathchSageAttentionKJ",
            "LTX2MemoryEfficientSageAttentionPatch",
            "LTX2AttentionTunerPatch",
            "LTX2SamplingPreviewOverride",
        }
        and isinstance(node["inputs"].get("model"), list)
    }
    for patch_id in patch_ids:
        replacement = api[patch_id]["inputs"]["model"]
        for node in api.values():
            for input_name, value in list(node["inputs"].items()):
                if isinstance(value, list) and str(value[0]) == patch_id:
                    node["inputs"][input_name] = replacement
    for patch_id in patch_ids:
        del api[patch_id]


def patch_load_images(api: dict, mode: str, input_names: dict[str, str]) -> None:
    if mode == "fml_native":
        for node in api.values():
            if node["class_type"] != "LoadImage":
                continue
            title = str(node.get("_meta", {}).get("title") or "").lower()
            if "first" in title:
                node["inputs"]["image"] = input_names["source"]
            elif "middle" in title:
                node["inputs"]["image"] = input_names["middle"]
            elif "last" in title:
                node["inputs"]["image"] = input_names["end"]
        return

    if "900" in api:
        api["900"]["inputs"]["image"] = input_names["source"]
        if mode in {"flf", "fml", "flf_ia2v"} and input_names.get("end"):
            injected = False
            for node in api.values():
                if node["class_type"] != "LoadImage":
                    continue
                if "end" in str(node.get("_meta", {}).get("title") or "").lower():
                    node["inputs"]["image"] = input_names["end"]
                    injected = True
            if not injected and "930" in api:
                api["930"]["inputs"]["image"] = input_names["end"]
        return

    load_images = [node for node in api.values() if node["class_type"] == "LoadImage"]
    if not load_images:
        return
    load_images[0]["inputs"]["image"] = input_names["source"]
    if mode in {"flf", "fml", "flf_ia2v"} and input_names.get("end") and len(load_images) > 1:
        load_images[1]["inputs"]["image"] = input_names["end"]


def bernini_frame_length(duration: Any) -> int:
    return max(1, int(float(duration or 1) * 24) + 1)


def bernini_conditioning_length(mode: str, duration: Any) -> int:
    if mode in BERNINI_IMAGE_MODES:
        return 1
    return bernini_frame_length(duration)


def clamp_float(value: Any, default: float, min_value: float, max_value: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    return max(min_value, min(max_value, number))


def clamp_int(value: Any, default: int, min_value: int, max_value: int) -> int:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        number = default
    return max(min_value, min(max_value, number))


def inpaint_frame_length(duration: Any) -> int:
    return max(1, int(float(duration or 1) * INPAINT_FPS) + 1)


def patch_bernini_api(api: dict, mode: str, run: dict, input_names: dict[str, str]) -> None:
    if "3" in api and api["3"]["class_type"] == "CLIPTextEncode":
        api["3"]["inputs"]["text"] = bernini_prompt_text(mode, run["prompt"])
    if "4" in api and api["4"]["class_type"] == "CLIPTextEncode":
        api["4"]["inputs"]["text"] = str(run.get("negative_prompt") or BERNINI_DEFAULT_NEGATIVE).strip()

    length = bernini_conditioning_length(mode, run.get("duration"))
    reference_strength = clamp_float(run.get("global_reference_strength"), 0.35, 0.0, 1.0)
    ref_max_size = clamp_int(run.get("bernini_ref_max_size"), 848, 16, 8192)
    seed = int(run.get("seed") or 0)
    for node in api.values():
        inputs = node["inputs"]
        if node["class_type"] == "BerniniConditioning":
            inputs["width"] = int(run["width"])
            inputs["height"] = int(run["height"])
            inputs["length"] = length
            if "ref_max_size" in inputs:
                inputs["ref_max_size"] = ref_max_size
            if "reference_strength" in inputs:
                inputs["reference_strength"] = reference_strength
            for key in list(inputs):
                if key.startswith("reference_images.") and "strength" in key:
                    inputs[key] = reference_strength
        if node["class_type"] == "VHS_LoadVideo" and "frame_load_cap" in node["inputs"]:
            node["inputs"]["frame_load_cap"] = length
        if seed:
            if "noise_seed" in inputs:
                inputs["noise_seed"] = seed
            if "seed" in inputs:
                inputs["seed"] = seed
        if "filename_prefix" in inputs:
            inputs["filename_prefix"] = f"camera_lab/{run.get('batch_id', 'dry')}/{run.get('run_id', 'bernini')}"

    if mode in {"bernini_i2v", "bernini_i2i"} and input_names.get("source"):
        patch_first_load_image(api, input_names["source"])
    if mode in {"bernini_r2v", "bernini_r2i", "bernini_vi2v", "bernini_rv2v"} and input_names.get("reference_image"):
        patch_bernini_reference_image(api, input_names["reference_image"])
    if mode in {"bernini_v2v", "bernini_mv2v", "bernini_vi2v", "bernini_vrc2v", "bernini_rv2v"} and input_names.get("source_video"):
        patch_load_videos(api, [input_names["source_video"]])
    if mode == "bernini_ads2v":
        patch_load_videos(api, [input_names["source_video"], input_names["reference_video"]])
    bypass_sage_attention_patches(api)


def patch_first_load_image(api: dict, image_name: str) -> None:
    for node in api.values():
        if node["class_type"] == "LoadImage":
            node["inputs"]["image"] = image_name
            return


def patch_bernini_reference_image(api: dict, image_name: str) -> None:
    reference = None
    conditioning_node = None
    for node in api.values():
        if node["class_type"] != "BerniniConditioning":
            continue
        conditioning_node = node
        inputs = node.get("inputs") or {}
        reference = inputs.pop("reference_images", None)
        break
    if not reference:
        image_node_id = next_api_node_id(api)
        api[image_node_id] = {
            "class_type": "LoadImage",
            "inputs": {"image": image_name},
            "_meta": {"title": "Camera Lab reference image"},
        }
        if conditioning_node is not None:
            conditioning_node["inputs"]["reference_images.reference_image_0"] = [image_node_id, 0]
        return

    ref_node_id = str(reference[0])
    ref_node = api.get(ref_node_id)
    if ref_node and ref_node.get("class_type") == "BatchImagesNode":
        reference = ref_node.get("inputs", {}).get("images.image0") or reference

    load_node = api.get(str(reference[0]))
    if load_node and load_node.get("class_type") == "LoadImage":
        load_node["inputs"]["image"] = image_name

    for node in api.values():
        if node["class_type"] == "BerniniConditioning":
            node["inputs"]["reference_images.reference_image_0"] = reference
            return


def patch_load_videos(api: dict, video_names: list[str]) -> None:
    video_nodes = [node for node in api.values() if node["class_type"] == "VHS_LoadVideo"]
    for node, video_name in zip(video_nodes, video_names):
        node["inputs"]["video"] = video_name


def next_api_node_id(api: Mapping[str, Any]) -> str:
    numeric = [int(node_id) for node_id in api if str(node_id).isdigit()]
    return str(max(numeric + [0]) + 1)


def add_inpaint_control_video_nodes(api: dict, source_frames: list[Any], width: int, height: int, length: int) -> list[Any]:
    frame_batch_id = next_api_node_id(api)
    api[frame_batch_id] = {
        "class_type": "ImageFromBatch",
        "inputs": {"image": source_frames, "batch_index": 0, "length": length},
        "_meta": {"title": "Camera Lab inpaint source frame range"},
    }
    scaled_id = next_api_node_id(api)
    api[scaled_id] = {
        "class_type": "ImageScale",
        "inputs": {
            "image": [frame_batch_id, 0],
            "upscale_method": "lanczos",
            "width": width,
            "height": height,
            "crop": "center",
        },
        "_meta": {"title": "Camera Lab inpaint source resize"},
    }
    return [scaled_id, 0]


def patch_inpaint_api(api: dict, run: dict, input_names: dict[str, str]) -> None:
    length = inpaint_frame_length(run.get("duration"))
    width = int(run["width"])
    height = int(run["height"])
    load_video_id = ""
    reference_id = ""
    reference_name = input_names.get("reference_image") or ""
    source_frames: list[Any] | None = None

    for node_id, node in list(api.items()):
        class_type = node.get("class_type")
        inputs = node.get("inputs") or {}
        title = str(node.get("_meta", {}).get("title") or "").lower()
        if class_type == "LoadVideo":
            inputs["file"] = input_names["source_video"]
            load_video_id = node_id
        elif class_type == "LoadImage" and reference_name and not reference_id:
            inputs["image"] = reference_name
            reference_id = node_id
        elif class_type == "GetVideoComponents":
            source_frames = [node_id, 0]
        elif class_type == "CLIPTextEncode":
            if "negative" in title:
                inputs["text"] = str(run.get("negative_prompt") or INPAINT_DEFAULT_NEGATIVE).strip()
            elif "positive" in title:
                inputs["text"] = str(run.get("prompt") or "").strip()
        elif class_type == "KSampler":
            inputs["seed"] = int(run.get("seed") or 0)
            inputs["sampler_name"] = "uni_pc"
            inputs["scheduler"] = "simple"
            inputs["denoise"] = 1.0
        elif class_type == "CreateVideo":
            inputs["fps"] = INPAINT_FPS
        if "filename_prefix" in inputs:
            inputs["filename_prefix"] = f"camera_lab/{run.get('batch_id', 'dry')}/{run.get('run_id', 'inpaint')}"
        if "filename" in inputs and class_type == "SaveVideo":
            inputs["filename"] = f"camera_lab/{run.get('batch_id', 'dry')}/{run.get('run_id', 'inpaint')}"

    if not load_video_id:
        raise RuntimeError("inpaint workflow is missing LoadVideo")
    if reference_name and not reference_id:
        raise RuntimeError("inpaint workflow is missing LoadImage")

    mask_id = next_api_node_id(api)
    api[mask_id] = {
        "class_type": "LoadImage",
        "inputs": {"image": input_names["mask_image"]},
        "_meta": {"title": "Camera Lab painted mask"},
    }
    repeated_mask_id = next_api_node_id(api)
    api[repeated_mask_id] = {
        "class_type": "RepeatImageBatch",
        "inputs": {"image": [mask_id, 0], "amount": length},
        "_meta": {"title": "Camera Lab repeated inpaint mask"},
    }
    image_to_mask_id = next_api_node_id(api)
    api[image_to_mask_id] = {
        "class_type": "ImageToMask",
        "inputs": {"image": [repeated_mask_id, 0], "channel": "red"},
        "_meta": {"title": "Camera Lab mask to VACE"},
    }

    control_video: list[Any] | None = None
    if source_frames:
        control_video = add_inpaint_control_video_nodes(api, source_frames, width, height, length)

    for node in api.values():
        if node.get("class_type") != "WanVaceToVideo":
            continue
        inputs = node.setdefault("inputs", {})
        inputs["width"] = width
        inputs["height"] = height
        inputs["length"] = length
        inputs["batch_size"] = 1
        if reference_id:
            inputs["reference_image"] = [reference_id, 0]
        else:
            inputs.pop("reference_image", None)
        inputs["control_masks"] = [image_to_mask_id, 0]
        if control_video:
            inputs["control_video"] = control_video
        break
    else:
        raise RuntimeError("inpaint workflow is missing WanVaceToVideo")

    for node_id, node in list(api.items()):
        if node.get("class_type") in {"SAM3_Detect", "ResizeImageMaskNode", "GrowMask", "ImageCompositeMasked", "MaskPreview", "PreviewImage"}:
            api.pop(node_id, None)


def comfy_safe_filename(value: str) -> str:
    return safe_filename(value).replace(" ", "_")


def stage_bernini_inputs(run: dict[str, Any], width: int, height: int, run_dir: Path) -> dict[str, str]:
    input_names: dict[str, str] = {}
    mode = str(run.get("workflow_mode") or "")
    COMFY_INPUT.mkdir(parents=True, exist_ok=True)

    def copy_image(field: str, role: str, key: str) -> None:
        src = Path(run.get(field) or "")
        if not src.exists():
            raise FileNotFoundError(f"{role} image is missing")
        frame = run_dir / f"{role}_{width}x{height}.png"
        resize_cover(src, frame, width=width, height=height)
        name = f"{run['run_id']}_{role}.png"
        shutil.copy2(frame, COMFY_INPUT / name)
        input_names[key] = name

    def copy_video(field: str, key: str) -> None:
        src = Path(run.get(field) or "")
        if not src.exists():
            raise FileNotFoundError(f"{key.replace('_', ' ')} is missing")
        name = f"{run['run_id']}_{comfy_safe_filename(src.name)}"
        shutil.copy2(src, COMFY_INPUT / name)
        input_names[key] = name

    if mode in {"bernini_i2v", "bernini_i2i"}:
        copy_image("source_image", "source", "source")
    if mode in {"bernini_r2v", "bernini_r2i", "bernini_vi2v", "bernini_rv2v"}:
        copy_image("reference_image", "reference", "reference_image")
    if mode in {"bernini_v2v", "bernini_mv2v", "bernini_vi2v", "bernini_vrc2v", "bernini_rv2v", "bernini_ads2v"}:
        copy_video("source_video", "source_video")
    if mode == "bernini_ads2v":
        copy_video("reference_video", "reference_video")
    return input_names


def stage_inpaint_inputs(run: dict[str, Any], width: int, height: int, run_dir: Path) -> dict[str, str]:
    input_names: dict[str, str] = {}
    COMFY_INPUT.mkdir(parents=True, exist_ok=True)

    source_video = Path(run.get("source_video") or "")
    reference_image = Path(run.get("reference_image") or "") if run.get("reference_image") else None
    mask_image = Path(run.get("mask_image") or "")
    if not source_video.exists():
        raise FileNotFoundError("source video is missing")
    if reference_image is not None and not reference_image.exists():
        raise FileNotFoundError("reference image is missing")
    if not mask_image.exists():
        raise FileNotFoundError("painted mask is missing")

    source_name = f"{run['run_id']}_{comfy_safe_filename(source_video.name)}"
    shutil.copy2(source_video, COMFY_INPUT / source_name)
    input_names["source_video"] = source_name

    if reference_image is not None:
        reference_frame = run_dir / f"reference_{width}x{height}.png"
        resize_cover(reference_image, reference_frame, width=width, height=height)
        reference_name = f"{run['run_id']}_reference.png"
        shutil.copy2(reference_frame, COMFY_INPUT / reference_name)
        input_names["reference_image"] = reference_name

    mask_frame = run_dir / f"mask_{width}x{height}.png"
    mask = Image.open(mask_image).convert("L").resize((width, height), Image.Resampling.NEAREST)
    mask_rgb = Image.merge("RGB", (mask, mask, mask))
    mask_rgb.save(mask_frame)
    mask_name = f"{run['run_id']}_mask.png"
    shutil.copy2(mask_frame, COMFY_INPUT / mask_name)
    input_names["mask_image"] = mask_name
    return input_names


def patch_model_names(api: dict, run: dict) -> None:
    model_names: dict[str, str] = {}
    for node in api.values():
        inputs = node["inputs"]
        if node["class_type"] == "CheckpointLoaderSimple" and "ckpt_name" in inputs:
            ensure_model_exists("checkpoints", str(inputs["ckpt_name"]))
            model_names["checkpoint"] = inputs["ckpt_name"]
        if node["class_type"] == "CLIPLoader" and "clip_name" in inputs:
            ensure_model_exists("text_encoders", str(inputs["clip_name"]))
            model_names["text_encoder"] = inputs["clip_name"]
    if model_names:
        run["models"] = model_names


def ensure_model_exists(folder: str, name: str) -> None:
    """Best-effort warning when ComfyUI clearly cannot see the model. Never raises:
    ComfyUI's own /prompt validation is the authority, so submission keeps working
    regardless of where models physically live (extra_model_paths / subfolders)."""
    if model_missing(folder, name):
        print(f"Camera Lab: warning - model may be missing: models/{folder}/{name}", flush=True)


def workflow_status(workflow: dict) -> dict[str, Any]:
    avail = available_models()
    if workflow.get("builder") == "ltx23_ttp_flf":
        missing: list[str] = []
        if not (TTP_TOOLSET_ROOT / "LTXVFirstLastFrameControl_TTP.py").exists():
            missing.append("custom_nodes/Comfyui_TTP_Toolset")
        for folder, name in [
            ("checkpoints", LTX23_CHECKPOINT),
            ("text_encoders", LTX23_TEXT_ENCODER),
            ("loras", LOCAL_LTX23_DISTILLED_LORA),
            ("latent_upscale_models", LTX23_UPSCALER),
        ]:
            if model_missing(folder, name, avail):
                missing.append(f"models/{folder}/{name}")
        if missing:
            return {"available": False, "reason": "missing " + ", ".join(missing)}
        return {"available": True, "reason": ""}

    path = Path(workflow["path"])
    if not path.exists():
        return {"available": False, "reason": "workflow file not found"}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"available": False, "reason": str(exc)}
    if not workflow.get("builder"):
        data = workflow_to_api(data)
        patch_ltx23_local_loras(data)
        bypass_sage_attention_patches(data)
        data = {"extra": {"prompt": data}}
    elif workflow.get("builder") == "ltx_director_2":
        data = workflow_to_api(data)
        bypass_sage_attention_patches(data)
        data = {"extra": {"prompt": data}}
    missing: list[str] = []
    for folder, name in required_models(expand_subgraphs_recursive(data)):
        if model_missing(folder, name, avail):
            missing.append(f"models/{folder}/{name}")
    if missing:
        return {"available": False, "reason": "missing " + ", ".join(missing)}
    return {"available": True, "reason": ""}


def required_models(workflow: dict) -> list[tuple[str, str]]:
    models: list[tuple[str, str]] = []
    prompts = [] if workflow.get("nodes") else [workflow.get("extra", {}).get("prompt") or {}]
    for node in workflow.get("nodes", []):
        node_type = node.get("type")
        values = list(node.get("widgets_values") or [])
        if node_type == "CheckpointLoaderSimple" and values:
            models.append(("checkpoints", str(values[0])))
        elif node_type == "UNETLoader" and values:
            models.append(("diffusion_models", str(values[0])))
        elif node_type in {"VAELoader", "VAELoaderKJ"} and values:
            models.append(("vae", str(values[0])))
        elif node_type == "LatentUpscaleModelLoader" and values:
            models.append(("latent_upscale_models", str(values[0])))
        elif node_type == "LoraLoaderModelOnly" and values:
            models.append(("loras", str(values[0])))
        elif node_type == "CLIPLoader" and values:
            models.append(("text_encoders", str(values[0])))
        elif node_type == "DualCLIPLoader" and len(values) >= 2:
            models.append(("text_encoders", str(values[0])))
            models.append(("text_encoders", str(values[1])))
        elif node_type == "LTXAVTextEncoderLoader" and len(values) >= 2:
            models.append(("text_encoders", str(values[0])))
            models.append(("checkpoints", str(values[1])))
    for prompt in prompts:
        for node in prompt.values():
            node_type = node.get("class_type")
            inputs = node.get("inputs") or {}
            if node_type == "CheckpointLoaderSimple" and inputs.get("ckpt_name"):
                models.append(("checkpoints", str(inputs["ckpt_name"])))
            elif node_type == "UNETLoader" and inputs.get("unet_name"):
                models.append(("diffusion_models", str(inputs["unet_name"])))
            elif node_type in {"VAELoader", "VAELoaderKJ"} and inputs.get("vae_name"):
                models.append(("vae", str(inputs["vae_name"])))
            elif node_type == "LatentUpscaleModelLoader" and inputs.get("model_name"):
                models.append(("latent_upscale_models", str(inputs["model_name"])))
            elif node_type == "LoraLoaderModelOnly" and inputs.get("lora_name"):
                models.append(("loras", str(inputs["lora_name"])))
            elif node_type == "CLIPLoader" and inputs.get("clip_name"):
                models.append(("text_encoders", str(inputs["clip_name"])))
            elif node_type == "DualCLIPLoader":
                for key in ("clip_name1", "clip_name2"):
                    if inputs.get(key):
                        models.append(("text_encoders", str(inputs[key])))
            elif node_type == "LTXAVTextEncoderLoader":
                if inputs.get("text_encoder_name"):
                    models.append(("text_encoders", str(inputs["text_encoder_name"])))
                if inputs.get("clip_name"):
                    models.append(("text_encoders", str(inputs["clip_name"])))
                if inputs.get("ckpt_name"):
                    models.append(("checkpoints", str(inputs["ckpt_name"])))
                if inputs.get("model_name"):
                    models.append(("checkpoints", str(inputs["model_name"])))
    return sorted(set(models))


def copy_outputs(run_dir: Path, prompt_id: str, base_url: str | None = None) -> list[Path]:
    history = http_json(f"/history/{prompt_id}", timeout=30, base_url=base_url).get(prompt_id, {})
    (run_dir / "history.json").write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    copied: list[Path] = []
    input_root = MOTION_COMFY_INPUT if (base_url or "").rstrip("/") == MOTION_COMFY_URL.rstrip("/") else COMFY_INPUT
    output_root = MOTION_COMFY_OUTPUT if (base_url or "").rstrip("/") == MOTION_COMFY_URL.rstrip("/") else COMFY_OUTPUT
    for output in history.get("outputs", {}).values():
        for key in ("videos", "images", "gifs"):
            for item in output.get(key, []):
                filename = item.get("filename")
                if not filename:
                    continue
                subfolder = item.get("subfolder", "")
                src_root = output_root if item.get("type", "output") == "output" else input_root
                src = src_root / subfolder / filename
                if src.exists():
                    dst = run_dir / filename
                    shutil.copy2(src, dst)
                    copied.append(dst)
    return copied


def make_contact_sheet(video: Path, contact: Path, title: str) -> None:
    frames_dir = contact.parent / "_contact_frames"
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True, exist_ok=True)
    pattern = frames_dir / "frame_%02d.jpg"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(video), "-vf", "fps=1,scale=320:-1", "-frames:v", "6", str(pattern)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    frames = sorted(frames_dir.glob("frame_*.jpg"))
    if not frames:
        return
    thumb_w, thumb_h = Image.open(frames[0]).size
    sheet = Image.new("RGB", (thumb_w * len(frames), thumb_h + 42), "white")
    draw = ImageDraw.Draw(sheet)
    draw.text((10, 12), title, fill=(0, 0, 0))
    for i, frame in enumerate(frames):
        sheet.paste(Image.open(frame).convert("RGB"), (i * thumb_w, 42))
    sheet.save(contact, quality=92)
    shutil.rmtree(frames_dir)


def extract_last_frame(video: Path, image: Path) -> None:
    image.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-sseof",
            "-0.08",
            "-i",
            str(video),
            "-frames:v",
            "1",
            str(image),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def extract_first_frame(video: Path, image: Path) -> None:
    image.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(video),
            "-frames:v",
            "1",
            str(image),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def align_4k1(n: int) -> int:
    """Largest valid SCAIL length <= n with (length - 1) % 4 == 0; minimum 1."""
    if n <= 1:
        return 1
    return ((n - 1) // 4) * 4 + 1


def video_frame_count(path: Path) -> int:
    """Frame count of a video via ffprobe (ffmpeg/ffprobe already used elsewhere in this server)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_frames",
         "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return int(out)


def video_duration_seconds(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    return max(0.0, float(out or 0))


def bernini_split_options(mode: str, payload: Mapping[str, Any]) -> dict[str, Any]:
    enabled = mode == "bernini_rv2v" and bool(payload.get("bernini_split_enabled"))
    duration = max(1.0, min(5.0, float(payload.get("bernini_split_duration") or 4.0)))
    return {
        "enabled": enabled,
        "duration": duration,
        "merge": bool(payload.get("bernini_split_merge", True)),
    }


def bernini_segment_specs(total_duration: float, segment_duration: float) -> list[dict[str, float | int]]:
    total = max(0.0, float(total_duration or 0))
    segment = max(0.1, float(segment_duration or 4.0))
    if total <= 0:
        return [{"index": 1, "start": 0.0, "duration": segment}]
    specs: list[dict[str, float | int]] = []
    start = 0.0
    index = 1
    while start < total - 0.001:
        duration = min(segment, total - start)
        specs.append({"index": index, "start": round(start, 3), "duration": round(duration, 3)})
        start += duration
        index += 1
    return specs


def split_video_segments(
    source: Path,
    output_dir: Path,
    segment_duration: float,
    *,
    runner: Any = subprocess.run,
) -> list[Path]:
    total_duration = video_duration_seconds(source)
    specs = bernini_segment_specs(total_duration, segment_duration)
    output_dir.mkdir(parents=True, exist_ok=True)
    segments: list[Path] = []
    for spec in specs:
        index = int(spec["index"])
        output = output_dir / f"segment_{index:03d}.mp4"
        runner(
            [
                "ffmpeg",
                "-y",
                "-ss",
                f"{float(spec['start']):.3f}",
                "-t",
                f"{float(spec['duration']):.3f}",
                "-i",
                str(source),
                "-map",
                "0:v:0",
                "-an",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "18",
                "-pix_fmt",
                "yuv420p",
                str(output),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if not output.exists():
            raise FileNotFoundError(f"video segment was not created: {output}")
        segments.append(output)
    return segments


def merge_segment_videos(
    videos: list[Path],
    output: Path,
    *,
    runner: Any = subprocess.run,
) -> Path:
    if not videos:
        raise ValueError("no segment videos to merge")
    output.parent.mkdir(parents=True, exist_ok=True)
    concat_list = output.with_suffix(".txt")
    lines = []
    for video in videos:
        safe_path = str(video.resolve()).replace("\\", "/").replace("'", "'\\''")
        lines.append(f"file '{safe_path}'")
    concat_list.write_text("\n".join(lines) + "\n", encoding="utf-8")
    runner(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(output)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if not output.exists():
        raise FileNotFoundError(f"merged video was not created: {output}")
    return output


def trim_video_clip(
    source: Path,
    output_dir: Path,
    start: float,
    end: float,
    *,
    runner: Any = subprocess.run,
) -> Path:
    start_time = max(0.0, float(start))
    end_time = max(0.0, float(end))
    if end_time <= start_time + 0.001:
        raise ValueError("end must be after start")
    duration = end_time - start_time
    output_dir.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^a-zA-Z0-9._-]+", "_", source.stem)[:80] or "clip"
    output = output_dir / f"{int(time.time())}_{random.randint(1000, 9999)}_{stem}_{start_time:.2f}_{end_time:.2f}.mp4"
    runner(
        [
            "ffmpeg",
            "-y",
            "-ss",
            f"{start_time:.3f}",
            "-t",
            f"{duration:.3f}",
            "-i",
            str(source),
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "18",
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-movflags",
            "+faststart",
            str(output),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if not output.exists():
        raise FileNotFoundError(f"trimmed video was not created: {output}")
    return output


def preserve_video_audio(
    generated_video: Path,
    source_video: Path,
    *,
    runner: Any = subprocess.run,
) -> Path:
    if not generated_video.exists():
        raise FileNotFoundError(f"generated video is missing: {generated_video}")
    if not source_video.exists():
        raise FileNotFoundError(f"source video is missing: {source_video}")
    output = generated_video.with_name(f"{generated_video.stem}_preserve_audio.mp4")
    runner(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(generated_video),
            "-i",
            str(source_video),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0?",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "160k",
            "-shortest",
            "-movflags",
            "+faststart",
            str(output),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if not output.exists():
        raise FileNotFoundError(f"audio-preserved video was not created: {output}")
    return output


def apply_bernini_preserve_audio(run: dict[str, Any], video: Path) -> Path:
    if not run.get("bernini_preserve_audio"):
        return video
    source = Path(run.get("source_video") or "")
    if not source.exists():
        run["video"] = str(video)
        run["bernini_audio_preserved"] = False
        run["bernini_audio_warning"] = f"source video is missing for audio preservation: {source}"
        return video
    try:
        output = preserve_video_audio(video, source)
    except Exception as exc:
        run["video"] = str(video)
        run["bernini_audio_preserved"] = False
        run["bernini_audio_warning"] = str(exc)
        return video
    run["video"] = str(output)
    run["bernini_audio_preserved"] = True
    run["bernini_audio_source"] = str(source)
    copied = run.setdefault("copied", [])
    if str(output) not in copied:
        copied.append(str(output))
    return output


def image_outputs_from_paths(paths: list[Any]) -> list[Path]:
    return [Path(path) for path in paths if Path(path).suffix.lower() in IMAGE_OUTPUT_SUFFIXES]


def hydrate_run_image_outputs(run: dict[str, Any]) -> None:
    if run.get("video") or run.get("image"):
        return
    images = image_outputs_from_paths(run.get("copied") or [])
    if not images:
        return
    run["image"] = str(images[0])
    run["images"] = [str(path) for path in images]


def record_run_media_outputs(run: dict[str, Any], copied: list[Path], workflow_mode: str, run_dir: Path) -> None:
    run["copied"] = [str(path) for path in copied]
    videos = [path for path in copied if path.suffix.lower() in VIDEO_OUTPUT_SUFFIXES]
    if videos:
        video = videos[0]
        if is_bernini_mode(workflow_mode):
            video = apply_bernini_preserve_audio(run, video)
        run["video"] = str(video)
        contact = run_dir / "contact.jpg"
        make_contact_sheet(video, contact, f"{run['variant_name']} / {run['camera_move']}")
        run["contact_sheet"] = str(contact)
        return
    hydrate_run_image_outputs(run)


def prepare_bernini_split_runs(base_run: dict[str, Any], batch_dir: Path, segment_duration: float) -> list[dict[str, Any]]:
    source = Path(base_run.get("source_video") or "")
    if not source.exists():
        raise FileNotFoundError("source video is missing")
    total_duration = video_duration_seconds(source)
    specs = bernini_segment_specs(total_duration, segment_duration)
    segments = split_video_segments(source, batch_dir / "_segments", segment_duration)
    if len(segments) != len(specs):
        raise RuntimeError(f"expected {len(specs)} segment(s), got {len(segments)}")

    runs: list[dict[str, Any]] = []
    for spec, segment in zip(specs, segments):
        index = int(spec["index"])
        run = copy.deepcopy(base_run)
        run_id = f"{base_run['run_id']}_seg{index:03d}"
        run["run_id"] = run_id
        run["run_dir"] = str(batch_dir / run_id)
        run["source_video"] = str(segment)
        run["duration"] = float(spec["duration"])
        run["segment_index"] = index
        run["segment_start"] = float(spec["start"])
        run["segment_duration"] = float(spec["duration"])
        run["variant_name"] = f"{base_run.get('variant_name', 'prompt')} segment {index:03d}"
        run["status"] = "queued"
        runs.append(run)
    return runs


def merge_bernini_split_batch(batch: dict[str, Any]) -> dict[str, Any] | None:
    split = batch.get("bernini_split") or {}
    if not split.get("enabled") or not split.get("merge"):
        return None
    if any(run.get("run_id") == "merged" for run in batch.get("runs", [])):
        return None
    segment_runs = [
        run for run in batch.get("runs", [])
        if run.get("workflow_mode") == "bernini_rv2v" and run.get("segment_index")
    ]
    if not segment_runs:
        return None
    if any(run.get("status") != "done" or not run.get("video") for run in segment_runs):
        return None
    ordered = sorted(segment_runs, key=lambda run: int(run.get("segment_index") or 0))
    videos = [Path(run["video"]) for run in ordered]
    batch_dir = Path(batch["batch_dir"])
    merged_dir = batch_dir / "merged"
    merged_dir.mkdir(parents=True, exist_ok=True)
    merged_video = merge_segment_videos(videos, merged_dir / "merged.mp4")
    first = ordered[0]
    final_run = {
        "batch_id": batch["batch_id"],
        "run_id": "merged",
        "run_dir": str(merged_dir),
        "workflow_id": first.get("workflow_id", "bernini_rv2v"),
        "workflow_mode": first.get("workflow_mode", "bernini_rv2v"),
        "workflow_label": f"{first.get('workflow_label', 'Bernini RV2V')} Merged",
        "camera_move": first.get("camera_move", "bernini_rv2v"),
        "duration": sum(float(run.get("duration") or 0) for run in ordered),
        "width": first.get("width"),
        "height": first.get("height"),
        "seed": first.get("seed"),
        "variant_name": "merged",
        "prompt": first.get("prompt", ""),
        "negative_prompt": first.get("negative_prompt", ""),
        "status": "done",
        "queued_at": first.get("queued_at", time.time()),
        "started_at": min(float(run.get("started_at") or time.time()) for run in ordered),
        "finished_at": time.time(),
        "video": str(merged_video),
        "copied": [str(merged_video)],
        "scores": {},
        "notes": "Merged Bernini RV2V split output",
    }
    try:
        contact = merged_dir / "contact.jpg"
        make_contact_sheet(merged_video, contact, f"{final_run['variant_name']} / {final_run['camera_move']}")
        final_run["contact_sheet"] = str(contact)
    except Exception:
        pass
    batch.setdefault("runs", []).append(final_run)
    batch["merged_video"] = str(merged_video)
    return final_run


def check_run_canceled(run: dict[str, Any]) -> None:
    if run.get("status") == "canceled":
        raise RunCanceled()


def wait_for_completion(prompt_id: str, run: dict[str, Any], timeout_s: int = 1800, base_url: str | None = None) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        check_run_canceled(run)
        history = http_json(f"/history/{prompt_id}", timeout=30, base_url=base_url)
        if prompt_id in history:
            status = history[prompt_id].get("status", {})
            if status.get("status_str") == "error":
                messages = status.get("messages", [])
                raise RuntimeError(str(messages[-1] if messages else status))
            if status.get("completed"):
                return
        time.sleep(5)
    raise TimeoutError(prompt_id)


def align_multiple(value: float, multiple: int) -> int:
    return max(multiple, int(round(value / multiple)) * multiple)


def add_ttp_sampler_stage(
    api: dict[str, dict],
    *,
    start_id: int,
    model_ref: list[Any],
    positive_ref: list[Any],
    negative_ref: list[Any],
    latent_ref: list[Any],
    sampler_name: str,
    sigmas: str,
    seed: int,
) -> tuple[list[Any], int]:
    api[str(start_id)] = {
        "class_type": "CFGGuider",
        "inputs": {"model": model_ref, "positive": positive_ref, "negative": negative_ref, "cfg": 1.0},
    }
    api[str(start_id + 1)] = {"class_type": "KSamplerSelect", "inputs": {"sampler_name": sampler_name}}
    api[str(start_id + 2)] = {"class_type": "ManualSigmas", "inputs": {"sigmas": sigmas}}
    api[str(start_id + 3)] = {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}}
    api[str(start_id + 4)] = {
        "class_type": "SamplerCustomAdvanced",
        "inputs": {
            "noise": [str(start_id + 3), 0],
            "guider": [str(start_id), 0],
            "sampler": [str(start_id + 1), 0],
            "sigmas": [str(start_id + 2), 0],
            "latent_image": latent_ref,
        },
    }
    return [str(start_id + 4), 0], start_id + 5


def build_ltx23_ttp_flf_api(run: dict[str, Any], input_names: dict[str, str]) -> dict[str, dict]:
    width = int(run["width"])
    height = int(run["height"])
    low_width = align_multiple(width / 2, 32)
    low_height = align_multiple(height / 2, 32)
    frames = max(9, align_multiple(float(run["duration"]) * 24, 8) + 1)
    seed = int(run["seed"])
    prefix = f"camera_lab/{run['batch_id']}/{run['run_id']}"
    pass1_sigmas = "1.0, 0.99375, 0.9875, 0.98125, 0.975, 0.909375, 0.725, 0.421875, 0.0"
    pass2_sigmas = "0.85, 0.7250, 0.4219, 0.0"

    api: dict[str, dict] = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": LTX23_CHECKPOINT}},
        "2": {
            "class_type": "LTXAVTextEncoderLoader",
            "inputs": {"text_encoder": LTX23_TEXT_ENCODER, "ckpt_name": LTX23_CHECKPOINT, "device": "default"},
        },
        "3": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": run["prompt"]}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["2", 0], "text": run["negative_prompt"]}},
        "5": {"class_type": "LTXVConditioning", "inputs": {"positive": ["3", 0], "negative": ["4", 0], "frame_rate": 24}},
        "6": {"class_type": "LoadImage", "inputs": {"image": input_names["source"]}},
        "7": {"class_type": "LoadImage", "inputs": {"image": input_names["end"]}},
        "8": {"class_type": "LTXVPreprocess", "inputs": {"image": ["6", 0], "img_compression": 18}},
        "9": {"class_type": "LTXVPreprocess", "inputs": {"image": ["7", 0], "img_compression": 18}},
        "10": {"class_type": "EmptyLTXVLatentVideo", "inputs": {"width": low_width, "height": low_height, "length": frames, "batch_size": 1}},
        "11": {
            "class_type": "LTXVFirstLastFrameControl_TTP",
            "inputs": {
                "vae": ["1", 2],
                "latent": ["10", 0],
                "first_image": ["8", 0],
                "last_image": ["9", 0],
                "first_strength": 1.0,
                "last_strength": 1.0,
            },
        },
        "12": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {"model": ["1", 0], "lora_name": LOCAL_LTX23_DISTILLED_LORA, "strength_model": 0.5},
        },
        "13": {"class_type": "LatentUpscaleModelLoader", "inputs": {"model_name": LTX23_UPSCALER}},
    }
    stage1, next_id = add_ttp_sampler_stage(
        api,
        start_id=20,
        model_ref=["12", 0],
        positive_ref=["5", 0],
        negative_ref=["5", 1],
        latent_ref=["11", 0],
        sampler_name="euler_ancestral_cfg_pp",
        sigmas=pass1_sigmas,
        seed=seed,
    )
    api[str(next_id)] = {"class_type": "LTXVLatentUpsampler", "inputs": {"samples": stage1, "upscale_model": ["13", 0], "vae": ["1", 2]}}
    upsampled = [str(next_id), 0]
    next_id += 1
    api[str(next_id)] = {
        "class_type": "LTXVFirstLastFrameControl_TTP",
        "inputs": {
            "vae": ["1", 2],
            "latent": upsampled,
            "first_image": ["8", 0],
            "last_image": ["9", 0],
            "first_strength": 1.0,
            "last_strength": 1.0,
        },
    }
    ttp2 = [str(next_id), 0]
    next_id += 1
    stage2, next_id = add_ttp_sampler_stage(
        api,
        start_id=next_id,
        model_ref=["12", 0],
        positive_ref=["5", 0],
        negative_ref=["5", 1],
        latent_ref=ttp2,
        sampler_name="euler_cfg_pp",
        sigmas=pass2_sigmas,
        seed=seed + 1,
    )
    api[str(next_id)] = {
        "class_type": "LTXVTiledVAEDecode",
        "inputs": {
            "vae": ["1", 2],
            "latents": stage2,
            "horizontal_tiles": 2,
            "vertical_tiles": 2,
            "overlap": 6,
            "last_frame_fix": True,
            "working_device": "auto",
            "working_dtype": "auto",
        },
    }
    decoded = [str(next_id), 0]
    next_id += 1
    api[str(next_id)] = {"class_type": "CreateVideo", "inputs": {"images": decoded, "fps": 24}}
    video = [str(next_id), 0]
    next_id += 1
    api[str(next_id)] = {"class_type": "SaveVideo", "inputs": {"video": video, "filename_prefix": prefix, "format": "auto", "codec": "auto"}}
    return api


def run_fml_two_segment(run: dict[str, Any], workflow: dict) -> None:
    run_dir = Path(run["run_dir"])
    source = Path(run["source_image"])
    middle = Path(run["middle_image"])
    end = Path(run["end_image"])
    duration = max(1.0, float(run["duration"]) / 2)
    segments = [
        run_flf_segment(run, workflow, source, middle, run_dir / "seg1", 1, duration, int(run["seed"])),
        run_flf_segment(run, workflow, middle, end, run_dir / "seg2", 2, duration, int(run["seed"]) + 1),
    ]
    run["segments"] = segments
    videos = [Path(segment["video"]) for segment in segments if segment.get("video")]
    if len(videos) != 2:
        raise RuntimeError("FML did not produce two segment videos")
    concat = run_dir / "concat.txt"
    concat.write_text("".join(f"file '{video.as_posix()}'\n" for video in videos), encoding="utf-8")
    output = run_dir / f"{run['run_id']}_fml.mp4"
    concat_cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", str(output)]
    try:
        subprocess.run(concat_cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except subprocess.CalledProcessError:
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat),
                "-c:v",
                "libx264",
                "-c:a",
                "aac",
                "-pix_fmt",
                "yuv420p",
                str(output),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    contact = run_dir / "contact.jpg"
    make_contact_sheet(output, contact, f"{run['camera_move']} / FML")
    run["video"] = str(output)
    run["contact_sheet"] = str(contact)
    run["copied"] = [str(output), str(contact)] + [path for segment in segments for path in segment.get("copied", [])]


def run_flf_segment(
    run: dict[str, Any],
    workflow: dict,
    source: Path,
    end: Path,
    segment_dir: Path,
    segment_index: int,
    duration: float,
    seed: int,
) -> dict[str, Any]:
    check_run_canceled(run)
    segment_dir.mkdir(parents=True, exist_ok=True)
    width = int(run["width"])
    height = int(run["height"])
    segment_run = dict(run)
    segment_run["run_id"] = f"{run['run_id']}_seg{segment_index}"
    segment_run["duration"] = duration
    segment_run["seed"] = seed
    segment_workflow = dict(workflow)
    segment_workflow["mode"] = "flf"

    source_frame = segment_dir / f"source_{width}x{height}.png"
    end_frame = segment_dir / f"end_{width}x{height}.png"
    resize_cover(source, source_frame, width=width, height=height)
    resize_cover(end, end_frame, width=width, height=height)

    COMFY_INPUT.mkdir(parents=True, exist_ok=True)
    source_name = f"{segment_run['run_id']}_source.png"
    end_name = f"{segment_run['run_id']}_end.png"
    shutil.copy2(source_frame, COMFY_INPUT / source_name)
    shutil.copy2(end_frame, COMFY_INPUT / end_name)

    if segment_workflow.get("builder") == "ltx23_ttp_flf":
        api = build_ltx23_ttp_flf_api(segment_run, {"source": source_name, "end": end_name})
    else:
        workflow_json = json.loads(Path(workflow["path"]).read_text(encoding="utf-8"))
        api = workflow_to_api(workflow_json)
        patch_api(api, segment_workflow, segment_run, {"source": source_name, "end": end_name})
    (segment_dir / "api_prompt.json").write_text(json.dumps(api, ensure_ascii=False, indent=2), encoding="utf-8")
    (segment_dir / "prompt.txt").write_text(
        f"{run['variant_name']} segment {segment_index}\n{width}x{height}\nseed: {seed}\n\n{run['prompt']}\n\nNEGATIVE:\n{run['negative_prompt']}\n",
        encoding="utf-8",
    )
    submit = http_json("/prompt", {"prompt": api, "client_id": f"camera-lab-{segment_run['run_id']}"}, timeout=60)
    prompt_id = submit.get("prompt_id")
    (segment_dir / "submit.json").write_text(json.dumps(submit, ensure_ascii=False, indent=2), encoding="utf-8")
    if submit.get("node_errors"):
        raise RuntimeError(json.dumps(submit["node_errors"], ensure_ascii=False))
    if not prompt_id:
        raise RuntimeError(json.dumps(submit, ensure_ascii=False))
    if segment_index == 1:
        run["prompt_id"] = prompt_id
    else:
        run["prompt_id"] = prompt_id
        run["prompt_id_2"] = prompt_id
    wait_for_completion(prompt_id, run)
    copied = copy_outputs(segment_dir, prompt_id)
    videos = [path for path in copied if path.suffix.lower() in {".mp4", ".webm", ".mov"}]
    if not videos:
        raise RuntimeError(f"FML segment {segment_index} produced no video")
    contact = segment_dir / "contact.jpg"
    make_contact_sheet(videos[0], contact, f"{run['camera_move']} / segment {segment_index}")
    return {
        "segment": segment_index,
        "prompt_id": prompt_id,
        "video": str(videos[0]),
        "contact_sheet": str(contact),
        "copied": [str(path) for path in copied],
    }


def cancel_comfy_run(run: dict[str, Any]) -> list[str]:
    actions: list[str] = []
    prompt_id = run.get("prompt_id")
    if not prompt_id:
        return actions
    try:
        http_post("/queue", {"delete": [prompt_id]}, timeout=10)
        actions.append("queue_delete")
    except Exception as exc:
        actions.append(f"queue_delete_failed: {exc}")
    if comfy_prompt_running(str(prompt_id)):
        try:
            http_post("/interrupt", {}, timeout=10)
            actions.append("interrupt")
        except Exception as exc:
            actions.append(f"interrupt_failed: {exc}")
    return actions


def comfy_prompt_running(prompt_id: str) -> bool:
    try:
        queue = http_json("/queue", timeout=10)
    except Exception:
        return False
    return any(prompt_id in json.dumps(item, ensure_ascii=False) for item in queue.get("queue_running", []))


def submit_motion_stage(api: dict[str, Any], run: dict[str, Any], stage_dir: Path, stage: str) -> str:
    (stage_dir / "api_prompt.json").write_text(json.dumps(api, ensure_ascii=False, indent=2), encoding="utf-8")
    submit = http_json(
        "/prompt",
        {"prompt": api, "client_id": f"camera-lab-motion-{run['run_id']}-{stage}"},
        timeout=60,
        base_url=MOTION_COMFY_URL,
    )
    (stage_dir / "submit.json").write_text(json.dumps(submit, ensure_ascii=False, indent=2), encoding="utf-8")
    if submit.get("node_errors"):
        raise RuntimeError(json.dumps(submit["node_errors"], ensure_ascii=False))
    prompt_id = submit.get("prompt_id")
    if not prompt_id:
        raise RuntimeError(json.dumps(submit, ensure_ascii=False))
    return str(prompt_id)


def first_video(copied: list[Path], stage: str) -> Path:
    videos = [path for path in copied if path.suffix.lower() in {".mp4", ".webm", ".mov"}]
    if not videos:
        raise RuntimeError(f"{stage} produced no video")
    return videos[0]


def persist_motion_batch(batch: dict[str, Any] | None) -> None:
    if batch:
        write_batch(batch)


def finish_motion_batch(batch: dict[str, Any] | None) -> None:
    if not batch:
        return
    batch["status"] = "done" if all(r.get("status") in {"done", "guide_done", "canceled"} for r in batch["runs"]) else "error"
    batch["finished_at"] = time.time()
    write_batch(batch)


def create_motion_video_batch(payload: dict[str, Any]) -> dict[str, Any]:
    guide_path = payload.get("guide_video_path") or payload.get("guide_path") or ""
    if not guide_path:
        raise ValueError("motion guide video is required")
    guide_video = safe_media_path(str(guide_path))
    if not guide_video.exists():
        raise FileNotFoundError("motion guide video is missing")

    reference_path = payload.get("reference_path") or payload.get("source_path") or ""
    if not reference_path:
        raise ValueError("motion reference image is required")
    reference = safe_media_path(str(reference_path))
    if not reference.exists():
        raise FileNotFoundError("motion reference image is missing")

    width, height = validate_size(payload.get("width") or 480, payload.get("height") or 832)
    seed = validate_seed(payload.get("seed"))
    steps = max(1, min(100, int(payload.get("steps") or 8)))
    pose_strength = max(0.0, min(1.0, float(payload.get("pose_strength") or 1.0)))
    frame_count = video_frame_count(guide_video)
    trim_start, trim_end = motion_trim_values(payload)
    if trim_end is not None:
        trim_duration = max(0.5, trim_end - trim_start)
        scail_length = align_4k1(round(trim_duration * 24))
        duration = max(0.5, min(60.0, trim_duration))
    else:
        scail_length = align_4k1(frame_count)
        duration = max(0.5, min(60.0, float(payload.get("duration") or frame_count / 24 or 4.0)))
    prompt = str(payload.get("prompt") or "").strip() or f"uploaded guide video: {guide_video.name}"

    motion_type = str(payload.get("motion_type") or "scail").strip().lower()
    is_3d_motion = motion_type in {"3d", "motion_3d", "3d_motion"}
    workflow_id = "motion_3d_to_scail" if is_3d_motion else "uploaded_motion_to_scail"
    workflow_mode = "motion_3d" if is_3d_motion else "motion_scail"
    workflow_label = "3D Motion" if is_3d_motion else "SCAIL2"

    batch_id = f"motion_{int(time.time())}_{random.randint(1000, 9999)}"
    batch_dir = RUN_ROOT / batch_id
    run_id = "01_motion"
    run_dir = batch_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    run = {
        "batch_id": batch_id,
        "run_id": run_id,
        "run_dir": str(run_dir),
        "workflow_id": workflow_id,
        "workflow_mode": workflow_mode,
        "workflow_label": workflow_label,
        "camera_move": "motion",
        "reference_image": str(reference),
        "guide_video": str(guide_video),
        "scail_length": scail_length,
        "duration": duration,
        "guide_trim_start": trim_start,
        "guide_trim_end": trim_end,
        "width": width,
        "height": height,
        "seed": seed,
        "variant_name": "motion",
        "prompt": prompt,
        "rewrite": False,
        "cfg_scale": 5.0,
        "steps": steps,
        "pose_strength": pose_strength,
        "use_pose_video_mask": payload_bool(payload.get("use_pose_video_mask"), True),
        "pose_video_mask_prompt": str(payload.get("pose_video_mask_prompt") or "person").strip() or "person",
        "status": "guide_done",
        "queued_at": time.time(),
        "scores": {},
        "notes": "",
    }
    batch = {
        "batch_id": batch_id,
        "batch_dir": str(batch_dir),
        "status": "queued",
        "queued_at": time.time(),
        "runs": [run],
    }
    BATCHES[batch_id] = batch
    write_batch(batch)
    return batch


def record_3dmotion_guide_run(
    source_video: Path,
    duration: Any = 0,
    prompt: str = "",
    *,
    runner: Any = subprocess.run,
) -> dict[str, Any]:
    if not source_video.exists():
        raise FileNotFoundError("3D Motion recording is missing")
    safe_duration = max(0.1, min(60.0, float(duration or video_duration_seconds(source_video) or 1.0)))
    label = str(prompt or "").strip() or "3D motion recorded guide"
    batch_id = f"motion_3d_{int(time.time())}_{random.randint(1000, 9999)}"
    batch_dir = RUN_ROOT / batch_id
    run_id = "01_recording"
    run_dir = batch_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    output = run_dir / "recorded_3d.mp4"
    ffmpeg = os.environ.get("FFMPEG_PATH") or "ffmpeg"
    cmd = [
        ffmpeg,
        "-y",
        "-i",
        str(source_video),
        "-vf",
        "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=24",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-an",
        str(output),
    ]
    try:
        runner(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else ""
        raise RuntimeError(stderr or f"ffmpeg exited with code {exc.returncode}") from exc
    if not output.exists():
        raise RuntimeError("ffmpeg did not produce a 3D Motion recording")
    now = time.time()
    run = {
        "batch_id": batch_id,
        "run_id": run_id,
        "run_dir": str(run_dir),
        "workflow_id": "motion_3d_to_scail",
        "workflow_mode": "motion_3d",
        "workflow_label": "3D Motion",
        "camera_move": "motion",
        "guide_video": str(output),
        "video": str(output),
        "copied": [str(output)],
        "duration": round(safe_duration, 3),
        "variant_name": "3D Motion recording",
        "prompt": label,
        "rewrite": False,
        "status": "guide_done",
        "queued_at": now,
        "finished_at": now,
        "scores": {},
        "notes": "Recorded in 3D Motion",
    }
    batch = {
        "batch_id": batch_id,
        "batch_dir": str(batch_dir),
        "status": "done",
        "queued_at": now,
        "finished_at": now,
        "runs": [run],
    }
    BATCHES[batch_id] = batch
    write_batch(batch)
    return batch


def motion_trim_values(values: Mapping[str, Any]) -> tuple[float, float | None]:
    raw_start = values.get("guide_trim_start", values.get("trim_start", 0))
    raw_end = values.get("guide_trim_end", values.get("trim_end"))
    start = max(0.0, float(raw_start or 0))
    if raw_end in {None, ""}:
        return start, None
    end = max(0.0, float(raw_end))
    if end <= start + 0.05:
        raise ValueError("trim end must be greater than trim start")
    return round(start, 3), round(end, 3)


def trim_motion_guide_video(run: dict[str, Any], guide_video: Path, run_dir: Path) -> Path:
    trim_start, trim_end = motion_trim_values(run)
    if trim_end is None:
        return guide_video
    trim_dir = run_dir / "motion_trim"
    trim_dir.mkdir(parents=True, exist_ok=True)
    trimmed = trim_dir / f"{guide_video.stem}_trim.mp4"
    duration = trim_end - trim_start
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{trim_start:.3f}",
        "-i",
        str(guide_video),
        "-t",
        f"{duration:.3f}",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        str(trimmed),
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if not trimmed.exists():
        raise RuntimeError("ffmpeg did not produce trimmed guide video")
    run["guide_trimmed_video"] = str(trimmed)
    run["duration"] = round(duration, 3)
    return trimmed


def run_motion_guide_stage(run: dict[str, Any]) -> list[Path]:
    run_dir = Path(run["run_dir"])
    motion_dir = run_dir / "motion"
    motion_dir.mkdir(parents=True, exist_ok=True)
    run["status"] = "running_motion"
    run["prefix"] = f"camera_lab/{run['batch_id']}/{run['run_id']}/motion_guide"
    hymotion_api = build_hymotion_api(run)
    motion_prompt_id = submit_motion_stage(hymotion_api, run, motion_dir, "guide")
    run["motion_prompt_id"] = motion_prompt_id
    run["prompt_id"] = motion_prompt_id
    wait_for_completion(motion_prompt_id, run, base_url=MOTION_COMFY_URL)
    check_run_canceled(run)

    guide_copied = copy_outputs(motion_dir, motion_prompt_id, base_url=MOTION_COMFY_URL)
    guide_video = first_video(guide_copied, "HY-Motion guide")
    run["guide_video"] = str(guide_video)
    run["scail_length"] = align_4k1(video_frame_count(guide_video))
    run["copied"] = [str(path) for path in guide_copied]
    run["status"] = "guide_done"
    return guide_copied


def run_motion_final_stage(run: dict[str, Any]) -> list[Path]:
    run_dir = Path(run["run_dir"])
    video_dir = run_dir / "video"
    video_dir.mkdir(parents=True, exist_ok=True)
    guide_video = Path(run.get("guide_video") or "")
    if not guide_video.exists():
        raise FileNotFoundError("motion guide video is missing")

    guide_for_scail = trim_motion_guide_video(run, guide_video, run_dir)
    if guide_for_scail != guide_video:
        length = align_4k1(video_frame_count(guide_for_scail))
    else:
        length = int(run.get("scail_length") or align_4k1(video_frame_count(guide_for_scail)))
    run["scail_length"] = length

    MOTION_COMFY_INPUT.mkdir(parents=True, exist_ok=True)
    guide_name = f"{safe_filename(run['run_id'])}_{safe_filename(guide_for_scail.name)}"
    shutil.copy2(guide_for_scail, MOTION_COMFY_INPUT / guide_name)
    run["guide_name"] = guide_name

    reference_path = run.get("reference_image") or ""
    if reference_path:
        reference = Path(reference_path)
        if not reference.exists():
            raise FileNotFoundError("motion reference image is missing")
        reference_name = f"{safe_filename(run['run_id'])}_{safe_filename(reference.name)}"
        run.update(prepare_scail_reference_assets(reference, MOTION_COMFY_INPUT, reference_name))

    run["status"] = "running_video"
    run["prefix"] = f"camera_lab/{run['batch_id']}/{run['run_id']}/motion_final"
    scail_api = build_scail_api(run, guide_name, length)
    video_prompt_id = submit_motion_stage(scail_api, run, video_dir, "video")
    run["video_prompt_id"] = video_prompt_id
    run["prompt_id"] = video_prompt_id
    wait_for_completion(video_prompt_id, run, base_url=MOTION_COMFY_URL)
    check_run_canceled(run)

    final_copied = copy_outputs(video_dir, video_prompt_id, base_url=MOTION_COMFY_URL)
    final_video = first_video(final_copied, "SCAIL video")
    run["video"] = str(final_video)
    run["copied"] = [*run.get("copied", []), *[str(path) for path in final_copied]]
    contact = run_dir / "contact.jpg"
    try:
        make_contact_sheet(final_video, contact, "Motion / SCAIL")
        run["contact_sheet"] = str(contact)
    except Exception as exc:
        run["contact_error"] = str(exc)
    run["status"] = "done"
    return final_copied


def motion_guide_worker(run: dict[str, Any], batch: dict[str, Any] | None = None) -> None:
    try:
        if batch:
            batch["status"] = "running"
            batch["started_at"] = time.time()
        run["started_at"] = time.time()
        persist_motion_batch(batch)
        run_motion_guide_stage(run)
        run["finished_at"] = time.time()
    except RunCanceled:
        run["status"] = "canceled"
        run["error"] = "canceled"
        run["finished_at"] = time.time()
    except Exception as exc:
        run["status"] = "error"
        run["error"] = str(exc)
        run["finished_at"] = time.time()
    finally:
        persist_motion_batch(batch)
        finish_motion_batch(batch)


def motion_final_worker(run: dict[str, Any], batch: dict[str, Any] | None = None) -> None:
    try:
        if batch:
            batch["status"] = "running"
            batch["started_at"] = time.time()
        run.pop("error", None)
        run["finished_at"] = None
        persist_motion_batch(batch)
        run_motion_final_stage(run)
        run["finished_at"] = time.time()
    except RunCanceled:
        run["status"] = "canceled"
        run["error"] = "canceled"
        run["finished_at"] = time.time()
    except Exception as exc:
        run["status"] = "error"
        run["error"] = str(exc)
        run["finished_at"] = time.time()
    finally:
        persist_motion_batch(batch)
        finish_motion_batch(batch)


def motion_worker(run: dict[str, Any], batch: dict[str, Any] | None = None) -> None:
    try:
        if batch:
            batch["status"] = "running"
            batch["started_at"] = time.time()
        run["started_at"] = time.time()
        persist_motion_batch(batch)
        run_motion_guide_stage(run)
        persist_motion_batch(batch)
        run_motion_final_stage(run)
        run["finished_at"] = time.time()
    except RunCanceled:
        run["status"] = "canceled"
        run["error"] = "canceled"
        run["finished_at"] = time.time()
    except Exception as exc:
        run["status"] = "error"
        run["error"] = str(exc)
        run["finished_at"] = time.time()
    finally:
        persist_motion_batch(batch)
        finish_motion_batch(batch)


def run_batch_worker(batch_id: str) -> None:
    batch = BATCHES[batch_id]
    batch["status"] = "running"
    batch["started_at"] = time.time()
    for run in batch["runs"]:
        if run.get("status") == "canceled":
            continue
        run["status"] = "running"
        run["started_at"] = time.time()
        try:
            check_run_canceled(run)
            run_dir = Path(run["run_dir"])
            workflow = next(w for w in WORKFLOWS if w["id"] == run["workflow_id"])
            source = Path(run["source_image"]) if run.get("source_image") else Path()
            end = Path(run["end_image"]) if run.get("end_image") else Path()
            width = int(run["width"])
            height = int(run["height"])
            if workflow["mode"] == "fml":
                run_fml_two_segment(run, workflow)
                run["status"] = "done"
                run["finished_at"] = time.time()
                continue
            COMFY_INPUT.mkdir(parents=True, exist_ok=True)
            input_names = {}
            if is_inpaint_mode(workflow["mode"]):
                input_names = stage_inpaint_inputs(run, width, height, run_dir)
            elif is_bernini_mode(workflow["mode"]):
                input_names = stage_bernini_inputs(run, width, height, run_dir)
            elif workflow["mode"] not in {"t2v", "director_ref"}:
                source_frame = run_dir / f"source_{width}x{height}.png"
                resize_cover(source, source_frame, width=width, height=height)
                source_name = f"{run['run_id']}_source.png"
                shutil.copy2(source_frame, COMFY_INPUT / source_name)
                input_names["source"] = source_name
            if workflow["mode"] == "fml_native":
                middle = Path(run["middle_image"])
                middle_frame = run_dir / f"middle_{width}x{height}.png"
                resize_cover(middle, middle_frame, width=width, height=height)
                end_frame = run_dir / f"end_{width}x{height}.png"
                resize_cover(end, end_frame, width=width, height=height)
                middle_name = f"{run['run_id']}_middle.png"
                end_name = f"{run['run_id']}_end.png"
                shutil.copy2(middle_frame, COMFY_INPUT / middle_name)
                shutil.copy2(end_frame, COMFY_INPUT / end_name)
                input_names["middle"] = middle_name
                input_names["end"] = end_name
            if workflow["mode"] in {"flf", "flf_ia2v"}:
                end_frame = run_dir / f"end_{width}x{height}.png"
                resize_cover(end, end_frame, width=width, height=height)
                end_name = f"{run['run_id']}_end.png"
                shutil.copy2(end_frame, COMFY_INPUT / end_name)
                input_names["end"] = end_name
            if workflow["mode"] in {"ia2v", "flf_ia2v"} or (workflow["mode"] == "director_ref" and run.get("audio_path")):
                audio = Path(run.get("audio_path") or "")
                if not audio.exists():
                    raise FileNotFoundError(f"{workflow['label']} audio file is missing")
                audio_name = f"{run['run_id']}_{safe_filename(audio.name)}"
                shutil.copy2(audio, COMFY_INPUT / audio_name)
                input_names["audio"] = audio_name
                if workflow["mode"] == "director_ref":
                    run["comfy_audio_name"] = audio_name

            if workflow.get("builder") == "ltx23_ttp_flf":
                api = build_ltx23_ttp_flf_api(run, input_names)
            elif workflow.get("builder") == "ltx_director_2":
                run["director_timeline"] = director_timeline_from_payload(run, fps=24)
                (run_dir / "director_timeline.json").write_text(
                    json.dumps(run["director_timeline"], ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                api = build_ltx_director_v2_api(run)
            else:
                workflow_json = json.loads(Path(workflow["path"]).read_text(encoding="utf-8"))
                api = workflow_to_api(workflow_json)
                if is_inpaint_mode(workflow["mode"]):
                    patch_inpaint_api(api, run, input_names)
                elif is_bernini_mode(workflow["mode"]):
                    patch_bernini_api(api, workflow["mode"], run, input_names)
                else:
                    patch_api(api, workflow, run, input_names)
            (run_dir / "api_prompt.json").write_text(json.dumps(api, ensure_ascii=False, indent=2), encoding="utf-8")
            (run_dir / "prompt.txt").write_text(
                f"{run['variant_name']}\n{width}x{height}\nseed: {run['seed']}\n\n{run['prompt']}\n\nNEGATIVE:\n{run['negative_prompt']}\n",
                encoding="utf-8",
            )
            submit = http_json("/prompt", {"prompt": api, "client_id": f"camera-lab-{run['run_id']}"}, timeout=60)
            run["prompt_id"] = submit.get("prompt_id")
            (run_dir / "submit.json").write_text(json.dumps(submit, ensure_ascii=False, indent=2), encoding="utf-8")
            if submit.get("node_errors"):
                raise RuntimeError(json.dumps(submit["node_errors"], ensure_ascii=False))
            if not run["prompt_id"]:
                raise RuntimeError(json.dumps(submit, ensure_ascii=False))
            wait_for_completion(run["prompt_id"], run)
            check_run_canceled(run)
            copied = copy_outputs(run_dir, run["prompt_id"])
            record_run_media_outputs(run, copied, workflow["mode"], run_dir)
            run["status"] = "done"
            run["finished_at"] = time.time()
        except RunCanceled:
            run["status"] = "canceled"
            run["error"] = "canceled"
            run["finished_at"] = time.time()
        except Exception as exc:
            run["status"] = "error"
            run["error"] = str(exc)
            run["finished_at"] = time.time()
        finally:
            write_batch(batch)
    merge_error = ""
    if batch.get("bernini_split", {}).get("enabled") and all(
        r.get("status") == "done" for r in batch["runs"] if r.get("segment_index")
    ):
        try:
            merge_bernini_split_batch(batch)
        except Exception as exc:
            merge_error = str(exc)
            batch["error"] = f"merge failed: {merge_error}"
    batch["status"] = "error" if merge_error else ("done" if all(r.get("status") in {"done", "canceled"} for r in batch["runs"]) else "error")
    batch["finished_at"] = time.time()
    write_batch(batch)


def write_batch(batch: dict) -> None:
    batch_dir = Path(batch["batch_dir"])
    batch_dir.mkdir(parents=True, exist_ok=True)
    (batch_dir / "batch.json").write_text(json.dumps(batch, ensure_ascii=False, indent=2), encoding="utf-8")


def parse_byte_range(range_header: str | None, total: int) -> tuple[int | None, int | None]:
    """Parse an HTTP Range header into inclusive (start, end) byte offsets.

    Returns (None, None) when there is no range, it is malformed, or it cannot
    be satisfied for a file of ``total`` bytes (caller falls back to a 200).
    """
    if not range_header or total <= 0 or not range_header.startswith("bytes="):
        return None, None
    spec = range_header[len("bytes="):].split(",", 1)[0].strip()
    if "-" not in spec:
        return None, None
    start_text, _, end_text = spec.partition("-")
    try:
        if not start_text:
            length = int(end_text)
            if length <= 0:
                return None, None
            start = max(0, total - length)
            end = total - 1
        else:
            start = int(start_text)
            end = int(end_text) if end_text else total - 1
    except ValueError:
        return None, None
    if start > end or start >= total:
        return None, None
    return start, min(end, total - 1)


def cosyvoice_version() -> str:
    return "cv3" if "cosyvoice3" in str(COSYVOICE_MODEL_DIR).lower() else "cv2"


def casting_voice_roster() -> list[dict[str, Any]]:
    """Resolve the voice roster against CASTING_VOICES_DIR; load ref_text from the
    sibling .txt. Only voices whose reference wav exists are included."""
    roster: list[dict[str, Any]] = []
    for voice in CASTING_VOICES:
        wav = CASTING_VOICES_DIR / voice["ref_wav"]
        if not wav.exists():
            continue
        txt = CASTING_VOICES_DIR / voice["ref_txt"]
        ref_text = txt.read_text(encoding="utf-8").strip() if txt.exists() else ""
        roster.append({
            "id": voice["id"],
            "label": voice["label"],
            "gender": voice.get("gender", ""),
            "ref_wav": str(wav),
            "ref_text": ref_text,
        })
    for wav in sorted(CASTING_VOICES_DIR.glob(f"{CUSTOM_VOICE_PREFIX}*.wav")):
        voice_id = wav.stem
        txt = wav.with_suffix(".txt")
        meta = wav.with_suffix(".json")
        label = voice_id.removeprefix(CUSTOM_VOICE_PREFIX).replace("_", " ").strip().title() or voice_id
        if meta.exists():
            try:
                data = json.loads(meta.read_text(encoding="utf-8"))
                label = str(data.get("label") or label).strip() or label
            except Exception:
                pass
        ref_text = txt.read_text(encoding="utf-8").strip() if txt.exists() else ""
        roster.append({
            "id": voice_id,
            "label": label,
            "gender": "",
            "ref_wav": str(wav),
            "ref_text": ref_text,
        })
    return roster


def custom_casting_voice_id(name: str, existing: set[str] | None = None) -> str:
    base = slugify(name).strip("_")
    if not base or base == "variant":
        base = "voice"
    candidate = f"{CUSTOM_VOICE_PREFIX}{base}"
    taken = set(existing or set())
    taken.update(path.stem for path in CASTING_VOICES_DIR.glob(f"{CUSTOM_VOICE_PREFIX}*.wav"))
    while candidate in taken:
        candidate = f"{CUSTOM_VOICE_PREFIX}{base}_{random.randint(1000, 9999)}"
    return candidate


def save_custom_casting_voice(name: str, audio_name: str, audio_bytes: bytes, ref_text: str) -> dict[str, str]:
    label = str(name or "").strip()
    text = str(ref_text or "").strip()
    if not label:
        raise ValueError("voice name is required")
    if not text:
        raise ValueError("reference text is required")
    suffix = Path(audio_name or "").suffix.lower()
    if suffix != ".wav":
        raise ValueError("custom voice reference must be a .wav file")
    if not audio_bytes:
        raise ValueError("reference audio is required")
    if len(audio_bytes) > 80 * 1024 * 1024:
        raise ValueError("reference audio is too large")
    CASTING_VOICES_DIR.mkdir(parents=True, exist_ok=True)
    voice_id = custom_casting_voice_id(label)
    wav = CASTING_VOICES_DIR / f"{voice_id}.wav"
    txt = CASTING_VOICES_DIR / f"{voice_id}.txt"
    meta = CASTING_VOICES_DIR / f"{voice_id}.json"
    wav.write_bytes(audio_bytes)
    txt.write_text(text, encoding="utf-8")
    meta.write_text(json.dumps({"id": voice_id, "label": label, "source": safe_filename(audio_name)}, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"id": voice_id, "label": label, "ref_wav": str(wav), "ref_txt": str(txt)}


def llm_chat(messages: list[dict[str, str]], temperature: float = 0.3, timeout: int = 120) -> str:
    """Call an OpenAI-compatible /chat/completions endpoint (LM Studio / Ollama /
    vLLM / cloud); return the assistant message content."""
    payload = {"model": LLM_MODEL, "messages": messages, "temperature": temperature}
    headers = {"Content-Type": "application/json"}
    if LLM_API_KEY:
        headers["Authorization"] = f"Bearer {LLM_API_KEY}"
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(LLM_URL + "/chat/completions", data=data, headers=headers, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = json.loads(response.read().decode("utf-8"))
    choices = body.get("choices")
    if not choices:
        raise RuntimeError(f"LLM returned no choices: {str(body.get('error') or body)[:300]}")
    return choices[0]["message"]["content"]


def llm_available(timeout: float = 0.75) -> tuple[bool, str]:
    try:
        headers = {"Authorization": f"Bearer {LLM_API_KEY}"} if LLM_API_KEY else {}
        request = urllib.request.Request(LLM_URL + "/models", headers=headers)
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response.read()
        return True, ""
    except Exception as exc:
        return False, f"LLM not reachable at {LLM_URL} ({exc.__class__.__name__})"


def casting_status() -> dict[str, Any]:
    """Availability of the casting feature: CosyVoice (on-demand subprocess) + LLM."""
    cv_reasons: list[str] = []
    if not executable_available(COSYVOICE_PYTHON):
        cv_reasons.append(f"missing CosyVoice python env: {COSYVOICE_PYTHON}")
    if not Path(COSYVOICE_MODEL_DIR).exists():
        cv_reasons.append(f"missing model dir: {display_config_path(Path(COSYVOICE_MODEL_DIR))}")
    if not Path(COSYVOICE_VENDOR).exists():
        cv_reasons.append(f"missing CosyVoice vendor: {display_config_path(Path(COSYVOICE_VENDOR))}")
    if not CASTING_TTS_SCRIPT.exists():
        cv_reasons.append("missing scripts/casting_tts.py")
    roster = casting_voice_roster()
    if not roster:
        cv_reasons.append(f"no voice references in {display_config_path(Path(CASTING_VOICES_DIR))}")
    llm_ok, llm_reason = llm_available()
    return {
        "cosyvoice": {"available": not cv_reasons, "reason": "; ".join(cv_reasons), "version": cosyvoice_version()},
        "llm": {"available": llm_ok, "reason": llm_reason, "url": LLM_URL, "model": LLM_MODEL},
        "voices": [{"id": v["id"], "label": v["label"], "gender": v["gender"]} for v in roster],
        "emotions": list(CASTING_EMOTIONS.keys()),
    }


def casting_library_clips() -> list[dict[str, Any]]:
    """List generated voice clips in the global library (newest first)."""
    migrate_legacy_casting_library()
    casting_current_dir().mkdir(parents=True, exist_ok=True)
    clips: list[dict[str, Any]] = []
    for wav in casting_current_dir().glob("*.wav"):
        meta = {}
        sidecar = wav.with_suffix(".json")
        if sidecar.exists():
            try:
                meta = json.loads(sidecar.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        clips.append({
            "name": wav.stem,
            "file": str(wav),
            "url": "/media?path=" + urllib.parse.quote(str(wav)),
            "mtime": wav.stat().st_mtime,
            "text": meta.get("text", ""),
            "voice": meta.get("voice", ""),
            "emotion": meta.get("emotion", ""),
            "speed": meta.get("speed", 1.0),
            "duration": wav_duration_seconds(wav),
        })
    clips.sort(key=lambda c: c["mtime"], reverse=True)
    return clips


def wav_duration_seconds(path: Path) -> float:
    try:
        with wave.open(str(path), "rb") as wav:
            rate = wav.getframerate()
            if rate <= 0:
                return 0.0
            return round(wav.getnframes() / rate, 3)
    except Exception:
        return 0.0


def casting_current_dir() -> Path:
    return CASTING_LIBRARY_DIR / "current"


def casting_archive_dir() -> Path:
    return CASTING_LIBRARY_DIR / "archive"


def migrate_legacy_casting_library() -> None:
    current_dir = casting_current_dir()
    current_dir.mkdir(parents=True, exist_ok=True)
    for src in sorted(CASTING_LIBRARY_DIR.glob("*.wav")):
        dst = current_dir / src.name
        if dst.exists():
            continue
        shutil.move(str(src), str(dst))
        sidecar = src.with_suffix(".json")
        if sidecar.exists():
            shutil.move(str(sidecar), str(current_dir / sidecar.name))


def casting_clip_slug(text: str, used: set[str], archive_existing: bool = False) -> str:
    """Filename from the first ~5 words of the line, de-duplicated."""
    words = [word.strip("_") for word in re.findall(r"[\w']+", text.lower(), flags=re.UNICODE)]
    words = [word for word in words if word]
    base = "_".join(words[:5])[:40] or "line"
    name = base
    while name in used or ((casting_current_dir() / f"{name}.wav").exists() and not archive_existing):
        name = f"{base}_{random.randint(1000, 9999)}"
    used.add(name)
    return name


def archive_casting_clip(name: str) -> list[Path]:
    """Move any existing library files for a clip into archive/ before replacing."""
    archived: list[Path] = []
    archive_dir = casting_archive_dir()
    for src in (casting_current_dir() / f"{name}.wav", casting_current_dir() / f"{name}.json"):
        if not src.exists():
            continue
        archive_dir.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%d_%H%M%S")
        dst = archive_dir / f"{src.stem}_{stamp}_{random.randint(1000, 9999)}{src.suffix}"
        shutil.move(str(src), str(dst))
        archived.append(dst)
    return archived


def archive_casting_library() -> list[Path]:
    """Archive every generated clip currently in the library root."""
    migrate_legacy_casting_library()
    current_dir = casting_current_dir()
    wavs = sorted(current_dir.glob("*.wav"))
    if not wavs:
        return []
    base = time.strftime("%Y%m%d_%H%M%S")
    archive_dir = casting_archive_dir() / base
    while archive_dir.exists():
        archive_dir = casting_archive_dir() / f"{base}_{random.randint(1000, 9999)}"
    archive_dir.mkdir(parents=True, exist_ok=True)
    archived: list[Path] = []
    for wav in wavs:
        for src in (wav, wav.with_suffix(".json")):
            if not src.exists():
                continue
            dst = archive_dir / src.name
            shutil.move(str(src), str(dst))
            archived.append(dst)
    return archived


def archive_casting_files(files: list[Path]) -> list[Path]:
    existing = [path for path in files if path.exists()]
    if not existing:
        return []
    base = time.strftime("%Y%m%d_%H%M%S")
    archive_dir = casting_archive_dir() / base
    while archive_dir.exists():
        archive_dir = casting_archive_dir() / f"{base}_{random.randint(1000, 9999)}"
    archive_dir.mkdir(parents=True, exist_ok=True)
    archived: list[Path] = []
    for src in existing:
        dst = archive_dir / src.name
        shutil.move(str(src), str(dst))
        archived.append(dst)
    return archived


def open_folder(path: Path) -> None:
    if os.name == "nt":
        os.startfile(str(path))  # type: ignore[attr-defined]
        return
    opener = "open" if sys.platform == "darwin" else "xdg-open"
    subprocess.Popen([opener, str(path)])


def open_casting_archive_folder(opener: Any = open_folder) -> dict[str, Any]:
    archive_dir = casting_archive_dir()
    archive_dir.mkdir(parents=True, exist_ok=True)
    opener(archive_dir)
    return {"ok": True, "path": str(archive_dir)}


def current_casting_clip_path(raw: str) -> Path:
    path = Path(raw).resolve()
    current = casting_current_dir().resolve()
    if path.suffix.lower() != ".wav" or not (path == current or current in path.parents):
        raise PermissionError(str(path))
    if not path.exists():
        raise FileNotFoundError(str(path))
    return path


def recycle_casting_clip(raw_path: str, recycler: Any = None) -> dict[str, Any]:
    src = current_casting_clip_path(raw_path)
    recycler = recycler or move_to_recycle_bin
    files = [src, src.with_suffix(".json")]
    recycled: list[str] = []
    for path in files:
        if not path.exists():
            continue
        recycler(path)
        recycled.append(str(path))
    return {"ok": True, "recycled": recycled, "clips": casting_library_clips()}


def trim_casting_clip(raw_path: str, start: Any, end: Any, runner: Any = subprocess.run) -> dict[str, Any]:
    src = current_casting_clip_path(raw_path)
    start_s = max(0.0, float(start))
    end_s = float(end)
    if end_s <= start_s:
        raise ValueError("trim end must be greater than trim start")
    tmp = src.with_name(f".{src.stem}_trim_{int(time.time())}_{random.randint(1000, 9999)}.wav")
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        str(round(start_s, 3)),
        "-to",
        str(round(end_s, 3)),
        "-i",
        str(src),
        str(tmp),
    ]
    try:
        runner(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if not tmp.exists():
            raise RuntimeError("ffmpeg did not produce trimmed audio")
        meta_path = src.with_suffix(".json")
        meta = {}
        if meta_path.exists():
            try:
                meta = json.loads(meta_path.read_text(encoding="utf-8"))
            except Exception:
                meta = {}
        archive_casting_files([src, meta_path])
        shutil.move(str(tmp), str(src))
        meta.update({"trim_start": start_s, "trim_end": end_s, "trimmed_at": time.time()})
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    finally:
        tmp.unlink(missing_ok=True)
    return {
        "ok": True,
        "name": src.stem,
        "file": str(src),
        "url": "/media?path=" + urllib.parse.quote(str(src)),
    }


_JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*\})\s*```", re.DOTALL)


def extract_json_object(content: str) -> dict:
    """Resilient JSON extraction from an LLM message (handles code fences / prose)."""
    match = _JSON_FENCE_RE.search(content)
    if match:
        content = match.group(1)
    start, end = content.find("{"), content.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError(f"LLM did not return JSON: {content.strip()[:200]!r}")
    return json.loads(content[start:end + 1])


MOTION_REWRITE_PROMPT_FORMAT = """
    # Role
    You are an expert in 3D motion analysis, animation timing, and choreography. Your task is to analyze textual action descriptions to estimate execution time and standardize the language for motion generation systems.

    # Task
    Analyze the user-provided [Input Action] and generate a structured JSON response containing a duration estimate and a refined caption.

    # Instructions

    ### 1. Duration Estimation (frame_count)
    - Analyze the complexity, speed, and physical constraints of the described action.
    - Estimate the time required to perform the action in a **smooth, natural, and realistic manner**.
    - Calculate the total duration in frames based on a **30 fps** (frames per second) standard.
    - Output strictly as an Integer.

    ### 2. Caption Refinement (short_caption)
    - Generate a refined, grammatically correct version of the input description in **English**.
    - **Strict Constraints**:
        - You must **PRESERVE** the original sequence of events (chronological order).
        - You must **RETAIN** all original spatial modifiers (e.g., "left," "upward," "quickly").
        - **DO NOT** add new sub-actions or hallucinate details not present in the input.
        - **DO NOT** delete any specific movements.
    - The goal is to improve clarity and flow while maintaining 100% semantic fidelity to the original request.

    ### 3. Output Format
    - Return **ONLY** a raw JSON object.
    - Do not use Markdown formatting (i.e., do not use ```json ... ```).
    - Ensure the JSON is valid and parsable.

    # JSON Structure
    {{
        "duration": <Integer, frames at 30fps>,
        "short_caption": "<String, the refined English description>"
    }}

    # Input
    {}
"""


def rewrite_motion_prompt(text: str, default_duration: float = 4.0) -> tuple[str, float]:
    """Rewrite a motion prompt via the in-server LLM and infer duration.

    Returns ``(short_caption, duration_seconds)``.  On any failure (LLM
    unavailable, non-JSON reply, missing keys) falls back to
    ``(text, default_duration)``.
    """
    try:
        prompt = MOTION_REWRITE_PROMPT_FORMAT.format(text)
        reply = llm_chat([{"role": "user", "content": prompt}])
        data = extract_json_object(reply)
        return (str(data["short_caption"]), float(data["duration"]) / 30.0)
    except Exception:
        return (text, default_duration)


def build_casting_prompt(script: str, roster: list[dict[str, Any]]) -> str:
    emotions = ", ".join(CASTING_EMOTIONS.keys())
    return (
        "You prepare dialogue for text-to-speech. Read the script/prompt below and extract only the words "
        "that should be spoken aloud, in reading order.\n\n"
        f"Allowed emotions: {emotions}\n\n"
        "Rules:\n"
        "- 'text' = the exact spoken words only (no stage directions, no surrounding quotes).\n"
        "- Pick 'emotion' from the allowed list; do not overuse neutral.\n"
        "- Neutral is only for emotionally flat or factual speech.\n"
        "- Infer emotion from nearby stage directions, verbs, adverbs, punctuation, and stakes in the scene.\n"
        "- Emotion cues: whispers -> whisper; shouts/yells -> angry or excited; cries/trembles/pleads -> sad; "
        "smiles/comforts/softly reassures -> warm or gentle; orders/warns/threatens -> serious or angry; "
        "urgent action or exclamation -> excited.\n"
        "- Keep the content inside one pair of quotation marks as one line when possible.\n"
        "- Do not split quoted dialogue only because it contains punctuation.\n"
        "- Break long dialogue into short TTS-friendly phrases.\n"
        "- Do not identify characters, people, or roles.\n"
        "- One object per phrase, in order.\n\n"
        'Output ONLY JSON: {"lines":[{"text":"...","emotion":"<emotion>"}]}\n\n'
        "# Script\n" + script
    )


def analyze_casting_script(script: str) -> dict[str, Any]:
    prompt = build_casting_prompt(script, [])
    last_err: Exception | None = None
    for temperature in (0.2, 0.4, 0.7):
        try:
            content = llm_chat([{"role": "user", "content": prompt}], temperature=temperature)
            data = extract_json_object(content)
            lines: list[dict[str, str]] = []
            for item in data.get("lines", []):
                text = str(item.get("text") or "").strip()
                if not text:
                    continue
                emotion = item.get("emotion") if item.get("emotion") in CASTING_EMOTIONS else "neutral"
                lines.append({"text": text, "emotion": emotion})
            if lines:
                return {"lines": lines}
        except Exception as exc:
            last_err = exc
            continue
    raise RuntimeError(f"casting analysis failed: {last_err}")


def prepare_casting_tts_job(
    lines: list[dict[str, Any]],
    roster: dict[str, dict[str, Any]],
    archive_all: bool = False,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if archive_all:
        archive_casting_library()
    used: set[str] = set()
    job_lines: list[dict[str, Any]] = []
    clips_meta: list[dict[str, Any]] = []
    for index, item in enumerate(lines, start=1):
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        voice = str(item.get("voice") or "").strip()
        if not voice:
            raise ValueError(f"voice is required for line {index}")
        if voice not in roster:
            raise ValueError(f"unknown voice for line {index}: {voice}")
        emotion = item.get("emotion") if item.get("emotion") in CASTING_EMOTIONS else "neutral"
        speed = clamp_casting_speed(item.get("speed"))
        name = casting_clip_slug(text, used)
        job_lines.append({"text": text, "voice": voice, "emotion": emotion, "speed": speed, "out_name": name})
        clips_meta.append({"text": text, "voice": voice, "emotion": emotion, "speed": speed, "name": name})
    return job_lines, clips_meta


def clamp_casting_speed(value: Any) -> float:
    try:
        speed = float(value)
    except (TypeError, ValueError):
        speed = 1.0
    return round(max(0.6, min(1.4, speed)), 2)


def safe_media_path(raw: str) -> Path:
    path = Path(raw).resolve()
    allowed_roots = [ROOT.resolve(), COMFY_OUTPUT.resolve()]
    if not any(path == root or root in path.parents for root in allowed_roots):
        raise PermissionError(str(path))
    return path


def payload_bool(value: Any, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"0", "false", "off", "no", "n"}:
            return False
        if normalized in {"1", "true", "on", "yes", "y"}:
            return True
    return bool(value)


def sanitize_3dmotion_video_name(name: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", name or "drive.webm")
    return re.sub(r"\.[^.]+$", "", cleaned) or "drive"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def send_json(self, data: Any, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

    def proxy_comfy_request(self, method: str, parsed: urllib.parse.ParseResult) -> None:
        suffix = parsed.path.removeprefix("/comfy")
        target = MOTION_COMFY_URL.rstrip("/") + suffix
        if parsed.query:
            target += "?" + parsed.query
        body = None
        if method != "GET":
            length = int(self.headers.get("Content-Length", "0"))
            body = self.rfile.read(length) if length else b""
        headers = {}
        for key in ("Content-Type", "Accept", "Range"):
            value = self.headers.get(key)
            if value:
                headers[key] = value
        request = urllib.request.Request(target, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                self.send_response(response.status)
                self.forward_proxy_headers(response.headers)
                self.end_headers()
                shutil.copyfileobj(response, self.wfile)
        except urllib.error.HTTPError as exc:
            self.send_response(exc.code)
            self.forward_proxy_headers(exc.headers)
            self.end_headers()
            self.wfile.write(exc.read())

    def forward_proxy_headers(self, headers: Any) -> None:
        for key in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges"):
            value = headers.get(key)
            if value:
                self.send_header(key, value)

    def handle_3dmotion_drive_video(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        base_name = sanitize_3dmotion_video_name(query.get("name", ["drive.webm"])[0])
        length = int(self.headers.get("Content-Length", "0"))
        if length > MAX_3DMOTION_DRIVE_BYTES:
            raise ValueError("drive video is too large")
        output_dir = MOTION_COMFY_INPUT / "3dmotion-scail"
        output_dir.mkdir(parents=True, exist_ok=True)
        webm_path = output_dir / f"{base_name}.webm"
        mp4_path = output_dir / f"{base_name}.mp4"
        with webm_path.open("wb") as handle:
            remaining = length
            while remaining > 0:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                handle.write(chunk)
                remaining -= len(chunk)
        ffmpeg = os.environ.get("FFMPEG_PATH") or "ffmpeg"
        cmd = [
            ffmpeg,
            "-y",
            "-i",
            str(webm_path),
            "-vf",
            "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=24",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-an",
            str(mp4_path),
        ]
        try:
            subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        except subprocess.CalledProcessError as exc:
            stderr = exc.stderr.decode("utf-8", errors="replace") if exc.stderr else ""
            raise RuntimeError(stderr or f"ffmpeg exited with code {exc.returncode}") from exc
        finally:
            webm_path.unlink(missing_ok=True)
        if not mp4_path.exists():
            raise RuntimeError("ffmpeg did not produce a drive video")
        self.send_json({"path": f"3dmotion-scail/{base_name}.mp4"})

    def handle_3dmotion_recording(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        base_name = sanitize_3dmotion_video_name(query.get("name", ["recorded_3d.webm"])[0])
        duration = float(query.get("duration", ["0"])[0] or 0)
        prompt = query.get("prompt", ["3D motion recorded guide"])[0]
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            raise ValueError("recorded video is empty")
        if length > MAX_3DMOTION_DRIVE_BYTES:
            raise ValueError("recorded video is too large")
        upload_dir = UPLOAD_ROOT / "videos" / "3dmotion"
        upload_dir.mkdir(parents=True, exist_ok=True)
        suffix = Path(base_name).suffix.lower()
        if suffix not in VIDEO_UPLOAD_SUFFIXES:
            base_name = f"{Path(base_name).stem}.webm"
        upload = upload_dir / f"{int(time.time())}_{random.randint(1000, 9999)}_{base_name}"
        with upload.open("wb") as handle:
            remaining = length
            while remaining > 0:
                chunk = self.rfile.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                handle.write(chunk)
                remaining -= len(chunk)
        batch = record_3dmotion_guide_run(upload, duration=duration, prompt=prompt)
        self.send_json({"batch": batch, "run": batch["runs"][0]})

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/":
                return self.serve_file(WEB_DIR / "index.html")
            if parsed.path.startswith("/static/"):
                return self.serve_file(WEB_DIR / parsed.path.removeprefix("/static/"))
            if parsed.path.startswith("/comfy/"):
                return self.proxy_comfy_request("GET", parsed)
            if parsed.path.startswith("/vendor/yedp/"):
                name = Path(parsed.path.removeprefix("/vendor/yedp/")).name
                if Path(name).suffix.lower() not in {".js", ".mjs", ".wasm"}:
                    self.send_error(404)
                    return
                return self.serve_file(YEDP_WEB_JS / name)
            if parsed.path == "/api/config":
                comfy = comfy_status()
                return self.send_json(
                    {
                        "workflows": public_workflows(None if comfy.get("ok") else comfy.get("reason") or "ComfyUI unavailable"),
                        "camera_moves": CAMERA_MOVES,
                        "camera_examples": CAMERA_EXAMPLES,
                        "images": REFERENCE_IMAGES,
                        "default_negative": DEFAULT_NEGATIVE,
                        "motion_rewrite_prompt_format": MOTION_REWRITE_PROMPT_FORMAT,
                        "comfy": comfy,
                        "casting": casting_status(),
                        "director": {"ic_loras": director_ic_loras()},
                    }
                )
            if parsed.path == "/api/casting/library":
                return self.send_json({"clips": casting_library_clips()})
            if parsed.path.startswith("/api/batches/"):
                batch_id = parsed.path.rsplit("/", 1)[-1]
                return self.send_json(BATCHES.get(batch_id) or load_batch(batch_id))
            if parsed.path == "/api/history":
                query = urllib.parse.parse_qs(parsed.query)
                limit = int(query.get("limit", ["30"])[0])
                return self.send_json({"runs": history_runs(limit)})
            if parsed.path == "/media":
                query = urllib.parse.parse_qs(parsed.query)
                return self.serve_file(safe_media_path(query.get("path", [""])[0]))
            self.send_error(404)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def do_POST(self) -> None:
        try:
            if self.path == "/api/run":
                return self.handle_run()
            if self.path == "/api/text-to-motion":
                return self.handle_text_to_motion()
            if self.path == "/api/text-to-motion-guide":
                return self.handle_text_to_motion_guide()
            if self.path == "/api/text-to-motion-final":
                return self.handle_text_to_motion_final()
            if self.path == "/api/text-to-motion-video-final":
                return self.handle_text_to_motion_video_final()
            if self.path == "/api/upload-audio":
                return self.handle_upload_audio()
            if self.path == "/api/upload-video":
                return self.handle_upload_video()
            if self.path == "/api/trim-video":
                return self.handle_trim_video()
            if self.path.startswith("/api/scail-drive-video"):
                return self.handle_3dmotion_drive_video()
            if self.path.startswith("/api/3dmotion-recording"):
                return self.handle_3dmotion_recording()
            if self.path == "/api/upload-image":
                return self.handle_upload_image()
            if self.path.startswith("/comfy/"):
                return self.proxy_comfy_request("POST", urllib.parse.urlparse(self.path))
            if self.path == "/api/photography-subject":
                return self.handle_photography_subject()
            if self.path == "/api/photography-frames":
                return self.handle_photography_frames()
            if self.path == "/api/shot-pack":
                return self.handle_shot_pack()
            if self.path == "/api/history-state":
                return self.handle_history_state()
            if self.path == "/api/last-frame":
                return self.handle_last_frame()
            if self.path == "/api/rate":
                return self.handle_rate()
            if self.path == "/api/casting/analyze":
                return self.handle_casting_analyze()
            if self.path == "/api/casting/tts":
                return self.handle_casting_tts()
            if self.path == "/api/casting/voice":
                return self.handle_casting_voice()
            if self.path == "/api/casting/open-archive":
                return self.send_json(open_casting_archive_folder())
            if self.path == "/api/casting/trim":
                payload = self.read_json()
                return self.send_json(trim_casting_clip(payload.get("file", ""), payload.get("start"), payload.get("end")))
            if self.path == "/api/casting/delete":
                payload = self.read_json()
                return self.send_json(recycle_casting_clip(payload.get("file", "")))
            self.send_error(404)
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def serve_file(self, path: Path) -> None:
        if not path.exists() or not path.is_file():
            self.send_error(404)
            return
        body = path.read_bytes()
        total = len(body)
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        is_web = path.resolve() == WEB_DIR.resolve() or WEB_DIR.resolve() in path.resolve().parents
        start, end = parse_byte_range(self.headers.get("Range"), total)
        if start is not None:
            chunk = body[start:end + 1]
            self.send_response(206)
            self.send_header("Content-Type", content_type)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Range", f"bytes {start}-{end}/{total}")
            if is_web:
                self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(chunk)))
            self.end_headers()
            self.wfile.write(chunk)
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Accept-Ranges", "bytes")
        if is_web:
            self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(total))
        self.end_headers()
        self.wfile.write(body)

    def handle_run(self) -> None:
        payload = self.read_json()
        workflow = next(w for w in WORKFLOWS if w["id"] == payload["workflow_id"])
        status = workflow_status(workflow)
        if not status["available"]:
            raise RuntimeError(f"{workflow['label']} unavailable: {status['reason']}")
        bernini_media = {
            "source": {"path": ""},
            "reference_image": {"path": ""},
            "source_video": {"path": ""},
            "reference_video": {"path": ""},
        }
        inpaint_media = {
            "source_video": {"path": ""},
            "reference_image": {"path": ""},
            "mask_image": {"path": ""},
        }
        if is_inpaint_mode(workflow["mode"]):
            inpaint_media = validate_inpaint_media_paths(payload)
            source = {"path": ""}
            end = {"path": ""}
            middle = {"path": ""}
        elif is_bernini_mode(workflow["mode"]):
            bernini_media = validate_bernini_media_paths(workflow["mode"], payload)
            source = bernini_media["source"]
            end = {"path": ""}
            middle = {"path": ""}
        else:
            source_path = payload.get("source_path") or ""
            if workflow["mode"] not in {"t2v", "director_ref"} and not source_path:
                raise ValueError("source image is required")
            source = {"path": str(safe_media_path(source_path)) if source_path else ""}
            end_path = payload.get("end_path") or source["path"]
            if workflow["mode"] in {"flf", "fml", "fml_native", "flf_ia2v"} and not payload.get("end_path"):
                raise ValueError("FLF/FML requires an uploaded end image")
            end = {"path": str(safe_media_path(end_path)) if end_path else ""}
            middle = {"path": ""}
            if workflow["mode"] in {"fml", "fml_native"}:
                middle_path = payload.get("middle_path") or ""
                if not middle_path:
                    raise ValueError("FML requires an uploaded middle image")
                middle = {"path": str(safe_media_path(middle_path))}
        width, height = validate_size(payload.get("width"), payload.get("height"))
        prompt = (payload.get("prompt") or "").strip()
        if workflow["mode"] == "director_ref":
            prompt = build_director_prompt_summary(payload)
            variants = [{"name": "director", "prompt": prompt}]
        else:
            variants = payload.get("variants") or [{"name": "prompt", "prompt": prompt}]
        if not any((variant.get("prompt") or "").strip() for variant in variants):
            raise ValueError("prompt is required")
        if workflow["mode"] in {"ia2v", "flf_ia2v"} and not payload.get("audio_path"):
            raise ValueError("IA2V requires an uploaded audio file")
        reference_images = {}
        director_segments = payload.get("timeline_segments") or payload.get("segments") or []
        director_audio_segments = payload.get("audio_segments") or []
        director_motion_segments = payload.get("motion_segments") or []
        if workflow["mode"] == "director_ref":
            reference_images = validate_reference_images(payload.get("reference_images") or {})
            director_segments = validate_director_segments(payload.get("timeline_segments") or payload.get("segments") or [])
            director_audio_segments = validate_director_audio_segments(payload.get("audio_segments") or [])
            director_motion_segments = validate_director_motion_segments(payload.get("motion_segments") or [])
        seed = validate_seed(payload.get("seed"))
        split_options = bernini_split_options(workflow["mode"], payload)
        batch_id = f"camera_lab_{int(time.time())}_{random.randint(1000, 9999)}"
        batch_dir = RUN_ROOT / batch_id
        batch_dir.mkdir(parents=True, exist_ok=True)
        runs = []
        for index, variant in enumerate(variants, start=1):
            run_id = f"{index:02d}_{slugify(variant['name'])}"
            run_dir = batch_dir / run_id
            run_dir.mkdir(parents=True, exist_ok=True)
            runs.append(
                {
                    "batch_id": batch_id,
                    "run_id": run_id,
                    "run_dir": str(run_dir),
                    "workflow_id": workflow["id"],
                    "workflow_mode": workflow["mode"],
                    "workflow_label": workflow["label"],
                    "workflow_path": workflow.get("path", ""),
                    "camera_move": payload.get("camera_move") or workflow["mode"],
                    "source_image": source["path"],
                    "middle_image": middle["path"],
                    "end_image": end["path"],
                    "reference_image": bernini_media["reference_image"]["path"] or inpaint_media["reference_image"]["path"],
                    "source_video": bernini_media["source_video"]["path"] or inpaint_media["source_video"]["path"],
                    "reference_video": bernini_media["reference_video"]["path"],
                    "mask_image": inpaint_media["mask_image"]["path"],
                    "audio_path": payload.get("audio_path", ""),
                    "bernini_preserve_audio": bool(payload.get("bernini_preserve_audio")) and bool(bernini_media["source_video"]["path"]),
                    "duration": 0.0 if workflow["mode"] in BERNINI_IMAGE_MODES else float(payload.get("duration", 4)),
                    "width": width,
                    "height": height,
                    "seed": seed,
                    "variant_name": variant["name"],
                    "prompt": variant["prompt"],
                    "global_prompt": payload.get("global_prompt", ""),
                    "global_reference_strength": max(0.0, min(1.0, float(payload.get("global_reference_strength") or 0.35))),
                    "bernini_ref_max_size": max(16, min(8192, int(float(payload.get("bernini_ref_max_size") or 848)))),
                    "segments": director_segments,
                    "audio_segments": director_audio_segments,
                    "motion_segments": director_motion_segments,
                    "reference_images": reference_images,
                    "negative_prompt": payload.get("negative_prompt") or (INPAINT_DEFAULT_NEGATIVE if is_inpaint_mode(workflow["mode"]) else DEFAULT_NEGATIVE),
                    "status": "queued",
                    "queued_at": time.time(),
                    "scores": {},
                    "notes": "",
                }
            )
        if split_options["enabled"]:
            split_runs: list[dict[str, Any]] = []
            for run in runs:
                split_runs.extend(prepare_bernini_split_runs(run, batch_dir, float(split_options["duration"])))
            runs = split_runs
        for run in runs:
            Path(run["run_dir"]).mkdir(parents=True, exist_ok=True)
        batch = {
            "batch_id": batch_id,
            "batch_dir": str(batch_dir),
            "status": "queued",
            "queued_at": time.time(),
            "runs": runs,
            "bernini_split": split_options,
        }
        BATCHES[batch_id] = batch
        write_batch(batch)
        thread = threading.Thread(target=run_batch_worker, args=(batch_id,), daemon=True)
        thread.start()
        self.send_json(batch)

    def create_motion_batch(self, payload: dict[str, Any], require_reference: bool = True) -> dict[str, Any]:
        prompt = str(payload.get("prompt") or "").strip()
        if not prompt:
            raise ValueError("prompt is required")
        reference_path = payload.get("reference_path") or payload.get("source_path") or ""
        if require_reference and not reference_path:
            raise ValueError("motion reference image is required")
        reference = safe_media_path(str(reference_path)) if reference_path else None
        width, height = validate_size(payload.get("width") or 480, payload.get("height") or 832)
        seed = validate_seed(payload.get("seed"))
        duration = max(0.5, min(12.0, float(payload.get("duration") or 4.0)))
        cfg_scale = max(1.0, min(5.0, float(payload.get("cfg_scale") or payload.get("cfg") or 5.0)))
        steps = max(1, min(100, int(payload.get("steps") or 8)))
        pose_strength = max(0.0, min(1.0, float(payload.get("pose_strength") or 1.0)))

        batch_id = f"motion_{int(time.time())}_{random.randint(1000, 9999)}"
        batch_dir = RUN_ROOT / batch_id
        run_id = "01_motion"
        run_dir = batch_dir / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        run = {
            "batch_id": batch_id,
            "run_id": run_id,
            "run_dir": str(run_dir),
            "workflow_id": "text_to_motion",
            "workflow_mode": "motion_text",
            "workflow_label": "Motion Guide",
            "camera_move": "motion",
            "reference_image": str(reference) if reference else "",
            "duration": duration,
            "width": width,
            "height": height,
            "seed": seed,
            "variant_name": "motion",
            "prompt": prompt,
            "rewrite": bool(payload.get("rewrite")),
            "cfg_scale": cfg_scale,
            "steps": steps,
            "pose_strength": pose_strength,
            "use_pose_video_mask": payload_bool(payload.get("use_pose_video_mask"), True),
            "pose_video_mask_prompt": str(payload.get("pose_video_mask_prompt") or "person").strip() or "person",
            "status": "queued",
            "queued_at": time.time(),
            "scores": {},
            "notes": "",
        }
        batch = {
            "batch_id": batch_id,
            "batch_dir": str(batch_dir),
            "status": "queued",
            "queued_at": time.time(),
            "runs": [run],
        }
        BATCHES[batch_id] = batch
        write_batch(batch)
        return batch

    def handle_text_to_motion(self) -> None:
        batch = self.create_motion_batch(self.read_json(), require_reference=True)
        thread = threading.Thread(target=motion_worker, args=(batch["runs"][0], batch), daemon=True)
        thread.start()
        self.send_json(batch)

    def handle_text_to_motion_guide(self) -> None:
        batch = self.create_motion_batch(self.read_json(), require_reference=False)
        thread = threading.Thread(target=motion_guide_worker, args=(batch["runs"][0], batch), daemon=True)
        thread.start()
        self.send_json(batch)

    def handle_text_to_motion_final(self) -> None:
        payload = self.read_json()
        batch_id = str(payload.get("batch_id") or "").strip()
        if not batch_id:
            raise ValueError("batch_id is required")
        batch = BATCHES.get(batch_id) or load_batch(batch_id)
        BATCHES[batch_id] = batch
        run_id = str(payload.get("run_id") or "").strip()
        run = next((item for item in batch.get("runs", []) if not run_id or item.get("run_id") == run_id), None)
        if not run:
            raise ValueError("motion run not found")
        if not run.get("guide_video"):
            raise ValueError("generate a motion guide first")

        if payload.get("reference_path") or payload.get("source_path"):
            run["reference_image"] = str(safe_media_path(str(payload.get("reference_path") or payload.get("source_path"))))
        width, height = validate_size(payload.get("width") or run.get("width") or 480, payload.get("height") or run.get("height") or 832)
        run["width"] = width
        run["height"] = height
        if payload.get("steps") not in {None, ""}:
            run["steps"] = max(1, min(100, int(payload.get("steps"))))
        if payload.get("pose_strength") not in {None, ""}:
            run["pose_strength"] = max(0.0, min(1.0, float(payload.get("pose_strength"))))
        run["use_pose_video_mask"] = payload_bool(payload.get("use_pose_video_mask"), True)
        run["pose_video_mask_prompt"] = str(payload.get("pose_video_mask_prompt") or run.get("pose_video_mask_prompt") or "person").strip() or "person"
        run["seed"] = validate_seed(payload.get("seed"))
        trim_start, trim_end = motion_trim_values(payload)
        run["guide_trim_start"] = trim_start
        run["guide_trim_end"] = trim_end
        run["workflow_id"] = "uploaded_motion_to_scail"
        run["workflow_mode"] = "motion_scail"
        run["workflow_label"] = "SCAIL2"
        if trim_end is not None:
            run["duration"] = round(trim_end - trim_start, 3)
            run["scail_length"] = align_4k1(round((trim_end - trim_start) * 24))
        write_batch(batch)
        thread = threading.Thread(target=motion_final_worker, args=(run, batch), daemon=True)
        thread.start()
        self.send_json(batch)

    def handle_text_to_motion_video_final(self) -> None:
        batch = create_motion_video_batch(self.read_json())
        thread = threading.Thread(target=motion_final_worker, args=(batch["runs"][0], batch), daemon=True)
        thread.start()
        self.send_json(batch)

    def handle_upload_audio(self) -> None:
        payload = self.read_json()
        name = safe_filename(payload.get("name") or "audio.wav")
        data_url = payload.get("data") or ""
        if "," in data_url:
            data_url = data_url.split(",", 1)[1]
        suffix = Path(name).suffix.lower()
        if suffix not in {".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".mp4"}:
            raise ValueError("unsupported audio file type")
        raw = base64.b64decode(data_url)
        if len(raw) > 80 * 1024 * 1024:
            raise ValueError("audio file is too large")
        upload_dir = UPLOAD_ROOT / "audio"
        upload_dir.mkdir(parents=True, exist_ok=True)
        path = upload_dir / f"{int(time.time())}_{random.randint(1000, 9999)}_{name}"
        path.write_bytes(raw)
        poster = path.with_name(f"{path.stem}_first_frame.jpg")
        try:
            extract_first_frame(path, poster)
        except Exception:
            poster = None
        response = {"path": str(path), "name": name}
        if poster and poster.exists():
            response["poster_path"] = str(poster)
        self.send_json(response)

    def handle_upload_video(self) -> None:
        content_type = self.headers.get("Content-Type", "")
        if content_type.startswith("multipart/form-data"):
            return self.handle_upload_video_form(content_type)
        payload = self.read_json()
        name = safe_filename(payload.get("name") or "video.mp4")
        data_url = payload.get("data") or ""
        if "," in data_url:
            data_url = data_url.split(",", 1)[1]
        raw = base64.b64decode(data_url)
        self.save_uploaded_video(name, raw)

    def handle_upload_video_form(self, content_type: str) -> None:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", DeprecationWarning)
            import cgi

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
                "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
            },
        )
        item = None
        for field_name in ("file", "video"):
            if field_name in form:
                item = form[field_name]
                break
        if isinstance(item, list):
            item = item[0] if item else None
        if item is None or not getattr(item, "file", None):
            raise ValueError("video file is required")
        name = safe_filename(getattr(item, "filename", "") or "video.mp4")
        raw = item.file.read(MAX_VIDEO_UPLOAD_BYTES + 1)
        self.save_uploaded_video(name, raw)

    def save_uploaded_video(self, name: str, raw: bytes) -> None:
        suffix = Path(name).suffix.lower()
        if suffix not in VIDEO_UPLOAD_SUFFIXES:
            raise ValueError("unsupported video file type")
        if len(raw) > MAX_VIDEO_UPLOAD_BYTES:
            raise ValueError("video file is too large")
        upload_dir = UPLOAD_ROOT / "videos"
        upload_dir.mkdir(parents=True, exist_ok=True)
        path = upload_dir / f"{int(time.time())}_{random.randint(1000, 9999)}_{name}"
        path.write_bytes(raw)
        self.send_json({"path": str(path), "name": name})

    def handle_trim_video(self) -> None:
        payload = self.read_json()
        source = safe_media_path(str(payload.get("video_path") or ""))
        if source.suffix.lower() not in SUPPORTED_VIDEO_SUFFIXES:
            raise ValueError("unsupported video file type")
        start = float(payload.get("start") or 0)
        end = float(payload.get("end") or 0)
        output = trim_video_clip(source, UPLOAD_ROOT / "videos" / "clips", start, end)
        duration = video_duration_seconds(output)
        self.send_json({"path": str(output), "name": output.name, "duration": duration})

    def handle_upload_image(self) -> None:
        payload = self.read_json()
        name = safe_filename(payload.get("name") or "image.png")
        data_url = payload.get("data") or ""
        if "," in data_url:
            data_url = data_url.split(",", 1)[1]
        suffix = Path(name).suffix.lower()
        if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
            raise ValueError("unsupported image file type")
        raw = base64.b64decode(data_url)
        if len(raw) > 80 * 1024 * 1024:
            raise ValueError("image file is too large")
        upload_dir = UPLOAD_ROOT / "images"
        upload_dir.mkdir(parents=True, exist_ok=True)
        path = upload_dir / f"{int(time.time())}_{random.randint(1000, 9999)}_{name}"
        path.write_bytes(raw)
        self.send_json({"path": str(path), "name": name})

    def handle_photography_subject(self) -> None:
        payload = self.read_json()
        name = safe_filename(payload.get("name") or "subject.png")
        data_url = payload.get("data") or ""
        if "," in data_url:
            header, data_url = data_url.split(",", 1)
            if not header.startswith("data:image/"):
                raise ValueError("subject must be an image data URL")
        suffix = Path(name).suffix.lower()
        if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
            raise ValueError("unsupported subject image file type")
        raw = base64.b64decode(data_url)
        if len(raw) > 32 * 1024 * 1024:
            raise ValueError("subject image is too large")
        folder = Path("camera_lab_photography_subjects")
        filename = f"{int(time.time())}_{random.randint(1000, 9999)}_{name}"
        comfy_path = COMFY_INPUT / folder / filename
        upload_path = UPLOAD_ROOT / "photography_subjects" / filename
        comfy_path.parent.mkdir(parents=True, exist_ok=True)
        upload_path.parent.mkdir(parents=True, exist_ok=True)
        comfy_path.write_bytes(raw)
        upload_path.write_bytes(raw)
        self.send_json(
            {
                "name": name,
                "comfy_input_name": str((folder / filename)).replace("\\", "/"),
                "path": str(upload_path),
            }
        )

    def handle_photography_frames(self) -> None:
        payload = self.read_json()
        raw_frames = payload.get("frames") or []
        if not isinstance(raw_frames, list) or not raw_frames:
            raise ValueError("frames are required")
        if len(raw_frames) > 120:
            raise ValueError("too many frames; maximum is 120")
        width, height = validate_size(payload.get("width"), payload.get("height"))
        run_id = f"photo_{int(time.time())}_{random.randint(1000, 9999)}"
        comfy_dir = COMFY_INPUT / "camera_lab_photography" / run_id
        upload_dir = UPLOAD_ROOT / "photography_frames" / run_id
        comfy_dir.mkdir(parents=True, exist_ok=True)
        upload_dir.mkdir(parents=True, exist_ok=True)

        saved = []
        for index, data_url in enumerate(raw_frames, start=1):
            value = str(data_url or "")
            if "," in value:
                header, encoded = value.split(",", 1)
                if not header.startswith("data:image/"):
                    raise ValueError("frames must be image data URLs")
            else:
                encoded = value
            raw = base64.b64decode(encoded)
            if len(raw) > 16 * 1024 * 1024:
                raise ValueError("a frame is too large")
            filename = f"frame_{index:04d}.png"
            comfy_path = comfy_dir / filename
            upload_path = upload_dir / filename
            comfy_path.write_bytes(raw)
            upload_path.write_bytes(raw)
            saved.append(str(comfy_path.relative_to(COMFY_INPUT)))

        manifest = {
            "run_id": run_id,
            "frame_count": len(saved),
            "width": width,
            "height": height,
            "comfy_input_subdir": str((Path("camera_lab_photography") / run_id)),
            "frames": saved,
        }
        (comfy_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        (upload_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        subject_image = str(payload.get("subject_image") or "").strip()
        workflow_path = sync_photography_workflow(manifest["comfy_input_subdir"], subject_image)
        self.send_json(
            {
                "run_id": run_id,
                "frame_count": len(saved),
                "width": width,
                "height": height,
                "comfy_input_subdir": manifest["comfy_input_subdir"],
                "first_frame": saved[0],
                "manifest": str(comfy_dir / "manifest.json"),
                "workflow": str(workflow_path),
                "subject_image": subject_image,
            }
        )

    def handle_shot_pack(self) -> None:
        payload = self.read_json()
        raw_frames = payload.get("frames") or []
        if not isinstance(raw_frames, list) or not raw_frames:
            raise ValueError("frames are required")
        if len(raw_frames) > 12:
            raise ValueError("too many shot frames; maximum is 12")
        width, height = validate_size(payload.get("width"), payload.get("height"))
        shot_id = f"shot_{int(time.time())}_{random.randint(1000, 9999)}"
        shot_dir = SHOT_PACK_ROOT / shot_id
        shot_dir.mkdir(parents=True, exist_ok=True)

        saved_frames = []
        for index, frame in enumerate(raw_frames, start=1):
            if not isinstance(frame, dict):
                raise ValueError("shot frame entries must be objects")
            label = safe_filename(str(frame.get("label") or f"frame_{index}")).lower()
            if not label:
                label = f"frame_{index}"
            data_url = str(frame.get("data") or "")
            if "," in data_url:
                header, encoded = data_url.split(",", 1)
                if not header.startswith("data:image/"):
                    raise ValueError("shot frames must be image data URLs")
            else:
                encoded = data_url
            raw = base64.b64decode(encoded)
            if len(raw) > 16 * 1024 * 1024:
                raise ValueError("a shot frame is too large")
            filename = f"{index:02d}_{label}.png"
            frame_path = shot_dir / filename
            frame_path.write_bytes(raw)
            saved_frames.append(
                {
                    "label": label,
                    "frame": frame.get("frame"),
                    "path": str(frame_path),
                    "filename": filename,
                }
            )

        plan = payload.get("plan") if isinstance(payload.get("plan"), dict) else {}
        plan.update(
            {
                "shot_id": shot_id,
                "width": width,
                "height": height,
                "frames": saved_frames,
            }
        )
        plan_path = shot_dir / "shot_plan.json"
        plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
        self.send_json(
            {
                "shot_id": shot_id,
                "path": str(shot_dir),
                "plan": str(plan_path),
                "frames": saved_frames,
            }
        )

    def handle_rate(self) -> None:
        payload = self.read_json()
        batch = BATCHES.get(payload["batch_id"]) or load_batch(payload["batch_id"])
        for run in batch["runs"]:
            if run["run_id"] == payload["run_id"]:
                run["notes"] = payload.get("notes", "")
                run["scores"] = payload.get("scores", {})
                break
        BATCHES[batch["batch_id"]] = batch
        write_batch(batch)
        self.send_json({"ok": True})

    def handle_casting_analyze(self) -> None:
        payload = self.read_json()
        script = (payload.get("script") or "").strip()
        if not script:
            raise ValueError("script is required")
        status = casting_status()
        if not status["llm"]["available"]:
            return self.send_json({"error": status["llm"]["reason"]}, status=503)
        result = analyze_casting_script(script)
        result["voices"] = status["voices"]
        result["emotions"] = status["emotions"]
        self.send_json(result)

    def handle_casting_tts(self) -> None:
        payload = self.read_json()
        lines = payload.get("lines") or []
        if not lines:
            raise ValueError("lines are required")
        status = casting_status()
        if not status["cosyvoice"]["available"]:
            return self.send_json({"error": status["cosyvoice"]["reason"]}, status=503)
        roster = {v["id"]: v for v in casting_voice_roster()}
        casting_current_dir().mkdir(parents=True, exist_ok=True)
        job_lines, clips_meta = prepare_casting_tts_job(lines, roster, archive_all=bool(payload.get("archive_all")))
        if not job_lines:
            raise ValueError("no speakable lines are ready for TTS")
        job = {
            "lines": job_lines,
            "voices": {vid: {"ref_wav": v["ref_wav"], "ref_text": v["ref_text"]} for vid, v in roster.items()},
            "emotions": CASTING_EMOTIONS,
            "model_dir": str(COSYVOICE_MODEL_DIR),
            "vendor": str(COSYVOICE_VENDOR),
            "version": cosyvoice_version(),
            "out_dir": str(casting_current_dir()),
        }
        job_path = CASTING_LIBRARY_DIR / f"_job_{int(time.time())}_{random.randint(1000, 9999)}.json"
        job_path.write_text(json.dumps(job, ensure_ascii=False), encoding="utf-8")
        try:
            proc = subprocess.run(
                [str(COSYVOICE_PYTHON), str(CASTING_TTS_SCRIPT), str(job_path)],
                capture_output=True, text=True, timeout=1800,
            )
        finally:
            job_path.unlink(missing_ok=True)
        if proc.returncode != 0:
            raise RuntimeError(f"casting TTS failed: {(proc.stderr or proc.stdout)[-800:]}")
        clips = []
        for meta in clips_meta:
            wav = casting_current_dir() / f"{meta['name']}.wav"
            entry = dict(meta)
            if wav.exists():
                wav.with_suffix(".json").write_text(
                    json.dumps({"text": meta["text"], "voice": meta["voice"], "emotion": meta["emotion"], "speed": meta["speed"]}, ensure_ascii=False),
                    encoding="utf-8",
                )
                entry["file"] = str(wav)
                entry["url"] = "/media?path=" + urllib.parse.quote(str(wav))
            else:
                entry["url"] = None
            clips.append(entry)
        self.send_json({"clips": clips})

    def handle_casting_voice(self) -> None:
        payload = self.read_json()
        data_url = str(payload.get("audio_data") or "")
        if "," in data_url:
            data_url = data_url.split(",", 1)[1]
        audio_bytes = base64.b64decode(data_url)
        voice = save_custom_casting_voice(
            str(payload.get("name") or ""),
            str(payload.get("audio_name") or "voice.wav"),
            audio_bytes,
            str(payload.get("ref_text") or ""),
        )
        self.send_json({
            "voice": {"id": voice["id"], "label": voice["label"], "gender": ""},
            "voices": [{"id": v["id"], "label": v["label"], "gender": v["gender"]} for v in casting_voice_roster()],
        })

    def handle_last_frame(self) -> None:
        payload = self.read_json()
        video = safe_media_path(str(payload.get("video") or ""))
        if video.suffix.lower() not in {".mp4", ".webm", ".mov"}:
            raise ValueError("last frame requires a video file")
        ensure_run_artifact_path(video)
        image = video.with_name(f"{video.stem}_last_frame.png")
        extract_last_frame(video, image)
        self.send_json({"path": str(image), "name": image.name})

    def handle_history_state(self) -> None:
        payload = self.read_json()
        key = str(payload.get("key") or "")
        action = str(payload.get("action") or "")
        if ":" not in key:
            raise ValueError("invalid history key")
        state = load_history_state()
        pinned = set(state["pinned"])
        hidden = set(state["hidden"])
        if action == "pin":
            pinned.add(key)
            hidden.discard(key)
        elif action == "unpin":
            pinned.discard(key)
        elif action == "delete":
            cancel_result = cancel_run_by_key(key)
            recycle_result = recycle_run_files_by_key(key)
            pinned.discard(key)
            hidden.add(key)
        else:
            raise ValueError("invalid history action")
        write_history_state({"pinned": sorted(pinned), "hidden": sorted(hidden)})
        self.send_json(
            {
                "ok": True,
                "cancel": cancel_result if action == "delete" else [],
                "recycled": recycle_result if action == "delete" else [],
            }
        )


def load_batch(batch_id: str) -> dict:
    path = RUN_ROOT / batch_id / "batch.json"
    if not path.exists():
        raise FileNotFoundError(batch_id)
    batch = json.loads(path.read_text(encoding="utf-8"))
    BATCHES[batch_id] = batch
    return batch


def cancel_run_by_key(key: str) -> list[str]:
    batch_id, run_id = key.split(":", 1)
    try:
        batch = BATCHES.get(batch_id) or load_batch(batch_id)
    except FileNotFoundError:
        return []
    actions: list[str] = []
    for run in batch.get("runs", []):
        if run.get("run_id") != run_id:
            continue
        if run.get("status") not in TERMINAL_RUN_STATUSES:
            run["status"] = "canceled"
            run["cancel_requested_at"] = time.time()
            actions = cancel_comfy_run(run)
            write_batch(batch)
        break
    BATCHES[batch_id] = batch
    return actions


def recycle_run_files_by_key(key: str) -> list[str]:
    batch_id, run_id = key.split(":", 1)
    try:
        batch = BATCHES.get(batch_id) or load_batch(batch_id)
    except FileNotFoundError:
        return []
    for run in batch.get("runs", []):
        if run.get("run_id") == run_id:
            recycled = recycle_run_files(run)
            BATCHES[batch_id] = batch
            return recycled
    return []


def recycle_run_files(run: dict[str, Any]) -> list[str]:
    paths: list[Path] = []
    for field in ("video", "contact_sheet"):
        value = run.get(field)
        if value:
            paths.append(Path(value))
    for value in run.get("copied") or []:
        path = Path(value)
        if path.suffix.lower() in {".mp4", ".webm", ".mov"}:
            paths.append(path)

    recycled: list[str] = []
    seen: set[Path] = set()
    for path in paths:
        resolved = path.resolve()
        if resolved in seen or not resolved.exists():
            continue
        seen.add(resolved)
        ensure_run_artifact_path(resolved)
        move_to_recycle_bin(resolved)
        recycled.append(str(resolved))
    return recycled


def ensure_run_artifact_path(path: Path) -> None:
    root = RUN_ROOT.resolve()
    if not (path == root or root in path.parents):
        raise PermissionError(f"refusing to recycle non-run artifact: {path}")


class SHFILEOPSTRUCTW(ctypes.Structure):
    _fields_ = [
        ("hwnd", ctypes.c_void_p),
        ("wFunc", ctypes.c_uint),
        ("pFrom", ctypes.c_wchar_p),
        ("pTo", ctypes.c_wchar_p),
        ("fFlags", ctypes.c_ushort),
        ("fAnyOperationsAborted", ctypes.c_bool),
        ("hNameMappings", ctypes.c_void_p),
        ("lpszProgressTitle", ctypes.c_wchar_p),
    ]


def move_to_recycle_bin(path: Path) -> None:
    # SHFileOperation requires a double-null-terminated source list.
    source = str(path) + "\0\0"
    operation = SHFILEOPSTRUCTW()
    operation.wFunc = 3  # FO_DELETE
    operation.pFrom = source
    operation.fFlags = 0x0040 | 0x0010 | 0x0004 | 0x0400  # allow undo, no confirm, silent, no error UI
    result = ctypes.windll.shell32.SHFileOperationW(ctypes.byref(operation))
    if result != 0 or operation.fAnyOperationsAborted:
        raise OSError(f"failed to move to recycle bin: {path} ({result})")


def public_workflows(unavailable_reason: str | None = None) -> list[dict[str, Any]]:
    items = []
    for workflow in WORKFLOWS:
        if unavailable_reason:
            status = {"available": False, "reason": unavailable_reason}
        else:
            try:
                status = workflow_status(workflow)
            except Exception as exc:
                status = {"available": False, "reason": str(exc)}
        item = dict(workflow)
        item.update(status)
        items.append(item)
    return items


def history_runs(limit: int = 30) -> list[dict[str, Any]]:
    state = load_history_state()
    pinned = set(state["pinned"])
    hidden = set(state["hidden"])
    runs: list[dict[str, Any]] = []
    for batch_file in RUN_ROOT.glob("*/batch.json"):
        try:
            batch = json.loads(batch_file.read_text(encoding="utf-8"))
        except Exception:
            continue
        for run in batch.get("runs", []):
            key = history_key(run)
            if key in hidden:
                continue
            item = dict(run)
            item["history_key"] = key
            item["pinned"] = key in pinned
            item["batch_status"] = batch.get("status", "")
            if not item.get("workflow_mode") or not item.get("workflow_label"):
                workflow = next((workflow for workflow in WORKFLOWS if workflow["id"] == item.get("workflow_id")), None)
                if workflow:
                    item.setdefault("workflow_mode", workflow["mode"])
                    item.setdefault("workflow_label", workflow["label"])
            hydrate_run_image_outputs(item)
            item["sort_time"] = item.get("finished_at") or item.get("started_at") or item.get("queued_at") or batch_file.stat().st_mtime
            runs.append(item)
    runs.sort(key=lambda run: (0 if run.get("pinned") else 1, -(run.get("sort_time") or 0)))
    return runs[: max(1, min(limit, 200))]


def history_key(run: dict[str, Any]) -> str:
    return f"{run.get('batch_id', '')}:{run.get('run_id', '')}"


def load_history_state() -> dict[str, list[str]]:
    if not HISTORY_STATE.exists():
        return {"pinned": [], "hidden": []}
    try:
        raw = json.loads(HISTORY_STATE.read_text(encoding="utf-8"))
    except Exception:
        return {"pinned": [], "hidden": []}
    return {
        "pinned": sorted({str(item) for item in raw.get("pinned", []) if ":" in str(item)}),
        "hidden": sorted({str(item) for item in raw.get("hidden", []) if ":" in str(item)}),
    }


def write_history_state(state: dict[str, list[str]]) -> None:
    HISTORY_STATE.parent.mkdir(parents=True, exist_ok=True)
    HISTORY_STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def slugify(value: str) -> str:
    clean = "".join(ch.lower() if ch.isalnum() else "_" for ch in value).strip("_")
    while "__" in clean:
        clean = clean.replace("__", "_")
    return clean or "variant"


def safe_filename(value: str) -> str:
    name = Path(value).name
    clean = "".join(ch if ch.isalnum() or ch in "._- " else "_" for ch in name).strip()
    return clean or "audio.wav"


def validate_size(width: Any, height: Any) -> tuple[int, int]:
    width = int(width or 1280)
    height = int(height or 720)
    if width < 64 or height < 64 or width > 2304 or height > 2304:
        raise ValueError("width and height must be between 64 and 2304")
    return round(width / 8) * 8, round(height / 8) * 8


def validate_seed(value: Any) -> int:
    if value in {None, ""}:
        return random.randint(1, 2_147_000_000)
    seed = int(value)
    if seed < 1 or seed > 2_147_000_000:
        raise ValueError("seed must be between 1 and 2147000000")
    return seed


def build_director_prompt_summary(payload: dict[str, Any]) -> str:
    global_prompt = str(payload.get("global_prompt") or "").strip()
    raw_segments = payload.get("timeline_segments") or payload.get("segments") or []
    segment_prompts = [
        str(segment.get("prompt") or "").strip()
        for segment in raw_segments
        if str(segment.get("prompt") or "").strip()
    ]
    if not global_prompt and not segment_prompts:
        has_visual_guide = any(
            str(segment.get("image_path") or segment.get("video_path") or "").strip()
            for segment in raw_segments
        )
        has_ic_video = any(
            str(segment.get("video_path") or segment.get("videoFile") or segment.get("file") or "").strip()
            for segment in (payload.get("motion_segments") or payload.get("motionSegments") or [])
        )
        if has_visual_guide or has_ic_video:
            return "visual guide"
        raise ValueError("director workflow requires a global prompt, segment prompt, or visual guide")
    return "\n\n".join([part for part in [global_prompt, " | ".join(segment_prompts)] if part])


def validate_reference_images(raw: Any) -> list[str]:
    paths = normalize_reference_image_paths(raw)
    return [str(safe_media_path(path)) for path in paths]


def validate_director_segments(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for segment in raw:
        item = dict(segment)
        image_path = str(item.get("image_path") or "").strip()
        if image_path:
            item["image_path"] = str(safe_media_path(image_path))
        else:
            item["image_path"] = ""
        video_path = str(item.get("video_path") or "").strip()
        if video_path:
            item["video_path"] = str(safe_media_path(video_path))
        else:
            item["video_path"] = ""
        audio_path = str(item.get("audio_path") or "").strip()
        if audio_path:
            item["audio_path"] = str(safe_media_path(audio_path))
        else:
            item["audio_path"] = ""
        segments.append(item)
    return segments


def validate_director_audio_segments(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for segment in raw:
        item = dict(segment)
        audio_path = str(item.get("audio_path") or item.get("file") or "").strip()
        if audio_path:
            item["audio_path"] = str(safe_media_path(audio_path))
        else:
            continue
        segments.append(item)
    return segments


def validate_director_motion_segments(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    segments: list[dict[str, Any]] = []
    for segment in raw:
        item = dict(segment)
        video_path = str(item.get("video_path") or item.get("videoFile") or item.get("file") or "").strip()
        if video_path:
            item["video_path"] = str(safe_media_path(video_path))
        else:
            continue
        item["type"] = "motion_video"
        segments.append(item)
    return segments


def verify_dropdown_workflows() -> list[str]:
    """Confirm every WORKFLOWS entry with a path actually exists in the repo.
    Returns a list of human-readable issue strings."""
    issues: list[str] = []
    for workflow in WORKFLOWS:
        path_str = workflow.get("path")
        if not path_str:
            continue
        path = Path(path_str)
        if not path.exists():
            issues.append(
                f"  - dropdown '{workflow['label']}' references missing file {path}"
            )
    return issues


def sync_workflows_to_comfyui() -> None:
    """Mirror repo workflows/app/*.json into ComfyUI's installed workflow folder
    so the ComfyUI workflow browser reflects what the dropdown is configured to
    use. Stale files (renamed or removed in the repo) are deleted from the
    ComfyUI side. Silently no-ops if COMFYUI_ROOT is unset/missing."""
    comfy_root_env = os.environ.get("COMFYUI_ROOT", "").strip()
    if not comfy_root_env:
        print("Camera Lab: COMFYUI_ROOT unset; skipping ComfyUI workflow sync.", flush=True)
        return
    comfy_root = Path(comfy_root_env)
    if not comfy_root.exists():
        print(f"Camera Lab: COMFYUI_ROOT does not exist ({comfy_root}); skipping sync.", flush=True)
        return

    target = comfy_root / "user" / "default" / "workflows" / "camera-lab" / "app"
    target.mkdir(parents=True, exist_ok=True)

    repo_files = {p.name: p for p in APP_WORKFLOW_ROOT.glob("*.json")}
    installed_files = {p.name: p for p in target.glob("*.json")}

    copied = 0
    for name, src in repo_files.items():
        dst = target / name
        if not dst.exists() or src.stat().st_mtime > dst.stat().st_mtime:
            shutil.copy2(src, dst)
            copied += 1

    removed = 0
    for name, installed in installed_files.items():
        if name not in repo_files:
            installed.unlink()
            removed += 1

    if copied or removed:
        print(
            f"Camera Lab: synced {copied} workflow file(s), removed {removed} stale, "
            f"into {target}",
            flush=True,
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Camera Lab local server.")
    parser.add_argument("--port", "-p", type=int, default=1234, help="Port to listen on.")
    parser.add_argument("--host", default="0.0.0.0", help="Host/IP to listen on. Use 127.0.0.1 for local-only.")
    args = parser.parse_args()

    RUN_ROOT.mkdir(parents=True, exist_ok=True)
    UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

    # Make sure the workflow files the dropdown points at exist on disk, and
    # mirror them into ComfyUI so its workflow browser stays in sync.
    issues = verify_dropdown_workflows()
    if issues:
        print("Camera Lab: dropdown workflow files missing in repo:", flush=True)
        for line in issues:
            print(line, flush=True)
    sync_workflows_to_comfyui()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    shown_host = "127.0.0.1" if args.host in {"0.0.0.0", ""} else args.host
    print(f"Camera Lab: http://{shown_host}:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
