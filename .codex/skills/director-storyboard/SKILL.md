---
name: director-storyboard
description: >
  Use when the user asks for 分镜, script plus keyframes, storyboard analysis,
  keyframe bridging, LTX Director 2 timeline prompting, multiple Director variants,
  automatic Camera Lab Director runs, or invokes $director-storyboard or /director-storyboard.
metadata:
  short-description: "Script + keyframes → Director timeline run"
---

# /director-storyboard — Script + Images → Director Run

You convert a **剧情脚本 / plot** and a **图片集合 (keyframes)** into a
Director-ready storyboard, then optionally auto-submit it to Camera Lab.

## When to use

- User provides a script/story + stills and wants Director prompts
- User wants two (or more) keyframes bridged with continuous motion
- User asks to auto-run LTX Director 2 from images + prompts
- Slash: `/director-storyboard`

## Pipeline

```text
script + images
    → (this skill) understand shots, order keyframes, write prompts
    → storyboard JSON
    → python scripts/run_director_storyboard.py --storyboard <file>
    → Camera Lab /api/run  (workflow_id=ltx_director_2)
```

## Step 1 — Gather inputs

Collect:

1. **Script / plot** (scene beats, dialogue, camera intent)
2. **Image set** (ordered keyframes, or unsorted — then you must sort them)
3. Optional: target duration, resolution, seed, negative prompt
4. Whether to **only write** the JSON or **also run** the workflow

If images are unordered, infer order from the script and from visual continuity
(same character, lighting, location progression). State the ordering explicitly.

## Step 2 — Analyze as a continuous Director shot

Director v2 is **not** “stitch many I2V clips”. It is:

| Layer | Role |
|---|---|
| **Global prompt** | Persistent identity, wardrobe, location, lighting, style |
| **Local segment prompt** | What happens in *this* time window only |
| **Keyframe image** | Visual guide at that time (model is *pulled toward* the frame) |

Rules:

1. Prefer **one continuous cinematic shot** per storyboard unless the user wants hard cuts.
2. Keep **identity + wardrobe + location + lighting** stable across keyframes.
3. Keyframes are **targets the generation should reach**, not only start frames.
4. Between two keyframes, the local prompt must describe the **bridge motion**
   (how pose/camera gets from A to B), not just re-describe stills.
5. Give enough duration for the action (do not pack complex motion into 2s).

Read `references/prompting.md` for LTX + Prompt Relay guidance.

## Step 3 — Map script beats → timeline segments

For N keyframe images:

1. Align each image to a script beat (or mark as bridge-only text segment).
2. Set `start` / `duration` in seconds so segments cover the full shot without large empty gaps
   (gaps get absorbed into neighboring local-prompt lengths).
3. Default strengths: **0.78–0.85** for important keyframes. Do **not** drop below ~0.75
   to fix a static / slideshow feel — that trades away keyframe fidelity. Fix static shots
   in the prompts instead (see *Anti-slideshow rules* below).
4. First image usually at `start: 0`. Last image near the end of the timeline
   (or own segment near the end) so the shot lands on that composition.

Suggested timing defaults when user does not specify:

| Transition | Duration between keyframes |
|---|---|
| Micro expression / head turn | 1.5–2.5s |
| Walk a few steps / simple gesture | 2.5–4s |
| Full pose + camera track | 4–8s |

## Step 4 — Write prompts

### Global prompt (English, one paragraph)

Structure (LTX official style):

1. Continuous shot + subject identity
2. Wardrobe / appearance
3. Location + time of day / weather
4. Lighting + color palette
5. Continuity constraints (same person, coherent motion)

Do **not** put beat-by-beat action only in global. Global is the anchor.

### Local prompts (per segment)

- Present-tense **verbs** (turns, walks, raises, camera tracks…)
- Explicit **camera** (static / slow push-in / tracks right / handheld)
- Only the events that happen in this segment
- Adjacent segments must **relay** — same world, progressive action
- Dialogue in quotation marks if needed
- Keep each segment focused (one dominant beat)

### Anti-slideshow rules

Multi-cut storyboards (several close-ups, reused reaction images) read as a slideshow
unless every beat visibly moves:

- Every segment prompt must contain ongoing motion: light flicker/shift, wind in hair,
  breathing, drifting dust/smoke, churning clouds, falling debris.
- The camera is never locked — give each beat a drift, push-in, or tremble.
- When reusing a keyframe for a reaction insert, advance its state (light change, tighter
  framing, deeper emotion) instead of re-describing the still.
- Add static terms to the negative prompt: `slideshow, still photograph, freeze frame,
  static image, motionless scene`.
- Keep strength high (0.78–0.85) and let the prompt carry the motion.

### Negative prompt

Default if user does not specify:

```text
blurry, distorted face, identity change, clothing change, flicker, jump cut, text overlay, watermark
```

## Step 5 — Emit storyboard JSON

Write a file (prefer under `tasks/` — gitignored) matching
`references/storyboard.schema.json`.

Minimal shape:

```json
{
  "global_prompt": "A continuous cinematic shot of ...",
  "negative_prompt": "blurry, distorted face, ...",
  "width": 768,
  "height": 512,
  "seed": null,
  "segments": [
    {
      "id": "s1",
      "image": "C:/path/or/repo/relative/frame_01.png",
      "prompt": "Medium shot. She stands under the umbrella...",
      "start": 0.0,
      "duration": 3.0,
      "strength": 0.8
    },
    {
      "id": "s2",
      "image": "C:/path/or/repo/relative/frame_02.png",
      "prompt": "She turns right and walks toward the crosswalk...",
      "start": 3.0,
      "duration": 4.0,
      "strength": 0.75
    }
  ]
}
```

Notes:

- `image` may be absolute or repo-relative. The runner stages copies under
  `tasks/camera_lab_uploads/` so the server accepts them.
- Text-only bridge segments are allowed: omit `image`, keep `prompt` + timing.
- Field aliases accepted by the runner: `image_path`, `local_prompt`, `length_seconds`.
- **Video segments**: `"video": "path.mp4"` (alias `video_path`) uses an existing take as
  a timeline guide — the standard way to extend a good take: video segment at
  strength ~1.0 covering its original duration, then new tail segments after it.
- A **text-only tail after a strength-1.0 video guide is often ignored** (the new event
  never happens). Anchor the new event with an image guide — extract a frame from a
  previous good run (`ffmpeg -ss <t> -i take.mp4 -frames:v 1 guide.png`) and use it with
  strength ~0.75–0.8.
- **Audio segments**: top-level `"audio_segments": [{"audio", "start", "duration",
  "volume", "trimStart"}]`, usually with `"inpaint_audio": true`.
- The negative prompt must not forbid any event a segment requires (e.g. remove
  `ship explodes` from the negative before adding an explosion beat).

Also show the user a short markdown table:

| # | start–end | image | local prompt (1 line) |
|---|---|---|---|

## Step 6 — Run the workflow (when requested)

Prerequisites:

1. Camera Lab server running (`python scripts/start_camera_lab.py`)
2. ComfyUI up and Director workflow available
3. Storyboard JSON written to disk

Commands:

```powershell
# dry-run: print payload only
python scripts/run_director_storyboard.py --storyboard tasks/my_storyboard.json --dry-run

# submit and wait
python scripts/run_director_storyboard.py --storyboard tasks/my_storyboard.json --wait

# custom server URL / resolution overrides
python scripts/run_director_storyboard.py --storyboard tasks/my_storyboard.json --base-url http://127.0.0.1:1234 --width 768 --height 512 --wait
```

Notes:

- On Windows, if `python` resolves to the Microsoft Store stub ("Python was not found"),
  use `py -3` instead.
- **Variant takes for editing**: rerun the same storyboard with `--seed <n>` overrides
  (one take per seed) and log every take (segment, seed, batch_id, dialogue) in
  `tasks/storyboards/takes_manifest.md` so the editor can pick shots.

Alternate input without a pre-made JSON:

```powershell
python scripts/run_director_storyboard.py `
  --images tasks/frames/01.png tasks/frames/02.png `
  --global-prompt "A continuous cinematic shot of ..." `
  --prompts "first beat..." "second beat..." `
  --durations 3 4 `
  --wait
```

After submit, report:

- `batch_id`
- run status URL path `/api/batches/<batch_id>`
- output video path when status is `done` / `completed`

If the server is down, still deliver the storyboard JSON and tell the user how to start Camera Lab.

## Quality checklist before run

- [ ] Same character / wardrobe / location across keyframes (or deliberate cut explained)
- [ ] Global anchors identity; locals carry motion only
- [ ] Bridge between every pair of keyframes is described
- [ ] Durations match action complexity
- [ ] Strengths not all 1.0 unless user wants hard stickiness
- [ ] Paths resolve; images exist — **re-verify right before every submit**, including
      re-runs of old storyboards (users rename/replace keyframe files between runs)
- [ ] Negative prompt does not forbid any event required by a segment
- [ ] Total duration is intentional (sum of segments / last end time)

## Retakes (fixing part of a take)

`py -3 tasks/storyboards/_submit_retake.py <config.json>` replaces a time window of an
existing video (config: `base_video`, `duration`, `retake_start`, `retake_length`,
`retake_prompt`, `global_prompt`, `negative_prompt`, `seed`, `retake_strength`).

Hard-won limits:

- The window must start **before the artifact first appears**. Retake conditions on the
  base video — an artifact already in frame at window start persists regardless of seed.
- Strong model priors (e.g. an open wound drifting red) usually survive retakes even with
  clean conditioning and heavy negatives. Instead: re-run the batch with the shot ending
  earlier (stop at the peak, before the drift), or anchor the fix with a corrected guide
  image extracted from a good take.
- Retake cannot extend duration. To extend a take, use a video segment + tail segments
  (see Step 5 notes).

## Do not

- Invent ComfyUI model paths or claim generation succeeded without API confirmation
- Put large multi-event monologues into a 2s segment
- Change identity mid-timeline without user intent
- Commit generated videos, uploads, or `tasks/` outputs
- Skip writing the JSON to disk when the user asked to run (runner needs a file or CLI args)

## References

- `references/prompting.md` — LTX Director prompting + keyframe bridging
- `references/storyboard.schema.json` — machine schema
- `references/example_storyboard.json` — sample payload
- Repo workflow: `workflows/app/ltx_director_2.json`
- Server entry: `POST /api/run` with `workflow_id: "ltx_director_2"`

