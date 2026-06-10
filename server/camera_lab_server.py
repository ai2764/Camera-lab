from __future__ import annotations

import argparse
import json
import mimetypes
import os
import random
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import base64
import copy
import ctypes
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
COMFY_INPUT = COMFY_CONFIG["input"]
COMFY_OUTPUT = COMFY_CONFIG["output"]
COMFY_MODELS = COMFY_CONFIG["models"]
WORKFLOW_ROOT = COMFY_CONFIG["workflows"]
TEMPLATE_WORKFLOW_ROOT = COMFY_CONFIG["template_workflows"]
YEDP_WEB_JS = COMFY_CONFIG["root"] / "custom_nodes" / "ComfyUI-Yedp-Action-Director" / "web" / "js"
LOCAL_LTX23_DISTILLED_LORA = "ltx-2.3-22b-distilled-lora-1.1_fro90_ceil72_condsafe.safetensors"
APP_WORKFLOW_ROOT = ROOT / "workflows" / "app"
TTP_TOOLSET_ROOT = COMFY_CONFIG["ttp_toolset"]
LTX23_CHECKPOINT = "ltx-2.3-22b-dev-fp8.safetensors"
LTX23_TEXT_ENCODER = "gemma_3_12B_it_fp4_mixed.safetensors"
LTX23_UPSCALER = "ltx-2.3-spatial-upscaler-x2-1.1.safetensors"
DIRECTOR_WORKFLOW_PATH = APP_WORKFLOW_ROOT / "ltx_director_reference_mvp.json"
PHOTOGRAPHY_WORKFLOW_NAME = "Photography_LTX-2.3_ICLoRA_Union_Control_Canny.local.json"
PHOTOGRAPHY_WORKFLOW_TEMPLATE = ROOT / "workflows" / "experimental" / PHOTOGRAPHY_WORKFLOW_NAME
PHOTOGRAPHY_WORKFLOW_PATH = WORKFLOW_ROOT / PHOTOGRAPHY_WORKFLOW_NAME

REFERENCE_IMAGES: list[dict[str, str]] = []

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
        "id": "ltx_director_reference_mvp",
        "label": "LTX Director Reference MVP",
        "mode": "director_ref",
        "path": str(DIRECTOR_WORKFLOW_PATH),
        "builder": "ltx_director_reference_mvp",
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


def http_json(path: str, payload: dict | None = None, timeout: int = 30) -> dict:
    url = COMFY_URL.rstrip("/") + path
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


def http_post(path: str, payload: dict | None = None, timeout: int = 30) -> None:
    url = COMFY_URL.rstrip("/") + path
    data = json.dumps(payload or {}).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        response.read()


def object_info() -> dict[str, Any]:
    global OBJECT_INFO
    if OBJECT_INFO is None:
        OBJECT_INFO = http_json("/object_info", timeout=30)
    return OBJECT_INFO


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
    workflow = expand_subgraphs(workflow)
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
    raw_segments = payload.get("segments") or []
    segments: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_segments, start=1):
        prompt = str(raw.get("prompt") or "").strip()
        duration = max(0.25, float(raw.get("duration") or 1.0))
        frames = max(1, round(duration * fps))
        role = ""
        image_path = str(raw.get("image_path") or "").strip()
        if not prompt and not image_path:
            continue
        if not prompt:
            prompt = "visual guide"
        strength = max(0.0, min(10.0, float(raw.get("strength") or 0.0)))
        guide_frame = int(raw.get("guide_frame") if raw.get("guide_frame") is not None else sum(s["frames"] for s in segments))
        segments.append(
            {
                "prompt": prompt,
                "duration": duration,
                "frames": frames,
                "reference": role,
                "image_path": image_path,
                "guide_frame": max(0, guide_frame),
                "strength": strength,
                "start_frame": sum(s["frames"] for s in segments),
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
                "guide_frame": 0,
                "strength": 0.0,
                "start_frame": 0,
            }
        ]
    duration_frames = sum(segment["frames"] for segment in segments)
    duration_seconds = round(duration_frames / fps, 3)
    return {
        "global_prompt": str(payload.get("global_prompt") or "").strip(),
        "global_reference_strength": max(0.0, min(1.0, float(payload.get("global_reference_strength") or 0.35))),
        "local_prompts": " | ".join(segment["prompt"] for segment in segments),
        "segment_lengths": ",".join(str(segment["frames"]) for segment in segments),
        "duration_frames": duration_frames,
        "duration_seconds": duration_seconds,
        "fps": fps,
        "segments": segments,
        "guide_frames": [],
        "guide_strengths": [],
        "guide_roles": [],
    }


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
    COMFY_INPUT.mkdir(parents=True, exist_ok=True)
    input_names: dict[int, str] = {}
    for index, segment in enumerate(timeline["segments"], start=1):
        raw_path = segment.get("image_path")
        if not raw_path:
            continue
        src = Path(str(raw_path))
        if not src.exists():
            continue
        frame = Path(run["run_dir"]) / f"timeline_{index}_{width}x{height}.png"
        resize_cover(src, frame, width=width, height=height)
        name = f"{run['run_id']}_timeline_{index:02d}.png"
        shutil.copy2(frame, COMFY_INPUT / name)
        input_names[index] = name
    return input_names


