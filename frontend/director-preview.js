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

  function mount(nextEls) {
    Object.assign(els, nextEls || {});
    if (els.playerEl && timeline.width && timeline.height) {
      els.playerEl.style.aspectRatio = `${timeline.width} / ${timeline.height}`;
    }
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
    positionPlayhead();
  }

  window.DirectorPreview = {
    activeClipAt, mount, setTimeline, seek, renderFrame,
    play, pause, toggle, isPlaying, seekFromPointer,
    _state: () => ({ currentTime, timeline, playing }),
  };
})();
