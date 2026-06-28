# Director Timeline Preview Player Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pre-generation preview player above the Director timeline with a playhead: video segments play, images show static, text/gaps show black + prompt, and the two audio lanes play in sync at their per-clip volume.

**Architecture:** A new isolated global module `frontend/director-preview.js` (`DirectorPreview`) owns the player DOM, a requestAnimationFrame clock, frame rendering, the playhead, and audio. `app.js` resolves Director state into a flat `{clips, audioClips, duration, width, height}` view (URLs already resolved via `mediaUrl`) and feeds it through `DirectorPreview.setTimeline(...)`; the module never reads `state`.

**Tech Stack:** Static vanilla JS (no bundler), HTML/CSS, Playwright e2e (`page.evaluate` drives the module deterministically via `seek`).

## Global Constraints

- The module is standalone: it consumes only what `setTimeline` is given; it must not reference `state`, `$`, or any `app.js` global.
- Script load order: `director-preview.js` is included **before** `app.js` so the `DirectorPreview` global exists when `app.js` mounts it. Files are served from `/static/`.
- Preview content = main-track source media (pre-generation), not the generated run.
- Frame for text segments / gaps = black background + the segment's `prompt` (fallback text "Text segment").
- Audio preview volume is capped to `[0,1]` (HTMLMediaElement cannot boost > 1); the generated output still uses the server-side gain.
- Only one visual layer (video / image / text-overlay) is visible at a time.
- Do not break existing Director e2e (`tests/e2e/home.spec.js`).

---

## File Structure

- `frontend/director-preview.js` — **create**: the `DirectorPreview` global (clip resolution, frame rendering, rAF clock, playhead, audio).
- `frontend/index.html` — **modify**: add the player container + playhead markup above `director-timeline-shell`; include `director-preview.js` before `app.js`.
- `frontend/styles.css` — **modify**: player aspect-ratio box, stacked media layers, transport bar, playhead line.
- `frontend/app.js` — **modify**: in `renderDirectorEditor`, build the flat timeline view and call `DirectorPreview.setTimeline`; mount once; wire ruler click/drag → `seek`.
- `tests/e2e/home.spec.js` — **modify**: seek-driven preview tests.

---

### Task 1: Preview module — clip resolution + frame rendering

**Files:**
- Create: `frontend/director-preview.js`
- Modify: `frontend/index.html` (player markup + script include), `frontend/styles.css`
- Test: `tests/e2e/home.spec.js`

**Interfaces:**
- Produces global `DirectorPreview` with:
  - `activeClipAt(clips, t) -> { clip, kind }` — last clip with `start <= t < start+duration`; `{clip:null, kind:"text"}` if none.
  - `mount(els)` where `els = { playerEl, videoEl, imageEl, overlayEl, playButtonEl, timeReadoutEl, playheadEl, timelineEl }` (idempotent — safe to call repeatedly).
  - `setTimeline({ clips, audioClips, duration, width, height })`; `clips` = `[{start,duration,kind:"video"|"image"|"text",src,prompt,trimStart}]`.
  - `seek(t)`, `renderFrame(t)`.
- Consumes: nothing.

- [ ] **Step 1: Create the module with `activeClipAt`, `mount`, `setTimeline`, `seek`, `renderFrame`**

Create `frontend/director-preview.js`:

