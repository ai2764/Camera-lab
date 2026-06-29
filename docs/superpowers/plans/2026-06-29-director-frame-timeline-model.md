# Director Frame Timeline Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace scattered Director timeline editing math with a frame-first timeline model aligned with the original LTXDirector node semantics.

**Architecture:** Add a standalone `DirectorTimelineModel` module that stores all timeline items in frame space (`start`, `length`, `trimStart`) and exposes conversion helpers for the existing seconds-based UI. Keep the current DOM timeline UI for now, but route split, drag, resize, delete, payload, preview, and retake selection through the model so behavior is consistent and testable.

**Tech Stack:** Vanilla JavaScript frontend, Playwright e2e tests, Python pytest for server payload conversion, existing Camera Lab static frontend served by `server/camera_lab_server.py`.

---

## File Structure

- Create: `frontend/director-timeline-model.js`
  - Pure timeline model. No DOM, no app `state`, no ComfyUI calls.
  - Owns frame/seconds conversion, snapping, split/delete/move/resize, trim handling, payload serialization helpers.
- Modify: `frontend/index.html`
  - Load `director-timeline-model.js` before `director-preview.js` and `app.js`.
  - Bump script cache versions.
- Modify: `frontend/app.js`
  - Add adapters between current `state.directorSegments` / `state.directorAudioSegments` / `state.directorVideoAudioSegments` / `state.directorIcVideoSegments` and the frame model.
  - Replace timeline editing functions incrementally: split, delete, drag, resize, collect payload, preview.
- Modify: `frontend/director-preview.js`
  - No broad rewrite. Only adjust if model conversion reveals a playback mismatch.
- Modify: `tests/e2e/home.spec.js`
  - Add model-backed behavioral tests through the UI.
- Create: `tests/e2e/director-timeline-model.spec.js`
  - Browser-level unit tests for the pure model loaded from static assets.
- Modify: `tests/test_director_v2.py`
  - Add server conversion regressions for frame-first audio/video/motion segments if needed.

---

## Design Rules

- Internal timeline math is always frame-based.
- UI display can remain seconds-based.
- Use `fps = 24` unless `state` or payload explicitly supplies another frame rate.
- Snap editing to `0.1s`, implemented as `Math.round(seconds * fps * 10) / 10` converted to frames only at the model boundary. For 24 fps, 0.1s is not always an integer frame, so use rounded frame values and keep display derived from frames.
- Segment shape in model:

```js
{
  id: "seg_1",
  track: "main", // "main" | "video_audio" | "dialogue" | "ic_video"
  kind: "text", // "text" | "image" | "video" | "audio" | "motion_video"
  start: 0,
  length: 48,
  trimStart: 0,
  sourceDuration: 144,
  prompt: "",
  mediaPath: "",
  mediaName: "",
  previewUrl: "",
  posterUrl: "",
  strength: 0.65,
  volume: 1
}
```

- Existing app state remains seconds-based during Phase 1-2 to limit blast radius. The model adapter converts in and out.
- Phase 3 can optionally store frame fields in state after tests prove behavior.

---

### Task 1: Add Pure Frame Timeline Model

**Files:**
- Create: `frontend/director-timeline-model.js`
- Create: `tests/e2e/director-timeline-model.spec.js`
- Modify: `frontend/index.html`

- [x] **Step 1: Write failing browser unit tests for conversion, split, delete, move, resize**

Create `tests/e2e/director-timeline-model.spec.js`:

