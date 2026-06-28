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