```javascript
(function () {
  "use strict";

  function activeClipAt(clips, t) {
    let found = null;
    for (const clip of clips || []) {
      const start = Number(clip.start) || 0;
      const end = start + (Number(clip.duration) || 0);
      if (t >= start && t < end) found = clip; // last covering clip wins
    }
    return { clip: found, kind: found ? found.kind : "text" };
  }

  const els = {};
  let timeline = { clips: [], audioClips: [], duration: 0, width: 16, height: 9 };
  let currentTime = 0;

  function mount(nextEls) {
    Object.assign(els, nextEls || {});
    if (els.playerEl && timeline.width && timeline.height) {
      els.playerEl.style.aspectRatio = `${timeline.width} / ${timeline.height}`;
    }
  }

  function setTimeline(next) {
    timeline = {
      clips: (next && next.clips) || [],
      audioClips: (next && next.audioClips) || [],
      duration: Math.max(0, Number(next && next.duration) || 0),
      width: Number(next && next.width) || 16,
      height: Number(next && next.height) || 9,
    };
    if (els.playerEl) els.playerEl.style.aspectRatio = `${timeline.width} / ${timeline.height}`;
    currentTime = Math.min(currentTime, timeline.duration);
    renderFrame(currentTime);
  }

  function show(el, visible) {
    if (el) el.style.display = visible ? "" : "none";
  }

  function renderFrame(t) {
    const { clip, kind } = activeClipAt(timeline.clips, t);
    if (kind === "video" && clip && clip.src) {
      if (els.videoEl && els.videoEl.getAttribute("src") !== clip.src) els.videoEl.setAttribute("src", clip.src);
      if (els.videoEl) {
        const into = Math.max(0, t - (Number(clip.start) || 0) + (Number(clip.trimStart) || 0));
        try { if (Math.abs(els.videoEl.currentTime - into) > 0.05) els.videoEl.currentTime = into; } catch (e) {}
      }
      show(els.videoEl, true); show(els.imageEl, false); show(els.overlayEl, false);
    } else if (kind === "image" && clip && clip.src) {
      if (els.imageEl) els.imageEl.setAttribute("src", clip.src);
      show(els.imageEl, true); show(els.videoEl, false); show(els.overlayEl, false);
    } else {
      if (els.overlayEl) els.overlayEl.textContent = (clip && clip.prompt) || "Text segment";
      show(els.overlayEl, true); show(els.videoEl, false); show(els.imageEl, false);
    }
    if (els.timeReadoutEl) els.timeReadoutEl.textContent = `${t.toFixed(1)}s / ${timeline.duration.toFixed(1)}s`;
  }

  function seek(t) {
    currentTime = Math.max(0, Math.min(Number(t) || 0, timeline.duration));
    renderFrame(currentTime);
  }

  window.DirectorPreview = {
    activeClipAt,
    mount,
    setTimeline,
    seek,
    renderFrame,
    _state: () => ({ currentTime, timeline }),
  };
})();
```

- [ ] **Step 2: Add the player markup and script include to `index.html`**

In `frontend/index.html`, immediately inside `director-main-editor` and before
`<div class="director-timeline-shell">` (line 333), insert:

```html
              <div class="director-preview" id="directorPreview">
                <div class="director-preview-stage">
                  <video id="directorPreviewVideo" class="director-preview-media" muted playsinline preload="metadata" style="display:none"></video>
                  <img id="directorPreviewImage" class="director-preview-media" alt="Timeline preview" style="display:none">
                  <div id="directorPreviewOverlay" class="director-preview-overlay" style="display:none"></div>
                </div>
                <div class="director-preview-transport">
                  <button id="directorPreviewPlay" type="button" aria-label="Play preview">▶</button>
                  <span id="directorPreviewTime" class="director-preview-time">0.0s / 0.0s</span>
                </div>
              </div>
```

Then change the script include (line 981) from:

```html
  <script src="/static/app.js?v=late-preview-poll-1"></script>
```

to:

```html
  <script src="/static/director-preview.js?v=preview-player-1"></script>
  <script src="/static/app.js?v=late-preview-poll-1"></script>
```

- [ ] **Step 3: Add minimal CSS**

Append to `frontend/styles.css`:

```css
.director-preview {
  margin-bottom: 12px;
}

.director-preview-stage {
  position: relative;
  width: 100%;
  max-width: 480px;
  aspect-ratio: 16 / 9;
  background: #000;
  border-radius: 8px;
  overflow: hidden;
}

.director-preview-media,
.director-preview-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.director-preview-media {
  object-fit: contain;
}

.director-preview-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  text-align: center;
  color: #ddd;
  font-size: 13px;
}

.director-preview-transport {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
}
```

- [ ] **Step 4: Write the failing e2e test for frame rendering**

Append to `tests/e2e/home.spec.js`:

```javascript
test("director preview shows video, image, and text frames by seek position", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await page.evaluate(() => {
    DirectorPreview.mount({
      playerEl: document.getElementById("directorPreview"),
      videoEl: document.getElementById("directorPreviewVideo"),
      imageEl: document.getElementById("directorPreviewImage"),
      overlayEl: document.getElementById("directorPreviewOverlay"),
      playButtonEl: document.getElementById("directorPreviewPlay"),
      timeReadoutEl: document.getElementById("directorPreviewTime"),
    });
    DirectorPreview.setTimeline({
      duration: 6,
      width: 1280,
      height: 720,
      clips: [
        { start: 0, duration: 2, kind: "video", src: "/static/app.js", trimStart: 0 },
        { start: 2, duration: 2, kind: "image", src: "/favicon.ico" },
        { start: 4, duration: 2, kind: "text", src: "", prompt: "a quiet street" },
      ],
      audioClips: [],
    });
  });

  await page.evaluate(() => DirectorPreview.seek(0.5));
  await expect(page.locator("#directorPreviewVideo")).toBeVisible();
  await expect(page.locator("#directorPreviewImage")).toBeHidden();

  await page.evaluate(() => DirectorPreview.seek(2.5));
  await expect(page.locator("#directorPreviewImage")).toBeVisible();
  await expect(page.locator("#directorPreviewVideo")).toBeHidden();

  await page.evaluate(() => DirectorPreview.seek(5));
  await expect(page.locator("#directorPreviewOverlay")).toBeVisible();
  await expect(page.locator("#directorPreviewOverlay")).toHaveText("a quiet street");
});
```

- [ ] **Step 5: Run the test**

Run: `npx playwright test tests/e2e/home.spec.js --grep "preview shows video, image, and text" --reporter=line`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/director-preview.js frontend/index.html frontend/styles.css tests/e2e/home.spec.js
git commit -m "feat: director preview player frame rendering"
```

---

### Task 2: Playhead + play/pause clock + scrub

**Files:**
- Modify: `frontend/director-preview.js`, `frontend/index.html`, `frontend/styles.css`
- Test: `tests/e2e/home.spec.js`

**Interfaces:**
- Consumes: Task 1 `DirectorPreview` (mount/setTimeline/seek/renderFrame).
- Produces: `play()`, `pause()`, `toggle()`, `isPlaying()`; playhead positioned via `els.playheadEl` over `els.timelineEl`; `seekFromPointer(clientX)` maps a timeline click to a seek.

- [ ] **Step 1: Add the playhead element + the timeline ref**

In `frontend/index.html`, inside `director-timeline-shell` (after `<div class="director-ruler" id="directorRuler"></div>`, line 341), add:

```html
                <div class="director-playhead" id="directorPlayhead" style="left:0%"></div>
```

Append to `frontend/styles.css`:

```css
.director-timeline-shell { position: relative; }

.director-playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #ff5a5a;
  pointer-events: none;
  z-index: 5;
}
```

- [ ] **Step 2: Write the failing e2e test for play/pause + playhead**

Append to `tests/e2e/home.spec.js`:

```javascript
test("director preview play toggles state and advances the playhead", async ({ page }) => {
  await page.goto("/");
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    DirectorPreview.mount({
      playerEl: document.getElementById("directorPreview"),
      videoEl: document.getElementById("directorPreviewVideo"),
      imageEl: document.getElementById("directorPreviewImage"),
      overlayEl: document.getElementById("directorPreviewOverlay"),
      playButtonEl: document.getElementById("directorPreviewPlay"),
      timeReadoutEl: document.getElementById("directorPreviewTime"),
      playheadEl: document.getElementById("directorPlayhead"),
      timelineEl: document.querySelector(".director-timeline-shell"),
    });
    DirectorPreview.setTimeline({
      duration: 6, width: 1280, height: 720, audioClips: [],
      clips: [{ start: 0, duration: 6, kind: "text", src: "", prompt: "x" }],
    });
    DirectorPreview.seek(0);
  });

  const leftAt = () => page.evaluate(() => document.getElementById("directorPlayhead").style.left);
  await page.evaluate(() => DirectorPreview.seek(3));
  expect(await leftAt()).toBe("50%");

  await page.evaluate(() => DirectorPreview.play());
  expect(await page.evaluate(() => DirectorPreview.isPlaying())).toBe(true);
  await page.evaluate(() => DirectorPreview.pause());
  expect(await page.evaluate(() => DirectorPreview.isPlaying())).toBe(false);
});
```

- [ ] **Step 3: Add the clock, playhead positioning, and pointer seek to the module**

In `frontend/director-preview.js`, replace the `renderFrame`/`seek` region and the
exported object. First, add these helpers and state near the top (after `let currentTime = 0;`):

```javascript
  let playing = false;
  let rafId = 0;
  let lastTs = 0;

  function positionPlayhead() {
    if (!els.playheadEl) return;
    const pct = timeline.duration > 0 ? Math.max(0, Math.min(1, currentTime / timeline.duration)) * 100 : 0;
    els.playheadEl.style.left = `${pct}%`;
  }

  function tick(ts) {
    if (!playing) return;
    if (!lastTs) lastTs = ts;
    currentTime += (ts - lastTs) / 1000;
    lastTs = ts;
    if (currentTime >= timeline.duration) {
      currentTime = timeline.duration;
      renderFrame(currentTime);
      positionPlayhead();
      pause();
      return;
    }
    renderFrame(currentTime);
    positionPlayhead();
    rafId = window.requestAnimationFrame(tick);
  }

  function play() {
    if (playing || timeline.duration <= 0) return;
    if (currentTime >= timeline.duration) currentTime = 0;
    playing = true;
    lastTs = 0;
    if (els.playButtonEl) els.playButtonEl.textContent = "❚❚";
    rafId = window.requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;
    if (els.playButtonEl) els.playButtonEl.textContent = "▶";
  }

  function toggle() { playing ? pause() : play(); }
  function isPlaying() { return playing; }

  function seekFromPointer(clientX) {
    if (!els.timelineEl || timeline.duration <= 0) return;
    const rect = els.timelineEl.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seek(ratio * timeline.duration);
  }