```js
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.DirectorTimelineModel));
});

test("director timeline model converts seconds state to frame items", async ({ page }) => {
  const result = await page.evaluate(() => {
    return DirectorTimelineModel.fromAppState({
      fps: 24,
      main: [{ id: "seg_1", start: 1.5, duration: 2.5, trimStart: 0.5, prompt: "shot", videoPath: "guide.mp4", videoName: "guide.mp4" }],
      videoAudio: [{ id: "va_1", start: 0, duration: 1, trimStart: 0.25, audioPath: "guide.mp4", audioName: "guide.mp4", audioDuration: 3 }],
      dialogue: [{ id: "aud_1", start: 3, duration: 1.5, trimStart: 0.75, audioPath: "line.wav", audioName: "line.wav", audioDuration: 4 }],
      icVideo: [{ id: "ic_1", start: 4, duration: 2, trimStart: 1, videoPath: "motion.mp4", videoName: "motion.mp4", videoDuration: 8 }],
    });
  });

  expect(result.items.map(({ id, track, kind, start, length, trimStart, sourceDuration }) => ({
    id, track, kind, start, length, trimStart, sourceDuration,
  }))).toEqual([
    { id: "seg_1", track: "main", kind: "video", start: 36, length: 60, trimStart: 12, sourceDuration: 0 },
    { id: "va_1", track: "video_audio", kind: "audio", start: 0, length: 24, trimStart: 6, sourceDuration: 72 },
    { id: "aud_1", track: "dialogue", kind: "audio", start: 72, length: 36, trimStart: 18, sourceDuration: 96 },
    { id: "ic_1", track: "ic_video", kind: "motion_video", start: 96, length: 48, trimStart: 24, sourceDuration: 192 },
  ]);
});

test("director timeline model splits trim-aware clips at a frame", async ({ page }) => {
  const result = await page.evaluate(() => {
    const model = DirectorTimelineModel.create({
      fps: 24,
      items: [{ id: "aud_1", track: "dialogue", kind: "audio", start: 24, length: 96, trimStart: 12, mediaPath: "line.wav" }],
    });
    model.split("dialogue", "aud_1", 60);
    return model.items.map(({ id, start, length, trimStart }) => ({ id, start, length, trimStart }));
  });

  expect(result).toEqual([
    { id: "aud_1", start: 24, length: 36, trimStart: 12 },
    { id: expect.stringMatching(/^aud_1_split_/), start: 60, length: 60, trimStart: 48 },
  ]);
});

test("director timeline model refuses to split image clips", async ({ page }) => {
  const result = await page.evaluate(() => {
    const model = DirectorTimelineModel.create({
      fps: 24,
      items: [{ id: "img_1", track: "main", kind: "image", start: 0, length: 48, mediaPath: "guide.png" }],
    });
    return model.split("main", "img_1", 24);
  });

  expect(result).toBe(false);
});

test("director timeline model moves and resizes in frame space", async ({ page }) => {
  const result = await page.evaluate(() => {
    const model = DirectorTimelineModel.create({
      fps: 24,
      items: [{ id: "seg_1", track: "main", kind: "video", start: 0, length: 48, trimStart: 0 }],
    });
    model.move("main", "seg_1", 12);
    model.resizeLeft("main", "seg_1", 24);
    model.resizeRight("main", "seg_1", 84);
    return model.items.map(({ start, length, trimStart }) => ({ start, length, trimStart }));
  });

  expect(result).toEqual([{ start: 24, length: 60, trimStart: 12 }]);
});

test("director timeline model serializes back to app seconds", async ({ page }) => {
  const result = await page.evaluate(() => {
    const model = DirectorTimelineModel.create({
      fps: 24,
      items: [
        { id: "seg_1", track: "main", kind: "video", start: 24, length: 48, trimStart: 12, prompt: "shot", mediaPath: "guide.mp4", mediaName: "guide.mp4", strength: 0.65 },
        { id: "aud_1", track: "dialogue", kind: "audio", start: 72, length: 24, trimStart: 6, mediaPath: "line.wav", mediaName: "line.wav", sourceDuration: 96, volume: 0.5 },
      ],
    });
    return model.toAppState();
  });

  expect(result.main).toEqual([expect.objectContaining({ id: "seg_1", start: 1, duration: 2, trimStart: 0.5, videoPath: "guide.mp4" })]);
  expect(result.dialogue).toEqual([expect.objectContaining({ id: "aud_1", start: 3, duration: 1, trimStart: 0.25, audioPath: "line.wav", audioDuration: 4, volume: 0.5 })]);
});
```

- [x] **Step 2: Add script tag and verify tests fail because model is missing**

Modify `frontend/index.html` near the bottom before `director-preview.js`:

```html
  <script src="/static/director-timeline-model.js?v=director-frame-model-1"></script>
  <script src="/static/director-preview.js?v=director-key-delete-scroll-1"></script>
  <script src="/static/app.js?v=director-audio-waveform-trim-1"></script>
```

Run:

```powershell
npx playwright test tests/e2e/director-timeline-model.spec.js
```

Expected: FAIL because `/static/director-timeline-model.js` does not exist or `window.DirectorTimelineModel` is missing.

- [x] **Step 3: Implement minimal pure model**

Create `frontend/director-timeline-model.js`:

