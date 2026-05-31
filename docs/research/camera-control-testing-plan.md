# Camera Control System Testing Plan

**Goal:** For each camera move, identify the most sensitive prompt wording, stable seed ranges, and image conditions that produce the cleanest result across I2V, IA2V, and FLF.

**Current workflows:**
- I2V: `LTX 2.3 I2V Official Local`
- IA2V: `LTX 2.3 IA2V`
- FLF: `LTX 2.3 FLF SFX`

**Camera moves under test:**
- Dolly Push In
- Dolly Pull Back
- Truck Left
- Truck Right
- Pedestal Up
- Tilt Up
- Pan Right
- Roll Clockwise
- Orbit Right
- Foreground Pass

## Test Principle

Do not test every possible prompt, seed, image, workflow, and size combination at once. Each move gets four passes:

1. Image sensitivity pass: find which source image type gives the model enough visual structure.
2. Prompt sensitivity pass: find which wording actually moves the camera instead of changing the scene.
3. Seed hunt pass: find seeds that preserve identity and obey the move.
4. Confirmation pass: rerun the best prompt + seed on multiple images and aspect ratios.

The final output for each move is one recommended prompt pattern, two backup prompt patterns, three seed candidates, and notes about which image types help or hurt.

## Fixed Defaults

Use these unless the pass says otherwise:

- Duration: `4s`
- FPS: workflow default / 24 fps
- Size for baseline: request `16:9` at `1280x720`; record actual output dimensions separately because LTX may quantize to model-compatible multiples.
- Secondary sizes: `9:16`, `1:1`
- Negative prompt: keep the current UI default
- Prompt style: only describe camera motion unless testing audio/SFX behavior
- Audio for IA2V: one neutral 4-second file with no music change, no strong beats, no dialogue unless specifically testing audio influence

Baseline seed ladder:

```text
1626970716
1661903965
1780104579
1780115672
123456789
987654321
```

## Source Image Set

Use at least six image classes. The image class is part of the result, not just input data.

| Image Class | Purpose | Expected Helpful Moves | Expected Weak Moves |
|---|---|---|---|
| Front portrait, shallow depth | Identity stability baseline | Push, Pull, Roll, Tilt | Truck, Orbit, Foreground Pass |
| Side profile portrait | Face-angle stress test | Push, Pull, Truck | Orbit, Pan |
| Street/depth scene with subject | Parallax baseline | Dolly, Truck, Orbit, Foreground Pass | Roll |
| Interior with clear vertical/horizontal lines | Geometry baseline | Pan, Tilt, Roll, Pedestal | Foreground Pass |
| Foreground occluder image | Tests strong parallax | Foreground Pass, Truck, Dolly | Roll |
| Low-depth flat image | Failure control | Roll, slight Push | Dolly, Truck, Orbit, Foreground Pass |

Record image notes in this form:

```text
image_id:
  depth: low / medium / high
  foreground: none / weak / strong
  subject_size: close / medium / wide
  line_structure: weak / strong
  identity_risk: low / medium / high
```

## Scoring Rubric

Score each result from 0 to 5.

| Metric | 0 | 3 | 5 |
|---|---|---|---|
| Direction accuracy | wrong/no movement | partial or ambiguous | clear intended move |
| Camera purity | scene/object moves instead | mixed camera and subject movement | camera motion reads cleanly |
| Parallax/perspective | none | mild | strong and physically plausible |
| Identity stability | identity breaks | minor drift | stable identity |
| Composition stability | cut/warp/black frame | minor framing issues | continuous and usable |
| Audio/SFX fit | missing/broken | present but irrelevant | plausible and usable |

Primary score:

```text
camera_score = direction + camera_purity + parallax + composition
usable_score = camera_score + identity + audio
```

Mark a run as `winner` only if:

- direction accuracy >= 4
- camera purity >= 4
- composition stability >= 4
- identity stability >= 3

## Prompt Sensitivity Ladder

For each move, test four prompt levels. The most sensitive wording is the shortest prompt that consistently changes pass/fail behavior.

### Level A: Minimal

```text
Slow [camera move]. No cut.
```

