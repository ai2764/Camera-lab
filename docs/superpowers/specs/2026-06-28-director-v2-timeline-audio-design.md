# Director v2 Timeline + Audio — Design

> Status: design (brainstormed 2026-06-28). Implementation plan to follow via writing-plans.
> Branch: `director2`.

## Goal

Bring the WhatDreamsCost **LTX Director 2** workflow into camera-lab, replacing the
current Director MVP (v1), and build a multi-track timeline editor around it:

- **Main timeline** holding image keyframes **and** video clips (a video clip auto-extracts its audio).
- **Two general audio tracks** with per-track volume + audition, mixed down in the browser.
- **IC-LoRA selection** + an **IC reference (video) track** that feeds the chosen IC-LoRA.

The ComfyUI workflow input contract (the `LTXDirector` `timeline_data` JSON + a few
toggles) stays unchanged; the browser does the mixing, the server patches the workflow.

## Scope (this version / phase 1)

- **Block 0 — v2 base integration** (replaces v1).
- **Block 1 — main timeline**: image keyframes + video clips; video clip auto-extracts audio.
- **Block 2 — two-track audio mixer** (frontend Web Audio).
- **Block 3 — IC-LoRA selection** (dropdown of installed IC-LoRAs).
- **Block 4 — IC reference track** (BYO control content for the selected IC-LoRA).

### Out of scope (deferred to phase 2)

- **Retake** (Director-native seamless temporal in-paint). Deferred for its same-model
  seamlessness value; see *Considerations → Retake*. Interim "fix a region" need is covered
  by the existing **Edit** module (WAN Bernini / WAN VACE inpaint).
- **Motion-track preprocessing** (raw video → point-tracked spline overlays). IC-LoRA usage
  is BYO; camera-lab does not extract tracks.
- **Overlay/post-mux audio mode**, **Casting/TTS binding**.

---

## Considerations / Investigation Findings

Captured so the design's "why" is not lost. All line references are to the installed fork at
`ComfyUI-scail/custom_nodes/WhatDreamsCost-ComfyUI/`.

### The v2 workflow