```js
(function () {
  "use strict";

  const TRACKS = new Set(["main", "video_audio", "dialogue", "ic_video"]);
  const SPLITTABLE_KINDS = new Set(["video", "audio", "motion_video"]);

  function toFrame(seconds, fps) {
    return Math.max(0, Math.round((Number(seconds) || 0) * fps));
  }

  function toSeconds(frames, fps) {
    return Math.round((Math.max(0, Number(frames) || 0) / fps) * 1000) / 1000;
  }

  function makeSplitId(id) {
    return `${id}_split_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function normalizeItem(item, fps) {
    const track = TRACKS.has(item.track) ? item.track : "main";
    const start = Math.max(0, Math.round(Number(item.start) || 0));
    const length = Math.max(1, Math.round(Number(item.length) || 1));
    const trimStart = Math.max(0, Math.round(Number(item.trimStart) || 0));
    const sourceDuration = Math.max(0, Math.round(Number(item.sourceDuration) || 0));
    return {
      id: String(item.id || `item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
      track,
      kind: item.kind || "text",
      start,
      length,
      trimStart,
      sourceDuration,
      prompt: item.prompt || "",
      mediaPath: item.mediaPath || "",
      mediaName: item.mediaName || "",
      previewUrl: item.previewUrl || "",
      posterUrl: item.posterUrl || "",
      strength: Number.isFinite(Number(item.strength)) ? Number(item.strength) : 0.65,
      volume: Number.isFinite(Number(item.volume)) ? Number(item.volume) : 1,
      fps,
    };
  }

  class DirectorTimelineModelImpl {
    constructor({ fps = 24, items = [] } = {}) {
      this.fps = Math.max(1, Math.round(Number(fps) || 24));
      this.items = items.map((item) => normalizeItem(item, this.fps)).sort((a, b) => a.start - b.start);
    }

    find(track, id) {
      return this.items.find((item) => item.track === track && item.id === id) || null;
    }

    split(track, id, frame) {
      const item = this.find(track, id);
      if (!item || !SPLITTABLE_KINDS.has(item.kind)) return false;
      const cut = Math.round(Number(frame) || 0);
      const end = item.start + item.length;
      if (cut <= item.start || cut >= end) return false;
      const leftLength = cut - item.start;
      const rightLength = end - cut;
      const right = normalizeItem({
        ...item,
        id: makeSplitId(item.id),
        start: cut,
        length: rightLength,
        trimStart: item.trimStart + leftLength,
      }, this.fps);
      item.length = leftLength;
      this.items.splice(this.items.indexOf(item) + 1, 0, right);
      this.sort();
      return right.id;
    }

    remove(track, id) {
      const before = this.items.length;
      this.items = this.items.filter((item) => !(item.track === track && item.id === id));
      return this.items.length !== before;
    }

    move(track, id, startFrame) {
      const item = this.find(track, id);
      if (!item) return false;
      item.start = Math.max(0, Math.round(Number(startFrame) || 0));
      this.sort();
      return true;
    }

    resizeLeft(track, id, nextStartFrame) {
      const item = this.find(track, id);
      if (!item) return false;
      const nextStart = Math.max(0, Math.round(Number(nextStartFrame) || 0));
      const end = item.start + item.length;
      if (nextStart >= end - 1) return false;
      const trimDelta = nextStart - item.start;
      item.start = nextStart;
      item.length = end - nextStart;
      item.trimStart = Math.max(0, item.trimStart + trimDelta);
      this.sort();
      return true;
    }

    resizeRight(track, id, nextEndFrame) {
      const item = this.find(track, id);
      if (!item) return false;
      const nextEnd = Math.max(item.start + 1, Math.round(Number(nextEndFrame) || 0));
      item.length = nextEnd - item.start;
      this.sort();
      return true;
    }

    sort() {
      this.items.sort((a, b) => a.start - b.start || a.track.localeCompare(b.track));
    }

    toAppState() {
      const main = [];
      const videoAudio = [];
      const dialogue = [];
      const icVideo = [];
      for (const item of this.items) {
        const common = {
          id: item.id,
          start: toSeconds(item.start, this.fps),
          duration: toSeconds(item.length, this.fps),
          trimStart: toSeconds(item.trimStart, this.fps),
        };
        if (item.track === "main") {
          main.push({
            ...common,
            prompt: item.prompt,
            strength: item.strength,
            imagePath: item.kind === "image" ? item.mediaPath : "",
            imageName: item.kind === "image" ? item.mediaName : "",
            imagePreviewUrl: item.kind === "image" ? item.previewUrl : "",
            videoPath: item.kind === "video" ? item.mediaPath : "",
            videoName: item.kind === "video" ? item.mediaName : "",
            videoPreviewUrl: item.kind === "video" ? item.previewUrl : "",
            videoPosterUrl: item.kind === "video" ? item.posterUrl : "",
          });
        } else if (item.track === "video_audio") {
          videoAudio.push({ ...common, audioPath: item.mediaPath, audioName: item.mediaName, audioDuration: toSeconds(item.sourceDuration, this.fps), volume: item.volume, source: "video" });
        } else if (item.track === "dialogue") {
          dialogue.push({ ...common, audioPath: item.mediaPath, audioName: item.mediaName, audioDuration: toSeconds(item.sourceDuration, this.fps), volume: item.volume });
        } else if (item.track === "ic_video") {
          icVideo.push({ ...common, videoPath: item.mediaPath, videoName: item.mediaName, videoPreviewUrl: item.previewUrl, videoPosterUrl: item.posterUrl, videoDuration: toSeconds(item.sourceDuration, this.fps) });
        }
      }
      return { main, videoAudio, dialogue, icVideo };
    }
  }

  function fromAppState({ fps = 24, main = [], videoAudio = [], dialogue = [], icVideo = [] } = {}) {
    const frameRate = Math.max(1, Math.round(Number(fps) || 24));
    const items = [];
    for (const segment of main) {
      const isVideo = Boolean(segment.videoPath);
      const isImage = Boolean(segment.imagePath);
      items.push({
        id: segment.id,
        track: "main",
        kind: isVideo ? "video" : (isImage ? "image" : "text"),
        start: toFrame(segment.start, frameRate),
        length: Math.max(1, toFrame(segment.duration || 0.5, frameRate)),
        trimStart: toFrame(segment.trimStart, frameRate),
        prompt: segment.prompt || "",
        mediaPath: isVideo ? segment.videoPath : (isImage ? segment.imagePath : ""),
        mediaName: isVideo ? segment.videoName : (isImage ? segment.imageName : ""),
        previewUrl: isVideo ? segment.videoPreviewUrl : (isImage ? segment.imagePreviewUrl : ""),
        posterUrl: segment.videoPosterUrl || "",
        strength: segment.strength,
      });
    }
    for (const segment of videoAudio) {
      items.push({
        id: segment.id,
        track: "video_audio",
        kind: "audio",
        start: toFrame(segment.start, frameRate),
        length: Math.max(1, toFrame(segment.duration || 0.5, frameRate)),
        trimStart: toFrame(segment.trimStart, frameRate),
        sourceDuration: toFrame(segment.audioDuration, frameRate),
        mediaPath: segment.audioPath,
        mediaName: segment.audioName,
        volume: segment.volume,
      });
    }
    for (const segment of dialogue) {
      items.push({
        id: segment.id,
        track: "dialogue",
        kind: "audio",
        start: toFrame(segment.start, frameRate),
        length: Math.max(1, toFrame(segment.duration || 0.5, frameRate)),
        trimStart: toFrame(segment.trimStart, frameRate),
        sourceDuration: toFrame(segment.audioDuration, frameRate),
        mediaPath: segment.audioPath,
        mediaName: segment.audioName,
        volume: segment.volume,
      });
    }
    for (const segment of icVideo) {
      items.push({
        id: segment.id,
        track: "ic_video",
        kind: "motion_video",
        start: toFrame(segment.start, frameRate),
        length: Math.max(1, toFrame(segment.duration || 0.5, frameRate)),
        trimStart: toFrame(segment.trimStart, frameRate),
        sourceDuration: toFrame(segment.videoDuration, frameRate),
        mediaPath: segment.videoPath,
        mediaName: segment.videoName,
        previewUrl: segment.videoPreviewUrl,
        posterUrl: segment.videoPosterUrl,
      });
    }
    return new DirectorTimelineModelImpl({ fps: frameRate, items });
  }

  window.DirectorTimelineModel = {
    create: (options) => new DirectorTimelineModelImpl(options),
    fromAppState,
    toFrame,
    toSeconds,
  };
})();
```

- [x] **Step 4: Run model tests**

Run:

```powershell
npx playwright test tests/e2e/director-timeline-model.spec.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/director-timeline-model.js frontend/index.html tests/e2e/director-timeline-model.spec.js
git commit -m "feat: add director frame timeline model"
```

---

### Task 2: Route Split/Delete Through Frame Model

**Files:**
- Modify: `frontend/app.js`
- Modify: `tests/e2e/home.spec.js`

- [x] **Step 1: Add failing UI regressions for model-backed split/delete**

Append to the existing Director timeline tests in `tests/e2e/home.spec.js`:

```js
test("director frame model preserves audio clip lengths after repeated split and delete", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{ id: "seg_anchor", start: 0, duration: 8, prompt: "anchor", reference: "", imagePath: "", imageName: "", imagePreviewUrl: "", strength: 0.65 }];
    state.directorAudioSegments = [{ id: "aud_chain", start: 1, duration: 6, trimStart: 0.5, audioPath: "fixtures/line.wav", audioName: "line.wav", audioDuration: 10, volume: 1 }];
    state.directorVideoAudioSegments = [];
    state.directorIcVideoSegments = [];
    state.directorSelectedId = "aud_chain";
    state.directorSelectionType = "audio";
    renderDirectorEditor();
    DirectorPreview.seek(3);
  });

  await page.locator("#directorCutAtPlayheadBtn").click();
  await page.evaluate(() => {
    state.directorSelectedId = state.directorAudioSegments[1].id;
    state.directorSelectionType = "audio";
    renderDirectorEditor();
    DirectorPreview.seek(5);
  });
  await page.locator("#directorCutAtPlayheadBtn").click();

  expect(await page.evaluate(() => state.directorAudioSegments.map(({ start, duration, trimStart }) => ({ start, duration, trimStart })))).toEqual([
    { start: 1, duration: 2, trimStart: 0.5 },
    { start: 3, duration: 2, trimStart: 2.5 },
    { start: 5, duration: 2, trimStart: 4.5 },
  ]);

  await page.evaluate(() => {
    state.directorSelectedId = state.directorAudioSegments[1].id;
    state.directorSelectionType = "audio";
    renderDirectorEditor();
  });
  await page.keyboard.press("Delete");

  expect(await page.evaluate(() => state.directorAudioSegments.map(({ start, duration, trimStart }) => ({ start, duration, trimStart })))).toEqual([
    { start: 1, duration: 2, trimStart: 0.5 },
    { start: 5, duration: 2, trimStart: 4.5 },
  ]);
});
```

- [x] **Step 2: Run the test and verify it fails before routing through model**

Run:

```powershell
npx playwright test tests/e2e/home.spec.js -g "director frame model preserves audio clip lengths"
```

Expected before implementation: FAIL if current split/delete drifts or if model is not used. If it passes, keep it as a regression and continue implementation because the goal is architecture convergence.

- [x] **Step 3: Add app/model adapter helpers**

In `frontend/app.js`, add near `normalizedDirectorVideoAudioSegments()`:

```js
function directorTimelineFps() {
  return 24;
}

function createDirectorTimelineModelFromState() {
  if (!window.DirectorTimelineModel) return null;
  return DirectorTimelineModel.fromAppState({
    fps: directorTimelineFps(),
    main: state.directorSegments,
    videoAudio: state.directorVideoAudioSegments,
    dialogue: state.directorAudioSegments,
    icVideo: state.directorIcVideoSegments,
  });
}

function applyDirectorTimelineModelToState(model) {
  if (!model) return;
  const next = model.toAppState();
  state.directorSegments = next.main;
  state.directorVideoAudioSegments = next.videoAudio;
  state.directorAudioSegments = next.dialogue;
  state.directorIcVideoSegments = next.icVideo;
}

function directorTrackForSelectionType(type = state.directorSelectionType) {
  if (type === "audio") return "dialogue";
  if (type === "video_audio") return "video_audio";
  if (type === "ic_video") return "ic_video";
  return "main";
}
```

- [x] **Step 4: Replace split implementation**

Replace `splitSelectedDirectorSegmentAtPlayhead()` body with:

```js
function splitSelectedDirectorSegmentAtPlayhead() {
  if (!selectedDirectorSegmentCanSplit()) return false;
  const model = createDirectorTimelineModelFromState();
  if (!model) return false;
  const cutFrame = DirectorTimelineModel.toFrame(Number(window.DirectorPreview?._state?.().currentTime) || 0, directorTimelineFps());
  const track = directorTrackForSelectionType();
  const newId = model.split(track, state.directorSelectedId, cutFrame);
  if (!newId) return false;
  applyDirectorTimelineModelToState(model);
  state.directorSelectedId = newId;
  renderDirectorEditor();
  $("runHint").textContent = "Selected timeline clip split at playhead";
  return true;
}
```

- [x] **Step 5: Replace selected delete implementation**

Replace `removeSelectedDirectorTimelineItem()` with:

```js
function removeSelectedDirectorTimelineItem() {
  if (!state.directorSelectedId) return false;
  const model = createDirectorTimelineModelFromState();
  if (!model) return false;
  const removed = model.remove(directorTrackForSelectionType(), state.directorSelectedId);
  if (!removed) return false;
  applyDirectorTimelineModelToState(model);
  state.directorSelectionType = "image";
  state.directorSelectedId = state.directorSegments[0]?.id || "";
  renderDirectorEditor();
  return true;
}
```

- [x] **Step 6: Run focused tests**

Run:

```powershell
node --check frontend/app.js
npx playwright test tests/e2e/director-timeline-model.spec.js
npx playwright test tests/e2e/home.spec.js -g "director frame model preserves audio clip lengths|director playhead scissors preserves trim offsets|director selected timeline segments can be deleted"
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```powershell
git add frontend/app.js tests/e2e/home.spec.js
git commit -m "refactor: route director split delete through frame model"
```

---

### Task 3: Route Drag/Resize Through Frame Model

**Files:**
- Modify: `frontend/app.js`
- Modify: `tests/e2e/home.spec.js`

- [x] **Step 1: Add failing drag/resize tests that assert frame-derived seconds**

Add to `tests/e2e/home.spec.js`:

```js
test("director frame model drag preserves audio trim and duration", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{ id: "seg_anchor", start: 0, duration: 10, prompt: "anchor", reference: "", imagePath: "", imageName: "", imagePreviewUrl: "", strength: 0.65 }];
    state.directorAudioSegments = [{ id: "aud_drag_model", start: 1, duration: 2, trimStart: 3, audioPath: "fixtures/line.wav", audioName: "line.wav", audioDuration: 12 }];
    state.directorSelectedId = "aud_drag_model";
    state.directorSelectionType = "audio";
    renderDirectorEditor();
  });

  const block = page.locator("#directorAudioTrack .director-audio-block").first();
  const box = await block.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 96, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();

  const seg = await page.evaluate(() => state.directorAudioSegments.find((item) => item.id === "aud_drag_model"));
  expect(seg.duration).toBe(2);
  expect(seg.trimStart).toBe(3);
  expect(seg.start).toBeGreaterThan(1);
});