### Level B: Physical Camera

```text
Slow [camera move]. The camera moves physically, not the subject. No cut.
```

### Level C: Visual Evidence

```text
Slow [camera move]. The camera moves physically, with visible parallax and stable subject identity. No cut.
```

### Level D: Constraint Heavy

```text
Slow [camera move]. The camera moves physically while the subject stays naturally stable. Background and foreground shift with correct parallax. No zoom simulation, no scene change, no cut.
```

If Level D improves direction but damages identity, step back to Level C and only add one targeted phrase.

## Move-Specific Prompt Hypotheses

### Dolly Push In

Likely sensitive words:

- `physically forward`
- `perspective change`
- `subtle parallax`
- avoid `zoom in` unless intentionally comparing optical zoom

Candidate prompt:

```text
Slow dolly push in. The camera moves physically forward toward the subject with smooth perspective change and subtle parallax. No cut.
```

### Dolly Pull Back

Likely sensitive words:

- `physically backward`
- `revealing more of the scene`
- `subject stays centered`

Candidate prompt:

```text
Slow dolly pull back. The camera moves physically backward, revealing more of the scene while the subject stays centered. No cut.
```

### Truck Left

Likely sensitive words:

- `lateral camera move`
- `foreground and background slide at different speeds`
- `subject stays stable`

Candidate prompt:

```text
Smooth truck left. The camera moves laterally left with foreground and background sliding at different speeds. The subject stays stable. No cut.
```

### Truck Right

Likely sensitive words:

- `lateral camera move`
- `rightward parallax`
- `not pan`

Candidate prompt:

```text
Smooth truck right. The camera moves laterally right with clear side parallax, not a pan. The subject stays stable. No cut.
```

### Pedestal Up

Likely sensitive words:

- `camera rises vertically`
- `same angle`
- `no tilt`

Candidate prompt:

```text
Smooth pedestal up. The camera rises vertically while keeping the same angle and stable framing. No tilt, no cut.
```

### Tilt Up

Likely sensitive words:

- `pivots upward`
- `fixed position`
- `vertical reveal`

Candidate prompt:

```text
Smooth tilt up. The camera pivots upward from a fixed position, revealing higher parts of the scene. No cut.
```

### Pan Right

Likely sensitive words:

- `rotates horizontally`
- `fixed position`
- `not lateral move`

Candidate prompt:

```text
Smooth pan right. The camera rotates horizontally to the right from a fixed position, not sliding sideways. No cut.
```

### Roll Clockwise

Likely sensitive words:

- `around the lens axis`
- `clockwise frame rotation`
- `subject remains same`

Candidate prompt:

```text
Smooth clockwise camera roll. The frame rotates around the lens axis while the subject remains the same. No cut.
```

### Orbit Right

Likely sensitive words:

- `arc around the subject`
- `curved parallax`
- `viewpoint changes angle`

Candidate prompt:

```text
Subtle orbit right. The camera arcs to the right around the subject with curved parallax and a small viewpoint angle change. No cut.
```

### Foreground Pass

Likely sensitive words:

- `close foreground element`
- `passes across frame`
- `strong parallax`

Candidate prompt:

```text
Slow lateral camera move with a close foreground element passing near the edge of frame, creating strong parallax. No cut.
```

Important: this move needs an input image with an actual foreground object or edge detail. Flat portraits are expected to fail or become fake object generation.

## Round Structure

### Round 0: Calibration

Run one known easy move before each testing day.

- Move: `Dolly Push In`
- Workflow: I2V
- Image: street/depth scene
- Seed: `1626970716`
- Prompt: Dolly Push In candidate

Pass condition: output has video, no black frame, saved `api_prompt.json` matches the baseline constraints, and the mp4 has both video and audio streams when the official LTX 2.3 template includes audio generation.

Current I2V baseline constraint:

- use the ComfyUI built-in LTX 2.3 I2V local template;
- no NAG anti-text patch;
- no subtitle padcrop or extendcrop workflow;
- bypass the template's internal `LTXVCropGuides` node for strict no-crop testing;
- disable prompt enhancement so the submitted prompt is what gets tested;
- keep the official local two-stage sampling chain;
- record requested size and actual output size in every result row.