- Canonical file `LTX_Director_2_Workflow_Hotfix.json` — local copy, upstream
  `example_workflows/`, and `tasks/wdc_ltx_director_2_hotfix.json` are **byte-identical**
  (sha256 `46770dd4d2e9`). Upstream node code is also identical to local (so "fork not
  updated" referred to nothing material here). Format is ComfyUI UI/graph (33 nodes).
- **Differs from v1 MVP**: v2 loads the pre-merged distilled transformer via `UNETLoader`
  (`ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors`) with **no separate
  LoRA** (distillation baked in), uses **`LTXDirectorCropGuides`**, and the `LTXDirector`
  node id is **131** (v1 MVP is id 46, base checkpoint + `LoraLoaderModelOnly`).
- Models referenced match the `director-v2-distilled-fp8` profile already in
  `scripts/camera_lab_setup/modules.py`: UNET distilled fp8, `DualCLIPLoader`
  (gemma_3_12B + ltx-2.3 text projection), `VAELoader` ×2 (audio + video VAE),
  `VAELoaderKJ` (taeltx2_3), `LatentUpscaleModelLoader` (spatial upscaler x2 1.1).
- The two `LTXDirectorGuide` nodes (132/133) are **two sampling stages** (base → upsample →
  refine), not two timelines. They share the same timeline tracks.

### Timeline track model (`js/ltx_director.js`, `ltx_director.py`)

The `LTXDirector` timeline widget has three tracks, serialized inside one `timeline_data` JSON:

| Track | Data key | Segment type | Mechanism |
|---|---|---|---|
| Main | `segments` | `image` / `video` | image → single keyframe guide; video → its full frames loaded (`_load_video_tensor`, `ltx_director.py:418`) and inserted as a **dense multi-frame keyframe guide** at `insert_frame` with `guide_strength`, via `LTXVAddGuide` (`ltx_director_guide.py:484-543`). |
| IC / motion | `motionSegments` | `motion_video` | `_encode_video_iclora_guide` (`:121`) VAE-encodes frames at the IC-LoRA reference downscale; meaning is defined entirely by the selected IC-LoRA. |
| Audio | `audioSegments` | — | `_build_combined_audio` (`:584`). |

- **Main-track video carries content + motion through** (dense per-frame guides at strength),
  not just appearance. **IC-track video meaning depends on the IC-LoRA** (appearance for
  Ingredients, trajectory for Motion Track, etc.).

### LTX has no native v2v — "motion guide" is IC-LoRA

- The IC/motion track only does anything when an **IC-LoRA** is loaded
  (`_load_lora_model_only`, `ltx_director_guide.py:323`; `is_lora_active`, `:360`). The v2
  workflow ships with `ic_lora_name = 'None'` on both guide stages → IC track inert by default.
- IC-LoRA is a **family**; the track is generic. Installed: only
  `ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors` (content/subject injection, takes
  **reference images**). Motion/structure IC-LoRAs are **not installed**:
  - Motion Track — `Lightricks/LTX-2.3-22b-IC-LoRA-Motion-Track-Control`,
    `ltx-2.3-22b-ic-lora-motion-track-control-ref0.5.safetensors` (327 MB). **Requires a
    spline-overlay / point-trajectory control video** (e.g. via SpatialTrackerV2), not raw
    footage. The director does **no** track extraction — whatever frames you drop are the
    control signal. This is why "drop a raw video and it follows motion" is not free.
  - Union Control — `ltx-2.3-22b-ic-lora-union-control-ref0.5.safetensors`.
- **Decision**: IC track is **BYO** — expose an IC-LoRA dropdown + reference track; the user
  supplies content compatible with their chosen IC-LoRA. No preprocessing in scope.

### Audio mechanism (`ltx_director.py`)

- `_build_combined_audio` (`:584`) mixes segments of **one** source **additively** (`+=`, `:727`).
  Source is chosen by `overrideAudio` (binary): `false` → `audioSegments`; `true` →
  `motionSegments` video audio. Retake forces `true` (`:607`). **No cross-track mixing** of
  video-native audio and a separate track inside the node.
- The audio latent gate: `if use_custom_audio or override_audio or is_retake_active:`
  (`:1194`). If none, an **empty latent** is used and audio is **fully generated**.
- `inpaint_audio` (`:899`, default true): with `audioSegments`, content regions get
  `noise_mask=0` (preserved/guide), gaps get `1` (generated). `false` → all-zero mask =
  silence preserved.
- **Black-frame caveat** (`:1219-1221`): the audio mask must be 3D `[B,F,H]`, never 4D, or the
  KSampler masks the 128-channel video latent and blacks out frames.
- **Implication for our mixer**: route everything through `audioSegments` with
  `overrideAudio=false` and `use_custom_audio=true`. Per-track volume + audition + true mixing
  must therefore happen **in the browser** (Web Audio); the node only sees pre-mixed segments.
  This is why "merge in frontend, gaps to model, contract unchanged" is the chosen model.

### Retake (deferred to phase 2)

- Mechanism (`ltx_director_guide.py:364-473`): base video VAE-encoded into the latent;
  `retakeStart/retakeLength` → latent indices `l_start/l_end`; temporal `noise_mask` = 0
  (frozen) everywhere except `[l_start:l_end] = retake_strength` (regenerate). Two-stage keeps
  preserved regions high-res-faithful.
- **Seamlessness** is *not* mask feathering (hard step). It comes from: (1) frozen regions hold
  the **real** original latents; (2) the diffusion model in-paints the retake region while
  attending to the frozen neighbors as context → content flows continuously in/out; (3) VAE
  temporal decode smooths the latent-frame boundary; (4) `retake_strength` controls deviation.
  Audio is in-painted in the same region for AV sync.
- **Why deferred, not replaced**: retake's same-model continuity is its unique value. The Edit
  module (WAN VACE inpaint / Bernini vi2v) can fix regions today but is **cross-model**
  (LTX original ↔ WAN edit → possible seam) and spatial-mask oriented. Retake also **forces
  `override_audio=true`**, conflicting with the two-track mixer. Phase 2 will design retake
  natively (incl. resolving the audio conflict).

### Existing camera-lab foundation (extend, don't rebuild)

- Frontend already has a director timeline: `state.directorSegments`,
  `state.directorAudioSegments`, selection/drag (`frontend/app.js`).
- Server already builds director timeline + audio: `director_timeline_from_payload`,
  `director_audio_segments_from_payload`, `director_timeline_audio_segments`,
  `build_ltx_director_reference_api` (`server/camera_lab_server.py`), and already sets
  `use_custom_audio=True` when audio segments exist (`:1299`).

---

## Architecture (Approach A)

Extend the existing pieces; isolate the new complexity into its own frontend module; add a
parallel v2 server builder and retire v1.

### Components

1. **Frontend timeline module** (new, isolated like `frontend/3dmotion/` & `photography.js`)
   - Owns: track model (main / IC / two audio), segment CRUD + drag/trim, video frame
     thumbnails, **Web Audio mixer** (per-track gain, audition/transport), and **mixdown**
     to per-content-region audio clips.
   - Inputs: config (installed IC-LoRAs, fps, size), media upload endpoints.
   - Output: a director-v2 generation payload (timeline segments + IC selection + audio toggles
     + uploaded mixed-audio file references).
   - `app.js` only mounts the module in the Director workspace and forwards config; it does not
     absorb multi-track or audio-mixing logic.

2. **Server v2 builder** `build_ltx_director_v2_api` (new, in `server/camera_lab_server.py`)
   - Loads the v2 workflow JSON, `workflow_to_api`, patches the v2 `LTXDirector` (by class_type,
     not the v1 id 46) and the two `LTXDirectorGuide` stages.
   - Reuses `director_timeline_from_payload` + audio-segment helpers; adds **main-track video
     segments**, **`motionSegments`** (IC track), and **`ic_lora_name`** wiring on both stages.
   - Sets `overrideAudio=false`, `use_custom_audio=true` when audio present, and forwards the
     `inpaint_audio` toggle. v2 model patching: `UNETLoader` (no LoRA), `LTXDirectorCropGuides`.

3. **Workflow + profile registration**
   - Bundle the v2 workflow into `workflows/app/`; point the Director module's workflow at v2;
     retire the v1 MVP workflow. Make `director-v2-distilled-fp8` the drop-in profile so the
     module resolves ready (consistent with the resolver rule on `director2`).

### Data flow (generation)

```
Frontend timeline module
  main track:  image segments + video segments
               (video → auto-extract its audio → audio track 1; independent clip after extraction,
                does NOT stay linked to the video segment when moved/trimmed)
  IC track:    reference video/images  +  IC-LoRA dropdown selection
  audio tracks: 2 lanes, per-track gain, audition
        │  Web Audio mixdown per contiguous covered region (gain applied), gaps left empty
        ▼
  payload: { timeline_segments[], motion_segments[](IC), mixed_audio_segments[],
             ic_lora_name, inpaint_audio, size/fps, uploaded media refs }
        │
        ▼  POST (existing director generate endpoint, extended)
Server build_ltx_director_v2_api
  → workflow_to_api(v2)
  → timeline_data = { segments(main img+video), motionSegments(IC), audioSegments(mixed) }
  → LTXDirector.inputs: timeline_data, use_custom_audio=true, overrideAudio=false, inpaint_audio
  → LTXDirectorGuide(132/133).inputs: ic_lora_name, model wired
  → patch UNET / VAE / text encoders / upscaler
        ▼
ComfyUI (LTX Director 2)  →  AV video out
```

- **Audio contract unchanged**: mixed-region clips become `audioSegments` (start/length/trim);
  truly empty regions are gaps → model in-paints when `inpaint_audio=true`.
- **Gap semantics**: global `inpaint_audio` toggle, default AI-fill.

### Interfaces (each unit testable in isolation)

- Frontend mixer: `mixdown(tracks, fps, duration) -> [{start, length, audioFile|blob}]`
  (pure, given decoded buffers) — unit-testable.
- Frontend payload builder: `toDirectorV2Payload(timelineState) -> payload` — pure mapping.
- Server `build_ltx_director_v2_api(run) -> api_dict` — unit-testable against a sample payload,
  asserting node patches (ic_lora_name, use_custom_audio, overrideAudio, UNET, no-LoRA, CropGuides).
- Server timeline/audio helpers reused as-is where possible.

### Build sequencing (phased, each independently verifiable)

1. v2 base swap — workflow bundled, `build_ltx_director_v2_api`, profile/registration; parity
   with the current image-keyframe director.
2. Main-track **video segments** + auto-extract audio.
3. **Two-track audio mixer** (Web Audio gain + audition + mixdown → audioSegments).
4. **IC-LoRA selection** + **IC reference track**.

## Error handling

- Missing v2 models / IC-LoRA not installed → resolver/profile surfaces it; IC dropdown only
  lists installed IC-LoRAs; `ic_lora_name=None` keeps the IC track inert (no error).
- Upload-in-progress / missing media → validate before queue (mirror existing director checks).
- Audio mixdown must emit 3D-safe segments; never feed an empty-but-present audio clip when the
  user wants silence (use `inpaint_audio=false`, not a zero clip) — avoids the black-frame mask
  trap and unintended generation.
- Cross-model edit (Edit module) is interim-only; flagged in UI copy, not wired into v2.

## Testing

- Python: `build_ltx_director_v2_api` unit tests (node patch assertions); audio-segment mapping
  tests; profile/resolver readiness for v2.
- Frontend: mixer mixdown unit tests (gain, overlap sum, gap boundaries); payload-builder tests;
  Playwright smoke for the Director workspace (tracks render, IC dropdown, generate payload shape).
- Manual: a real v2 generation run; **validate the IC-LoRA compatibility risk** below.

## Risks / open validation

- **IC-LoRA on the pre-distilled fp8 transformer**: official IC-LoRA examples stack
  `distilled-lora-384 + IC-LoRA` on the **base** checkpoint; v2 uses the **pre-merged** distilled
  fp8 UNET. Whether IC-LoRA applies cleanly must be **verified by a real run** before relying on
  Block 4.
- Web Audio mixdown fidelity vs node `+=` (clipping/limiting) — frontend should gain-stage to
  avoid clipping the guide audio.
- Main-track video at high `guide_strength` ≈ passthrough; confirm continuity with neighboring
  generated shots in a real run.

## Phase 2 (later)

- Director-native **retake** (seamless same-model temporal in-paint) incl. resolving the
  `override_audio` vs mixer conflict.
- Optional motion/structure IC-LoRA with a track-extraction preprocessing pipeline.

## Director Timeline Model Contract

- Camera Lab Director editing logic uses a frame-first model that mirrors LTXDirector `timeline_data`.
- Internal model fields are `start`, `length`, and `trimStart` in frames.
- UI state may expose `start`, `duration`, and `trimStart` in seconds, but editing operations must convert to the frame model first.
- Splitting media clips advances the right clip `trimStart` by the left clip length.
- Image clips are not splittable.
- Audio, video-audio, main video, and IC video clips are splittable.
- Payload `trim_start` is emitted in frames.
- Payload `start` and `duration` remain seconds for Camera Lab server compatibility.