test("director frame model resize left advances video trim", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{ id: "seg_resize_model", start: 0, duration: 4, trimStart: 1, prompt: "video", reference: "", videoPath: "fixtures/guide.mp4", videoName: "guide.mp4", videoPreviewUrl: "/media/fixtures/guide.mp4", strength: 0.65 }];
    state.directorSelectedId = "seg_resize_model";
    state.directorSelectionType = "image";
    renderDirectorEditor();
  });

  const block = page.locator("#directorTrack .director-block").first();
  const box = await block.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();

  const seg = await page.evaluate(() => state.directorSegments[0]);
  expect(seg.start).toBeGreaterThan(0);
  expect(seg.duration).toBeLessThan(4);
  expect(seg.trimStart).toBeGreaterThan(1);
});
```

- [x] **Step 2: Run tests to get current behavior**

Run:

```powershell
npx playwright test tests/e2e/home.spec.js -g "director frame model drag|director frame model resize"
```

Expected: tests may PASS already for simple cases. Keep them as regression before replacing code.

- [x] **Step 3: Replace `onDirectorDrag()` mutation with model operations**

In `frontend/app.js`, update `onDirectorDrag(event)` so it computes frame deltas and calls the model:

```js
function onDirectorDrag(event) {
  const drag = state.directorDrag;
  if (!drag) return;
  const model = createDirectorTimelineModelFromState();
  if (!model) return;
  const deltaSeconds = ((event.clientX - drag.startX) / Math.max(1, drag.rect.width)) * drag.total;
  const deltaFrames = DirectorTimelineModel.toFrame(deltaSeconds, directorTimelineFps());
  if (Math.abs(event.clientX - drag.startX) > 3) drag.moved = true;
  const track = directorTrackForSelectionType(drag.type === "audio" ? "audio" : drag.type);
  const originalStartFrame = DirectorTimelineModel.toFrame(drag.originalStart, directorTimelineFps());
  const originalDurationFrame = Math.max(1, DirectorTimelineModel.toFrame(drag.originalDuration, directorTimelineFps()));
  if (drag.type === "image" && drag.edge === "left") {
    model.resizeLeft(track, drag.id, originalStartFrame + deltaFrames);
  } else if (drag.type === "image" && drag.edge === "right") {
    model.resizeRight(track, drag.id, originalStartFrame + originalDurationFrame + deltaFrames);
  } else {
    model.move(track, drag.id, originalStartFrame + deltaFrames);
  }
  applyDirectorTimelineModelToState(model);
  renderDirectorTimelineOnly();
}
```

If `directorTrackForSelectionType()` does not map drag type strings correctly, replace the track line with:

```js
  const track = drag.type === "audio" ? "dialogue" : drag.type === "video_audio" ? "video_audio" : drag.type === "ic_video" ? "ic_video" : "main";
