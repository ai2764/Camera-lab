# Text-to-Motion (HY-Motion → SCAIL) UI — Design Spec

**Date:** 2026-06-16
**Status:** Approved design, pending implementation plan
**Scope:** A camera-lab UI feature that turns a text description into an animated video of a reference character, via `text → HY-Motion (motion) → guide video → SCAIL-2 (video)`.

---

## Goal

Let a user type a plain motion description (Chinese or English), pick a reference character image, and get a video of that character performing the motion. Expose the **few parameters that actually matter**; hardcode everything that is fixed by the generation recipe. Simpler is better.

## Interaction model: two steps (staged), not fused

The pipeline runs in two visible stages:

1. **Motion step** — text → HY-Motion → a clean static-camera skeleton **guide video**. The user previews this guide.
2. **Video step** — the guide + reference image → SCAIL-2 → the final character video.

Rationale: the user can inspect the guide before committing to the (heavier) SCAIL render, and failures are easy to localize to the correct stage. The motion step stays minimal; the video step reuses camera-lab's existing setup-panel vocabulary (size preset, scale, seed, etc.).

## Duration & fps flow (fully automatic — no user control)

This is the crux of correct end-to-end behavior. SCAIL's `WanSCAILToVideo` consumes the `pose_video` (guide) **frame-for-frame, 1:1** — it takes the first `length` frames, only spatially downscaling; **no time resampling, no interpolation** (`comfy_extras/nodes_scail.py:213`, `pose_video[:length]`). The final video length is set by SCAIL's `length`, not by the guide.

Therefore:

- **Rewrite (optional) optimizes the prompt + estimates the duration — done in-server via camera-lab's existing LLM, NOT HY-Motion's local prompter.** HY-Motion's `Text2MotionPrompter` is a ~61GB / ~30B model that won't co-fit on the 4090 — and its node loads it with `local_files_only=True` (no usable auto-download). Since the rewrite is purely prompt engineering, camera-lab instead calls its existing `llm_chat()` client (`server/camera_lab_server.py:2254`, `LLM_MODEL`) with HY-Motion's own rewrite prompt template (`REWRITE_AND_INFER_TIME_PROMPT_FORMAT`), which returns `{"duration": <frames@30fps int>, "short_caption": "<refined English>"}`. The server parses it (reuse the resilient JSON extractor at `:2489`), sets `duration_seconds = frames / 30`, and injects `short_caption`/`duration_seconds` as literal inputs into the direct-prompt guide workflow (`HYMotionEncodeText.text`, `HYMotionGenerate.duration`). When rewrite is OFF, the user's text is used verbatim and a default/explicit duration applies. No HY-Motion prompter node, no 61GB download, no extra model in VRAM.
- **The generated guide's actual frame count drives SCAIL `length`.** After the guide is rendered, read its frame count `N`, set SCAIL `length` to `N` aligned up/down to the nearest `4k+1` (SCAIL's step-4 / `((length-1)//4)+1` latent requirement). SCAIL then consumes the **entire** guide — no motion is truncated.
- **fps is fixed at 30 end-to-end.** SCAIL ignores fps metadata (frame-based), so the guide render fps must equal the output save fps or the motion plays at the wrong speed. HY-Motion's native motion cadence is 30fps (`output_mesh_fps = 30`), so render the guide at 30fps and save the SCAIL output at 30fps. (The earlier proof-of-concept used a 30fps / 90-frame guide but SCAIL `length=49` + 24fps save → the motion was both **truncated** to the first ~1.6s and **slowed**; this design eliminates both.)

Net effect for the user: there is **no duration control**. They type a prompt; the system picks a faithful length automatically.

## Exposed parameters (the recommendation)

Tier 1 is always visible. Tier 2 lives in a collapsed "Advanced" section (default collapsed) to preserve the minimal feel.

```
[motion]  Motion description prompt   (text area; CN/EN; optional in-server LLM rewrite)
[SCAIL]   Reference character image   (file upload; defines final identity)
[SCAIL]   Size preset + scale         (reuse existing setup-panel controls)
[SCAIL]   Steps                       (number, default 8)
[both]    Seed                        (number, blank = random; one shared seed)
────────── Advanced (collapsed by default) ──────────
[SCAIL]   pose_strength               (slider 0–10, default 1.0)
[motion]  Motion adherence (cfg_scale)(slider 1–15, default 5.0)
```

- **Seed is a single shared value** spanning both steps (motion seed + video seed derived from it), per user decision.

## Hardcoded recipe (NOT exposed — fixed by the distill-LoRA pipeline)

These are locked because the working fast-path depends on them; exposing them is a footgun.

| Setting | Fixed value | Why |
|---|---|---|
| SCAIL KSampler `cfg` | **1.0** | lightx2v distill LoRA is cfg-distilled; raising cfg breaks quality and slows it |
| `sampler_name` / `scheduler` | `euler` / `simple` | proven recipe |
| `denoise` | 1.0 | full denoise |
| distill LoRA strength | 1.0 | enables 6–8 step generation |
| `ModelSamplingSD3 shift` | 5.0 | proven recipe |
| HY-Motion `network` | Full (`HY-Motion-1.0`) | best quality; 4090 has the VRAM |
| fps | 30 | guide/output consistency (see above) |
| `duration` | from in-server LLM rewrite (frames/30), else explicit/default → guide → length | see above |
| `pose_start` / `pose_end` | 0.0 / 1.0 | advanced; sensible default |
| `replacement_mode`, `batch_size`, `num_samples` | off / 1 | separate feature / later |