def director_reference_timeline_segments(
    timeline: dict[str, Any],
    _global_input_names: Any,
    timeline_input_names: dict[int, str],
) -> list[dict[str, Any]]:
    segments = []
    for index, segment in enumerate(timeline["segments"], start=1):
        if index not in timeline_input_names:
            continue
        start_frame = segment.get("guide_frame", segment["start_frame"])
        segments.append(
            {
                "id": f"camera-lab-segment-{index}",
                "type": "image",
                "label": f"segment {index}",
                "start": max(0, int(start_frame)),
                "imageFile": timeline_input_names[index],
                "strength": float(segment.get("strength") or 0.7),
            }
        )
    return segments


def build_ltx_director_reference_api(run: dict[str, Any]) -> dict[str, dict]:
    workflow_json = json.loads(DIRECTOR_WORKFLOW_PATH.read_text(encoding="utf-8"))
    api = workflow_to_api(workflow_json)
    timeline = director_timeline_from_payload(run, fps=24)
    width = int(run["width"])
    height = int(run["height"])
    reference_input_names = copy_director_reference_images(run, timeline, width, height)
    timeline_input_names = copy_director_timeline_images(run, timeline, width, height)

    director = api.get("46")
    if not director or director["class_type"] != "LTXDirector":
        raise RuntimeError("Director workflow does not contain expected LTXDirector node 46")
    director["inputs"]["global_prompt"] = timeline["global_prompt"]
    director["inputs"]["duration_frames"] = timeline["duration_frames"]
    director["inputs"]["duration_seconds"] = timeline["duration_seconds"]
    guide_segments = director_reference_timeline_segments(timeline, reference_input_names, timeline_input_names)
    director["inputs"]["timeline_data"] = json.dumps({"segments": guide_segments, "audioSegments": []}, ensure_ascii=False)
    director["inputs"]["local_prompts"] = timeline["local_prompts"]
    director["inputs"]["segment_lengths"] = timeline["segment_lengths"]
    director["inputs"]["guide_strength"] = ",".join(str(segment["strength"]) for segment in guide_segments)
    director["inputs"]["frame_rate"] = timeline["fps"]
    director["inputs"]["custom_width"] = width
    director["inputs"]["custom_height"] = height
    director["inputs"]["resize_method"] = "maintain aspect ratio"
    director["inputs"]["divisible_by"] = 32
    director["inputs"]["img_compression"] = 18

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
    # Always take the fallback path (LTXVAddGuideMulti) so camera-lab runs the
    # same way it did before LTXDirector grew native global-reference inputs.
    insert_director_global_reference_guides(api, reference_input_names, timeline)

    for node in api.values():
        if "filename_prefix" in node["inputs"]:
            node["inputs"]["filename_prefix"] = f"camera_lab/{run['batch_id']}/{run['run_id']}"
        if "noise_seed" in node["inputs"]:
            node["inputs"]["noise_seed"] = run["seed"]
    patch_model_names(api, run)
    patch_ltx23_local_loras(api)
    patch_director_custom_audio(api, run)
    bypass_sage_attention_patches(api)

    return api


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
    if mode == "ia2v":
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
        if "padded generation height" in title and isinstance(node["inputs"].get("a"), list):
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
    local_lora = COMFY_MODELS / "loras" / LOCAL_LTX23_DISTILLED_LORA
    if not local_lora.exists():
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
        if mode in {"flf", "fml"} and input_names.get("end"):
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
    if mode in {"flf", "fml"} and input_names.get("end") and len(load_images) > 1:
        load_images[1]["inputs"]["image"] = input_names["end"]


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
    if not (COMFY_MODELS / folder / name).exists():
        raise FileNotFoundError(f"Missing ComfyUI model: models/{folder}/{name}")


