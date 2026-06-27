from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

from .modules import ModelRef


LOADER_FIELDS: dict[str, tuple[tuple[str, str], ...]] = {
    "checkpoints": (("CheckpointLoaderSimple", "ckpt_name"),),
    "diffusion_models": (("UNETLoader", "unet_name"), ("UnetLoaderGGUF", "unet_name")),
    "text_encoders": (
        ("DualCLIPLoader", "clip_name1"),
        ("DualCLIPLoader", "clip_name2"),
        ("LTXAVTextEncoderLoader", "text_encoder_name"),
        ("LTXAVTextEncoderLoader", "clip_name"),
    ),
    "vae": (("VAELoader", "vae_name"), ("VAELoaderKJ", "vae_name"), ("LTXVAudioVAELoader", "vae_name")),
    "loras": (("LoraLoaderModelOnly", "lora_name"), ("LoraLoader", "lora_name")),
    "latent_upscale_models": (("LatentUpscaleModelLoader", "model_name"),),
}


@dataclass(frozen=True)
class ComfyVisibility:
    nodes: frozenset[str]
    models: Mapping[str, frozenset[str]]
    source: str


def _input_entry_options(entry: Any) -> list[str]:
    if not isinstance(entry, list) or not entry:
        return []
    first = entry[0]
    if isinstance(first, list):
        return [str(item) for item in first]
    if isinstance(first, str) and len(entry) > 1 and isinstance(entry[1], dict):
        options = entry[1].get("options")
        if isinstance(options, list):
            return [str(item) for item in options]
    return []


def visibility_from_object_info(object_info: Mapping[str, Any]) -> ComfyVisibility:
    models: dict[str, set[str]] = {}
    for folder, loaders in LOADER_FIELDS.items():
        names: set[str] = set()
        for node_name, field in loaders:
            node = object_info.get(node_name, {})
            required = node.get("input", {}).get("required", {}) if isinstance(node, dict) else {}
            names.update(_input_entry_options(required.get(field)))
        models[folder] = names
    return ComfyVisibility(
        nodes=frozenset(str(name) for name in object_info.keys()),
        models={folder: frozenset(names) for folder, names in models.items()},
        source="object_info",
    )


def model_visible(visibility: ComfyVisibility, model: ModelRef) -> bool:
    return model.name in visibility.models.get(model.folder, frozenset())


def node_visible(visibility: ComfyVisibility, node_name: str) -> bool:
    return node_name in visibility.nodes