```

- [x] **Step 4: Run focused drag/resize tests**

Run:

```powershell
node --check frontend/app.js
npx playwright test tests/e2e/home.spec.js -g "director frame model drag|director frame model resize|director segment drag uses tenth-second snapping|director segment resize uses tenth-second snapping|director video audio segment drag moves only that clip"
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/app.js tests/e2e/home.spec.js
git commit -m "refactor: route director drag resize through frame model"
```

---

### Task 4: Route Payload and Preview Through Frame Model

**Files:**
- Modify: `frontend/app.js`
- Modify: `tests/e2e/home.spec.js`
- Modify: `tests/test_director_v2.py`

- [x] **Step 1: Add payload regression for all four tracks**

Add to `tests/e2e/home.spec.js`:

```js
test("director frame model serializes payload for all timeline tracks", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{ id: "seg_payload", start: 1, duration: 2, trimStart: 0.5, prompt: "video", reference: "", videoPath: "fixtures/guide.mp4", videoName: "guide.mp4", strength: 0.7 }];
    state.directorVideoAudioSegments = [{ id: "va_payload", start: 1, duration: 2, trimStart: 0.5, audioPath: "fixtures/guide.mp4", audioName: "guide.mp4", audioDuration: 5, source: "video" }];
    state.directorAudioSegments = [{ id: "aud_payload", start: 3, duration: 1.5, trimStart: 1, audioPath: "fixtures/line.wav", audioName: "line.wav", audioDuration: 5, volume: 0.8 }];
    state.directorIcVideoSegments = [{ id: "ic_payload", start: 2, duration: 3, trimStart: 0.25, videoPath: "fixtures/motion.mp4", videoName: "motion.mp4", videoDuration: 8 }];
    renderDirectorEditor();
  });

  const payload = await page.evaluate(() => collectPayload());
  expect(payload.timeline_segments).toEqual([
    expect.objectContaining({ id: "seg_payload", start: 1, duration: 2, trim_start: 12, type: "video" }),
  ]);
  expect(payload.audio_segments).toEqual([
    expect.objectContaining({ id: "va_payload", source: "video", start: 1, duration: 2, trim_start: 12 }),
    expect.objectContaining({ id: "aud_payload", start: 3, duration: 1.5, trim_start: 24, volume: 0.8 }),
  ]);
  expect(payload.motion_segments).toEqual([
    expect.objectContaining({ id: "ic_payload", start: 2, duration: 3, trim_start: 6 }),
  ]);
});
```

- [x] **Step 2: Run payload test before implementation**

Run:

```powershell
npx playwright test tests/e2e/home.spec.js -g "director frame model serializes payload"
```

Expected: likely PASS with current code. Keep as regression while routing through model.

- [x] **Step 3: Add frame-model payload helpers**

In `frontend/app.js`, add near `collectDirectorSegments()`:

```js
function directorModelForPayload() {
  return createDirectorTimelineModelFromState();
}
```

Then update `collectDirectorSegments()`, `collectDirectorAudioSegments()`, and `collectDirectorMotionSegments()` to build from `directorModelForPayload().items` when model exists, falling back to current normalized functions if missing.

Use this pattern for `collectDirectorAudioSegments()`:

```js
function collectDirectorAudioSegments() {
  syncDirectorVideoAudioSegments();
  const model = directorModelForPayload();
  if (model) {
    return model.items
      .filter((item) => (item.track === "video_audio" || item.track === "dialogue") && item.mediaPath)
      .map((item) => ({
        id: item.id,
        ...(item.track === "video_audio" ? { source: "video" } : {}),
        audio_path: item.mediaPath,
        start: DirectorTimelineModel.toSeconds(item.start, model.fps),
        duration: DirectorTimelineModel.toSeconds(item.length, model.fps),
        trim_start: item.trimStart,
        volume: Math.max(0, Number(item.volume ?? 1)),
      }))
      .sort((a, b) => a.start - b.start);
  }
  // existing implementation remains below as fallback
}
```

Use equivalent logic for main and IC video:

```js
trim_start: item.trimStart
start: DirectorTimelineModel.toSeconds(item.start, model.fps)
duration: DirectorTimelineModel.toSeconds(item.length, model.fps)
```

- [x] **Step 4: Update preview builders to use frame model**

Update `directorPreviewClips()` and `directorPreviewAudioClips()` to read from model when available. Example for audio:

```js
function directorPreviewAudioClips() {
  if (state.directorMode === "retake") return [];
  const model = createDirectorTimelineModelFromState();
  if (model) {
    return model.items
      .filter((item) => (item.track === "video_audio" || item.track === "dialogue") && item.mediaPath)
      .map((item) => ({
        start: DirectorTimelineModel.toSeconds(item.start, model.fps),
        duration: DirectorTimelineModel.toSeconds(item.length, model.fps),
        trimStart: DirectorTimelineModel.toSeconds(item.trimStart, model.fps),
        src: mediaUrl(item.mediaPath),
        volume: Math.max(0, Number(item.volume ?? 1)),
      }));
  }
  // existing fallback remains
}
```

- [x] **Step 5: Run frontend and server tests**

Run:

```powershell
node --check frontend/app.js
npx playwright test tests/e2e/director-timeline-model.spec.js
npx playwright test tests/e2e/home.spec.js -g "director frame model serializes payload|director editor feeds the preview|director playhead scissors preserves trim offsets|director video audio lane can add library audio clips"
python -m pytest -p no:cacheprovider tests/test_director_v2.py -k "audio_segments or motion_segments or retake" -q
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```powershell
git add frontend/app.js tests/e2e/home.spec.js tests/test_director_v2.py
git commit -m "refactor: serialize director timeline from frame model"
```