```

Then update `seek` to also move the playhead:

```javascript
  function seek(t) {
    currentTime = Math.max(0, Math.min(Number(t) || 0, timeline.duration));
    renderFrame(currentTime);
    positionPlayhead();
  }
```

In `mount`, after `Object.assign(els, nextEls || {});`, wire the play button and timeline pointer (idempotent: only bind once per element):

```javascript
    if (els.playButtonEl && !els.playButtonEl._wired) {
      els.playButtonEl._wired = true;
      els.playButtonEl.addEventListener("click", toggle);
    }
    if (els.timelineEl && !els.timelineEl._wiredSeek) {
      els.timelineEl._wiredSeek = true;
      els.timelineEl.addEventListener("pointerdown", (event) => {
        if (event.target.closest(".director-block, .director-audio-clear, button, input, select, textarea")) return;
        seekFromPointer(event.clientX);
      });
    }
```

Extend the exported object to include the new methods:

```javascript
  window.DirectorPreview = {
    activeClipAt, mount, setTimeline, seek, renderFrame,
    play, pause, toggle, isPlaying, seekFromPointer,
    _state: () => ({ currentTime, timeline, playing }),
  };
```

- [ ] **Step 4: Run the tests**

Run: `npx playwright test tests/e2e/home.spec.js --grep "preview play toggles|preview shows video" --reporter=line`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add frontend/director-preview.js frontend/index.html frontend/styles.css tests/e2e/home.spec.js
git commit -m "feat: director preview playhead, transport, and scrub"
```

---

### Task 3: Audio sync (two lanes at volume)

**Files:**
- Modify: `frontend/director-preview.js`
- Test: `tests/e2e/home.spec.js`

**Interfaces:**
- Consumes: Task 2 module (clock + seek).
- Produces: audio playback driven by `timeline.audioClips`; an `audioEls` pool keyed by clip id/index; volume capped to `[0,1]`. New introspection `_audio()` returns `[{src, playing, volume}]` for tests.

- [ ] **Step 1: Write the failing e2e test for audio sync**

Append to `tests/e2e/home.spec.js`:

```javascript
test("director preview drives audio clips at their volume by playhead position", async ({ page }) => {
  await page.goto("/");
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    DirectorPreview.mount({
      playerEl: document.getElementById("directorPreview"),
      videoEl: document.getElementById("directorPreviewVideo"),
      imageEl: document.getElementById("directorPreviewImage"),
      overlayEl: document.getElementById("directorPreviewOverlay"),
      playButtonEl: document.getElementById("directorPreviewPlay"),
      timeReadoutEl: document.getElementById("directorPreviewTime"),
      playheadEl: document.getElementById("directorPlayhead"),
      timelineEl: document.querySelector(".director-timeline-shell"),
    });
    DirectorPreview.setTimeline({
      duration: 6, width: 1280, height: 720,
      clips: [{ start: 0, duration: 6, kind: "text", src: "", prompt: "x" }],
      audioClips: [
        { start: 0, duration: 2, trimStart: 0, src: "/favicon.ico", volume: 0.4 },
        { start: 3, duration: 2, trimStart: 0, src: "/favicon.ico", volume: 1.5 },
      ],
    });
  });

  // At t=1 the first audio clip is active at gain 0.4; the second is not.
  await page.evaluate(() => DirectorPreview.seek(1));
  const a1 = await page.evaluate(() => DirectorPreview._audio());
  expect(a1.find((a) => a.start === 0).active).toBe(true);
  expect(a1.find((a) => a.start === 0).volume).toBeCloseTo(0.4, 5);
  expect(a1.find((a) => a.start === 3).active).toBe(false);

  // At t=3.5 the second clip is active and its >1 volume is capped to 1.0.
  await page.evaluate(() => DirectorPreview.seek(3.5));
  const a2 = await page.evaluate(() => DirectorPreview._audio());
  expect(a2.find((a) => a.start === 3).active).toBe(true);
  expect(a2.find((a) => a.start === 3).volume).toBeCloseTo(1.0, 5);
});
```

