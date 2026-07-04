(function () {
  "use strict";

  const TRACKS = new Set(["main", "video_audio", "dialogue", "ic_video"]);
  const TRACK_ORDER = { main: 0, video_audio: 1, dialogue: 2, ic_video: 3 };
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

  function clampRange({ start = 0, length = 1, total = 1, minLength = 1 } = {}) {
    const safeMin = Math.max(1, Math.round(Number(minLength) || 1));
    const safeTotal = Math.max(safeMin, Math.round(Number(total) || safeMin));
    const safeStart = Math.max(0, Math.min(safeTotal - safeMin, Math.round(Number(start) || 0)));
    const safeLength = Math.max(safeMin, Math.min(safeTotal - safeStart, Math.round(Number(length) || safeMin)));
    return { start: safeStart, length: safeLength };
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
      extra: item.extra || {},
      fps,
    };
  }

  class DirectorTimelineModelImpl {
    constructor({ fps = 24, items = [] } = {}) {
      this.fps = Math.max(1, Math.round(Number(fps) || 24));
      this.items = items.map((item) => normalizeItem(item, this.fps));
      this.sort();
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
      this.items.sort((a, b) => (TRACK_ORDER[a.track] ?? 99) - (TRACK_ORDER[b.track] ?? 99) || a.start - b.start);
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
            ...item.extra,
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
          videoAudio.push({ ...item.extra, ...common, audioPath: item.mediaPath, audioName: item.mediaName, audioDuration: toSeconds(item.sourceDuration, this.fps), volume: item.volume, source: "video" });
        } else if (item.track === "dialogue") {
          dialogue.push({ ...item.extra, ...common, audioPath: item.mediaPath, audioName: item.mediaName, audioDuration: toSeconds(item.sourceDuration, this.fps), volume: item.volume });
        } else if (item.track === "ic_video") {
          icVideo.push({ ...item.extra, ...common, videoPath: item.mediaPath, videoName: item.mediaName, videoPreviewUrl: item.previewUrl, videoPosterUrl: item.posterUrl, videoDuration: toSeconds(item.sourceDuration, this.fps) });
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
      const {
        id, start, duration, trimStart, prompt, videoPath, videoName, videoPreviewUrl, videoPosterUrl,
        imagePath, imageName, imagePreviewUrl, strength, ...extra
      } = segment;
      items.push({
        id,
        track: "main",
        kind: isVideo ? "video" : (isImage ? "image" : "text"),
        start: toFrame(start, frameRate),
        length: Math.max(1, toFrame(duration || 0.5, frameRate)),
        trimStart: toFrame(trimStart, frameRate),
        prompt: prompt || "",
        mediaPath: isVideo ? videoPath : (isImage ? imagePath : ""),
        mediaName: isVideo ? videoName : (isImage ? imageName : ""),
        previewUrl: isVideo ? videoPreviewUrl : (isImage ? imagePreviewUrl : ""),
        posterUrl: videoPosterUrl || "",
        strength,
        extra,
      });
    }
    for (const segment of videoAudio) {
      const { id, start, duration, trimStart, audioDuration, audioPath, audioName, volume, ...extra } = segment;
      items.push({
        id,
        track: "video_audio",
        kind: "audio",
        start: toFrame(start, frameRate),
        length: Math.max(1, toFrame(duration || 0.5, frameRate)),
        trimStart: toFrame(trimStart, frameRate),
        sourceDuration: toFrame(audioDuration, frameRate),
        mediaPath: audioPath,
        mediaName: audioName,
        volume,
        extra,
      });
    }
    for (const segment of dialogue) {
      const { id, start, duration, trimStart, audioDuration, audioPath, audioName, volume, ...extra } = segment;
      items.push({
        id,
        track: "dialogue",
        kind: "audio",
        start: toFrame(start, frameRate),
        length: Math.max(1, toFrame(duration || 0.5, frameRate)),
        trimStart: toFrame(trimStart, frameRate),
        sourceDuration: toFrame(audioDuration, frameRate),
        mediaPath: audioPath,
        mediaName: audioName,
        volume,
        extra,
      });
    }
    for (const segment of icVideo) {
      const { id, start, duration, trimStart, videoDuration, videoPath, videoName, videoPreviewUrl, videoPosterUrl, ...extra } = segment;
      items.push({
        id,
        track: "ic_video",
        kind: "motion_video",
        start: toFrame(start, frameRate),
        length: Math.max(1, toFrame(duration || 0.5, frameRate)),
        trimStart: toFrame(trimStart, frameRate),
        sourceDuration: toFrame(videoDuration, frameRate),
        mediaPath: videoPath,
        mediaName: videoName,
        previewUrl: videoPreviewUrl,
        posterUrl: videoPosterUrl,
        extra,
      });
    }
    return new DirectorTimelineModelImpl({ fps: frameRate, items });
  }

  window.DirectorTimelineModel = {
    create: (options) => new DirectorTimelineModelImpl(options),
    fromAppState,
    toFrame,
    toSeconds,
    clampRange,
  };
})();