def workflow_status(workflow: dict) -> dict[str, Any]:
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
            if not (COMFY_MODELS / folder / name).exists():
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
    if not workflow.get("builder") or workflow.get("builder") == "ltx_director_reference_mvp":
        data = workflow_to_api(data)
        patch_ltx23_local_loras(data)
        bypass_sage_attention_patches(data)
        data = {"extra": {"prompt": data}}
    missing: list[str] = []
    for folder, name in required_models(expand_subgraphs(data)):
        if not (COMFY_MODELS / folder / name).exists():
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


def copy_outputs(run_dir: Path, prompt_id: str) -> list[Path]:
    history = http_json(f"/history/{prompt_id}", timeout=30).get(prompt_id, {})
    (run_dir / "history.json").write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    copied: list[Path] = []
    for output in history.get("outputs", {}).values():
        for key in ("videos", "images", "gifs"):
            for item in output.get(key, []):
                filename = item.get("filename")
                if not filename:
                    continue
                subfolder = item.get("subfolder", "")
                src_root = COMFY_OUTPUT if item.get("type", "output") == "output" else COMFY_INPUT
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


def check_run_canceled(run: dict[str, Any]) -> None:
    if run.get("status") == "canceled":
        raise RunCanceled()


def wait_for_completion(prompt_id: str, run: dict[str, Any], timeout_s: int = 1800) -> None:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        check_run_canceled(run)
        history = http_json(f"/history/{prompt_id}", timeout=30)
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
            if workflow["mode"] not in {"t2v", "director_ref"}:
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
            if workflow["mode"] == "flf":
                end_frame = run_dir / f"end_{width}x{height}.png"
                resize_cover(end, end_frame, width=width, height=height)
                end_name = f"{run['run_id']}_end.png"
                shutil.copy2(end_frame, COMFY_INPUT / end_name)
                input_names["end"] = end_name
            if workflow["mode"] == "ia2v" or (workflow["mode"] == "director_ref" and run.get("audio_path")):
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
            elif workflow.get("builder") == "ltx_director_reference_mvp":
                run["director_timeline"] = director_timeline_from_payload(run, fps=24)
                (run_dir / "director_timeline.json").write_text(
                    json.dumps(run["director_timeline"], ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                api = build_ltx_director_reference_api(run)
            else:
                workflow_json = json.loads(Path(workflow["path"]).read_text(encoding="utf-8"))
                api = workflow_to_api(workflow_json)
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
            videos = [p for p in copied if p.suffix.lower() in {".mp4", ".webm", ".mov"}]
            run["copied"] = [str(p) for p in copied]
            if videos:
                run["video"] = str(videos[0])
                contact = run_dir / "contact.jpg"
                make_contact_sheet(videos[0], contact, f"{run['variant_name']} / {run['camera_move']}")
                run["contact_sheet"] = str(contact)
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
    batch["status"] = "done" if all(r.get("status") in {"done", "canceled"} for r in batch["runs"]) else "error"
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


def safe_media_path(raw: str) -> Path:
    path = Path(raw).resolve()
    allowed_roots = [ROOT.resolve(), COMFY_OUTPUT.resolve()]
    if not any(path == root or root in path.parents for root in allowed_roots):
        raise PermissionError(str(path))
    return path


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

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/":
                return self.serve_file(WEB_DIR / "index.html")
            if parsed.path.startswith("/static/"):
                return self.serve_file(WEB_DIR / parsed.path.removeprefix("/static/"))
            if parsed.path.startswith("/vendor/yedp/"):
                name = Path(parsed.path.removeprefix("/vendor/yedp/")).name
                if Path(name).suffix.lower() not in {".js", ".mjs", ".wasm"}:
                    self.send_error(404)
                    return
                return self.serve_file(YEDP_WEB_JS / name)
            if parsed.path == "/api/config":
                comfy_ok = True
                try:
                    http_json("/system_stats", timeout=5)
                except Exception:
                    comfy_ok = False
                return self.send_json(
                    {
                        "workflows": public_workflows(),
                        "camera_moves": CAMERA_MOVES,
                        "camera_examples": CAMERA_EXAMPLES,
                        "images": REFERENCE_IMAGES,
                        "default_negative": DEFAULT_NEGATIVE,
                        "comfy": {"url": COMFY_URL, "ok": comfy_ok},
                    }
                )
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
            if self.path == "/api/upload-audio":
                return self.handle_upload_audio()
            if self.path == "/api/upload-image":
                return self.handle_upload_image()
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
        source_path = payload.get("source_path") or ""
        if workflow["mode"] not in {"t2v", "director_ref"} and not source_path:
            raise ValueError("source image is required")
        source = {"path": str(safe_media_path(source_path)) if source_path else ""}
        end_path = payload.get("end_path") or source["path"]
        if workflow["mode"] in {"flf", "fml", "fml_native"} and not payload.get("end_path"):
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
        if workflow["mode"] == "ia2v" and not payload.get("audio_path"):
            raise ValueError("IA2V requires an uploaded audio file")
        reference_images = {}
        director_segments = payload.get("segments") or []
        if workflow["mode"] == "director_ref":
            reference_images = validate_reference_images(payload.get("reference_images") or {})
            director_segments = validate_director_segments(payload.get("segments") or [])
        seed = validate_seed(payload.get("seed"))
        batch_id = f"camera_lab_{int(time.time())}_{random.randint(1000, 9999)}"
        batch_dir = RUN_ROOT / batch_id
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
                    "audio_path": payload.get("audio_path", ""),
                    "duration": float(payload.get("duration", 4)),
                    "width": width,
                    "height": height,
                    "seed": seed,
                    "variant_name": variant["name"],
                    "prompt": variant["prompt"],
                    "global_prompt": payload.get("global_prompt", ""),
                    "global_reference_strength": max(0.0, min(1.0, float(payload.get("global_reference_strength") or 0.35))),
                    "segments": director_segments,
                    "reference_images": reference_images,
                    "negative_prompt": payload.get("negative_prompt") or DEFAULT_NEGATIVE,
                    "status": "queued",
                    "queued_at": time.time(),
                    "scores": {},
                    "notes": "",
                }
            )
        batch = {"batch_id": batch_id, "batch_dir": str(batch_dir), "status": "queued", "queued_at": time.time(), "runs": runs}
        BATCHES[batch_id] = batch
        write_batch(batch)
        thread = threading.Thread(target=run_batch_worker, args=(batch_id,), daemon=True)
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
        self.send_json({"path": str(path), "name": name})

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


def public_workflows() -> list[dict[str, Any]]:
    items = []
    for workflow in WORKFLOWS:
        status = workflow_status(workflow)
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
    segment_prompts = [
        str(segment.get("prompt") or "").strip()
        for segment in payload.get("segments") or []
        if str(segment.get("prompt") or "").strip()
    ]
    if not global_prompt and not segment_prompts:
        raise ValueError("director workflow requires a global prompt or at least one segment prompt")
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