- [ ] **Step 2: Implement the audio pool and sync in the module**

In `frontend/director-preview.js`, add an audio pool. After `let lastTs = 0;` add:

```javascript
  let audioEls = []; // [{ clip, el, active }]

  function rebuildAudio() {
    for (const item of audioEls) { try { item.el.pause(); } catch (e) {} }
    audioEls = (timeline.audioClips || []).map((clip) => {
      const el = new Audio();
      el.preload = "auto";
      if (clip.src) el.src = clip.src;
      el.volume = Math.max(0, Math.min(1, Number(clip.volume == null ? 1 : clip.volume)));
      return { clip, el, active: false };
    });
  }

  function syncAudio(t, allowPlay) {
    for (const item of audioEls) {
      const start = Number(item.clip.start) || 0;
      const end = start + (Number(item.clip.duration) || 0);
      const covers = t >= start && t < end;
      const into = Math.max(0, t - start + (Number(item.clip.trimStart) || 0));
      if (covers) {
        item.active = true;
        try { if (Math.abs(item.el.currentTime - into) > 0.08) item.el.currentTime = into; } catch (e) {}
        if (allowPlay && playing && item.el.paused) { item.el.play().catch(() => {}); }
        if (!playing && !item.el.paused) item.el.pause();
      } else {
        item.active = false;
        if (!item.el.paused) item.el.pause();
      }
    }
  }
```

In `setTimeline`, after assigning `timeline`, call `rebuildAudio();` (before `renderFrame`).
In `seek`, after `renderFrame(currentTime)` add `syncAudio(currentTime, false);`.
In `tick`, after `renderFrame(currentTime)` (the non-terminal branch) add `syncAudio(currentTime, true);`.
In `play`, after setting `playing = true;` add `syncAudio(currentTime, true);`.
In `pause`, after `playing = false;` add `for (const item of audioEls) { if (!item.el.paused) item.el.pause(); }`.

Extend the exported object with introspection:

```javascript
    _audio: () => audioEls.map((item) => ({ start: Number(item.clip.start) || 0, active: item.active, volume: item.el.volume })),
```

- [ ] **Step 3: Run the tests**

Run: `npx playwright test tests/e2e/home.spec.js --grep "preview drives audio|preview play toggles|preview shows video" --reporter=line`
Expected: PASS (all three).

- [ ] **Step 4: Commit**

```bash
git add frontend/director-preview.js tests/e2e/home.spec.js
git commit -m "feat: director preview synced audio lanes at volume"
```

---

### Task 4: Wire the preview into the Director editor

**Files:**
- Modify: `frontend/app.js`
- Test: `tests/e2e/home.spec.js`

**Interfaces:**
- Consumes: `DirectorPreview.mount/setTimeline` (Tasks 1–3); existing `normalizedDirectorSegments`, `normalizedDirectorAudioSegments`, `normalizedDirectorVideoAudioSegments`, `directorTotalSeconds`, `currentSize`, `mediaUrl`.
- Produces: the preview is fed from real Director state on every `renderDirectorEditor`.

- [ ] **Step 1: Add a builder + mount helper in `app.js`**

In `frontend/app.js`, add near `renderDirectorEditor` (before line 1868):