Verify audio stream:

```powershell
ffprobe -v error -show_streams -of json "<video_path>"
```

Expected: one `codec_type: "video"` stream and one `codec_type: "audio"` stream for the official LTX 2.3 I2V template.

### Round 1: Image Sensitivity

For each move:

- Workflow: I2V only
- Prompt: Level C
- Seeds: first 3 baseline seeds
- Images: all six image classes
- Size: request `1280x720`; record actual output size.

Run count per move: `18`

Decision:

- Keep the top 2 image classes per move.
- If all fail, mark the move as image-dependent and add a custom source image requirement.

### Round 2: Prompt Sensitivity

For each move:

- Workflow: I2V
- Images: top 2 from Round 1
- Seeds: best 2 from Round 1
- Prompts: Level A, B, C, D

Run count per move: `16`

Decision:

- Pick the shortest prompt level that scores within 1 point of the best.
- Record any single phrase that flips results from fail to pass.

### Round 3: Seed Hunt

For each move:

- Workflow: I2V
- Image: best image class from Round 1
- Prompt: winner from Round 2
- Seeds: 12 candidates

Seed list:

```text
1626970716
1661903965
1780104579
1780115672
123456789
987654321
101010101
202020202
303030303
404040404
505050505
606060606
```

Decision:

- Keep best 3 seeds.
- Mark seed behavior:
  - `stable`: same prompt works across images
  - `directional`: strong movement but identity risk
  - `identity-safe`: weaker movement but keeps face

### Round 4: Workflow Comparison

For each move:

- Prompt: winner from Round 2
- Seeds: best 3 from Round 3
- Images: best 2 image classes
- Workflows: I2V, FLF, IA2V

Run count per move: `18`

Rules:

- I2V answers: best one-image camera behavior and generated SFX/audio.
- FLF answers: whether explicit first/last frame improves control.
- IA2V answers: whether audio changes movement or identity stability.

### Round 5: Aspect Ratio Confirmation

For each move:

- Workflow: best workflow from Round 4
- Prompt: final prompt
- Seed: best seed
- Image: best image class
- Sizes: `16:9`, `9:16`, `1:1`

Run count per move: `3`

Decision:

- If a move only works in one aspect ratio, record that as part of the recipe.

## Result Record Template

Use one block per run:

```markdown
### Run ID

- workflow:
- move:
- prompt_level:
- prompt:
- seed:
- size:
- source_image_id:
- source_image_class:
- end_image_id:
- audio_id:
- video_path:
- contact_sheet_path:
- audio_stream: yes / no

Scores:
- direction:
- camera_purity:
- parallax:
- identity:
- composition:
- audio:
- camera_score:
- usable_score:

Notes:
- sensitive_words:
- failure_mode:
- keep_or_reject:
```

## Thinking And Decision Log

Record the reasoning after every review session. This is not just lab bookkeeping; it is the narrative material for the final video.

Use this format:

```markdown
## Decision Log: [date] [session name]

### Starting Hypothesis

- What I expected:
- Why I expected it:
- What would prove it:
- What would disprove it:

### What I Changed This Round

- Variable changed:
- Variables kept fixed:
- Reason for changing only this variable:

### Observation

- What happened visually:
- What happened to identity:
- What happened to camera motion:
- What happened to audio/SFX:
- Unexpected behavior:

### Decision

- Keep:
- Reject:
- Modify:
- Next test:

### Reasoning

- Main reason:
- Tradeoff:
- Confidence: low / medium / high
- Video narration note:
```

Example:

```markdown
## Decision Log: 2026-05-30 Orbit Right Round 2

### Starting Hypothesis

- What I expected: orbit needs explicit "arc around the subject" wording.
- Why I expected it: "orbit" alone may be interpreted as object rotation or scene drift.
- What would prove it: the camera viewpoint changes angle while the subject remains stable.
- What would disprove it: the subject spins, the background warps, or the result becomes a lateral truck.

### What I Changed This Round

- Variable changed: prompt wording.
- Variables kept fixed: image, workflow, seed, size, duration.
- Reason for changing only this variable: isolate whether wording controls the move.

### Observation

- What happened visually: "curved parallax" improved background motion, but face angle changed too much.
- What happened to identity: identity drift increased at stronger motion wording.
- What happened to camera motion: Level C was readable; Level D over-constrained and caused morphing.
- What happened to audio/SFX: audio present but not useful for judging orbit.
- Unexpected behavior: "small viewpoint angle change" reduced face morphing.

### Decision

- Keep: Level C prompt with "arc to the right" and "small viewpoint angle change".
- Reject: Level D prompt with too many constraints.
- Modify: remove "strong parallax"; keep "curved parallax".
- Next test: seed hunt on Level C.

### Reasoning

- Main reason: the best prompt is the shortest one that reliably produces orbit without identity collapse.
- Tradeoff: weaker orbit is more usable than strong orbit with face drift.
- Confidence: medium.
- Video narration note: "The model understands orbit only when I describe the camera path, but too much force breaks the character."
```

## Decision Rules

Use these rules to make decisions consistent across moves.

### When To Keep A Prompt

Keep a prompt if:

- it improves direction accuracy by at least 1 point over the baseline;
- it does not reduce identity stability below 3;
- it works on at least two seeds or two image classes.

Do not keep a prompt just because one seed looked good.

### When To Reject A Prompt

Reject a prompt if:

- it makes the subject move instead of the camera;
- it creates scene edits, cuts, new objects, or major identity drift;
- it only works on one lucky seed and fails everywhere else;
- it gets the direction right but produces unusable composition.

### When To Hunt More Seeds

Run more seeds only after the prompt and image class are already promising.

Seed hunt is justified if:

- direction score is at least 4 once;
- identity score is at least 3 once;
- failures look stochastic rather than systematic.

Do not hunt seeds if the prompt consistently describes the wrong kind of movement.

### When To Change Images

Change the source image when:

- the move needs parallax but the image has no depth;
- foreground pass lacks a real foreground edge;
- pan/tilt lacks vertical or horizontal structure;
- orbit lacks enough background information to reveal viewpoint change.

Keep the prompt fixed while changing images.

### When To Prefer A Weaker Prompt

Prefer the weaker prompt when:

- the stronger prompt improves motion but damages identity;
- the stronger prompt adds fake objects;
- the weaker prompt is more repeatable across seeds;
- the final video use case values clean character continuity over extreme camera motion.

### When To Promote A Result To Final Recipe

Promote only if the result survives confirmation:

- same prompt works on at least two source images;
- one seed is clearly best, with two backups;
- result is not dependent on a hidden accident in the image;
- workflow and aspect ratio are recorded;
- failure conditions are understood.

## Video Material Capture Notes

For every important decision point, capture both the winning and losing examples.

Record these pairs:

- Minimal prompt vs physical camera prompt
- Best seed vs failed seed
- Flat portrait vs depth scene
- I2V vs FLF when FLF improves or worsens control
- I2V with audio stream vs older no-audio simple workflow if useful for explaining the workflow change
- Strong prompt that breaks identity vs weaker prompt that holds identity

Recommended narration beats:

1. "I first assumed the camera word itself was enough."
2. "Then I isolated the image, because camera motion needs visual structure."
3. "The same prompt behaved differently when the image had foreground and depth."
4. "After that, seed hunting only made sense for prompts that already showed the right movement."
5. "The final recipe is not just a prompt. It is prompt + seed + image geometry + workflow."

## Recovery Log Requirement

Every testing session must be recoverable from disk without relying on terminal scrollback, chat history, or memory.

Maintain one append-only recovery log:

```text
docs/research/camera-control-test-recovery-log.md
```

Update it at these moments:

- before starting a new round;
- after queueing a batch;
- after a batch finishes;
- after scoring a batch;
- after changing prompt wording, image set, workflow, size, or seed list;
- before stopping for the day;
- immediately after any error, crash, canceled run, or manual ComfyUI intervention.

Never rewrite previous log entries. Add a correction entry if an earlier note was wrong.

### Recovery Log Entry Template

