"""Generate the FLF (first-last-frame) app workflow from the working I2V subtitle
cleaner template.

Rationale: the I2V subtitle cleaner already wires the LTX-2 audio chain
(LTXVEmptyLatentAudio -> LTXVConcatAVLatent -> LTXVSeparateAVLatent ->
LTXVAudioVAEDecode -> CreateVideo) plus local models / NAG. The only thing
missing for FLF is a *last frame* keyframe. The official ltx2.3 flf2v template
pins keyframes with `LTXVAddGuide` (frame_idx 0 for first, -1 for last). The I2V
template already pins the first frame via LTXVImgToVideoInplace, so here we only
add the last-frame guide.

This script is deterministic and re-runnable. It clones real node objects from
the source templates so the generated graph stays structurally valid, then
rewires the two sampling stages so each ConcatAVLatent / CFGGuider consumes the
last-frame LTXVAddGuide output.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "workflows" / "app"
I2V = APP / "ltx23_i2v_subtitle_cleaner_nag_extend.json"
OUT = APP / "ltx23_flf_subtitle_cleaner_nag_extend.json"

# Each preset adds the last-frame keyframe to a base template that already
# carries an LTX-2 audio chain. The i2v base generates SFX from an empty audio
# latent; the ia2v base instead encodes an uploaded audio track. The last-frame
# graph surgery is identical because both share the same node ids/structure.
PRESETS = {
    "flf": (I2V, OUT),
    "flf_ia2v": (
        APP / "ltx23_nag_ia2v_extendcrop_general.json",
        APP / "ltx23_flf_ia2v_nag_extend.json",
    ),
}

def default_comfy_template_root() -> Path:
    configured = os.environ.get("COMFYUI_TEMPLATE_ROOT")
    if configured:
        return Path(configured)
    comfy_root = Path(os.environ.get("COMFYUI_ROOT") or "ComfyUI")
    return comfy_root / ".venv" / "Lib" / "site-packages" / "comfyui_workflow_templates_media_video" / "templates"


# Official ltx2.3 flf2v template ships with ComfyUI; used purely as the
# structural prototype for the core `LTXVAddGuide` node object.
FLF2V = default_comfy_template_root() / "video_ltx2_3_flf2v.json"

# Stable node ids for the additions. Chosen above the I2V top-level range
# (<=1021) and the expanded-subgraph internal range (<=1017) to avoid collisions.
END_LOADIMAGE_ID = 9930
END_PREPROCESS_ID = 1101
ADDGUIDE_PASS1_ID = 1102
ADDGUIDE_PASS2_ID = 1103

# Pipeline anchors in the I2V template (verified by inspection).
COND_NODE = 307          # LTXVConditioning (positive slot0 / negative slot1)
VAE_NODE = 336           # VAELoaderKJ video VAE (slot0)
INPLACE_PASS1 = 325      # LTXVImgToVideoInplace (first frame, stage 1) -> latent slot0
INPLACE_PASS2 = 296      # LTXVImgToVideoInplace (first frame, stage 2) -> latent slot0
CONCAT_PASS1 = 326       # LTXVConcatAVLatent (stage 1) .video_latent
CONCAT_PASS2 = 287       # LTXVConcatAVLatent (stage 2) .video_latent
GUIDER_PASS1 = 315       # CFGGuider (stage 1) .positive/.negative
CROPGUIDES = 292         # LTXVCropGuides (stage 2 conditioning, positive slot0 / negative slot1)
GUIDER_PASS2 = 290       # CFGGuider (stage 2) .positive/.negative
SOURCE_LOADIMAGE = 900   # LoadImage (source) -> cloned for the end frame
SOURCE_PREPROCESS = 334  # LTXVPreprocess (source) -> cloned for the end frame


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def find_node(graph: dict, node_id: int) -> dict:
    for node in graph["nodes"]:
        if int(node["id"]) == node_id:
            return node
    raise KeyError(f"node {node_id} not found")


def input_def(node: dict, name: str) -> dict:
    for inp in node.get("inputs", []):
        if inp.get("name") == name:
            return inp
    raise KeyError(f"input {name!r} not found on node {node['id']}")


class Graph:
    def __init__(self, graph: dict):
        self.g = graph
        self.links = graph["links"]  # [id, origin, oslot, target, tslot, type]
        self._next_link = max([int(l[0]) for l in self.links] + [0]) + 1

    def link_source(self, node_id: int, input_name: str):
        """Return (origin_id, origin_slot, type) currently feeding an input."""
        node = find_node(self.g, node_id)
        lid = input_def(node, input_name).get("link")
        if lid is None:
            raise ValueError(f"input {input_name} of node {node_id} is unconnected")
        for l in self.links:
            if int(l[0]) == int(lid):
                return int(l[1]), int(l[2]), l[5]
        raise KeyError(f"link {lid} not found")

    def _drop_old_input_link(self, node_id: int, input_name: str):
        node = find_node(self.g, node_id)
        old = input_def(node, input_name).get("link")
        if old is None:
            return
        # remove from top-level links and from the origin output list
        for l in list(self.links):
            if int(l[0]) == int(old):
                origin = find_node(self.g, int(l[1]))
                for out in origin.get("outputs", []):
                    if out.get("links") and int(old) in out["links"]:
                        out["links"].remove(int(old))
                self.links.remove(l)

    def connect(self, origin_id: int, origin_slot: int, target_id: int, target_name: str, link_type: str, replace: bool = True):
        if replace:
            self._drop_old_input_link(target_id, target_name)
        lid = self._next_link
        self._next_link += 1
        self.links.append([lid, origin_id, origin_slot, target_id, find_node(self.g, target_id) and 0, link_type])
        # fix target slot index properly
        target = find_node(self.g, target_id)
        tdef = input_def(target, target_name)
        # locate slot index of this input among inputs
        tslot = target["inputs"].index(tdef)
        self.links[-1][4] = tslot
        tdef["link"] = lid
        # register on origin output
        origin = find_node(self.g, origin_id)
        outs = origin.get("outputs", [])
        if origin_slot < len(outs):
            outs[origin_slot].setdefault("links", [])
            if outs[origin_slot]["links"] is None:
                outs[origin_slot]["links"] = []
            outs[origin_slot]["links"].append(lid)
        return lid

    def add_node(self, node: dict):
        self.g["nodes"].append(node)


def build(source: Path, out_path: Path, workflow_id: str) -> None:
    g_raw = load(source)
    flf2v = load(FLF2V)

    # --- AddGuide prototype from the official flf2v template ---
    def walk(o):
        out = []
        if isinstance(o, dict):
            if o.get("type") == "LTXVAddGuide":
                out.append(o)
            for v in o.values():
                out += walk(v)
        elif isinstance(o, list):
            for v in o:
                out += walk(v)
        return out

    addguide_proto = walk(flf2v)[0]

    graph = Graph(g_raw)

    # --- end-frame LoadImage (clone of source) ---
    end_load = copy.deepcopy(find_node(g_raw, SOURCE_LOADIMAGE))
    end_load["id"] = END_LOADIMAGE_ID
    end_load["title"] = "UPLOAD END IMAGE"
    end_load["pos"] = [end_load.get("pos", [0, 0])[0], end_load.get("pos", [0, 0])[1] + 360]
    for inp in end_load.get("inputs", []):
        inp["link"] = None
    for out in end_load.get("outputs", []):
        out["links"] = []
    end_load["widgets_values"] = ["", "image"]
    graph.add_node(end_load)

    # --- end-frame LTXVPreprocess (clone of source preprocess) ---
    end_pre = copy.deepcopy(find_node(g_raw, SOURCE_PREPROCESS))
    end_pre["id"] = END_PREPROCESS_ID
    end_pre["title"] = "End frame preprocess"
    end_pre["pos"] = [end_pre.get("pos", [0, 0])[0], end_pre.get("pos", [0, 0])[1] + 360]
    for inp in end_pre.get("inputs", []):
        inp["link"] = None
    for out in end_pre.get("outputs", []):
        out["links"] = []
    graph.add_node(end_pre)
    # LoadImage IMAGE (slot0) -> end preprocess image
    graph.connect(END_LOADIMAGE_ID, 0, END_PREPROCESS_ID, "image", "IMAGE", replace=False)

    def make_addguide(node_id: int, frame_idx: int, strength: float, pos):
        node = copy.deepcopy(addguide_proto)
        node["id"] = node_id
        node["title"] = f"Last frame guide (idx {frame_idx})"
        node["pos"] = pos
        node["widgets_values"] = [frame_idx, strength]
        for inp in node.get("inputs", []):
            inp["link"] = None
        for out in node.get("outputs", []):
            out["links"] = []
        return node

    # ---- Stage 1: insert AddGuide between Inplace#325 and Concat#326 / Guider#315 ----
    pos_a, oslot_pos1, _ = graph.link_source(GUIDER_PASS1, "positive")
    neg_a, oslot_neg1, _ = graph.link_source(GUIDER_PASS1, "negative")
    vae_o, vae_s, _ = graph.link_source(INPLACE_PASS1, "vae")
    lat_o, lat_s, _ = graph.link_source(CONCAT_PASS1, "video_latent")  # == Inplace#325 slot0

    ag1 = make_addguide(ADDGUIDE_PASS1_ID, -1, 0.7, [200, 1400])
    graph.add_node(ag1)
    graph.connect(pos_a, oslot_pos1, ADDGUIDE_PASS1_ID, "positive", "CONDITIONING", replace=False)
    graph.connect(neg_a, oslot_neg1, ADDGUIDE_PASS1_ID, "negative", "CONDITIONING", replace=False)
    graph.connect(vae_o, vae_s, ADDGUIDE_PASS1_ID, "vae", "VAE", replace=False)
    graph.connect(lat_o, lat_s, ADDGUIDE_PASS1_ID, "latent", "LATENT", replace=False)
    graph.connect(END_PREPROCESS_ID, 0, ADDGUIDE_PASS1_ID, "image", "IMAGE", replace=False)
    # rewire consumers to AddGuide outputs (pos slot0 / neg slot1 / latent slot2)
    graph.connect(ADDGUIDE_PASS1_ID, 2, CONCAT_PASS1, "video_latent", "LATENT", replace=True)
    graph.connect(ADDGUIDE_PASS1_ID, 0, GUIDER_PASS1, "positive", "CONDITIONING", replace=True)
    graph.connect(ADDGUIDE_PASS1_ID, 1, GUIDER_PASS1, "negative", "CONDITIONING", replace=True)

    # ---- Stage 2: insert AddGuide between Inplace#296 and Concat#287 / Guider#290 ----
    pos_b, oslot_pos2, _ = graph.link_source(GUIDER_PASS2, "positive")
    neg_b, oslot_neg2, _ = graph.link_source(GUIDER_PASS2, "negative")
    vae_o2, vae_s2, _ = graph.link_source(INPLACE_PASS2, "vae")
    lat_o2, lat_s2, _ = graph.link_source(CONCAT_PASS2, "video_latent")  # == Inplace#296 slot0

    ag2 = make_addguide(ADDGUIDE_PASS2_ID, -1, 1.0, [200, 1700])
    graph.add_node(ag2)
    graph.connect(pos_b, oslot_pos2, ADDGUIDE_PASS2_ID, "positive", "CONDITIONING", replace=False)
    graph.connect(neg_b, oslot_neg2, ADDGUIDE_PASS2_ID, "negative", "CONDITIONING", replace=False)
    graph.connect(vae_o2, vae_s2, ADDGUIDE_PASS2_ID, "vae", "VAE", replace=False)
    graph.connect(lat_o2, lat_s2, ADDGUIDE_PASS2_ID, "latent", "LATENT", replace=False)
    graph.connect(END_PREPROCESS_ID, 0, ADDGUIDE_PASS2_ID, "image", "IMAGE", replace=False)
    graph.connect(ADDGUIDE_PASS2_ID, 2, CONCAT_PASS2, "video_latent", "LATENT", replace=True)
    graph.connect(ADDGUIDE_PASS2_ID, 0, GUIDER_PASS2, "positive", "CONDITIONING", replace=True)
    graph.connect(ADDGUIDE_PASS2_ID, 1, GUIDER_PASS2, "negative", "CONDITIONING", replace=True)

    g_raw["last_node_id"] = max(int(n["id"]) for n in g_raw["nodes"] if isinstance(n["id"], int))
    g_raw["last_link_id"] = max(int(l[0]) for l in g_raw["links"])
    g_raw["id"] = workflow_id
    if isinstance(g_raw.get("extra"), dict):
        g_raw["extra"]["workflow_name"] = workflow_id

    out_path.write_text(json.dumps(g_raw, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate an FLF (last-frame) app template from an audio-enabled base.")
    parser.add_argument("preset", nargs="?", default="all", choices=["all", *PRESETS], help="Which template(s) to build.")
    args = parser.parse_args()
    names = list(PRESETS) if args.preset == "all" else [args.preset]
    for name in names:
        source, out = PRESETS[name]
        build(source, out, workflow_id=out.stem.replace("_", "-"))


if __name__ == "__main__":
    main()
