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
  let timeline = { clips: [], audioClips: [], duration: 0, displayDuration: 0, width: 16, height: 9 };
  let currentTime = 0;
  let playing = false;
  let rafId = 0;
  let lastTs = 0;
  let audioEls = []; // [{ clip, el, active }]
  let draggingPointerId = null;

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

  function timelineTrackMetrics() {
    if (!els.timelineEl) return { left: 0, width: 1 };
    const visibleTrack = els.timelineEl.querySelector(".director-lane:not([hidden]) .director-track")
      || els.timelineEl.querySelector("#directorTrack")
      || els.timelineEl.querySelector(".director-track");
    const style = getComputedStyle(els.timelineEl);
    const fallbackLeft = parseFloat(style.getPropertyValue("--director-timeline-label-width")) || 0;
    const fallbackWidth = parseFloat(style.getPropertyValue("--director-timeline-track-min"))
      || Math.max(1, els.timelineEl.scrollWidth - fallbackLeft);
    if (!visibleTrack) return { left: fallbackLeft, width: fallbackWidth };
    const rect = visibleTrack.getBoundingClientRect();
    return {
      left: Number.isFinite(visibleTrack.offsetLeft) ? visibleTrack.offsetLeft : fallbackLeft,
      width: rect.width > 0 ? rect.width : fallbackWidth,
    };
  }

  function positionPlayhead() {
    if (!els.playheadEl) return;
    const displayDuration = Math.max(timeline.duration, Number(timeline.displayDuration) || 0);
    const pct = displayDuration > 0 ? Math.max(0, Math.min(1, currentTime / displayDuration)) : 0;
    els.playheadEl.style.setProperty("--director-playhead-pct", pct);
    if (els.timelineEl) {
      const metrics = timelineTrackMetrics();
      els.playheadEl.style.setProperty("--director-playhead-left", `${metrics.left + (metrics.width * pct)}px`);
    }
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
    syncAudio(currentTime, true);
    positionPlayhead();
    rafId = window.requestAnimationFrame(tick);
  }

  function play() {
    if (playing || timeline.duration <= 0) return;
    if (currentTime >= timeline.duration) currentTime = 0;
    playing = true;
    syncAudio(currentTime, true);
    lastTs = 0;
    if (els.playButtonEl) els.playButtonEl.textContent = "❚❚";
    rafId = window.requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    for (const item of audioEls) { if (!item.el.paused) item.el.pause(); }
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;
    if (els.playButtonEl) els.playButtonEl.textContent = "▶";
  }

  function toggle() { playing ? pause() : play(); }
  function isPlaying() { return playing; }

  function seekFromPointer(clientX) {
    if (!els.timelineEl || timeline.duration <= 0) return;
    const rect = els.timelineEl.getBoundingClientRect();
    const metrics = timelineTrackMetrics();
    const trackX = clientX - rect.left - metrics.left + els.timelineEl.scrollLeft;
    const ratio = Math.max(0, Math.min(1, trackX / metrics.width));
    const displayDuration = Math.max(timeline.duration, Number(timeline.displayDuration) || 0);
    seek(ratio * displayDuration);
  }

  function isTimelineControlTarget(target) {
    return Boolean(target && target.closest(
      ".director-block, .director-audio-block, .director-video-audio-block, .director-ic-video-block, .director-retake-selection, .director-audio-clear, button, input, select, textarea"
    ));
  }

  function mount(nextEls) {
    Object.assign(els, nextEls || {});
    if (els.playerEl) els.playerEl.style.removeProperty("--director-preview-aspect-ratio");
    if (els.playButtonEl && !els.playButtonEl._wired) {
      els.playButtonEl._wired = true;
      els.playButtonEl.addEventListener("click", toggle);
    }
    if (els.timelineEl && !els.timelineEl._wiredSeek) {
      els.timelineEl._wiredSeek = true;
      els.timelineEl.addEventListener("pointerdown", (event) => {
        if (isTimelineControlTarget(event.target)) return;
        try { window.getSelection && window.getSelection().removeAllRanges(); } catch (e) {}
        event.preventDefault();
        draggingPointerId = event.pointerId;
        try { els.timelineEl.setPointerCapture(event.pointerId); } catch (e) {}
        seekFromPointer(event.clientX);
      });
      els.timelineEl.addEventListener("pointermove", (event) => {
        if (draggingPointerId === event.pointerId) {
          seekFromPointer(event.clientX);
          return;
        }
        if (!els.playheadEl) return;
        const rect = els.playheadEl.getBoundingClientRect();
        const nearPlayhead = event.clientX >= rect.left - 3 && event.clientX <= rect.right + 3;
        els.timelineEl.style.cursor = nearPlayhead ? "ew-resize" : "";
      });
      els.timelineEl.addEventListener("pointerleave", () => {
        if (!draggingPointerId) els.timelineEl.style.cursor = "";
      });
      els.timelineEl.addEventListener("pointerup", (event) => {
        if (draggingPointerId !== event.pointerId) return;
        draggingPointerId = null;
        els.timelineEl.style.cursor = "";
        try { els.timelineEl.releasePointerCapture(event.pointerId); } catch (e) {}
      });
      els.timelineEl.addEventListener("pointercancel", (event) => {
        if (draggingPointerId !== event.pointerId) return;
        draggingPointerId = null;
        els.timelineEl.style.cursor = "";
      });
    }
  }

  function setTimeline(next) {
    timeline = {
      clips: (next && next.clips) || [],
      audioClips: (next && next.audioClips) || [],
      duration: Math.max(0, Number(next && next.duration) || 0),
      displayDuration: Math.max(0, Number(next && next.displayDuration) || Number(next && next.duration) || 0),
      width: Number(next && next.width) || 16,
      height: Number(next && next.height) || 9,
    };
    if (els.playerEl) els.playerEl.style.removeProperty("--director-preview-aspect-ratio");
    currentTime = Math.min(currentTime, timeline.duration);
    rebuildAudio();
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
    syncAudio(currentTime, false);
    positionPlayhead();
  }

  window.DirectorPreview = {
    activeClipAt, mount, setTimeline, seek, renderFrame,
    play, pause, toggle, isPlaying, seekFromPointer,
    _state: () => ({ currentTime, timeline, playing }),
    _audio: () => audioEls.map((item) => ({ start: Number(item.clip.start) || 0, active: item.active, volume: item.el.volume })),
  };
})();