```markdown
## [YYYY-MM-DD HH:MM] Session Checkpoint

### Current State

- active_round:
- active_move:
- active_workflow:
- active_prompt_level:
- active_image_set:
- active_seed_set:
- active_size:
- active_batch_id:
- comfy_status:
- camera_lab_url:

### Queued / Running

| batch_id | run_ids | workflow | move | prompt_level | seeds | images | status |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

### Completed Since Last Checkpoint

| batch_id | run_id | video_path | score | keep/reject | reason |
|---|---|---|---|---|---|
| | | | | | |

### Decisions Made

- kept:
- rejected:
- changed:
- reason:

### Next Exact Action

1. 
2. 
3. 

### Resume Command / UI State

- open_url: `http://127.0.0.1:8766`
- select_workflow:
- select_move:
- select_size:
- seed_input:
- source_image:
- end_image:
- audio_file:
- prompt:
```

### Minimum Resume Data

If time is short, write at least this one-line checkpoint before leaving:

```text
[YYYY-MM-DD HH:MM] round=<round> move=<move> workflow=<workflow> prompt=<prompt_level/name> seeds=<seed list> images=<image ids> batch=<batch_id> next=<next exact action>
```

### Recovery Procedure

If the terminal, browser, or chat context is lost:

1. Open `docs/research/camera-control-test-recovery-log.md`.
2. Find the latest `Session Checkpoint`.
3. Open `http://127.0.0.1:8766`.
4. Use Camera Lab history to locate the latest `active_batch_id`.
5. Verify each completed run has `video_path`, `score`, and `keep/reject`.
6. Continue from `Next Exact Action`.
7. Add a new recovery log entry before queueing more runs.

### What Must Not Be Only In Chat

These must always be written to the recovery log:

- final prompt candidates;
- rejected prompt wording and why;
- seed candidates and labels;
- image class decisions;
- workflow preference decisions;
- ComfyUI errors;
- batch IDs;
- video paths for winners and important failures;
- any subjective observation that affects the next test.

## Final Recipe Template

Use this for each camera move after testing:

```markdown
## [Camera Move]

Best workflow:
Best image class:
Best aspect ratio:
Best prompt:
Best seeds:
- primary:
- backup_identity_safe:
- backup_strong_motion:

Prompt pattern:
`[pattern]`

Sensitive words:
- word/phrase:
- effect:

Image requirements:
- helps:
- hurts:

Common failures:
- failure:
- mitigation:

Recommended use:
- when to use:
- when to avoid:
```

## Estimated Run Count

Per move:

- Round 1: 18
- Round 2: 16
- Round 3: 12
- Round 4: 18
- Round 5: 3

Total per move: `67`

Total for 10 moves: `670`

Practical shortcut:

- Fully test Dolly Push, Truck Right, Tilt Up, Roll, Orbit, Foreground Pass first.
- Mirror results from Truck Right to Truck Left and Dolly Push to Dolly Pull, then only run confirmation rounds.

Shortcut estimate: `420-480` runs.

## Execution Order

1. Confirm I2V SFX output includes audio stream.
2. Build six source images and label them by image class.
3. Run Round 1 for all moves in I2V.
4. Review contact sheets and score without changing prompts.
5. Run Round 2 for the top image classes.
6. Run Round 3 seed hunt only for prompt winners.
7. Compare I2V, FLF, IA2V on shortlisted recipes.
8. Confirm aspect ratios.
9. Write final recipe cards for all moves.
10. Pin the best result in Camera Lab history and delete failed non-informative runs.

## Current Hypotheses To Prove Or Disprove

- Dolly and truck need depth cues; flat portraits will look like zoom or face morph.
- Pan and tilt are easier on scenes with strong straight lines.
- Roll is seed-sensitive but image-insensitive.
- Orbit is the most sensitive to wording and source depth.
- Foreground Pass is image-dependent; prompt alone will not reliably invent correct foreground parallax.
- IA2V may preserve timing/audio intent but can reduce pure camera-control obedience compared with I2V.
- FLF should improve end-state control but may fight continuous camera motion if the end frame is too different.