---

### Task 5: Retake Selection Uses Frame Model Semantics

**Files:**
- Modify: `frontend/director-timeline-model.js`
- Modify: `frontend/app.js`
- Modify: `tests/e2e/director-timeline-model.spec.js`
- Modify: `tests/e2e/home.spec.js`

- [x] **Step 1: Add model tests for retake range**

Append to `tests/e2e/director-timeline-model.spec.js`:

```js
test("director timeline model clamps retake range in frames", async ({ page }) => {
  const result = await page.evaluate(() => {
    const range = DirectorTimelineModel.clampRange({ start: 90, length: 80, total: 120, minLength: 3 });
    return range;
  });
  expect(result).toEqual({ start: 90, length: 30 });
});
```

- [x] **Step 2: Verify test fails**

Run:

```powershell
npx playwright test tests/e2e/director-timeline-model.spec.js -g "clamps retake"
```

Expected: FAIL because `clampRange` is missing.

- [x] **Step 3: Add `clampRange` to model**

In `frontend/director-timeline-model.js`, add:

```js
function clampRange({ start = 0, length = 1, total = 1, minLength = 1 } = {}) {
  const safeTotal = Math.max(minLength, Math.round(Number(total) || minLength));
  const safeMin = Math.max(1, Math.round(Number(minLength) || 1));
  const safeStart = Math.max(0, Math.min(safeTotal - safeMin, Math.round(Number(start) || 0)));
  const safeLength = Math.max(safeMin, Math.min(safeTotal - safeStart, Math.round(Number(length) || safeMin)));
  return { start: safeStart, length: safeLength };
}
```