```javascript
function directorPreviewClips() {
  return normalizedDirectorSegments().map((segment) => {
    let kind = "text";
    let src = "";
    if (segment.videoPath) { kind = "video"; src = segment.videoPreviewUrl || mediaUrl(segment.videoPath); }
    else if (segment.imagePath) { kind = "image"; src = segment.imagePreviewUrl || mediaUrl(segment.imagePath); }
    return {
      start: segment.start,
      duration: segment.duration,
      kind,
      src,
      prompt: segment.prompt || "",
      trimStart: 0,
    };
  });
}

function directorPreviewAudioClips() {
  const lanes = [...normalizedDirectorVideoAudioSegments(), ...normalizedDirectorAudioSegments()];
  return lanes
    .filter((segment) => segment.audioPath)
    .map((segment) => ({
      start: Math.max(0, Number(segment.start) || 0),
      duration: Math.max(0.5, Number(segment.duration) || 0.5),
      trimStart: Math.max(0, Number(segment.trimStart) || 0),
      src: mediaUrl(segment.audioPath),
      volume: Math.max(0, Number(segment.volume ?? 1)),
    }));
}

function syncDirectorPreview() {
  if (!window.DirectorPreview) return;
  DirectorPreview.mount({
    playerEl: $("directorPreview"),
    videoEl: $("directorPreviewVideo"),
    imageEl: $("directorPreviewImage"),
    overlayEl: $("directorPreviewOverlay"),
    playButtonEl: $("directorPreviewPlay"),
    timeReadoutEl: $("directorPreviewTime"),
    playheadEl: $("directorPlayhead"),
    timelineEl: document.querySelector(".director-timeline-shell"),
  });
  const size = currentSize();
  DirectorPreview.setTimeline({
    clips: directorPreviewClips(),
    audioClips: directorPreviewAudioClips(),
    duration: directorTotalSeconds(),
    width: size.width,
    height: size.height,
  });
}
```

- [ ] **Step 2: Call the sync at the end of `renderDirectorEditor`**

In `frontend/app.js`, find the end of `renderDirectorEditor` (the function that begins at line 1868) and add `syncDirectorPreview();` as its last statement before the closing brace.

- [ ] **Step 3: Write the failing e2e test for the wired preview**

Append to `tests/e2e/home.spec.js`:

```javascript
test("director editor feeds the preview from timeline state", async ({ page }) => {
  await page.goto("/");
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [
      { id: "p1", start: 0, duration: 2, prompt: "opening shot", strength: 0.7 },
    ];
    state.directorAudioSegments = [];
    state.directorVideoAudioSegments = [];
    renderDirectorEditor();
  });

  await page.evaluate(() => DirectorPreview.seek(1));
  await expect(page.locator("#directorPreviewOverlay")).toBeVisible();
  await expect(page.locator("#directorPreviewOverlay")).toHaveText("opening shot");
  const st = await page.evaluate(() => DirectorPreview._state());
  expect(st.timeline.duration).toBeGreaterThan(0);
});
```

- [ ] **Step 4: Run the focused director preview tests**

Run: `npx playwright test tests/e2e/home.spec.js --grep "preview" --reporter=line`
Expected: PASS (all preview tests).

- [ ] **Step 5: Run the full director e2e subset + JS check**

Run:
```bash
node --check frontend/director-preview.js && node --check frontend/app.js
npx playwright test tests/e2e/home.spec.js --grep "director|preview|video audio|IC-LoRA|audio volume" --reporter=line
```
Expected: PASS; no regressions in existing director tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/app.js tests/e2e/home.spec.js
git commit -m "feat: feed director preview from timeline state"
```

---

## Self-Review Notes

- **Spec coverage:** player-on-top markup + CSS (Task 1), main-track video/image/text frame (Task 1), playhead + play/pause + scrub (Task 2), two-lane audio at volume with >1 cap (Task 3), fed from real state on render (Task 4), isolated module not touching `state` (Tasks 1–3). Empty-timeline/clamp handled in `setTimeline`/`seek`/`tick`.
- **Placeholder scan:** every code step shows complete code; tests are concrete and seek-driven for determinism (no rAF wall-clock assertions).
- **Type consistency:** `clips` use `{start,duration,kind,src,prompt,trimStart}` and `audioClips` use `{start,duration,trimStart,src,volume}` consistently across the module and the `app.js` builders; `mount` element keys (`playerEl/videoEl/imageEl/overlayEl/playButtonEl/timeReadoutEl/playheadEl/timelineEl`) match between tasks and the `app.js` mount call.
- **Note:** `DirectorPreview` is loaded before `app.js`; `app.js` guards with `if (!window.DirectorPreview) return;` so render never crashes if the script is missing.
