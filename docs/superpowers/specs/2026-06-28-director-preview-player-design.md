# Director Timeline Preview Player — Design

> Status: design (brainstormed 2026-06-28). Implementation plan to follow via writing-plans.
> Branch: `director2`.

## Goal

Add a preview player above the Director timeline plus a playhead pointer on the
timeline. Pressing play (or dragging the playhead) scrubs through the main track:
video segments play, image segments show as a static frame, and the mixed audio
(both lanes, at each clip's volume) plays in sync. This is a **pre-generation
animatic** of the source guides the user has assembled — not the generated result.

## Scope

- **In:** preview player UI above the timeline; a playhead on the timeline;
  play/pause + drag-to-scrub; main-track media playback (video plays / image static /
  text segment shows black + prompt overlay); synced playback of the two audio lanes
  at their per-clip volume; player follows the Director frame aspect ratio.
- **Out (not this feature):** previewing the generated run output; per-frame canvas
  compositing; IC video / reference visualization in the player; waveform display;
  transitions/fades; export of the animatic.

## Background / context

- The Director workspace (`frontend/index.html`, `director-timeline-zone`) has a ruler
  (`#directorRuler`) and four lanes: main (`#directorTrack`), video-audio, dialogue
  (`#directorAudioTrack`), ic-video. There is **no** preview player or playhead today.
- Segment model (`frontend/app.js`): main-track segments carry `start`, `duration`,
  and media (`imagePath`/`imagePreviewUrl`, `videoPath`/`videoPreviewUrl`) or are text;
  audio clips carry `start`, `duration`, `trimStart`, `audioPath`, and `volume` (0–1.5).
- The project is static vanilla JS with separate scripts (`app.js`, `photography.js`,
  `3dmotion/`). New isolated UI is added as its own script exposing a global, consistent
  with that pattern.

## Decisions (from brainstorming)

1. Preview content = **main-track source media animatic** (pre-generation).
2. Playback = **play/pause + drag scrub**, with **mixed audio** in sync.
3. Layout = **player on top, timeline below**.
4. Text/gap frame = **black + overlaid prompt** (falls back to "Text segment").
5. Architecture = **isolated module + requestAnimationFrame clock**.

## Architecture

A new isolated module `frontend/director-preview.js` exposing a global
`DirectorPreview`. `app.js` owns the Director state and feeds the module a flat,
already-resolved view of the timeline; the module owns playback, the displayed frame,
the playhead position, and audio. The module never reads `state` directly — it only
consumes what `setTimeline` is given, so it can be understood and tested in isolation.

### Components

1. **`DirectorPreview` (`frontend/director-preview.js`)**
   - `mount({ playerEl, videoEl, imageEl, overlayEl, playButtonEl, timeReadoutEl, playheadEl, timelineEl })`
     — wire the DOM elements once.
   - `setTimeline({ clips, audioClips, duration, width, height })`
     - `clips`: main-track visible segments, sorted by start:
       `{ start, duration, kind: "video"|"image"|"text", src, prompt }`
       (`src` is a media URL for video/image; "" for text).
     - `audioClips`: both lanes merged: `{ start, duration, trimStart, src, volume }`.
     - `duration`: total timeline seconds; `width`/`height`: frame size for aspect ratio.
   - `play()` / `pause()` / `toggle()` / `seek(t)` — transport.
   - `destroy()` — stop the rAF loop and detach audio.
   - Internals: a `requestAnimationFrame` clock advances `currentTime` while playing;
     each tick calls `renderFrame(t)` and `syncAudio(t)` and positions the playhead.
   - Pure helper (exported on the global for testing):
     `activeClipAt(clips, t) -> { clip, kind }` — the clip covering time `t`
     (last one whose `start <= t < start+duration`), or `{ clip: null, kind: "text" }`.
   - `renderFrame(t)`: resolve `activeClipAt`; for `video` show `videoEl` and seek it to
     `t - clip.start + (clip.trimStart||0)`; for `image` show `imageEl` with `clip.src`;
     for `text`/gap show black with `overlayEl` = `clip?.prompt || "Text segment"`.
     Only one of video/image/overlay is visible at a time.
   - `syncAudio(t)`: maintain one `<audio>` per audio clip (or a small pool); play clips
     whose `[start, start+duration)` covers `t` at `volume` capped to `[0,1]` (HTMLMedia
     cannot boost >1; preview is best-effort), seeking to `t - start + trimStart`; pause
     the rest. On global pause/seek, pause/realign all.

2. **`app.js` integration**
   - In `renderDirectorEditor`, build the module inputs from Director state:
     main-track segments → `clips` (kind by media: video/image/text), both audio lanes
     (video-audio + dialogue, normalized) → `audioClips` with `volume`, total duration
     (`directorOutputDurationSeconds()`), and the current frame size; call
     `DirectorPreview.setTimeline(...)`.
   - Add a **playhead** element over the timeline shell; clicking/dragging on the ruler
     or lanes computes a time and calls `DirectorPreview.seek(t)`.
   - Mount `DirectorPreview` once on first Director render.

3. **`index.html`**
   - Add the preview player container (player + `<video>` + `<img>` + overlay +
     play/pause button + time readout) above `director-timeline-shell`.
   - Add the playhead element inside the timeline shell.
   - Include `<script src="director-preview.js">` before `app.js` (so the global exists).

4. **`frontend/styles.css`**
   - Player box sized by frame aspect ratio; stacked media layers; transport bar;
     a thin vertical playhead line spanning the lanes.

### Data flow

```
Director state (app.js)
  renderDirectorEditor():
    main segments  -> clips [{start,duration,kind,src,prompt}]
    audio lanes    -> audioClips [{start,duration,trimStart,src,volume}]
    duration,size  -> DirectorPreview.setTimeline(...)
        │
   user: Play / drag playhead / click ruler
        ▼
  DirectorPreview rAF clock -> renderFrame(t) + syncAudio(t) + move playhead
```

The module is fed on every Director re-render, so edits (add/move/trim/volume/delete)
are reflected the next time the editor renders; the current `seek` position is preserved
when possible (clamped to the new duration).

## Error handling / edge cases

- Empty timeline (no clips and no audio) → player shows a disabled/empty state; play is a no-op.
- Playhead at/after end → stop at end (pause), clamp `currentTime` to `duration`.
- Text segment or a gap with no covering clip → black frame + prompt/"Text segment".
- Missing/failed media URL → fall back to the black+label frame for that clip (no crash).
- Audio volume > 1 → capped to 1 for preview only (the rendered output still uses the
  server-side gain); volume 0 → muted clip.
- Re-render mid-playback → re-bind inputs without resetting `currentTime` (clamp only).

## Testing

- **Pure helper** `activeClipAt(clips, t)` — driven via Playwright `page.evaluate`:
  overlapping/adjacent clips resolve to the expected clip and kind; empty → text.
- **e2e (Playwright)** in `tests/e2e/home.spec.js`:
  - Seeding a timeline then `DirectorPreview.seek(t)` shows the right layer: video segment
    → `<video>` visible with the segment src; image segment → `<img>`; text/gap → overlay
    with the prompt text.
  - Play button toggles to a playing state and the playhead element moves (position style
    changes after a tick); pause stops it.
  - Playhead drag / ruler click calls seek and updates the displayed frame.
- Existing director e2e must stay green (player mounts without breaking the timeline).

## Risks / notes

- rAF timing is hard to assert exactly in e2e; tests drive `seek()` for determinism and
  assert play/pause *state* + playhead movement rather than wall-clock progress.
- HTMLMediaElement cannot boost volume >1, so loud-clip preview is approximate; this is a
  preview-only limitation and does not affect generated output.
- Audio/video drift across many clips is acceptable for an animatic; no sample-accurate sync.