Expose it:

```js
window.DirectorTimelineModel = {
  create: (options) => new DirectorTimelineModelImpl(options),
  fromAppState,
  toFrame,
  toSeconds,
  clampRange,
};
```

- [x] **Step 4: Route retake selection updates through `clampRange`**

In `frontend/app.js`, update retake selection setters and drag handlers so they convert seconds to frames, clamp, then convert back:

```js
function setDirectorRetakeRangeFromFrames(startFrame, lengthFrame, totalFrame) {
  const range = DirectorTimelineModel.clampRange({
    start: startFrame,
    length: lengthFrame,
    total: totalFrame,
    minLength: Math.max(1, DirectorTimelineModel.toFrame(0.1, directorTimelineFps())),
  });
  state.directorRetakeStart = DirectorTimelineModel.toSeconds(range.start, directorTimelineFps());
  state.directorRetakeLength = DirectorTimelineModel.toSeconds(range.length, directorTimelineFps());
}
```

Call this helper from existing `{`, `}`, retake selection drag, and handle resize logic.

- [x] **Step 5: Run retake tests**

Run:

```powershell
node --check frontend/app.js
npx playwright test tests/e2e/director-timeline-model.spec.js -g "clamps retake"
npx playwright test tests/e2e/home.spec.js -g "director retake selection can be dragged|director retake selection handles|director retake result card shows|director retake prompt"
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```powershell
git add frontend/director-timeline-model.js frontend/app.js tests/e2e/director-timeline-model.spec.js tests/e2e/home.spec.js
git commit -m "refactor: clamp director retake range in frame model"
```

---

### Task 6: Remove Duplicate Timeline Math and Document Contract

**Files:**
- Modify: `frontend/app.js`
- Modify: `docs/superpowers/specs/2026-06-28-director-v2-timeline-audio-design.md`
- Modify: `docs/superpowers/plans/2026-06-29-director-frame-timeline-model.md`

- [x] **Step 1: Search for direct timeline math**

Run:

```powershell
rg -n "trimStart|duration \\+|start \\+|roundTenth|roundHalf|directorPreciseTime|directorSelectionType|directorAudioSegments|directorVideoAudioSegments|directorIcVideoSegments" frontend/app.js frontend/director-preview.js
```

Expected: identify remaining direct mutations outside render-only and adapter code.

- [x] **Step 2: Keep render math, remove duplicate edit math**

In `frontend/app.js`, direct mutation is allowed only in:

```js
addDirectorSegment
addDirectorAudioClip
addDirectorVideoAudioClip
addDirectorIcVideoSegment
applyDirectorTimelineModelToState
renderDirectorEditor
renderDirectorTimelineOnly
collectPayload helpers
```

Replace any remaining split/drag/delete/retake math with calls to model helpers.

- [x] **Step 3: Document the contract**

Append to `docs/superpowers/specs/2026-06-28-director-v2-timeline-audio-design.md`:

```markdown
## Director Timeline Model Contract