## Gotchas to encode (do not re-discover)

1. **Two different "cfg" knobs.** HY-Motion `cfg_scale` (motion↔text adherence, tunable 1–15) is NOT the SCAIL KSampler `cfg` (must stay 1.0). Label them distinctly in the UI; only the HY-Motion one is exposed (as "Motion adherence").
2. **Text encoder must be 4096-dim (Qwen3-8B family).** If the LLM hidden dim ≠ 4096, HY-Motion silently inserts a **random untrained Linear projection** for the context conditioning (`custom_nodes/ComfyUI-HY-Motion1/nodes.py:1313-1325`) → garbage. The working `Qwen3-8B-bnb-4bit` is correct; never substitute Qwen3-0.6B.
3. **SCAIL recenters apparent motion.** HY-Motion emits root translation (e.g. "walk forward" physically moves the body). SCAIL maps all apparent motion in the guide to *character* motion and recenters the camera. For in-place motions this is fine; for traveling motions, expect the character to perform the travel in place. (Camera moves in the guide are dropped — keep the guide camera static, which HY-Motion already does.)

## Pipeline / data flow

```
                  camera-lab server (Stage A)
prompt ─▶ [optional] llm_chat(REWRITE template) ─▶ short_caption + duration(frames/30)
                                                          │
                                                          ▼  (literal inputs)
guide workflow:  HYMotionLoadLLM(Qwen3-8B-bnb-4bit) ─▶ EncodeText(text) ─┐
                 HYMotionLoadNetwork(HY-Motion-1.0) ────────────────────▶ Generate(duration, seed, cfg_scale)
                                                                          │
                                                          Preview(frame_step=1) ─▶ CreateVideo(fps=30) ─▶ SaveVideo
                                                                          │  guide mp4, N frames @30fps
reference image ─┐                                                        ▼  (Stage B)
size preset ─────┼─▶ SCAIL workflow: LoadVideo(guide) → length = align4k1(N), steps, seed, pose_strength ─▶ video @30fps
(fixed recipe) ──┘
```

## Workflow structure: two ComfyUI workflows, not one merged graph

The two stages are **two separate ComfyUI workflow submissions**, orchestrated by camera-lab's server, with the guide passed from stage A to stage B:

- **Workflow A** — `text → [server-side llm_chat rewrite] → Load LLM / Load Network → Encode(text) → Generate(duration) → Preview(frame_step=1) → CreateVideo(fps=30) → SaveVideo`. (Validated on 8188: `hymotion_guide.api.json` → `output/motion/guide_00001_.mp4`, 512×512/30fps/120fr at duration=4.0. UI-format twin `hymotion_guide.ui.json` for GUI viewing.)
- **Workflow B** — `load guide + reference image → SCAIL recipe (length = align4k1(guide frame count)) → save final video`.

Reasons not to merge into a single graph:

1. **Staged preview requires a pause.** A merged graph runs end-to-end with no point to inspect/approve the guide — that collapses back into the "fused" model the user rejected.
2. **VRAM.** HY-Motion (Qwen3-8B + motion net) and the SCAIL stack (Wan 14B fp8 + distill/DPO LoRAs + VAE + CLIP-vision) are both heavy on the 4090. Two separate executions let ComfyUI free the motion models before loading SCAIL, avoiding the offload/thrash failure mode noted in the handoff. One merged graph would try to hold both.
3. **`length` derivation is simpler between runs.** Stage B reads the saved guide's actual frame count and sets `length = align4k1(N)` — trivial in the server between submissions, vs. wiring a dynamic frame-count→`length` edge inside one graph.

(Note: the existing `mesh2scail_workflow.json` merges mesh2motion → SCAIL in one graph, but that path has no guide-preview step and is a different flow.)

## ComfyUI endpoint: minimal, migration-friendly (no dual-endpoint subsystem)

HY-Motion + SCAIL nodes currently live only on the separate `dev/ComfyUI-scail` instance (port 8188); camera-lab's other tabs target the desktop instance (port 8000). **The desktop nodes will eventually be migrated so only one instance remains** — so do NOT build an elaborate multi-endpoint routing layer (it would become dead code).

Minimal approach:

- Add an optional `base_url` param to `http_json` / `http_post` (default `COMFY_URL`).
- `MOTION_COMFY_URL = os.environ.get("COMFYUI_MOTION_URL") or COMFY_URL` — falls back to the single instance when unset.
- Pass `base_url=MOTION_COMFY_URL` **only** on the motion/SCAIL submissions.

After consolidation, dropping `COMFYUI_MOTION_URL` makes everything run on one instance with zero code changes.

## Out of scope (this spec)

- Multi-candidate generation (`num_samples` 1–4 + a pick-best UI) — revisit if hit-rate is low.
- Replacement mode (SAM3 masks) — separate feature.
- Kimodo as an alternative motion backend — blocked on gated Llama-3 access; tracked separately.

## Open questions

- Exact size presets to offer for this tab (reuse Camera Lab's, or a motion-specific set?).
- Whether the guide preview is a scrubber or just an autoplay loop.