- Camera Lab Director editing logic uses a frame-first model that mirrors LTXDirector `timeline_data`.
- Internal model fields are `start`, `length`, and `trimStart` in frames.
- UI state may expose `start`, `duration`, and `trimStart` in seconds, but editing operations must convert to the frame model first.
- Splitting media clips advances the right clip `trimStart` by the left clip length.
- Image clips are not splittable.
- Audio, video-audio, main video, and IC video clips are splittable.
- Payload `trim_start` is emitted in frames.
- Payload `start` and `duration` remain seconds for Camera Lab server compatibility.
```

- [x] **Step 4: Run full focused verification**

Run:

```powershell
node --check frontend/director-timeline-model.js
node --check frontend/director-preview.js
node --check frontend/app.js
npx playwright test tests/e2e/director-timeline-model.spec.js
npx playwright test tests/e2e/home.spec.js -g "director timeline|director playhead|director retake|director video audio|director selected timeline|director frame model"
python -m pytest -p no:cacheprovider tests/test_director_reference.py tests/test_director_v2.py -q
git diff --check
```

Expected:
- JS checks pass.
- New model tests pass.
- Focused Director e2e pass.
- Python Director tests pass.
- `git diff --check` has no whitespace errors; LF/CRLF warnings are acceptable in this repo.

- [x] **Step 5: Restart local app**

Run:

```powershell
python scripts/start_camera_lab.py --port 1234 --restart
```

Expected:

```text
Camera Lab: http://127.0.0.1:1234
ComfyUI: online (http://127.0.0.1:8188)
```

- [ ] **Step 6: Commit**

```powershell
git add frontend/app.js docs/superpowers/specs/2026-06-28-director-v2-timeline-audio-design.md docs/superpowers/plans/2026-06-29-director-frame-timeline-model.md
git commit -m "docs: document director frame timeline contract"
```

---

## Self-Review

**Spec coverage:** This plan addresses the bug source identified from the original LTXDirector node: frame-first timeline state, unified tracks, split/drag/resize/delete/payload/preview/retake operations, and tests for all four tracks.

**Placeholder scan:** No TBD/TODO placeholders. Every task has concrete files, code snippets, commands, and expected results.

**Type consistency:** Model uses `track`, `kind`, `start`, `length`, `trimStart`, and `sourceDuration` consistently. App adapters preserve existing state field names: `duration`, `audioDuration`, `videoDuration`, `videoPath`, `audioPath`, `trimStart`.

**Known constraint:** Directly copying `WhatDreamsCost-ComfyUI/js/ltx_director.js` is avoided because the source project is GPL-3.0. This plan recreates the behavior contract with a small local model instead of vendoring the original editor.
