function initialWorkspace() {
  if (window.location.hash === "#director") return "director";
  if (window.location.hash === "#casting") return "casting";
  if (window.location.hash === "#motion") return "motion";
  return "camera";
}

const state = {
  config: null,
  activeBatch: null,
  pollTimer: null,
  historyTimer: null,
  clockTimer: null,
  exampleAnimation: null,
  exampleDiagram: "",
  hiddenRunKeys: new Set(),
  sourcePath: "",
  middlePath: "",
  endPath: "",
  motionRefPath: "",
  motionGuideVideoPath: "",
  motionGuideDuration: 4,
  motionTrimPlaying: false,
  motionBatch: null,
  motionSubtab: "text",
  audioPath: "",
  referencePaths: [""],
  referenceNames: [""],
  referencePreviewUrls: [""],
  directorSegments: [],
  directorAudioSegments: [],
  directorSelectedId: "",
  directorSelectionType: "image",
  directorDrag: null,
  workspace: initialWorkspace(),
  cameraWorkflowId: "",
  directorWorkflowId: "",
  castingLines: [],
  castingLibrary: [],
  castingEdit: null,
  castingPreview: null,
};

const $ = (id) => document.getElementById(id);
const imageSlots = {
  source: { pathKey: "sourcePath", previewId: "sourcePreview", statusId: "sourceStatus", empty: "No image uploaded" },
  middle: { pathKey: "middlePath", previewId: "middlePreview", statusId: "middleStatus", empty: "No image uploaded" },
  end: { pathKey: "endPath", previewId: "endPreview", statusId: "endStatus", empty: "No image uploaded" },
  motion_ref: { pathKey: "motionRefPath", previewId: "motionRefPreview", statusId: "motionRefStatus", empty: "No image uploaded" },
};
async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function uploadFile(path, form) {
  const res = await fetch(path, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function fillSelect(el, items, labelKey = "label") {
  el.innerHTML = "";
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = item.id || item.path || item.slug;
    opt.textContent = item[labelKey] || item.name || item.id || item.path;
    if (item.available === false) {
      opt.disabled = true;
      opt.textContent += ` (unavailable: ${item.reason})`;
    }
    el.appendChild(opt);
  }
  const firstEnabled = [...el.options].find((opt) => !opt.disabled);
  if (firstEnabled) el.value = firstEnabled.value;
}

function currentMove() {
  const id = $("moveSelect").value;
  return state.config.camera_moves.find((m) => m.id === id);
}

function currentWorkflow() {
  const id = $("workflowSelect").value;
  return state.config.workflows.find((w) => w.id === id);
}

function isDirectorWorkflow() {
  const wf = currentWorkflow();
  return wf && wf.mode === "director_ref";
}

function directorWorkflowOption() {
  return [...$("workflowSelect").options].find((opt) => {
    const workflow = state.config?.workflows?.find((item) => item.id === opt.value);
    return workflow?.mode === "director_ref" && !opt.disabled;
  });
}

function cameraWorkflowOption() {
  return [...$("workflowSelect").options].find((opt) => {
    const workflow = state.config?.workflows?.find((item) => item.id === opt.value);
    return workflow?.mode !== "director_ref" && !opt.disabled;
  });
}

function workflowOptionById(id, mode) {
  if (!id) return null;
  const option = [...$("workflowSelect").options].find((opt) => opt.value === id && !opt.disabled);
  if (!option) return null;
  const workflow = state.config?.workflows?.find((item) => item.id === option.value);
  if (mode && workflow?.mode !== mode) return null;
  if (mode === "camera" && workflow?.mode === "director_ref") return null;
  return option;
}

function rememberCurrentWorkflow() {
  const workflow = currentWorkflow();
  if (!workflow) return;
  if (workflow.mode === "director_ref") state.directorWorkflowId = workflow.id;
  else state.cameraWorkflowId = workflow.id;
}

function setWorkspace(workspace, { syncWorkflow = true } = {}) {
  rememberCurrentWorkflow();
  state.workspace = workspace;
  const nextHash = workspace === "camera" ? "" : `#${workspace}`;
  if (window.location.hash !== nextHash) {
    history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
  }
  if (!state.config) return;
  if (syncWorkflow && state.config) {
    if (workspace === "director") {
      const option = workflowOptionById(state.directorWorkflowId, "director_ref") || directorWorkflowOption();
      if (option) $("workflowSelect").value = option.value;
    } else if (workspace === "camera" && isDirectorWorkflow()) {
      const option = workflowOptionById(state.cameraWorkflowId, "camera") || cameraWorkflowOption();
      if (option) $("workflowSelect").value = option.value;
    }
  }
  rememberCurrentWorkflow();
  updateWorkflowFields();
  if (workspace === "photography") {
    window.dispatchEvent(new CustomEvent("camera-lab:photography-visible"));
  }
}

function currentSize() {
  const ctx = currentSizeContext();
  const scale = Number($(ctx.scaleId).value) / 100;
  const base = parseSizeText($(ctx.sizeId).value);
  return {
    width: align8(base.width * scale),
    height: align8(base.height * scale),
    scale: Math.round(scale * 100),
  };
}

function currentSizeContext() {
  const useDirectorSize = state.workspace === "director" && isDirectorWorkflow() && $("directorSizePreset");
  return useDirectorSize
    ? { presetId: "directorSizePreset", scaleId: "directorSizeScale", sizeId: "directorCustomSizeInput" }
    : { presetId: "sizePreset", scaleId: "sizeScale", sizeId: "customSizeInput" };
}

function parseSizeText(value) {
  const match = String(value || "").trim().match(/^(\d+)\s*[xX*]\s*(\d+)$/);
  if (!match) return { width: 1280, height: 720 };
  return { width: Math.max(64, Number(match[1]) || 1280), height: Math.max(64, Number(match[2]) || 720) };
}

function syncCustomSizeFromPreset(ctx) {
  $(ctx.sizeId).value = $(ctx.presetId).value;
}

function onPresetSizeChange(ctx) {
  syncCustomSizeFromPreset(ctx);
  updateSizeReadout();
}

function onCustomSizeInput() {
  updateSizeReadout();
}

function align8(value) {
  return Math.max(64, Math.round(value / 8) * 8);
}

function updateSizeReadout() {
  const size = currentSize();
  const label = `${size.width}x${size.height} / ${size.scale}%`;
  $("sizeReadout").textContent = label;
  if ($("directorSizeReadout")) $("directorSizeReadout").textContent = label;
  $("sourcePreview").parentElement.style.aspectRatio = `${size.width} / ${size.height}`;
  $("middlePreview").parentElement.style.aspectRatio = `${size.width} / ${size.height}`;
  $("endPreview").parentElement.style.aspectRatio = `${size.width} / ${size.height}`;
}

function currentMotionSize() {
  const scale = Number($("motionSizeScale").value) / 100;
  const base = parseSizeText($("motionCustomSizeInput").value);
  return {
    width: align8(base.width * scale),
    height: align8(base.height * scale),
    scale: Math.round(scale * 100),
  };
}

function updateMotionSizeReadout() {
  const size = currentMotionSize();
  $("motionSizeReadout").textContent = `${size.width}x${size.height} / ${size.scale}%`;
  $("motionRefPreviewWrap").style.aspectRatio = `${size.width} / ${size.height}`;
}

function resetPrompt() {
  const move = currentMove();
  const workflow = currentWorkflow();
  if (!move || !workflow) return;
  $("promptTag").textContent = workflow.mode.toUpperCase();
  $("promptText").value = move.prompts.base || "";
  renderExample();
}

function renderExample() {
  const examples = state.config.camera_examples;
  const base = examples.default;
  const segment = examples.segments[$("moveSelect").value] || {};
  const video = $("exampleVideo");
  const canvas = $("exampleCanvas");
  stopExampleDiagram();
  if (segment.type === "diagram") {
    video.pause();
    video.removeAttribute("src");
    video.style.display = "none";
    canvas.style.display = "block";
    $("exampleTitle").textContent = `${segment.label}: ${segment.description}`;
    $("exampleLicense").textContent = `${segment.license} / ${segment.credit}`;
    $("exampleSource").removeAttribute("href");
    $("exampleSource").textContent = "Local diagram";
    startExampleDiagram($("moveSelect").value);
    return;
  }
  canvas.style.display = "none";
  video.style.display = "block";
  $("exampleSource").href = base.source_url;
  $("exampleSource").textContent = "CC0 source";
  const start = Number(segment.start || 0);
  const end = Number(segment.end || 0);
  video.dataset.segmentStart = String(start);
  video.dataset.segmentEnd = String(end);
  video.src = end > start ? `${base.url}#t=${start},${end}` : base.url;
  const timecode = end > start ? ` ${formatSeconds(start)}-${formatSeconds(end)}` : "";
  $("exampleTitle").textContent = `${segment.label || base.title}${timecode}: ${base.description}`;
  $("exampleLicense").textContent = `${base.license} / ${base.credit}`;
}

function formatSeconds(value) {
  return `${Number(value).toFixed(2)}s`;
}

function startExampleDiagram(kind) {
  state.exampleDiagram = kind;
  const draw = (time) => {
    drawExampleDiagram(kind, time / 1000);
    state.exampleAnimation = requestAnimationFrame(draw);
  };
  state.exampleAnimation = requestAnimationFrame(draw);
}

function stopExampleDiagram() {
  if (state.exampleAnimation) cancelAnimationFrame(state.exampleAnimation);
  state.exampleAnimation = null;
  state.exampleDiagram = "";
}

function drawExampleDiagram(kind, time) {
  const canvas = $("exampleCanvas");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, Math.round(rect.width * dpr));
  const height = Math.max(180, Math.round((rect.width * 9 / 16) * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = width / dpr;
  const h = height / dpr;
  ctx.clearRect(0, 0, w, h);
  drawGrid(ctx, w, h);
  if (kind === "orbit_right") drawOrbitDiagram(ctx, w, h, time);
  if (kind === "foreground_pass") drawForegroundPassDiagram(ctx, w, h, time);
}

function drawGrid(ctx, w, h) {
  ctx.fillStyle = "#0b0b09";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(240,235,225,.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawOrbitDiagram(ctx, w, h, time) {
  const cx = w * 0.5;
  const cy = h * 0.55;
  const rx = w * 0.28;
  const ry = h * 0.16;
  const progress = (time * 0.18) % 1;
  const angle = Math.PI * (0.9 - progress * 0.8);
  const camX = cx + Math.cos(angle) * rx;
  const camY = cy + Math.sin(angle) * ry;
  drawEllipsePath(ctx, cx, cy, rx, ry);
  drawSubject(ctx, cx, cy);
  drawCamera(ctx, camX, camY, cx, cy);
}

function drawForegroundPassDiagram(ctx, w, h, time) {
  const progress = (time * 0.22) % 1;
  const subjectX = w * 0.52 - progress * 24;
  const bgX = w * 0.5 - progress * 56;
  const fgX = w + 70 - progress * (w + 160);
  ctx.fillStyle = "rgba(143,199,192,.16)";
  ctx.fillRect(bgX - 115, h * 0.25, 230, h * 0.46);
  drawSubject(ctx, subjectX, h * 0.58);
  ctx.fillStyle = "rgba(215,180,106,.86)";
  ctx.fillRect(fgX - 34, h * 0.12, 68, h * 0.76);
  ctx.fillStyle = "#17130b";
  ctx.fillRect(fgX - 2, h * 0.12, 4, h * 0.76);
}

function drawEllipsePath(ctx, cx, cy, rx, ry) {
  ctx.strokeStyle = "rgba(215,180,106,.65)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 0.15, Math.PI * 0.95);
  ctx.stroke();
}

function drawSubject(ctx, x, y) {
  ctx.fillStyle = "rgba(240,235,225,.92)";
  ctx.beginPath();
  ctx.arc(x, y - 30, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - 18, y - 12, 36, 54);
}

function drawCamera(ctx, x, y, targetX, targetY) {
  ctx.strokeStyle = "rgba(143,199,192,.65)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(targetX, targetY - 20);
  ctx.stroke();
  ctx.fillStyle = "#8fc7c0";
  ctx.fillRect(x - 18, y - 10, 36, 20);
  ctx.fillStyle = "#d7b46a";
  ctx.fillRect(x + 18, y - 5, 12, 10);
}

function updateWorkflowFields() {
  const wf = currentWorkflow();
  if (!wf) return;
  const isDirector = wf.mode === "director_ref";
  const showDirectorWorkspace = state.workspace === "director" && isDirector;
  const showPhotographyWorkspace = state.workspace === "photography";
  const showCastingWorkspace = state.workspace === "casting";
  const showMotionWorkspace = state.workspace === "motion";
  const showSourceImage = wf.mode !== "t2v" && !isDirector;
  const showMiddleImage = wf.mode === "fml" || wf.mode === "fml_native";
  const showEndImage = wf.mode === "flf" || wf.mode === "fml" || wf.mode === "fml_native" || wf.mode === "flf_ia2v";
  document.body.classList.toggle("director-mode", showDirectorWorkspace);
  document.body.classList.toggle("director-workspace-active", showDirectorWorkspace);
  document.body.classList.toggle("photography-workspace-active", showPhotographyWorkspace);
  document.body.classList.toggle("casting-workspace-active", showCastingWorkspace);
  document.body.classList.toggle("motion-workspace-active", showMotionWorkspace);
  $("cameraWorkspaceTab").classList.toggle("active", state.workspace === "camera");
  $("directorWorkspaceTab").classList.toggle("active", showDirectorWorkspace);
  $("photographyWorkspaceTab").classList.toggle("active", showPhotographyWorkspace);
  $("castingWorkspaceTab").classList.toggle("active", showCastingWorkspace);
  $("motionWorkspaceTab").classList.toggle("active", showMotionWorkspace);
  $("motionWorkspace").hidden = !showMotionWorkspace;
  if (showPhotographyWorkspace) return;
  if (showCastingWorkspace) return;
  if (showMotionWorkspace) {
    updateMotionSubtabs();
    return;
  }
  $("cameraMoveWrap").style.display = isDirector ? "none" : "block";
  $("directorReferenceWrap").style.display = showDirectorWorkspace ? "grid" : "none";
  $("directorTimelinePanel").style.display = showDirectorWorkspace ? "block" : "none";
  $("directorInlineResults").style.display = showDirectorWorkspace ? "block" : "none";
  $("sourceImageWrap").style.display = showSourceImage ? "block" : "none";
  $("sourcePreviewWrap").style.display = showSourceImage ? "block" : "none";
  $("middleImageWrap").style.display = showMiddleImage ? "block" : "none";
  $("middlePreviewWrap").style.display = showMiddleImage ? "block" : "none";
  $("endImageWrap").style.display = showEndImage ? "block" : "none";
  $("endPreviewWrap").style.display = showEndImage ? "block" : "none";
  $("swapSourceEndWrap").style.display = wf.mode === "flf" || wf.mode === "flf_ia2v" ? "block" : "none";
  $("swapSourceMiddleWrap").style.display = showMiddleImage ? "block" : "none";
  $("swapMiddleEndWrap").style.display = showMiddleImage ? "block" : "none";
  const audioWrap = $("audioUploadWrap");
  const audioTarget = $("audioUploadHome");
  if (audioWrap.parentElement !== audioTarget) audioTarget.appendChild(audioWrap);
  $("audioUploadWrap").style.display = wf.mode === "ia2v" || wf.mode === "flf_ia2v" ? "block" : "none";
  const runStrip = $("directorRunStrip");
  const runTarget = showDirectorWorkspace ? $("directorRunSlot") : $("runStripHome");
  if (runStrip.parentElement !== runTarget) runTarget.appendChild(runStrip);
  $("promptTag").textContent = wf.mode.toUpperCase();
  $("promptPanelTitle").textContent = showDirectorWorkspace ? "Director" : "Prompt";
  if (showDirectorWorkspace) renderDirectorEditor();
}

function collectPayload() {
  const size = currentSize();
  const prompt = $("promptText").value.trim();

  if (isDirectorWorkflow()) {
    const segments = collectDirectorSegments();
    const audioSegments = collectDirectorAudioSegments();
    const duration = directorOutputDurationSeconds();
    return {
      workflow_id: $("workflowSelect").value,
      camera_move: "director_ref",
      source_path: "",
      middle_path: "",
      end_path: "",
      duration,
      width: size.width,
      height: size.height,
      seed: $("seedInput").value.trim(),
      negative_prompt: $("negativePrompt").value.trim(),
      prompt,
      global_prompt: $("directorGlobalPrompt").value.trim(),
      global_reference_strength: Math.max(0, Math.min(1, Number($("directorGlobalReferenceStrength").value) || 0)),
      segments,
      timeline_segments: segments,
      audio_segments: audioSegments,
      reference_images: collectReferenceImages(),
      audio_path: "",
    };
  }

  return {
    workflow_id: $("workflowSelect").value,
    camera_move: $("moveSelect").value,
    source_path: state.sourcePath,
    middle_path: state.middlePath,
    end_path: state.endPath,
    duration: Number($("durationInput").value),
    width: size.width,
    height: size.height,
    seed: $("seedInput").value.trim(),
    negative_prompt: $("negativePrompt").value.trim(),
    prompt,
    audio_path: state.audioPath,
  };
}

function collectReferenceImages() {
  return state.referencePaths.filter((path) => String(path || "").trim());
}

function collectDirectorSegments() {
  return normalizedDirectorSegments()
    .filter((segment) => segment.prompt.trim() || segment.imagePath)
    .map((segment) => ({
      id: segment.id,
      type: segment.imagePath ? "image" : "text",
      prompt: segment.prompt.trim(),
      duration: Math.max(0.5, Number(segment.duration) || 0.5),
      reference: "",
      image_path: segment.imagePath || "",
      start: Math.max(0, Number(segment.start) || 0),
      guide_frame: Math.max(0, Math.round(((Number(segment.start) || 0) * 24) + (Number(segment.guideOffsetFrames) || 0))),
      strength: Math.max(0, Math.min(1, Number(segment.strength) || 0.65)),
    }));
}

function collectDirectorAudioSegments() {
  return normalizedDirectorAudioSegments()
    .filter((segment) => segment.audioPath)
    .map((segment) => ({
      id: segment.id,
      audio_path: segment.audioPath,
      start: Math.max(0, Number(segment.start) || 0),
      duration: Math.max(0.5, Number(segment.duration) || 0.5),
      trim_start: Math.max(0, Math.round((Number(segment.trimStart) || 0) * 24)),
    }));
}

function addDirectorSegment(values = {}) {
  const previous = normalizedDirectorSegments();
  const last = previous[previous.length - 1];
  const duration = Math.max(0.5, Number(values.duration) || 2);
  const start = values.start ?? (last ? last.start + last.duration : 0);
  const segment = {
    id: values.id || `seg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    start: Math.max(0, Number(start) || 0),
    duration,
    prompt: values.prompt || "",
    reference: "",
    imagePath: values.imagePath || "",
    imageName: values.imageName || "",
    imagePreviewUrl: values.imagePreviewUrl || "",
    audioPath: values.audioPath || "",
    audioName: values.audioName || "",
    audioDuration: Number(values.audioDuration) || 0,
    strength: values.strength ?? 0.65,
  };
  state.directorSegments.push(segment);
  state.directorSelectedId = segment.id;
  renderDirectorEditor();
}

function setDirectorSegmentsFromStoryboard(images, prompts = []) {
  const existing = normalizedDirectorSegments();
  const appendStart = existing.reduce((max, segment) => Math.max(max, segment.start + segment.duration), 0);
  let cursor = appendStart;
  const imported = images.map((image, index) => {
    const promptSpec = segmentPromptSpec(prompts[index]);
    const duration = promptSpec.duration || 4;
    const start = cursor;
    cursor += duration;
    return {
      id: `seg_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      start,
      duration,
      prompt: promptSpec.prompt,
      reference: "",
      imagePath: image.path,
      imageName: image.name,
      imagePreviewUrl: mediaUrl(image.path),
      strength: index === 0 ? 1 : 0.85,
    };
  });
  state.directorSegments = [...state.directorSegments, ...imported];
  state.directorAudioSegments = [];
  state.directorSelectionType = "image";
  state.directorSelectedId = imported[0]?.id || state.directorSelectedId;
  renderDirectorEditor();
}

function importShotPackToDirector(detail = {}) {
  const frames = Array.isArray(detail.frames) ? detail.frames.filter((frame) => frame && frame.path) : [];
  if (!frames.length) {
    $("runHint").textContent = "Shot pack has no exported reference frames";
    return;
  }
  const plan = detail.plan_payload && typeof detail.plan_payload === "object" ? detail.plan_payload : {};
  const prompt = String(plan.camera_prompt || "Use the 3D reference frames as composition and camera movement guides. Redraw the scene with the intended subject, style, lighting, and production detail.").trim();
  const totalFrames = Math.max(1, Number(plan.total_frames) || 49);
  const totalSeconds = totalFrames / 24;
  const segmentDuration = Math.max(0.5, Math.ceil((totalSeconds / frames.length) * 2) / 2);

  setWorkspace("director");
  $("directorGlobalPrompt").value = prompt;
  $("promptText").value = prompt;
  state.directorAudioSegments = [];
  state.directorSelectionType = "image";
  state.directorSegments = frames.map((frame, index) => {
    const label = String(frame.label || `shot ${index + 1}`).trim();
    return {
      id: `shot_pack_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      start: Math.round(index * segmentDuration * 2) / 2,
      duration: segmentDuration,
      prompt: `${label}: redraw this 3D camera reference as the same shot in the final visual style. Maintain framing, perspective, subject placement, and camera continuity.`,
      reference: "",
      imagePath: frame.path,
      imageName: frame.filename || fileNameFromPath(frame.path),
      imagePreviewUrl: mediaUrl(frame.path),
      strength: index === 0 ? 1 : 0.85,
    };
  });
  state.directorSelectedId = state.directorSegments[0]?.id || "";
  renderDirectorEditor();
  $("runHint").textContent = `Imported ${frames.length} shot-pack reference frames into Director`;
}

function openStoryboardImportModal() {
  const modal = $("storyboardImportModal");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  $("storyboardImportStatus").textContent = $("storyboardImportInput").files[0]?.name || "No storyboard selected";
}

function closeStoryboardImportModal() {
  const modal = $("storyboardImportModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

async function applyStoryboardImport() {
  const file = $("storyboardImportInput").files[0];
  if (!file) {
    $("storyboardImportStatus").textContent = "Choose a 2x2 storyboard image first";
    return;
  }
  const prompts = parseBulkSegmentPrompts($("storyboardPromptText").value).slice(0, 4);
  await splitStoryboardImage(file, prompts);
  closeStoryboardImportModal();
}

function parseNumberList(value) {
  if (Array.isArray(value)) return value.map(Number).filter((item) => Number.isFinite(item));
  return String(value || "")
    .split(/[,\s]+/)
    .map(Number)
    .filter((item) => Number.isFinite(item));
}

function parseBulkSegmentPrompts(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  const withoutGlobal = text.replace(/^\s*(global prompt|global_prompt)\s*:.*$/gim, "").trim();
  const normalized = withoutGlobal.replace(/\r\n/g, "\n");
  const rawLines = normalized.split("\n").map((item) => item.trim()).filter(Boolean);
  if (rawLines.length > 1 && rawLines.some(hasSegmentDurationPrefix)) {
    return rawLines.map((item) => segmentPromptSpec(item)).filter((item) => item.prompt || item.duration);
  }
  const markerPattern = /(?:^|\n)\s*(?:shot\s*\d+|s\d+|segment\s*\d+|clip\s*\d+|\d+[\.\):-])\s*/gi;
  const matches = [...normalized.matchAll(markerPattern)];
  if (matches.length >= 2) {
    return matches.map((match, index) => {
      const start = match.index + match[0].length;
      const end = index + 1 < matches.length ? matches[index + 1].index : normalized.length;
      const marker = match[0].replace(/^\n/, "").trim();
      const body = normalized.slice(start, end).trim();
      return segmentPromptSpec(body, marker && /^shot\s*\d+/i.test(marker) ? marker : "");
    }).filter((item) => item.prompt || item.duration);
  }
  if (normalized.includes("|")) {
    const parts = normalized.split("|").map((item) => segmentPromptSpec(item)).filter((item) => item.prompt || item.duration);
    if (parts.length > 1) return parts;
  }
  const paragraphs = normalized.split(/\n\s*\n+/).map((item) => segmentPromptSpec(item)).filter((item) => item.prompt || item.duration);
  if (paragraphs.length > 1) return paragraphs;
  const lines = normalized.split("\n").map((item) => segmentPromptSpec(item)).filter((item) => item.prompt || item.duration);
  return lines.length > 1 ? lines : [segmentPromptSpec(normalized)];
}

function hasSegmentDurationPrefix(value) {
  return /^\s*\d+(?:\.\d+)?\s*(?:s|sec|secs|second|seconds)\b/i.test(String(value || ""));
}

function segmentPromptSpec(value, prefix = "") {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      prompt: String(value.prompt || "").trim(),
      duration: clampSegmentDuration(value.duration),
    };
  }
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds)\s*(?:[,，:：;；\-]\s*)?(.*)$/i);
  const duration = match ? clampSegmentDuration(match[1]) : 0;
  const prompt = (match ? match[2] : raw).trim();
  return {
    prompt: prefix ? `${prefix} ${prompt}`.trim() : prompt,
    duration,
  };
}

function clampSegmentDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0.5, Math.min(60, duration));
}

async function splitStoryboardImage(file, prompts = []) {
  if (!file) return;
  $("runHint").textContent = "Splitting 2x2 storyboard...";
  const image = await loadImageFromFile(file);
  const uploads = [];
  const base = file.name.replace(/\.[^.]+$/, "") || "storyboard";
  for (let index = 0; index < 4; index += 1) {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const blob = await cropImageBlob(image, col * image.naturalWidth / 2, row * image.naturalHeight / 2, image.naturalWidth / 2, image.naturalHeight / 2);
    const data = await blobToDataUrl(blob);
    const uploaded = await api("/api/upload-image", {
      method: "POST",
      body: JSON.stringify({ name: `${base}_shot_${index + 1}.png`, data }),
    });
    uploads.push(uploaded);
  }
  setDirectorSegmentsFromStoryboard(uploads, prompts);
  $("runHint").textContent = prompts.length
    ? `2x2 storyboard imported with ${prompts.length} prompt(s)`
    : "2x2 storyboard split into four timeline images";
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("could not read storyboard image"));
    };
    image.src = url;
  });
}

function cropImageBlob(image, sx, sy, sw, sh) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw);
    canvas.height = Math.round(sh);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("could not split storyboard image"));
    }, "image/png");
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function renumberDirectorSegments() {
  renderDirectorEditor();
}

function normalizedDirectorSegments() {
  return state.directorSegments
    .map((segment) => ({
      ...segment,
      start: Math.max(0, Number(segment.start) || 0),
      duration: Math.max(0.5, Number(segment.duration) || 0.5),
      strength: Math.max(0, Math.min(1, Number(segment.strength) || 0.65)),
    }))
    .sort((a, b) => a.start - b.start);
}

function normalizedDirectorAudioSegments() {
  return state.directorAudioSegments
    .map((segment) => ({
      ...segment,
      start: Math.max(0, Number(segment.start) || 0),
      duration: fixedDirectorAudioDuration(segment),
      trimStart: Math.max(0, Number(segment.trimStart) || 0),
      audioDuration: Math.max(0, Number(segment.audioDuration) || 0),
    }))
    .sort((a, b) => a.start - b.start);
}

function directorOutputDurationSeconds() {
  const imageEnd = normalizedDirectorSegments().reduce((max, segment) => Math.max(max, segment.start + segment.duration), 0);
  const audioEnd = normalizedDirectorAudioSegments().reduce((max, segment) => Math.max(max, segment.start + segment.duration), 0);
  return Math.max(0.5, Math.ceil(Math.max(imageEnd, audioEnd) * 2) / 2);
}

function directorTotalSeconds() {
  const end = directorOutputDurationSeconds();
  return Math.max(6, Math.ceil(end * 1.3 * 2) / 2);
}

function selectDirectorSegment(id) {
  state.directorSelectedId = id;
  state.directorSelectionType = "image";
  renderDirectorEditor();
}

function removeDirectorSegment(id) {
  state.directorSegments = state.directorSegments.filter((item) => item.id !== id);
  if (!state.directorSegments.some((item) => item.id === state.directorSelectedId)) {
    state.directorSelectedId = state.directorSegments[0]?.id || "";
  }
  renderDirectorEditor();
}

function removeDirectorAudioSegment(id) {
  state.directorAudioSegments = state.directorAudioSegments.filter((item) => item.id !== id);
  if (state.directorSelectionType === "audio" && !state.directorAudioSegments.some((item) => item.id === state.directorSelectedId)) {
    state.directorSelectionType = "image";
    state.directorSelectedId = state.directorSegments[0]?.id || "";
  }
  renderDirectorEditor();
}

function createDirectorBlock(segment, index, total) {
  const block = document.createElement("div");
  block.className = "director-block ref-none";
  block.classList.toggle("selected", segment.id === state.directorSelectedId && state.directorSelectionType !== "audio");
  block.classList.toggle("has-image-guide", Boolean(segment.imagePath));
  block.dataset.id = segment.id;
  block.setAttribute("role", "group");
  block.setAttribute("aria-label", `Segment S${index + 1}`);
  block.style.left = `${(segment.start / total) * 100}%`;
  block.style.width = `${(segment.duration / total) * 100}%`;
  const preview = segment.imagePreviewUrl || (segment.imagePath ? mediaUrl(segment.imagePath) : "");
  block.innerHTML = `
    ${preview ? `<img class="director-block-image" src="${escapeHtml(preview)}" alt="timeline image guide">` : ""}
    <button class="director-block-remove" type="button" aria-label="Remove segment S${index + 1}">x</button>
    <span class="director-block-index">S${index + 1}</span>
    <span class="director-block-prompt">${escapeHtml(segment.prompt || "empty prompt")}</span>
    <span class="director-block-ref">${segment.imagePath ? "timeline image" : "text only"}</span>
    <i class="resize-handle left" data-edge="left"></i>
    <i class="resize-handle right" data-edge="right"></i>
  `;
  block.addEventListener("click", () => selectDirectorSegment(segment.id));
  const removeButton = block.querySelector(".director-block-remove");
  removeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    removeDirectorSegment(segment.id);
  });
  removeButton.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });
  block.addEventListener("mousemove", (event) => updateDirectorBlockCursor(event, block));
  block.addEventListener("mouseleave", () => {
    block.style.cursor = "";
  });
  block.addEventListener("mousedown", (event) => startDirectorDrag(event, segment.id));
  return block;
}

function findCastingClipByFile(file) {
  return (state.castingLibrary || []).find((clip) => clip.file === file);
}

function directorAudioLabel(segment) {
  const clip = findCastingClipByFile(segment.audioPath);
  if (clip) return clip.name || clip.file || "audio clip";
  return segment.audioName || (segment.audioPath ? fileNameFromPath(segment.audioPath) : "");
}

function directorAudioUrl(segment) {
  const clip = findCastingClipByFile(segment.audioPath);
  return clip?.url || (segment.audioPath ? mediaUrl(segment.audioPath) : "");
}

function directorAudioDuration(segment) {
  const clip = findCastingClipByFile(segment.audioPath);
  const duration = Number(segment.audioDuration || clip?.duration || 0);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function fixedDirectorAudioDuration(segment) {
  const audioDuration = directorAudioDuration(segment);
  const rounded = roundUpHalf(audioDuration);
  return rounded || Math.max(0.5, Number(segment.duration) || 0.5);
}

function directorAudioTimingLabel(segment) {
  const audioDuration = directorAudioDuration(segment);
  if (!audioDuration) return "";
  return `Audio ${formatDurationPrecise(audioDuration)} -> Clip ${formatDurationPrecise(fixedDirectorAudioDuration(segment))}`;
}

function findDirectorAudioAtStart(start) {
  const target = Number(start) || 0;
  return state.directorAudioSegments.find((item) => Math.abs((Number(item.start) || 0) - target) < 0.01) || null;
}

function keepDirectorSegmentsSeparated(changedId) {
  const ordered = [...state.directorSegments].sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
  const changedIndex = ordered.findIndex((segment) => segment.id === changedId);
  if (changedIndex < 0) return;
  let cursor = (Number(ordered[changedIndex].start) || 0) + (Number(ordered[changedIndex].duration) || 0.5);
  for (const segment of ordered.slice(changedIndex + 1)) {
    const start = Number(segment.start) || 0;
    if (start < cursor) segment.start = roundHalf(cursor);
    cursor = (Number(segment.start) || 0) + (Number(segment.duration) || 0.5);
  }
}

function keepDirectorAudioSegmentsSeparated(changedId) {
  const ordered = [...state.directorAudioSegments].sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
  const changedIndex = ordered.findIndex((segment) => segment.id === changedId);
  if (changedIndex < 0) return;
  let cursor = (Number(ordered[changedIndex].start) || 0) + (Number(ordered[changedIndex].duration) || 0.5);
  for (const segment of ordered.slice(changedIndex + 1)) {
    const start = Number(segment.start) || 0;
    if (start < cursor) segment.start = roundHalf(cursor);
    cursor = (Number(segment.start) || 0) + (Number(segment.duration) || 0.5);
  }
}

function addDirectorAudioClip(audio = {}, start = 0) {
  const duration = Number(audio.duration) || 0;
  const roundedDuration = roundUpHalf(duration);
  const startTime = Math.max(0, Number(start) || 0);
  const existing = state.directorAudioSegments.find((item) => Math.abs((Number(item.start) || 0) - startTime) < 0.01);
  const segment = existing || {
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    start: startTime,
    duration: roundedDuration || 1,
    trimStart: 0,
  };
  segment.audioPath = audio.path || "";
  segment.audioName = audio.name || "";
  segment.audioDuration = duration > 0 ? duration : 0;
  segment.duration = roundedDuration || fixedDirectorAudioDuration(segment);
  if (!existing) state.directorAudioSegments.push(segment);
  state.directorSelectedId = segment.id;
  state.directorSelectionType = "audio";
  keepDirectorAudioSegmentsSeparated(segment.id);
  renderDirectorEditor();
}

function defaultDirectorAudioStart() {
  const end = normalizedDirectorAudioSegments().reduce((max, segment) => Math.max(max, segment.start + segment.duration), 0);
  return roundHalf(end);
}

function populateDirectorAudioModalLibrary() {
  const select = $("directorAudioLibrarySelect");
  if (!select) return;
  select.innerHTML = '<option value="">No audio</option>';
  (state.castingLibrary || []).forEach((clip) => {
    const option = document.createElement("option");
    option.value = clip.file;
    option.textContent = clip.name + (clip.voice ? ` · ${clip.voice}` : "");
    select.appendChild(option);
  });
}

function openDirectorAudioModal() {
  populateDirectorAudioModalLibrary();
  $("directorAudioModalStart").value = defaultDirectorAudioStart();
  $("directorAudioModalInput").value = "";
  $("directorAudioModalUploadStatus").textContent = "No upload selected";
  $("directorAudioModalStatus").textContent = "Choose a library clip or upload audio.";
  $("directorAudioModal").classList.add("open");
  $("directorAudioModal").setAttribute("aria-hidden", "false");
}

function closeDirectorAudioModal() {
  $("directorAudioModal").classList.remove("open");
  $("directorAudioModal").setAttribute("aria-hidden", "true");
}

async function addDirectorAudioFromModal() {
  const status = $("directorAudioModalStatus");
  const start = Number($("directorAudioModalStart").value) || 0;
  const file = $("directorAudioModalInput").files[0];
  const selectedFile = $("directorAudioLibrarySelect").value;
  try {
    if (file) {
      status.textContent = "Uploading audio...";
      const duration = await readAudioDuration(file);
      const data = await readFileAsDataUrl(file);
      const uploaded = await api("/api/upload-audio", {
        method: "POST",
        body: JSON.stringify({ name: file.name, data }),
      });
      addDirectorAudioClip({ path: uploaded.path, name: uploaded.name, duration }, start);
      closeDirectorAudioModal();
      $("runHint").textContent = "Audio clip added to timeline";
      return;
    }
    if (selectedFile) {
      const clip = findCastingClipByFile(selectedFile);
      const option = $("directorAudioLibrarySelect").options[$("directorAudioLibrarySelect").selectedIndex];
      addDirectorAudioClip({
        path: selectedFile,
        name: option ? option.textContent : fileNameFromPath(selectedFile),
        duration: clip?.duration || 0,
      }, start);
      closeDirectorAudioModal();
      $("runHint").textContent = "Audio clip added to timeline";
      return;
    }
    status.textContent = "Choose a library clip or upload audio.";
  } catch (err) {
    status.textContent = err.message;
  }
}

function createDirectorAudioBlock(segment, index, total) {
  const block = document.createElement("div");
  const hasAudio = Boolean(segment.audioPath);
  block.className = "director-audio-block";
  block.classList.toggle("selected", segment.id === state.directorSelectedId && state.directorSelectionType === "audio");
  block.classList.toggle("has-audio", hasAudio);
  block.dataset.id = segment.id;
  block.setAttribute("role", "button");
  block.setAttribute("tabindex", "0");
  block.setAttribute("aria-label", `Audio for segment S${index + 1}`);
  block.style.left = `${(segment.start / total) * 100}%`;
  block.style.width = `${(segment.duration / total) * 100}%`;
  const label = hasAudio ? directorAudioLabel(segment) : "Add audio";
  const timing = hasAudio ? directorAudioTimingLabel(segment) : "";
  block.innerHTML = `
    <span>S${index + 1}</span>
    <div class="director-audio-copy">
      <strong>${escapeHtml(label)}</strong>
      ${timing ? `<em>${escapeHtml(timing)}</em>` : ""}
    </div>
    ${hasAudio ? `<span class="director-audio-actions"></span>` : ""}
    ${hasAudio ? `<button class="director-audio-clear compact-icon-button" type="button" title="Delete audio clip" aria-label="Delete audio clip S${index + 1}">${ACTION_ICONS.delete}</button>` : ""}
  `;
  const select = () => {
    state.directorSelectedId = segment.id;
    state.directorSelectionType = "audio";
    renderDirectorEditor();
  };
  block.addEventListener("click", select);
  block.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  });
  const clearButton = block.querySelector(".director-audio-clear");
  if (clearButton) {
    clearButton.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });
    clearButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeDirectorAudioSegment(segment.id);
    });
  }
  const actions = block.querySelector(".director-audio-actions");
  if (actions) {
    const previewButton = makeCastingPreviewButton(directorAudioUrl(segment), `Preview audio ${index + 1}`);
    previewButton.classList.add("director-audio-preview");
    previewButton.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });
    previewButton.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    actions.appendChild(previewButton);
  }
  const copy = block.querySelector(".director-audio-copy");
  if (copy) {
    copy.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      startDirectorDrag(event, segment.id, "audio");
    });
  }
  const labelIndex = block.querySelector("span");
  if (labelIndex) {
    labelIndex.addEventListener("mousedown", (event) => {
      event.stopPropagation();
      startDirectorDrag(event, segment.id, "audio");
    });
  }
  block.addEventListener("mousemove", () => {
    block.style.cursor = "grab";
  });
  block.addEventListener("mouseleave", () => {
    block.style.cursor = "";
  });
  block.addEventListener("mousedown", (event) => startDirectorDrag(event, segment.id, "audio"));
  return block;
}

function renderDirectorEditor() {
  const track = $("directorTrack");
  const audioTrack = $("directorAudioTrack");
  const ruler = $("directorRuler");
  const list = $("directorSegments");
  if (!track || !audioTrack || !ruler || !list) return;
  const segments = normalizedDirectorSegments();
  const audioSegments = normalizedDirectorAudioSegments();
  const total = directorTotalSeconds();
  ruler.innerHTML = "";
  for (let sec = 0; sec <= total; sec += 1) {
    const tick = document.createElement("span");
    tick.style.left = `${(sec / total) * 100}%`;
    tick.textContent = `${sec}s`;
    ruler.appendChild(tick);
  }

  track.innerHTML = "";
  audioTrack.innerHTML = "";
  for (const [index, segment] of segments.entries()) {
    track.appendChild(createDirectorBlock(segment, index, total));
  }
  for (const [index, segment] of audioSegments.entries()) {
    audioTrack.appendChild(createDirectorAudioBlock(segment, index, total));
  }
  track.ondragover = null;
  track.ondrop = null;

  list.innerHTML = "";
  segments.forEach((segment, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "director-segment-chip";
    chip.classList.toggle("selected", segment.id === state.directorSelectedId && state.directorSelectionType !== "audio");
    chip.textContent = `S${index + 1} ${formatSeconds(segment.start)}-${formatSeconds(segment.start + segment.duration)}`;
    chip.addEventListener("click", () => {
      state.directorSelectedId = segment.id;
      renderDirectorEditor();
    });
    list.appendChild(chip);
  });
  audioSegments.forEach((segment, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "director-segment-chip director-audio-chip";
    chip.classList.toggle("selected", segment.id === state.directorSelectedId && state.directorSelectionType === "audio");
    chip.textContent = `A${index + 1} ${formatSeconds(segment.start)}-${formatSeconds(segment.start + segment.duration)}`;
    chip.addEventListener("click", () => {
      state.directorSelectionType = "audio";
      state.directorSelectedId = segment.id;
      renderDirectorEditor();
    });
    list.appendChild(chip);
  });
  renderDirectorInspector();
}

function renderDirectorInspector() {
  const inspector = $("directorSegmentInspector");
  if (!inspector) return;
  if (state.directorSelectionType === "audio") {
    renderDirectorAudioInspector(inspector);
    return;
  }
  const segment = state.directorSegments.find((item) => item.id === state.directorSelectedId) || state.directorSegments[0];
  if (!segment) {
    inspector.innerHTML = '<div class="hint">Add a segment to edit local prompt and timing.</div>';
    return;
  }
  state.directorSelectedId = segment.id;
  inspector.innerHTML = `
    <div class="director-inspector-head">
      <span>Selected segment</span>
      <button id="removeDirectorSegmentBtn" type="button">Remove</button>
    </div>
    <label>
      Local prompt
      <textarea id="directorSegmentPrompt" rows="5"></textarea>
    </label>
    <label>
      Timeline image guide
      <span id="directorSegmentImageStatus" class="hint segment-image-status">No image guide on this segment</span>
    </label>
    <label class="selected-segment-upload">
      <span class="selected-segment-upload-label">Upload / replace image guide</span>
      <input id="directorSegmentImageInput" type="file" accept="image/*">
    </label>
    <div class="director-segment-grid">
      <label>
        Start
        <input id="directorSegmentStart" type="number" min="0" max="120" step="0.5">
      </label>
      <label>
        Duration
        <input id="directorSegmentDuration" type="number" min="0.5" max="60" step="0.5">
      </label>
      <label>
        Strength
        <input id="directorSegmentStrength" type="number" min="0" max="1" step="0.05">
      </label>
      <label>
        Seed
        <input id="directorSeedInput" type="number" min="1" max="2147000000" step="1" placeholder="Random">
      </label>
    </div>
  `;
  $("directorSegmentPrompt").value = segment.prompt || "";
  $("directorSegmentStart").value = segment.start;
  $("directorSegmentDuration").value = segment.duration;
  $("directorSegmentStrength").value = segment.strength ?? 0.65;
  $("directorSeedInput").value = $("seedInput").value;
  $("directorSegmentImageStatus").textContent = segment.imageName || (segment.imagePath ? "Timeline image guide" : "No image guide on this segment");
  /*
  (state.castingLibrary || []).forEach((clip) => {
    const o = document.createElement("option");
    o.value = clip.file;
    o.textContent = clip.name + (clip.voice ? ` · ${clip.voice}` : "");
    audioSelect.appendChild(o);
  });
  if (anchoredAudio?.audioPath && !Array.from(audioSelect.options).some((o) => o.value === anchoredAudio.audioPath)) {
    const o = document.createElement("option");
    o.value = anchoredAudio.audioPath;
    o.textContent = anchoredAudio.audioName || "current clip";
    audioSelect.appendChild(o);
  }
  audioSelect.value = anchoredAudio?.audioPath || "";
  audioSelect.addEventListener("change", (event) => {
    const opt = event.target.options[event.target.selectedIndex];
    const clip = findCastingClipByFile(event.target.value);
    applyDirectorSegmentAudio(segment.id, {
      path: event.target.value,
      name: event.target.value ? (opt ? opt.textContent : "") : "",
      duration: clip?.duration || 0,
    });
  });
  */
  $("directorSegmentPrompt").addEventListener("input", (event) => updateDirectorSegment(segment.id, { prompt: event.target.value }, false));
  $("directorSegmentStart").addEventListener("input", (event) => updateDirectorSegment(segment.id, { start: Number(event.target.value) || 0 }, false));
  $("directorSegmentDuration").addEventListener("input", (event) => updateDirectorSegment(segment.id, { duration: Number(event.target.value) || 0.5 }, false));
  $("directorSegmentStrength").addEventListener("input", (event) => updateDirectorSegment(segment.id, { strength: Number(event.target.value) || 0 }, false));
  $("directorSeedInput").addEventListener("input", (event) => {
    $("seedInput").value = event.target.value;
  });
  $("directorSegmentImageInput").addEventListener("change", () => uploadDirectorSegmentImage(segment.id, $("directorSegmentImageInput").files[0]).catch((err) => {
    $("directorSegmentImageStatus").textContent = err.message;
    $("runHint").textContent = `Timeline image upload failed: ${err.message}`;
  }));
  $("removeDirectorSegmentBtn").addEventListener("click", () => removeDirectorSegment(segment.id));
}

function renderDirectorAudioInspector(inspector) {
  const segment = state.directorAudioSegments.find((item) => item.id === state.directorSelectedId) || state.directorAudioSegments[0];
  if (!segment) {
    state.directorSelectionType = "image";
    renderDirectorInspector();
    return;
  }
  state.directorSelectedId = segment.id;
  inspector.innerHTML = `
    <div class="director-inspector-head">
      <span>Selected audio</span>
      <button id="removeDirectorAudioBtn" type="button">Remove</button>
    </div>
    <div class="director-segment-audio-card">
      <div class="director-segment-audio-head">
        <span>${escapeHtml(directorAudioLabel(segment) || "Audio clip")}</span>
      </div>
      <span class="hint segment-audio-status">${escapeHtml(directorAudioTimingLabel(segment) || "Audio segment")}</span>
    </div>
    <div class="director-segment-grid">
      <label>
        Start
        <input id="directorAudioStart" type="number" min="0" max="120" step="0.5">
      </label>
      <div class="director-audio-readonly">
        Duration
        <b>${escapeHtml(formatDurationPrecise(fixedDirectorAudioDuration(segment)) || "0.5s")}</b>
      </div>
      <label>
        Trim start
        <input id="directorAudioTrimStart" type="number" min="0" max="60" step="0.5">
      </label>
    </div>
  `;
  $("directorAudioStart").value = segment.start;
  $("directorAudioTrimStart").value = segment.trimStart || 0;
  $("directorAudioStart").addEventListener("input", (event) => updateDirectorAudioSegment(segment.id, { start: Number(event.target.value) || 0 }, false));
  $("directorAudioTrimStart").addEventListener("input", (event) => updateDirectorAudioSegment(segment.id, { trimStart: Number(event.target.value) || 0 }, false));
  $("removeDirectorAudioBtn").addEventListener("click", () => removeDirectorAudioSegment(segment.id));
}

function updateDirectorSegment(id, patch, rerenderInspector = true) {
  const segment = state.directorSegments.find((item) => item.id === id);
  if (!segment) return;
  Object.assign(segment, patch);
  segment.start = Math.max(0, Number(segment.start) || 0);
  segment.duration = Math.max(0.5, Number(segment.duration) || 0.5);
  segment.strength = Math.max(0, Math.min(1, Number(segment.strength) || 0));
  if (rerenderInspector) renderDirectorEditor();
  else renderDirectorTimelineOnly();
}

function updateDirectorAudioSegment(id, patch, rerenderInspector = true) {
  const segment = state.directorAudioSegments.find((item) => item.id === id);
  if (!segment) return;
  const { duration: _duration, ...safePatch } = patch;
  Object.assign(segment, safePatch);
  segment.start = Math.max(0, Number(segment.start) || 0);
  segment.duration = fixedDirectorAudioDuration(segment);
  segment.trimStart = Math.max(0, Number(segment.trimStart) || 0);
  keepDirectorAudioSegmentsSeparated(id);
  if (rerenderInspector) renderDirectorEditor();
  else renderDirectorTimelineOnly();
}

function renderDirectorTimelineOnly() {
  const track = $("directorTrack");
  const audioTrack = $("directorAudioTrack");
  const ruler = $("directorRuler");
  const list = $("directorSegments");
  if (!track || !audioTrack || !ruler || !list) return;
  const segments = normalizedDirectorSegments();
  const audioSegments = normalizedDirectorAudioSegments();
  const total = directorTotalSeconds();
  ruler.innerHTML = "";
  for (let sec = 0; sec <= total; sec += 1) {
    const tick = document.createElement("span");
    tick.style.left = `${(sec / total) * 100}%`;
    tick.textContent = `${sec}s`;
    ruler.appendChild(tick);
  }
  track.innerHTML = "";
  audioTrack.innerHTML = "";
  for (const [index, segment] of segments.entries()) {
    track.appendChild(createDirectorBlock(segment, index, total));
  }
  for (const [index, segment] of audioSegments.entries()) {
    audioTrack.appendChild(createDirectorAudioBlock(segment, index, total));
  }
  track.ondragover = null;
  track.ondrop = null;
  list.innerHTML = "";
  segments.forEach((segment, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "director-segment-chip";
    chip.classList.toggle("selected", segment.id === state.directorSelectedId && state.directorSelectionType !== "audio");
    chip.textContent = `S${index + 1} ${formatSeconds(segment.start)}-${formatSeconds(segment.start + segment.duration)}`;
    chip.addEventListener("click", () => {
      state.directorSelectionType = "image";
      state.directorSelectedId = segment.id;
      renderDirectorEditor();
    });
    list.appendChild(chip);
  });
  audioSegments.forEach((segment, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "director-segment-chip director-audio-chip";
    chip.classList.toggle("selected", segment.id === state.directorSelectedId && state.directorSelectionType === "audio");
    chip.textContent = `A${index + 1} ${formatSeconds(segment.start)}-${formatSeconds(segment.start + segment.duration)}`;
    chip.addEventListener("click", () => {
      state.directorSelectionType = "audio";
      state.directorSelectedId = segment.id;
      renderDirectorEditor();
    });
    list.appendChild(chip);
  });
}

function startDirectorDrag(event, id, type = "image") {
  if (event.button !== 0) return;
  const isAudio = type === "audio";
  const segment = (isAudio ? state.directorAudioSegments : state.directorSegments).find((item) => item.id === id);
  if (!segment) return;
  event.preventDefault();
  state.directorSelectedId = id;
  state.directorSelectionType = isAudio ? "audio" : "image";
  const trackRect = $(isAudio ? "directorAudioTrack" : "directorTrack").getBoundingClientRect();
  const edge = isAudio ? "" : directorEdgeFromEvent(event, event.currentTarget);
  state.directorDrag = {
    id,
    type: isAudio ? "audio" : "image",
    edge,
    rect: trackRect,
    total: directorTotalSeconds(),
    startX: event.clientX,
    originalStart: segment.start,
    originalDuration: segment.duration,
  };
  document.body.classList.add("director-dragging");
  document.body.style.cursor = edge ? "ew-resize" : "grabbing";
  window.addEventListener("mousemove", onDirectorDrag);
  window.addEventListener("mouseup", stopDirectorDrag, { once: true });
}

function directorEdgeFromEvent(event, block) {
  const blockRect = block.getBoundingClientRect();
  const edgeHitSize = Math.min(34, Math.max(18, blockRect.width * 0.2));
  if (event.clientX - blockRect.left <= edgeHitSize) return "left";
  if (blockRect.right - event.clientX <= edgeHitSize) return "right";
  return "";
}

function updateDirectorBlockCursor(event, block) {
  block.style.cursor = directorEdgeFromEvent(event, block) ? "ew-resize" : "grab";
}

function onDirectorDrag(event) {
  const drag = state.directorDrag;
  if (!drag) return;
  const isAudio = drag.type === "audio";
  const segments = isAudio ? state.directorAudioSegments : state.directorSegments;
  const segment = segments.find((item) => item.id === drag.id);
  if (!segment) return;
  const deltaSeconds = ((event.clientX - drag.startX) / Math.max(1, drag.rect.width)) * drag.total;
  if (!isAudio && drag.edge === "left") {
    const nextStart = Math.max(0, drag.originalStart + deltaSeconds);
    const end = drag.originalStart + drag.originalDuration;
    segment.start = roundHalf(Math.min(nextStart, end - 0.5));
    segment.duration = roundHalf(end - segment.start);
  } else if (!isAudio && drag.edge === "right") {
    segment.duration = roundHalf(Math.max(0.5, drag.originalDuration + deltaSeconds));
  } else {
    segment.start = roundHalf(Math.max(0, drag.originalStart + deltaSeconds));
  }
  if (isAudio) segment.duration = fixedDirectorAudioDuration(segment);
  if (isAudio) keepDirectorAudioSegmentsSeparated(segment.id);
  renderDirectorTimelineOnly();
}

function stopDirectorDrag() {
  const drag = state.directorDrag;
  state.directorDrag = null;
  document.body.classList.remove("director-dragging");
  document.body.style.cursor = "";
  window.removeEventListener("mousemove", onDirectorDrag);
  if (drag) renderDirectorEditor();
}

function roundHalf(value) {
  return Math.round(value * 2) / 2;
}

function roundUpHalf(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.ceil(numeric * 2) / 2;
}

function formatDurationPrecise(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return `${numeric.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}s`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function ensureReferenceSlot() {
  if (!state.referencePaths.length) {
    state.referencePaths = [""];
    state.referenceNames = [""];
    state.referencePreviewUrls = [""];
  }
}

function addReferenceSlot() {
  ensureReferenceSlot();
  state.referencePaths.push("");
  state.referenceNames.push("");
  state.referencePreviewUrls.push("");
  renderReferenceSlots();
}

function clearReferenceSlot(index) {
  ensureReferenceSlot();
  if (state.referencePaths.length <= 1) {
    state.referencePaths = [""];
    state.referenceNames = [""];
    state.referencePreviewUrls = [""];
  } else {
    state.referencePaths.splice(index, 1);
    state.referenceNames.splice(index, 1);
    state.referencePreviewUrls.splice(index, 1);
  }
  renderReferenceSlots();
  $("runHint").textContent = "Global reference removed";
}

function renderReferenceSlots() {
  ensureReferenceSlot();
  const wrap = $("globalRefSlots");
  if (!wrap) return;
  wrap.innerHTML = "";
  state.referencePaths.forEach((path, index) => {
    const item = document.createElement("article");
    item.className = `reference-slot${path ? " has-image" : ""}`;
    const previewId = `globalRefPreview_${index}`;
    item.innerHTML = `
      <div class="reference-slot-preview" id="${previewId}"></div>
      <div class="reference-slot-controls">
        <label class="reference-file">
          <span>${path ? "Replace image" : "Upload image"}</span>
          <input id="globalRefInput_${index}" type="file" accept="image/*">
        </label>
        <span id="globalRefStatus_${index}" class="hint">${escapeHtml(state.referenceNames[index] || "No image uploaded")}</span>
      </div>
      <button id="globalRefRemove_${index}" class="reference-remove icon-button" type="button" title="Remove reference">x</button>
    `;
    wrap.appendChild(item);
    renderReferencePreview(previewId, state.referencePreviewUrls[index] || "");
    $(`globalRefInput_${index}`).addEventListener("change", () => {
      uploadReferenceImage($(`globalRefInput_${index}`).files[0], index).catch((err) => {
        state.referencePaths[index] = "";
        state.referenceNames[index] = err.message;
        state.referencePreviewUrls[index] = "";
        renderReferenceSlots();
        $("runHint").textContent = `Global reference upload failed: ${err.message}`;
      });
    });
    $(`globalRefRemove_${index}`).addEventListener("click", () => clearReferenceSlot(index));
  });
}

async function uploadReferenceImage(file, index) {
  if (!file) return;
  ensureReferenceSlot();
  const status = $(`globalRefStatus_${index}`);
  status.textContent = "Uploading...";
  const previewUrl = URL.createObjectURL(file);
  renderReferencePreview(`globalRefPreview_${index}`, previewUrl);
  const data = await readFileAsDataUrl(file);
  const uploaded = await api("/api/upload-image", {
    method: "POST",
    body: JSON.stringify({ name: file.name, data }),
  });
  state.referencePaths[index] = uploaded.path;
  state.referenceNames[index] = uploaded.name;
  state.referencePreviewUrls[index] = mediaUrl(uploaded.path);
  renderReferenceSlots();
  $("runHint").textContent = "Global reference uploaded";
}

async function uploadDirectorSegmentImage(segmentId, file) {
  if (!file) return;
  $("directorSegmentImageStatus").textContent = "Uploading image guide...";
  const previewUrl = URL.createObjectURL(file);
  const data = await readFileAsDataUrl(file);
  const uploaded = await api("/api/upload-image", {
    method: "POST",
    body: JSON.stringify({ name: file.name, data }),
  });
  updateDirectorSegment(segmentId, {
    imagePath: uploaded.path,
    imageName: uploaded.name,
    imagePreviewUrl: mediaUrl(uploaded.path) || previewUrl,
  });
  $("runHint").textContent = "Image guide added to selected timeline segment";
}

async function uploadDirectorSegmentAudio(segmentId, file) {
  if (!file) return;
  const anchor = state.directorSegments.find((item) => item.id === segmentId);
  const duration = await readAudioDuration(file);
  const data = await readFileAsDataUrl(file);
  const uploaded = await api("/api/upload-audio", {
    method: "POST",
    body: JSON.stringify({ name: file.name, data }),
  });
  addDirectorAudioClip({
    path: uploaded.path,
    name: uploaded.name,
    duration,
  }, anchor?.start || 0);
  $("runHint").textContent = "Audio clip added to timeline";
}

async function uploadDirectorTimelineAudio(file, start) {
  if (!file) return;
  const duration = await readAudioDuration(file);
  const data = await readFileAsDataUrl(file);
  const uploaded = await api("/api/upload-audio", {
    method: "POST",
    body: JSON.stringify({ name: file.name, data }),
  });
  addDirectorAudioClip({
    path: uploaded.path,
    name: uploaded.name,
    duration,
  }, start);
}

function renderReferencePreview(id, src) {
  const box = $(id);
  if (!box) return;
  if (!src) {
    box.innerHTML = "";
    box.classList.remove("has-image");
    return;
  }
  box.innerHTML = "";
  const img = document.createElement("img");
  img.src = src;
  img.alt = "uploaded reference preview";
  box.appendChild(img);
  box.classList.add("has-image");
}

function renderDirectorSegments(card, run) {
  const box = card.querySelector(".result-segments");
  const timeline = run.director_timeline || null;
  if (!timeline || !Array.isArray(timeline.segments) || !timeline.segments.length) {
    box.innerHTML = "";
    return;
  }
  const video = run.video ? mediaUrl(run.video) : "";
  let cursor = 0;
  box.innerHTML = "";
  timeline.segments.forEach((segment, index) => {
    const start = cursor;
    const end = cursor + Number(segment.duration || 0);
    cursor = end;
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = `S${index + 1} ${formatSeconds(start)}-${formatSeconds(end)}`;
    item.disabled = !video;
    item.addEventListener("click", () => {
      const player = card.querySelector(".media-box video");
      if (!player) return;
      player.currentTime = start;
      player.pause();
    });
    box.appendChild(item);
  });
}

function mediaUrl(path) {
  return `/media?path=${encodeURIComponent(path)}`;
}

function renderBatch(batch) {
  state.activeBatch = batch;
  updateElapsed();
  upsertRuns(batch.runs || [], true);
}

function upsertRuns(runs, newestFirst = false) {
  for (const run of runs) {
    if (isMotionRun(run)) continue;
    if (state.hiddenRunKeys.has(runKey(run))) continue;
    const grid = resultsGridForRun(run);
    const card = ensureRunCard(grid, run, newestFirst);
    updateRunCard(card, run);
  }
}

function upsertMotionRuns(runs, newestFirst = false) {
  const grid = $("motionResultsGrid");
  if (!grid) return;
  for (const run of runs) {
    if (!isMotionRun(run)) continue;
    if (state.hiddenRunKeys.has(runKey(run))) continue;
    const displayRun = motionDisplayRun(run);
    const card = ensureRunCard(grid, displayRun, newestFirst);
    updateRunCard(card, displayRun);
  }
}

function ensureRunCard(grid, run, newestFirst = false) {
  const tpl = $("resultTemplate");
  let card = grid.querySelector(`.result-card[data-run-key="${cssEscape(runKey(run))}"]`);
  if (!card) {
    const node = tpl.content.cloneNode(true);
    card = node.querySelector(".result-card");
    card.dataset.runKey = runKey(run);
    card.querySelector(".use-prompt-run").addEventListener("click", () => {
      if (card._run && isMotionRun(card._run)) useMotionRun(card._run);
      else if (card._run && isDirectorRun(card._run)) useRunTimeline(card._run);
      else useRunPrompt(card.dataset.prompt || "");
    });
    card.querySelector(".use-seed-run").addEventListener("click", () => {
      useRunSeed(card.dataset.seed);
    });
    card.querySelector(".preview-run").addEventListener("click", () => {
      openVideoPreview(card._run || {});
    });
    card.querySelector(".last-frame-run").addEventListener("click", () => {
      captureRunLastFrame(card).catch((err) => {
        $("runHint").textContent = `Last frame failed: ${err.message}`;
      });
    });
    card.querySelector(".pin-run").addEventListener("click", () => {
      const action = card.dataset.pinned === "true" ? "unpin" : "pin";
      updateHistoryState(card.dataset.runKey, action);
    });
    card.querySelector(".delete-run").addEventListener("click", () => {
      updateHistoryState(card.dataset.runKey, "delete");
    });
    if (newestFirst) grid.prepend(node);
    else grid.appendChild(node);
  }
  return card;
}

function motionDisplayRun(run) {
  return {
    ...run,
    motion_result_video: run.video || "",
    video: run.video || run.guide_video || "",
  };
}

function resultsGridForRun(run) {
  return isDirectorRun(run) ? $("directorResultsGrid") : $("resultsGrid");
}

function isDirectorRun(run) {
  const raw = String(run.workflow_mode || run.workflow_id || run.workflow_label || "").toLowerCase();
  return raw.includes("director");
}

function isMotionRun(run) {
  const raw = String(run.workflow_mode || run.workflow_id || run.workflow_label || "").toLowerCase();
  return raw.includes("motion");
}

function runKey(run) {
  return run.history_key || `${run.batch_id}:${run.run_id}`;
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function updateRunCard(card, run) {
  card._run = run;
  card.dataset.pinned = run.pinned ? "true" : "false";
  card.dataset.seed = run.seed || "";
  card.dataset.prompt = run.prompt || "";
  card.classList.toggle("pinned", Boolean(run.pinned));
  const mode = runModeLabel(run);
  const modeTag = card.querySelector(".mode-tag");
  modeTag.textContent = mode;
  modeTag.title = run.workflow_label || run.workflow_id || mode;
  const durationTag = card.querySelector(".duration-tag");
  const duration = runDurationSeconds(run);
  durationTag.textContent = duration ? formatSeconds(duration) : "";
  durationTag.style.display = duration ? "inline-flex" : "none";
  card.querySelector(".run-status").textContent = `${run.status} ${elapsedText(run)}`;
  const usePromptButton = card.querySelector(".use-prompt-run");
  const directorRun = isDirectorRun(run);
  const motionRun = isMotionRun(run);
  const motionFinalRun = motionRun && Boolean(motionFinalVideo(run));
  usePromptButton.textContent = motionRun
    ? (motionFinalRun ? "Use Same Setup" : "Use Motion")
    : directorRun ? "Use Timeline" : "Use Prompt";
  usePromptButton.disabled = motionRun
    ? !run.guide_video
    : directorRun
      ? !(run.director_timeline && Array.isArray(run.director_timeline.segments) && run.director_timeline.segments.length)
      : !run.prompt;
  card.querySelector(".use-seed-run").disabled = !run.seed;
  card.querySelector(".preview-run").disabled = !run.video;
  card.querySelector(".last-frame-run").disabled = !run.video;
  const pinButton = card.querySelector(".pin-run");
  pinButton.title = run.pinned ? "Unpin" : "Pin";
  pinButton.setAttribute("aria-label", run.pinned ? "Unpin" : "Pin");
  pinButton.classList.toggle("active", Boolean(run.pinned));

  const media = card.querySelector(".media-box");
  const mediaKey = run.video
    ? `video:${run.video}`
    : run.contact_sheet
      ? `contact:${run.contact_sheet}`
      : `empty:${run.status || ""}:${run.error || ""}`;
  if (card.dataset.mediaKey !== mediaKey) {
    card.dataset.mediaKey = mediaKey;
    media.classList.toggle("media-empty", !run.video && !run.contact_sheet && !run.error);
    media.textContent = run.error || "";
    if (run.video) {
      media.innerHTML = "";
      media.classList.remove("media-empty");
      const video = document.createElement("video");
      video.src = mediaUrl(run.video);
      video.controls = true;
      video.muted = false;
      video.loop = true;
      media.appendChild(video);
    } else if (run.contact_sheet) {
      media.innerHTML = "";
      media.classList.remove("media-empty");
      const img = document.createElement("img");
      img.src = mediaUrl(run.contact_sheet);
      img.alt = "contact sheet";
      media.appendChild(img);
    }
  }

  const promptLine = card.querySelector(".paths");
  const promptKey = run.prompt || "";
  if (card.dataset.promptKey !== promptKey) {
    card.dataset.promptKey = promptKey;
    promptLine.textContent = promptKey;
  }
  renderDirectorSegments(card, run);
}

function runDurationSeconds(run) {
  const candidates = [
    run.duration,
    run.duration_seconds,
    run.director_timeline?.duration_seconds,
  ];
  const duration = candidates.map(Number).find((value) => Number.isFinite(value) && value > 0);
  return duration || 0;
}

function openVideoPreview(run) {
  if (!run.video) return;
  const modal = $("videoPreviewModal");
  const player = $("videoPreviewPlayer");
  $("videoPreviewTitle").textContent = run.run_id || run.batch_id || "Preview";
  player.src = mediaUrl(run.video);
  player.loop = true;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  player.focus();
}

function closeVideoPreview() {
  const modal = $("videoPreviewModal");
  const player = $("videoPreviewPlayer");
  player.pause();
  player.removeAttribute("src");
  player.load();
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function runModeLabel(run) {
  const raw = String(run.workflow_mode || run.workflow_id || "").toLowerCase();
  if (raw.includes("motion")) return "MOTION";
  if (raw.includes("director")) return "DIR";
  if (raw.includes("ia2v")) return "IA2V";
  if (raw.includes("fml") || raw.includes("fmf")) return "FML";
  if (raw.includes("flf")) return "FLF";
  if (raw.includes("t2v")) return "T2V";
  if (raw.includes("i2v")) return "I2V";
  return "GEN";
}

function waitForVideoEvent(video, eventName) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener(eventName, onEvent);
      video.removeEventListener("error", onError);
    };
    const onEvent = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("video could not be read"));
    };
    video.addEventListener(eventName, onEvent, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function ensureVideoMetadata(video) {
  if (Number.isFinite(video.duration) && video.duration > 0 && video.videoWidth && video.videoHeight) return;
  await waitForVideoEvent(video, "loadedmetadata");
}

async function seekVideo(video, time) {
  if (Math.abs(video.currentTime - time) < 0.02) return;
  const done = waitForVideoEvent(video, "seeked");
  video.currentTime = time;
  await done;
}

async function captureRunLastFrame(card) {
  const run = card._run || {};
  if (!run.video) throw new Error("no video on this result");
  const frame = await api("/api/last-frame", {
    method: "POST",
    body: JSON.stringify({ video: run.video }),
  });
  const link = document.createElement("a");
  link.href = mediaUrl(frame.path);
  link.download = frame.name || `${run.run_id || "camera_lab"}_last_frame.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  $("runHint").textContent = "Last frame saved";
}

function useRunSeed(seed) {
  if (!seed) return;
  $("seedInput").value = seed;
  const directorSeedInput = $("directorSeedInput");
  if (directorSeedInput) directorSeedInput.value = seed;
  $("runHint").textContent = `Seed set to ${seed}`;
}

function useRunPrompt(prompt) {
  if (!prompt) return;
  $("promptText").value = prompt;
  $("runHint").textContent = "Prompt copied from result";
}

function setInputIfPresent(id, value) {
  if (value === undefined || value === null || value === "") return;
  $(id).value = String(value);
}

function fileNameFromPath(path) {
  return String(path || "").split(/[\\/]/).pop() || "";
}

function motionFinalVideo(run) {
  if (run.motion_result_video) return run.motion_result_video;
  if (run.video && run.video !== run.guide_video) return run.video;
  return "";
}

function motionReferencePath(run) {
  return run.reference_image || run.reference_path || run.source_path || "";
}

function restoreMotionSize(run) {
  const width = Number(run.width);
  const height = Number(run.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
  const size = `${Math.round(width)}x${Math.round(height)}`;
  $("motionCustomSizeInput").value = size;
  const preset = [...$("motionSizePreset").options].find((option) => option.value === size);
  if (preset) $("motionSizePreset").value = size;
  $("motionSizeScale").value = "100";
  updateMotionSizeReadout();
}

function restoreMotionTrim(run) {
  const start = Number(run.guide_trim_start ?? run.trim_start);
  const end = Number(run.guide_trim_end ?? run.trim_end);
  if (Number.isFinite(start)) {
    $("motionTrimStart").value = String(Math.max(0, start));
    $("motionTrimStartRange").value = $("motionTrimStart").value;
  }
  if (Number.isFinite(end) && end > 0) {
    $("motionTrimEnd").value = String(end);
    $("motionTrimEndRange").value = $("motionTrimEnd").value;
  }
  updateMotionTrimDisplay();
}

function restoreMotionGuide(run) {
  if (!run.guide_video) return false;
  state.motionBatch = null;
  state.motionGuideVideoPath = run.guide_video;
  const guide = $("motionGuide");
  guide.pause();
  guide.src = mediaUrl(run.guide_video);
  $("motionGuideUploadStatus").textContent = fileNameFromPath(run.guide_video);
  $("motionGuideState").textContent = "ready";
  setMotionTrimBounds(Number(run.duration) || motionGuideDurationFallback(), true);
  restoreMotionTrim(run);
  return true;
}

function restoreMotionReference(run) {
  const referencePath = motionReferencePath(run);
  state.motionRefPath = referencePath;
  setImagePreview("motion_ref", referencePath ? mediaUrl(referencePath) : "");
  $("motionRefStatus").textContent = referencePath ? fileNameFromPath(referencePath) : imageSlots.motion_ref.empty;
}

function useMotionRun(run) {
  if (!run || !run.guide_video) return;
  setWorkspace("motion", { syncWorkflow: false });
  if (run.prompt) $("motionPrompt").value = run.prompt;
  setInputIfPresent("motionDuration", run.duration);
  setInputIfPresent("motionSeed", run.seed);
  setInputIfPresent("motionScailSeed", run.seed);
  setInputIfPresent("motionSteps", run.steps);
  setInputIfPresent("motionPoseStrength", run.pose_strength);
  setInputIfPresent("motionCfg", run.cfg_scale);
  $("motionPoseReadout").textContent = Number($("motionPoseStrength").value).toFixed(2);
  $("motionCfgReadout").textContent = Number($("motionCfg").value).toFixed(1);
  restoreMotionSize(run);
  restoreMotionGuide(run);
  const finalVideo = motionFinalVideo(run);
  setMotionSubtab(finalVideo ? "scail" : "text");
  if (finalVideo) {
    restoreMotionReference(run);
    const result = $("motionResult");
    result.pause();
    result.src = mediaUrl(finalVideo);
    $("motionResultState").textContent = "ready";
    $("motionStatus").textContent = `Setup restored from ${run.batch_id || "result"}`;
  } else {
    clearMotionResult();
    $("motionStatus").textContent = `Motion guide loaded from ${run.batch_id || "result"}`;
  }
  updateMotionRunAvailability();
}

function setMotionSubtab(tab) {
  state.motionSubtab = ["text", "scail", "3d"].includes(tab) ? tab : "text";
  updateMotionSubtabs();
}

function updateMotionSubtabs() {
  const tabs = [
    ["text", "motionTextTab", "motionTextPanel"],
    ["scail", "motionScailTab", "motionScailPanel"],
    ["3d", "motion3dTab", "motion3dPanel"],
  ];
  for (const [name, tabId, panelId] of tabs) {
    const active = state.motionSubtab === name;
    $(tabId).classList.toggle("active", active);
    $(tabId).setAttribute("aria-selected", active ? "true" : "false");
    $(panelId).hidden = !active;
    $(panelId).classList.toggle("active", active);
  }
  moveMotionGuidePreview();
  moveMotionVideoPanel();
}

function moveMotionGuidePreview() {
  const panel = $("motionGuidePreviewCard");
  const target = $(state.motionSubtab === "scail" ? "motionScailGuideMount" : "motionTextGuideMount");
  if (panel && target && panel.parentElement !== target) {
    target.appendChild(panel);
  }
}

function moveMotionVideoPanel() {
  const panel = document.querySelector(".motion-video-panel");
  const target = $(state.motionSubtab === "scail" ? "motionScailMount" : "motionTextScailMount");
  if (panel && target && panel.parentElement !== target) {
    target.appendChild(panel);
  }
}

function savedFrameSeconds(value, fallback = 0) {
  const frame = Number(value);
  return Number.isFinite(frame) ? frame / 24 : fallback;
}

function useRunTimeline(run) {
  const timeline = run.director_timeline || null;
  if (!timeline || !Array.isArray(timeline.segments) || !timeline.segments.length) {
    $("runHint").textContent = "No director timeline saved on this result";
    return;
  }
  setWorkspace("director");
  $("directorGlobalPrompt").value = timeline.global_prompt || run.global_prompt || "";
  $("directorGlobalReferenceStrength").value = timeline.global_reference_strength ?? run.global_reference_strength ?? 0.35;
  if (run.seed) useRunSeed(run.seed);
  const refs = Array.isArray(run.reference_images) ? run.reference_images.filter(Boolean) : [];
  state.referencePaths = refs.length ? refs : [""];
  state.referenceNames = state.referencePaths.map(fileNameFromPath);
  state.referencePreviewUrls = state.referencePaths.map((path) => (path ? mediaUrl(path) : ""));
  state.directorSegments = timeline.segments.map((segment, index) => {
    const duration = Math.max(0.5, Number(segment.duration) || Number(segment.length || segment.frames || 0) / 24 || 4);
    const start = Number.isFinite(Number(segment.start_frame))
      ? savedFrameSeconds(segment.start_frame)
      : Number.isFinite(Number(segment.start))
        ? savedFrameSeconds(segment.start)
        : Number.isFinite(Number(segment.guide_frame))
          ? savedFrameSeconds(segment.guide_frame)
          : 0;
    const guideFrame = Number.isFinite(Number(segment.guide_frame)) ? Number(segment.guide_frame) : Math.round(start * 24);
    const guideOffsetFrames = guideFrame - Math.round(start * 24);
    const imagePath = segment.image_path || "";
    return {
      id: segment.id || `seg_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      start,
      duration,
      guideOffsetFrames,
      prompt: segment.prompt || "",
      reference: "",
      imagePath,
      imageName: fileNameFromPath(imagePath),
      imagePreviewUrl: imagePath ? mediaUrl(imagePath) : "",
      strength: segment.strength ?? (index === 0 ? 1 : 0.85),
    };
  });
  state.directorAudioSegments = (timeline.audio_segments || timeline.audioSegments || []).map((segment, index) => {
    const duration = Math.max(0.5, Number(segment.duration) || Number(segment.length || 0) / 24 || 1);
    const start = Number.isFinite(Number(segment.start_frame))
      ? savedFrameSeconds(segment.start_frame)
      : Number.isFinite(Number(segment.start))
        ? savedFrameSeconds(segment.start)
        : 0;
    const audioPath = segment.audio_path || segment.file || "";
    return {
      id: segment.id || `aud_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      start,
      duration,
      audioPath,
      audioName: segment.fileName || fileNameFromPath(audioPath),
      audioDuration: Number(segment.audio_duration || segment.audioDuration || 0) || duration,
      trimStart: savedFrameSeconds(segment.trim_start ?? segment.trimStart, 0),
    };
  });
  for (const segment of timeline.segments) {
    if (!segment.audio_path) continue;
    const start = Number.isFinite(Number(segment.start_frame)) ? Number(segment.start_frame) / 24 : 0;
    const duration = Math.max(0.5, Number(segment.duration) || Number(segment.frames || 0) / 24 || 1);
    state.directorAudioSegments.push({
      id: `aud_legacy_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      start,
      duration,
      audioPath: segment.audio_path,
      audioName: fileNameFromPath(segment.audio_path),
      audioDuration: duration,
      trimStart: 0,
    });
  }
  state.directorSelectedId = state.directorSegments[0]?.id || "";
  state.directorSelectionType = "image";
  renderReferenceSlots();
  renderDirectorEditor();
  $("runHint").textContent = `Timeline restored from ${run.batch_id || "result"}`;
}

function imageSlotValue(kind) {
  const slot = imageSlots[kind];
  return {
    path: state[slot.pathKey],
    src: $(slot.previewId).getAttribute("src") || "",
    status: $(slot.statusId).textContent,
  };
}

function setImagePreview(kind, src) {
  const slot = imageSlots[kind];
  const preview = $(slot.previewId);
  const previewBox = preview.parentElement;
  if (src) {
    preview.src = src;
    previewBox.classList.add("has-image");
    return;
  }
  preview.removeAttribute("src");
  previewBox.classList.remove("has-image");
}

function setImageSlotValue(kind, value) {
  const slot = imageSlots[kind];
  state[slot.pathKey] = value.path || "";
  setImagePreview(kind, value.src || "");
  $(slot.statusId).textContent = value.status || slot.empty;
}

function swapImageSlots(a, b) {
  const first = imageSlotValue(a);
  const second = imageSlotValue(b);
  if (!first.path && !second.path) {
    $("runHint").textContent = "No uploaded images to swap";
    return;
  }
  setImageSlotValue(a, second);
  setImageSlotValue(b, first);
  $("runHint").textContent = `Swapped ${a} and ${b}`;
}

function updateElapsed() {
  if (!state.activeBatch) return;
  $("queueText").textContent = `${state.activeBatch.batch_id} / ${state.activeBatch.status} ${elapsedText(state.activeBatch)}`;
  for (const run of state.activeBatch.runs || []) {
    if (isMotionRun(run)) continue;
    const grid = resultsGridForRun(run);
    const card = grid.querySelector(`.result-card[data-run-key="${cssEscape(runKey(run))}"]`);
    if (card) card.querySelector(".run-status").textContent = `${run.status} ${elapsedText(run)}`;
  }
}

function elapsedText(item) {
  const start = item.started_at || item.queued_at;
  if (!start) return "";
  const end = item.finished_at || Date.now() / 1000;
  return `(${formatDuration(Math.max(0, end - start))})`;
}

function formatDuration(seconds) {
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

async function pollBatch() {
  if (!state.activeBatch) return;
  try {
    const batch = await api(`/api/batches/${state.activeBatch.batch_id}`);
    renderBatch(batch);
    if (!["done", "error"].includes(batch.status)) {
      state.pollTimer = setTimeout(pollBatch, 5000);
    } else {
      await loadHistory({ replace: false });
    }
  } catch (err) {
    $("runHint").textContent = err.message;
    state.pollTimer = setTimeout(pollBatch, 5000);
  }
}

async function loadHistory({ replace = true } = {}) {
  const data = await api("/api/history?limit=200");
  if (replace) {
    $("resultsGrid").innerHTML = "";
    $("directorResultsGrid").innerHTML = "";
    $("motionResultsGrid").innerHTML = "";
  }
  upsertRuns(data.runs || [], false);
  upsertMotionRuns(data.runs || [], false);
}

function startHistoryRefresh() {
  if (state.historyTimer) clearInterval(state.historyTimer);
  state.historyTimer = setInterval(() => {
    loadHistory({ replace: false }).catch((err) => {
      $("runHint").textContent = err.message;
    });
  }, 10000);
}

async function updateHistoryState(key, action) {
  const result = await api("/api/history-state", {
    method: "POST",
    body: JSON.stringify({ key, action }),
  });
  if (action === "delete") {
    state.hiddenRunKeys.add(key);
    const card = document.querySelector(`#resultsGrid .result-card[data-run-key="${cssEscape(key)}"], #directorResultsGrid .result-card[data-run-key="${cssEscape(key)}"], #motionResultsGrid .result-card[data-run-key="${cssEscape(key)}"]`);
    if (card) card.remove();
    const recycled = result.recycled || [];
    const canceled = result.cancel || [];
    $("runHint").textContent = recycled.length
      ? `Moved ${recycled.length} file(s) to Recycle Bin`
      : canceled.length
        ? "Canceled queued/running ComfyUI task"
        : "Deleted from history";
    return;
  }
  await loadHistory();
}

async function startBatch() {
  $("runBtn").disabled = true;
  $("runBtn").textContent = "Queueing...";
  try {
    const batch = await api("/api/run", {
      method: "POST",
      body: JSON.stringify(collectPayload()),
    });
    renderBatch(batch);
    if (state.clockTimer) clearInterval(state.clockTimer);
    state.clockTimer = setInterval(updateElapsed, 1000);
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(pollBatch, 1500);
  } catch (err) {
    $("runHint").textContent = err.message;
  } finally {
    $("runBtn").disabled = false;
    $("runBtn").textContent = "Queue Run";
  }
}

function motionPayload(seedInputId = "motionSeed") {
  const size = currentMotionSize();
  const duration = Number($("motionDuration").value);
  const steps = Number($("motionSteps").value);
  const poseStrength = Number($("motionPoseStrength").value);
  const cfgScale = Number($("motionCfg").value);
  return {
    prompt: $("motionPrompt").value.trim(),
    reference_path: state.motionRefPath,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 4,
    width: size.width,
    height: size.height,
    steps: Number.isFinite(steps) && steps > 0 ? steps : 8,
    seed: $(seedInputId).value.trim(),
    rewrite: $("motionRewrite").checked,
    pose_strength: Number.isFinite(poseStrength) ? poseStrength : 1,
    cfg_scale: Number.isFinite(cfgScale) ? cfgScale : 5,
  };
}

function roundMotionTime(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.max(0, number) * 100) / 100 : 0;
}

const MOTION_TRIM_GAP = 0.05;

function motionGuideDurationFallback() {
  const videoDuration = Number($("motionGuide").duration);
  if (Number.isFinite(videoDuration) && videoDuration > 0) return videoDuration;
  const inputDuration = Number($("motionDuration").value);
  if (Number.isFinite(inputDuration) && inputDuration > 0) return inputDuration;
  return state.motionGuideDuration || 4;
}

function setMotionTrimBounds(duration, reset = false) {
  const max = Math.max(0.05, roundMotionTime(duration || motionGuideDurationFallback()));
  state.motionGuideDuration = max;
  for (const id of ["motionTrimStart", "motionTrimEnd", "motionTrimStartRange", "motionTrimEndRange"]) {
    const input = $(id);
    input.max = String(max);
  }
  if (reset || Number($("motionTrimEnd").value) <= 0) {
    $("motionTrimStart").value = "0";
    $("motionTrimStartRange").value = "0";
    $("motionTrimEnd").value = String(max);
    $("motionTrimEndRange").value = String(max);
  }
  updateMotionTrimDisplay();
}

function motionTrimValues(sourceId = "") {
  const max = motionGuideDurationFallback();
  let start = roundMotionTime($("motionTrimStart").value);
  let end = roundMotionTime($("motionTrimEnd").value);
  const startChanged = sourceId === "motionTrimStart" || sourceId === "motionTrimStartRange";
  const endChanged = sourceId === "motionTrimEnd" || sourceId === "motionTrimEndRange";
  if (!end) end = max;
  if (startChanged) {
    end = Math.min(Math.max(MOTION_TRIM_GAP, end), max);
    start = Math.min(Math.max(0, start), Math.max(0, end - MOTION_TRIM_GAP));
  } else if (endChanged) {
    start = Math.min(Math.max(0, start), Math.max(0, max - MOTION_TRIM_GAP));
    end = Math.min(Math.max(start + MOTION_TRIM_GAP, end), max);
  } else {
    start = Math.min(Math.max(0, start), Math.max(0, max - MOTION_TRIM_GAP));
    end = Math.min(Math.max(start + MOTION_TRIM_GAP, end), max);
  }
  return { start, end, duration: roundMotionTime(end - start) };
}

function updateMotionTrimDisplay(sourceId = "") {
  const { start, end, duration } = motionTrimValues(sourceId);
  $("motionTrimStart").value = String(start);
  $("motionTrimEnd").value = String(end);
  $("motionTrimStartRange").value = String(start);
  $("motionTrimEndRange").value = String(end);
  $("motionTrimStartReadout").textContent = `${start.toFixed(2)}s`;
  $("motionTrimEndReadout").textContent = `${end.toFixed(2)}s`;
  $("motionTrimDuration").textContent = `${duration.toFixed(2)}s`;
}

function motionTrimPayload() {
  const { start, end } = motionTrimValues();
  return {
    guide_trim_start: start,
    guide_trim_end: end,
  };
}

function playMotionTrim() {
  const video = $("motionGuide");
  if (!video.getAttribute("src")) return;
  const { start } = motionTrimValues();
  state.motionTrimPlaying = true;
  video.currentTime = start;
  const promise = video.play();
  if (promise?.catch) promise.catch(() => {
    state.motionTrimPlaying = false;
  });
}

function currentMotionRun() {
  return (state.motionBatch?.runs || [])[0] || {};
}

function hasMotionGuideVideo() {
  return Boolean(currentMotionRun().guide_video || state.motionGuideVideoPath);
}

function updateMotionRunAvailability() {
  $("motionRunBtn").disabled = !(hasMotionGuideVideo() && state.motionRefPath);
}

function clearMotionVideos() {
  state.motionGuideVideoPath = "";
  $("motionGuideUploadStatus").textContent = "No video uploaded";
  setMotionTrimBounds(Number($("motionDuration").value) || 4, true);
  for (const id of ["motionGuide", "motionResult"]) {
    const video = $(id);
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  $("motionGuideState").textContent = "waiting";
  $("motionResultState").textContent = "waiting";
  $("motionRunBtn").disabled = true;
}

function clearMotionResult() {
  const video = $("motionResult");
  video.pause();
  video.removeAttribute("src");
  video.load();
  $("motionResultState").textContent = "waiting";
}

function renderMotionBatch(batch) {
  state.motionBatch = batch;
  upsertMotionRuns(batch.runs || [], true);
  const run = (batch.runs || [])[0] || {};
  $("motionStatus").textContent = `${batch.batch_id} / ${run.status || batch.status} ${elapsedText(run)}`;
  if (run.error) $("motionStatus").textContent = run.error;
  if (run.guide_video) {
    const guideSrc = mediaUrl(run.guide_video);
    if ($("motionGuide").getAttribute("src") !== guideSrc) {
      $("motionGuide").src = guideSrc;
    }
    setMotionTrimBounds(Number(run.duration) || motionGuideDurationFallback(), true);
    $("motionGuideState").textContent = "ready";
    updateMotionRunAvailability();
  } else if (run.status === "running_motion") {
    $("motionGuideState").textContent = "rendering";
    $("motionRunBtn").disabled = true;
  }
  if (run.video) {
    const resultSrc = mediaUrl(run.video);
    if ($("motionResult").getAttribute("src") !== resultSrc) {
      $("motionResult").src = resultSrc;
    }
    $("motionResultState").textContent = "ready";
  } else if (run.status === "running_video") {
    $("motionResultState").textContent = "rendering";
    $("motionRunBtn").disabled = true;
  }
  if (["done", "guide_done", "error"].includes(run.status || batch.status) && run.guide_video) {
    updateMotionRunAvailability();
  }
}

async function pollMotion() {
  if (!state.motionBatch) return;
  try {
    const batch = await api(`/api/batches/${state.motionBatch.batch_id}`);
    renderMotionBatch(batch);
    if (!["done", "error"].includes(batch.status)) {
      state.pollTimer = setTimeout(pollMotion, 5000);
    } else {
      await loadHistory({ replace: false });
    }
  } catch (err) {
    $("motionStatus").textContent = err.message;
    state.pollTimer = setTimeout(pollMotion, 5000);
  }
}

async function startMotionGuide() {
  const payload = motionPayload();
  if (!payload.prompt) {
    $("motionStatus").textContent = "Prompt is required";
    return;
  }
  $("motionGuideBtn").disabled = true;
  $("motionGuideBtn").textContent = "Generating...";
  $("motionRunBtn").disabled = true;
  state.motionGuideVideoPath = "";
  $("motionGuideUploadStatus").textContent = "No video uploaded";
  clearMotionVideos();
  try {
    const batch = await api("/api/text-to-motion-guide", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    renderMotionBatch(batch);
    if (state.clockTimer) clearInterval(state.clockTimer);
    state.clockTimer = setInterval(updateElapsed, 1000);
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(pollMotion, 1500);
  } catch (err) {
    $("motionStatus").textContent = err.message;
  } finally {
    $("motionGuideBtn").disabled = false;
    $("motionGuideBtn").textContent = "Generate Motion Guide";
  }
}

async function startMotionFinal() {
  const payload = motionPayload("motionScailSeed");
  const run = currentMotionRun();
  const guideVideoPath = run.guide_video || state.motionGuideVideoPath;
  if (!guideVideoPath) {
    $("motionStatus").textContent = "Generate or upload a motion guide first";
    return;
  }
  if (!payload.reference_path) {
    $("motionStatus").textContent = "Reference image is required";
    return;
  }
  $("motionRunBtn").disabled = true;
  $("motionRunBtn").textContent = "Rendering...";
  clearMotionResult();
  try {
    const endpoint = state.motionBatch && run.guide_video ? "/api/text-to-motion-final" : "/api/text-to-motion-video-final";
    const body = endpoint === "/api/text-to-motion-final"
      ? { ...payload, ...motionTrimPayload(), batch_id: state.motionBatch.batch_id, run_id: run.run_id }
      : { ...payload, ...motionTrimPayload(), guide_video_path: guideVideoPath };
    const batch = await api(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
    });
    renderMotionBatch(batch);
    if (state.clockTimer) clearInterval(state.clockTimer);
    state.clockTimer = setInterval(updateElapsed, 1000);
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(pollMotion, 1500);
  } catch (err) {
    $("motionStatus").textContent = err.message;
    $("motionRunBtn").disabled = false;
  } finally {
    $("motionRunBtn").textContent = "Render Final Video";
  }
}

async function uploadMotionGuideVideo(file) {
  if (!file) return;
  $("motionGuideUploadStatus").textContent = "Uploading...";
  const form = new FormData();
  form.append("file", file, file.name);
  const uploaded = await uploadFile("/api/upload-video", form);
  state.motionGuideVideoPath = uploaded.path;
  state.motionBatch = null;
  const video = $("motionGuide");
  video.pause();
  video.src = mediaUrl(uploaded.path);
  setMotionTrimBounds(Number($("motionDuration").value) || 4, true);
  $("motionGuideState").textContent = "uploaded";
  $("motionGuideUploadStatus").textContent = uploaded.name;
  clearMotionResult();
  $("motionStatus").textContent = "Guide video uploaded. Ready for SCAIL2.";
  updateMotionRunAvailability();
}

function fillPythonFormatTemplate(template, text) {
  return String(template || "")
    .replaceAll("{{", "\u0000")
    .replaceAll("}}", "\u0001")
    .replace("{}", text)
    .replaceAll("\u0000", "{")
    .replaceAll("\u0001", "}");
}

async function copyMotionRewritePrompt() {
  const text = $("motionPrompt").value.trim();
  if (!text) {
    $("motionStatus").textContent = "Prompt is required";
    return;
  }
  const template = state.config?.motion_rewrite_prompt_format || "";
  if (!template) {
    $("motionStatus").textContent = "Rewrite template is unavailable";
    return;
  }
  const filled = fillPythonFormatTemplate(template, text);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(filled);
  } else {
    const ta = document.createElement("textarea");
    ta.value = filled;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  $("motionStatus").textContent = "Copied";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function readAudioDuration(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve(0);
      return;
    }
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const finish = (value) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.addEventListener("loadedmetadata", () => {
      finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
    }, { once: true });
    audio.addEventListener("error", () => finish(0), { once: true });
    audio.src = url;
  });
}

async function uploadAudio() {
  const file = $("audioInput").files[0];
  if (!file) return;
  $("audioStatus").textContent = "Uploading...";
  const data = await readFileAsDataUrl(file);
  const uploaded = await api("/api/upload-audio", {
    method: "POST",
    body: JSON.stringify({ name: file.name, data }),
  });
  state.audioPath = uploaded.path;
  $("audioStatus").textContent = uploaded.name;
}

function populateAudioLibrary() {
  const sel = $("audioLibrarySelect");
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">From casting library…</option>';
  (state.castingLibrary || []).forEach((clip) => {
    const o = document.createElement("option");
    o.value = clip.file;
    o.textContent = clip.name + (clip.voice ? ` · ${clip.voice}` : "");
    sel.appendChild(o);
  });
  sel.value = current;
}

async function uploadImage(file, kind) {
  if (!file) return;
  const slot = imageSlots[kind];
  if (!slot) throw new Error("unknown image slot");
  const status = $(slot.statusId);
  status.textContent = "Uploading...";
  const data = await readFileAsDataUrl(file);
  const uploaded = await api("/api/upload-image", {
    method: "POST",
    body: JSON.stringify({ name: file.name, data }),
  });
  state[slot.pathKey] = uploaded.path;
  setImagePreview(kind, mediaUrl(uploaded.path));
  status.textContent = uploaded.name;
  if (kind === "motion_ref") updateMotionRunAvailability();
}

// --- Casting tab ---
function castingStatus() {
  return (state.config && state.config.casting) || { cosyvoice: { available: false, reason: "" }, llm: { available: false, reason: "" }, voices: [], emotions: [] };
}

function renderCastingStatus() {
  const cs = castingStatus();
  const el = $("castingStatus");
  if (!el) return;
  const llm = cs.llm.available ? `LLM: ${cs.llm.model || "ok"}` : `LLM: off (${cs.llm.reason || "unavailable"})`;
  const tts = cs.cosyvoice.available ? `CosyVoice: ${cs.cosyvoice.version || "ok"}` : `CosyVoice: off (${cs.cosyvoice.reason || "unavailable"})`;
  el.textContent = `${llm}  ·  ${tts}`;
  el.className = `casting-status ${cs.llm.available && cs.cosyvoice.available ? "ok" : "bad"}`;
  const voices = (cs.voices || []).map((v) => v.label).join(", ");
  if ($("castingLegend")) $("castingLegend").textContent = voices ? `Voices: ${voices} · Emotions: ${(cs.emotions || []).join(", ")}` : "";
  if ($("castingAnalyzeBtn")) $("castingAnalyzeBtn").disabled = !cs.llm.available;
  renderCastingSetupWarning(cs);
}

function renderCastingSetupWarning(cs) {
  const warning = $("castingSetupWarning");
  if (!warning) return;
  const messages = [];
  if (!cs.llm.available) {
    messages.push(`LLM offline: ${cs.llm.reason || "not reachable"}`);
  }
  if (!cs.cosyvoice.available) {
    messages.push(`CosyVoice setup missing: ${cs.cosyvoice.reason || "unavailable"}`);
    messages.push("Expected repo-local paths: tts/cosyvoice, tts/models/Fun-CosyVoice3-0.5B, and tts/voices. You can use a symlink or junction to point these folders at an existing local install.");
  }
  warning.hidden = !messages.length;
  warning.textContent = messages.join(" ");
}

function makeCastingSelect(options, value, onChange) {
  const sel = document.createElement("select");
  options.forEach((opt) => {
    const option = typeof opt === "string" ? { value: opt, label: opt } : opt;
    const o = document.createElement("option");
    o.value = option.value;
    o.textContent = option.label;
    if (option.value === value) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener("change", () => onChange(sel.value));
  return sel;
}

function castingLineSpeed(line) {
  const speed = Number(line?.speed);
  if (!Number.isFinite(speed) || speed <= 0) return 1;
  return Math.max(0.6, Math.min(1.4, speed));
}

function updateCastingGenerateControls() {
  const cs = castingStatus();
  const hasMissingVoice = state.castingLines.some((line) => (line.text || "").trim() && !line.voice);
  const hasSpeakableLine = state.castingLines.some((line) => (line.text || "").trim());
  const canGenerateAll = Boolean(cs.cosyvoice.available && hasSpeakableLine);
  const allBtn = $("castingGenerateBtn");
  if (allBtn) {
    allBtn.disabled = !canGenerateAll;
    allBtn.title = hasMissingVoice ? "Select a voice for every line before generating." : "";
  }
  document.querySelectorAll("[data-casting-line-generate]").forEach((button) => {
    const line = state.castingLines[Number(button.dataset.lineIndex)];
    const missingVoice = Boolean((line?.text || "").trim() && !line?.voice);
    button.disabled = !cs.cosyvoice.available || !(line?.text || "").trim();
    button.title = missingVoice ? "Select a voice before generating this line." : "";
  });
}

function stopCastingPreview() {
  const preview = state.castingPreview;
  if (preview?.player) {
    preview.player.pause();
    preview.player.src = "";
  }
  if (preview?.button?.isConnected) {
    setCastingPreviewButtonState(preview.button, false);
    preview.button.classList.remove("active");
  }
  state.castingPreview = null;
}

const ACTION_ICONS = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7-11-7z"></path></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z"></path></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 17.3V20h2.7L18.8 8.9l-2.7-2.7L5 17.3zm13.9-10.5 1.3-1.3c.4-.4.4-1 0-1.4l-.3-.3c-.4-.4-1-.4-1.4 0l-1.3 1.3 2.7 2.7z"></path></svg>',
  delete: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8l1 2h4v2H3V6h4l1-2zm-1 6h10l-.8 10H7.8L7 10zm3 2v6h2v-6h-2zm4 0v6h2v-6h-2z"></path></svg>',
  save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h12l2 2v16H5V3zm3 2v5h8V5H8zm0 10v4h8v-4H8z"></path></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6 6.4 5z"></path></svg>',
};

function makeActionIconButton(icon, label, className = "") {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `compact-icon-button ${className}`.trim();
  btn.innerHTML = ACTION_ICONS[icon] || "";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  return btn;
}

function setCastingPreviewButtonState(btn, active) {
  btn.innerHTML = ACTION_ICONS[active ? "stop" : "play"];
  btn.title = active ? "Stop preview" : (btn.dataset.idleLabel || "Play preview");
  btn.setAttribute("aria-label", btn.title);
}

function makeCastingPreviewButton(url, label = "Play preview") {
  const btn = makeActionIconButton("play", label, "casting-play-button");
  btn.dataset.idleLabel = label;
  btn.disabled = !url;
  btn.addEventListener("click", async () => {
    if (state.castingPreview?.url === url) {
      stopCastingPreview();
      return;
    }
    stopCastingPreview();
    const player = new Audio(url);
    state.castingPreview = { url, player, button: btn };
    setCastingPreviewButtonState(btn, true);
    btn.classList.add("active");
    const stopIfCurrent = () => {
      if (state.castingPreview?.player === player) stopCastingPreview();
    };
    player.addEventListener("ended", stopIfCurrent, { once: true });
    player.addEventListener("error", stopIfCurrent, { once: true });
    try {
      await player.play();
    } catch (err) {
      if (state.castingPreview?.player !== player) return;
      stopCastingPreview();
      alert(`Preview failed: ${err.message}`);
    }
  });
  return btn;
}

async function analyzeCasting() {
  const script = $("castingScript").value.trim();
  if (!script) return;
  const btn = $("castingAnalyzeBtn");
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Analyzing…";
  try {
    const result = await api("/api/casting/analyze", { method: "POST", body: JSON.stringify({ script }) });
    state.castingLines = result.lines || [];
    renderCastingTable();
  } catch (err) {
    $("castingTableWrap").innerHTML = `<div class="hint bad">${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

function defaultCastingEmotion() {
  const emotions = castingStatus().emotions || [];
  return emotions.includes("neutral") ? "neutral" : (emotions[0] || "neutral");
}

function addCastingLine() {
  state.castingLines.push({
    text: "",
    voice: "",
    emotion: defaultCastingEmotion(),
    speed: 1,
  });
  renderCastingTable();
  const rows = document.querySelectorAll("[data-casting-line-row]");
  const row = rows[rows.length - 1];
  row?.querySelector("textarea")?.focus();
}

function renderCastingTable() {
  const wrap = $("castingTableWrap");
  const cs = castingStatus();
  if (!state.castingLines.length) {
    wrap.innerHTML = '<div class="casting-empty-state"><div>No lines yet</div></div>';
    $("castingGenerateBtn").disabled = true;
    return;
  }
  const voiceOpts = [
    { value: "", label: "Select voice..." },
    ...(cs.voices || []).map((v) => ({ value: v.id, label: v.label || v.id })),
  ];
  const emoOpts = cs.emotions || [];
  const list = document.createElement("div");
  list.className = "casting-line-list";
  state.castingLines.forEach((line, idx) => {
    line.speed = castingLineSpeed(line);
    const row = document.createElement("article");
    row.className = "casting-line-card";
    row.dataset.castingLineRow = "1";
    const meta = document.createElement("div");
    meta.className = "casting-line-meta";
    const num = document.createElement("span");
    num.className = "casting-line-number";
    num.textContent = String(idx + 1).padStart(2, "0");
    const stateLabel = document.createElement("span");
    stateLabel.className = line.url ? "casting-line-state ready" : "casting-line-state";
    stateLabel.textContent = line.url ? "Ready" : "Draft";
    meta.appendChild(num);
    meta.appendChild(stateLabel);
    row.appendChild(meta);

    const body = document.createElement("div");
    body.className = "casting-line-body";
    const ta = document.createElement("textarea");
    ta.className = "casting-line-text";
    ta.rows = 2;
    ta.value = line.text;
    ta.addEventListener("input", () => {
      line.text = ta.value;
      updateCastingGenerateControls();
    });
    body.appendChild(ta);

    const controls = document.createElement("div");
    controls.className = "casting-line-controls";
    const voiceLabel = document.createElement("label");
    voiceLabel.textContent = "Voice";
    voiceLabel.appendChild(makeCastingSelect(voiceOpts, line.voice || "", (val) => {
      line.voice = val;
      updateCastingGenerateControls();
    }));
    const emotionLabel = document.createElement("label");
    emotionLabel.textContent = "Emotion";
    emotionLabel.appendChild(makeCastingSelect(emoOpts, line.emotion, (val) => { line.emotion = val; }));
    const speedLabel = document.createElement("label");
    speedLabel.textContent = "Speed";
    const speedWrap = document.createElement("div");
    speedWrap.className = "casting-speed-control";
    const speedInput = document.createElement("input");
    speedInput.type = "range";
    speedInput.min = "0.6";
    speedInput.max = "1.4";
    speedInput.step = "0.05";
    speedInput.value = String(line.speed);
    const speedValue = document.createElement("span");
    speedValue.textContent = `${line.speed.toFixed(2)}x`;
    speedInput.addEventListener("input", () => {
      line.speed = castingLineSpeed({ speed: speedInput.value });
      speedValue.textContent = `${line.speed.toFixed(2)}x`;
    });
    speedWrap.appendChild(speedInput);
    speedWrap.appendChild(speedValue);
    speedLabel.appendChild(speedWrap);
    controls.appendChild(voiceLabel);
    controls.appendChild(emotionLabel);
    controls.appendChild(speedLabel);
    body.appendChild(controls);
    row.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "casting-audio-actions";
    if (line.url) {
      actions.appendChild(makeCastingPreviewButton(line.url, `Preview line ${idx + 1}`));
    } else {
      const pending = document.createElement("span");
      pending.className = "casting-audio-pending";
      pending.textContent = "No audio";
      actions.appendChild(pending);
    }
    const regen = document.createElement("button");
    regen.type = "button";
    regen.textContent = line.url ? "Regenerate" : "Generate";
    regen.dataset.castingLineGenerate = "1";
    regen.dataset.lineIndex = String(idx);
    regen.addEventListener("click", () => generateCastingLine(idx, regen));
    actions.appendChild(regen);
    const del = document.createElement("button");
    del.type = "button";
    del.className = "compact-icon-button casting-delete-button";
    del.innerHTML = ACTION_ICONS.delete;
    del.title = `Delete line ${idx + 1}`;
    del.setAttribute("aria-label", `Delete line ${idx + 1}`);
    del.addEventListener("click", () => deleteCastingLine(idx));
    actions.appendChild(del);
    row.appendChild(actions);
    list.appendChild(row);
  });
  wrap.innerHTML = "";
  wrap.appendChild(list);
  updateCastingGenerateControls();
}

function deleteCastingLine(index) {
  state.castingLines.splice(index, 1);
  renderCastingTable();
}

async function generateCastingLine(index, btn) {
  const line = state.castingLines[index];
  if (!line || !(line.text || "").trim()) return;
  if (!line.voice) {
    alert("Select a voice before generating this line.");
    return;
  }
  const prev = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Generating...";
  }
  try {
    const result = await api("/api/casting/tts", { method: "POST", body: JSON.stringify({ lines: [line] }) });
    const clip = (result.clips || [])[0];
    if (clip) {
      line.url = clip.url || "";
      line.name = clip.name;
    }
    renderCastingTable();
    await refreshCastingLibrary();
  } catch (err) {
    alert(`TTS failed: ${err.message}`);
  } finally {
    if (btn && btn.isConnected) {
      btn.disabled = false;
      btn.textContent = prev;
    }
  }
}

async function generateCasting() {
  if (!state.castingLines.length) return;
  if (state.castingLines.some((line) => (line.text || "").trim() && !line.voice)) {
    alert("Select a voice for every line before generating.");
    return;
  }
  const btn = $("castingGenerateBtn");
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Generating… (loads model first)";
  try {
    const result = await api("/api/casting/tts", { method: "POST", body: JSON.stringify({ lines: state.castingLines, archive_all: true }) });
    (result.clips || []).forEach((clip, i) => {
      if (state.castingLines[i]) {
        state.castingLines[i].url = clip.url || "";
        state.castingLines[i].name = clip.name;
      }
    });
    renderCastingTable();
    await refreshCastingLibrary();
  } catch (err) {
    alert(`TTS failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

async function refreshCastingLibrary() {
  try {
    const data = await api("/api/casting/library");
    state.castingLibrary = data.clips || [];
    renderCastingLibrary();
  } catch (err) {
    /* ignore */
  }
}

async function openCastingArchive() {
  try {
    await api("/api/casting/open-archive", { method: "POST" });
  } catch (err) {
    alert(`Open archive failed: ${err.message}`);
  }
}

async function deleteCastingClip(clip) {
  if (!clip?.file) return;
  if (!confirm(`Delete "${clip.name || fileNameFromPath(clip.file)}" to Recycle Bin?`)) return;
  stopCastingPreview();
  if (state.castingEdit?.file === clip.file) state.castingEdit = null;
  try {
    const result = await api("/api/casting/delete", {
      method: "POST",
      body: JSON.stringify({ file: clip.file }),
    });
    state.castingLibrary = result.clips || [];
    renderCastingLibrary();
    $("runHint").textContent = `Moved ${result.recycled?.length || 0} file(s) to Recycle Bin`;
  } catch (err) {
    alert(`Delete failed: ${err.message}`);
  }
}

function renderCastingLibrary() {
  const el = $("castingLibrary");
  if (!el) return;
  if (!state.castingLibrary.length) {
    el.innerHTML = '<div class="hint">Library is empty.</div>';
    return;
  }
  el.innerHTML = "";
  state.castingLibrary.forEach((clip, index) => {
    const row = document.createElement("div");
    row.className = "casting-library-item";
    const label = document.createElement("div");
    label.className = "casting-library-label";
    const extra = (clip.voice ? ` - ${clip.voice}` : "")
      + (clip.emotion && clip.emotion !== "neutral" ? ` - ${clip.emotion}` : "")
      + (Number(clip.speed || 1) !== 1 ? ` - ${Number(clip.speed).toFixed(2)}x` : "");
    label.textContent = clip.name + extra;
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.className = "casting-metadata-audio";
    audio.src = clip.url;
    audio.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        clip.duration = audio.duration;
        if (document.body.classList.contains("director-workspace-active") && state.directorAudioSegments.some((segment) => segment.audioPath === clip.file)) {
          renderDirectorEditor();
        }
      }
    });
    const preview = makeCastingPreviewButton(clip.url, `Preview ${clip.name || "clip"}`);
    const edit = makeActionIconButton("edit", `Edit ${clip.name || "clip"}`, "casting-edit-button");
    edit.addEventListener("click", () => startCastingClipEdit(index));
    const del = makeActionIconButton("delete", `Delete ${clip.name || "clip"}`, "casting-delete-button");
    del.addEventListener("click", () => deleteCastingClip(clip));
    row.appendChild(label);
    row.appendChild(audio);
    row.appendChild(preview);
    row.appendChild(edit);
    row.appendChild(del);
    el.appendChild(row);
    if (state.castingEdit?.file === clip.file) {
      const editor = renderCastingClipEditor(clip);
      el.appendChild(editor);
      if (state.castingEdit.justOpened) {
        state.castingEdit.justOpened = false;
        requestAnimationFrame(() => editor.scrollIntoView({ block: "center", inline: "nearest" }));
      }
    }
  });
  populateAudioLibrary();
  if (document.body.classList.contains("director-workspace-active")) {
    renderDirectorEditor();
  }
}

function startCastingClipEdit(index) {
  const clip = state.castingLibrary[index];
  if (!clip) return;
  stopCastingSelection();
  const duration = Number(clip.duration) || 60;
  state.castingEdit = { file: clip.file, start: 0, end: duration, justOpened: true };
  renderCastingLibrary();
}

function renderCastingClipEditor(clip) {
  const edit = state.castingEdit;
  const panel = document.createElement("div");
  panel.className = "casting-clip-editor";
  const duration = Math.max(0.1, Number(clip.duration) || Number(edit.end) || 60);
  const start = Math.max(0, Math.min(Number(edit.start) || 0, duration));
  const end = Math.max(start + 0.05, Math.min(Number(edit.end) || duration, duration));
  edit.start = start;
  edit.end = end;
  panel.innerHTML = `
    <div class="casting-waveform-shell">
      <canvas data-waveform-canvas></canvas>
    </div>
    <div class="casting-trim-readout">
      <span>Start <b data-trim-start>${start.toFixed(2)}s</b></span>
      <span>End <b data-trim-end>${end.toFixed(2)}s</b></span>
      <span>Keep <b data-trim-duration>${(end - start).toFixed(2)}s</b></span>
    </div>
    <div class="casting-trim-actions">
      <button class="compact-icon-button" type="button" data-trim-play title="Play selection" aria-label="Play selection">${ACTION_ICONS.play}</button>
      <button class="compact-icon-button" type="button" data-trim-stop title="Stop playback" aria-label="Stop playback">${ACTION_ICONS.stop}</button>
      <button class="compact-icon-button" type="button" data-trim-save title="Save trim" aria-label="Save trim">${ACTION_ICONS.save}</button>
      <button class="compact-icon-button" type="button" data-trim-cancel title="Cancel edit" aria-label="Cancel edit">${ACTION_ICONS.close}</button>
    </div>
  `;
  const canvas = panel.querySelector("[data-waveform-canvas]");
  setupCastingWaveformEditor(canvas, clip, panel);
  panel.querySelector("[data-trim-play]").addEventListener("click", () => playCastingSelection(clip));
  panel.querySelector("[data-trim-stop]").addEventListener("click", stopCastingSelection);
  panel.querySelector("[data-trim-save]").addEventListener("click", () => saveCastingClipTrim(clip, panel.querySelector("[data-trim-save]")));
  panel.querySelector("[data-trim-cancel]").addEventListener("click", () => {
    stopCastingSelection();
    state.castingEdit = null;
    renderCastingLibrary();
  });
  return panel;
}

function updateCastingTrimReadout(panel) {
  const edit = state.castingEdit;
  if (!edit) return;
  panel.querySelector("[data-trim-start]").textContent = `${edit.start.toFixed(2)}s`;
  panel.querySelector("[data-trim-end]").textContent = `${edit.end.toFixed(2)}s`;
  panel.querySelector("[data-trim-duration]").textContent = `${Math.max(0, edit.end - edit.start).toFixed(2)}s`;
}

function setupCastingWaveformEditor(canvas, clip, panel) {
  const edit = state.castingEdit;
  edit.peaks = edit.peaks || null;
  edit.dragHandle = "";
  const redraw = () => drawCastingWaveform(canvas, clip, panel);
  redraw();
  loadCastingWaveform(clip, canvas).then((peaks) => {
    if (!state.castingEdit || state.castingEdit.file !== clip.file) return;
    state.castingEdit.peaks = peaks;
    redraw();
  }).catch(() => redraw());
  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    edit.dragHandle = castingWaveformHandleFromEvent(canvas, clip, event);
    updateCastingWaveformDrag(canvas, clip, panel, event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!edit.dragHandle) return;
    updateCastingWaveformDrag(canvas, clip, panel, event);
  });
  canvas.addEventListener("pointerup", (event) => {
    edit.dragHandle = "";
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointercancel", () => {
    edit.dragHandle = "";
  });
  canvas.addEventListener("mousedown", (event) => {
    edit.dragHandle = castingWaveformHandleFromEvent(canvas, clip, event);
    updateCastingWaveformDrag(canvas, clip, panel, event);
  });
  window.addEventListener("mousemove", (event) => {
    if (!edit.dragHandle) return;
    updateCastingWaveformDrag(canvas, clip, panel, event);
  });
  window.addEventListener("mouseup", () => {
    edit.dragHandle = "";
  });
}

async function loadCastingWaveform(clip, canvas) {
  if (clip.peaks) return clip.peaks;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  const response = await fetch(clip.url);
  const buffer = await response.arrayBuffer();
  const ctx = new AudioCtx();
  try {
    const audioBuffer = await ctx.decodeAudioData(buffer);
    clip.duration = audioBuffer.duration || clip.duration;
    const channel = audioBuffer.getChannelData(0);
    const width = Math.max(240, Math.floor(canvas.getBoundingClientRect().width || canvas.clientWidth || 720));
    const samplesPerPeak = Math.max(1, Math.floor(channel.length / width));
    const peaks = [];
    for (let i = 0; i < width; i += 1) {
      let peak = 0;
      const start = i * samplesPerPeak;
      const stop = Math.min(channel.length, start + samplesPerPeak);
      for (let j = start; j < stop; j += 1) {
        peak = Math.max(peak, Math.abs(channel[j]));
      }
      peaks.push(peak);
    }
    clip.peaks = peaks;
    return peaks;
  } finally {
    if (ctx.close) ctx.close();
  }
}

function castingWaveformDuration(clip) {
  const edit = state.castingEdit;
  return Math.max(0.1, Number(clip.duration) || Number(edit?.end) || 60);
}

function castingWaveformXToTime(canvas, clip, x) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (x - rect.left) / Math.max(1, rect.width)));
  return ratio * castingWaveformDuration(clip);
}

function castingWaveformTimeToX(canvas, clip, time) {
  const rect = canvas.getBoundingClientRect();
  return (time / castingWaveformDuration(clip)) * rect.width;
}

function castingWaveformHandleFromEvent(canvas, clip, event) {
  const edit = state.castingEdit;
  const startX = castingWaveformTimeToX(canvas, clip, edit.start);
  const endX = castingWaveformTimeToX(canvas, clip, edit.end);
  const x = event.clientX - canvas.getBoundingClientRect().left;
  return Math.abs(x - startX) <= Math.abs(x - endX) ? "start" : "end";
}

function updateCastingWaveformDrag(canvas, clip, panel, event) {
  const edit = state.castingEdit;
  const duration = castingWaveformDuration(clip);
  const timeValue = castingWaveformXToTime(canvas, clip, event.clientX);
  if (edit.dragHandle === "start") {
    edit.start = Math.max(0, Math.min(timeValue, edit.end - 0.05));
  } else if (edit.dragHandle === "end") {
    edit.end = Math.min(duration, Math.max(timeValue, edit.start + 0.05));
  }
  updateCastingTrimReadout(panel);
  drawCastingWaveform(canvas, clip, panel);
}

function drawCastingWaveform(canvas, clip, panel) {
  const edit = state.castingEdit;
  if (!edit) return;
  const rect = canvas.getBoundingClientRect();
  const cssWidth = Math.max(320, Math.floor(rect.width || canvas.clientWidth || 720));
  const cssHeight = 132;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.floor(cssWidth * dpr) || canvas.height !== Math.floor(cssHeight * dpr)) {
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.style.width = "100%";
    canvas.style.height = `${cssHeight}px`;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = "#0e0e0b";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  const center = cssHeight / 2;
  const peaks = edit.peaks || clip.peaks || [];
  ctx.strokeStyle = "rgba(143, 199, 192, .9)";
  ctx.lineWidth = 1;
  if (peaks.length) {
    for (let x = 0; x < cssWidth; x += 1) {
      const peak = peaks[Math.floor((x / cssWidth) * peaks.length)] || 0;
      const h = Math.max(1, peak * (cssHeight * 0.42));
      ctx.beginPath();
      ctx.moveTo(x + 0.5, center - h);
      ctx.lineTo(x + 0.5, center + h);
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = "rgba(143, 199, 192, .45)";
    ctx.beginPath();
    ctx.moveTo(0, center);
    ctx.lineTo(cssWidth, center);
    ctx.stroke();
  }

  const duration = castingWaveformDuration(clip);
  const startX = (edit.start / duration) * cssWidth;
  const endX = (edit.end / duration) * cssWidth;
  ctx.fillStyle = "rgba(0, 0, 0, .55)";
  ctx.fillRect(0, 0, startX, cssHeight);
  ctx.fillRect(endX, 0, cssWidth - endX, cssHeight);
  ctx.fillStyle = "rgba(215, 180, 106, .16)";
  ctx.fillRect(startX, 0, endX - startX, cssHeight);
  ctx.strokeStyle = "#d7b46a";
  ctx.lineWidth = 2;
  [startX, endX].forEach((x) => {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, cssHeight);
    ctx.stroke();
    ctx.fillStyle = "#d7b46a";
    ctx.fillRect(x - 4, 8, 8, cssHeight - 16);
  });
  updateCastingTrimReadout(panel);
}

function stopCastingSelection() {
  const player = state.castingEdit?.player;
  if (player) {
    player.pause();
    player.src = "";
  }
  if (state.castingEdit?.playTimer) clearInterval(state.castingEdit.playTimer);
  if (state.castingEdit) {
    state.castingEdit.player = null;
    state.castingEdit.playTimer = null;
  }
}

async function playCastingSelection(clip) {
  const edit = state.castingEdit;
  if (!edit) return;
  stopCastingSelection();
  const player = new Audio(clip.url);
  edit.player = player;
  player.currentTime = Math.max(0, edit.start);
  edit.playTimer = setInterval(() => {
    if (player.currentTime >= edit.end) stopCastingSelection();
  }, 50);
  try {
    await player.play();
  } catch (err) {
    stopCastingSelection();
    alert(`Preview failed: ${err.message}`);
  }
}

async function saveCastingClipTrim(clip, btn) {
  const edit = state.castingEdit;
  if (!edit || edit.file !== clip.file) return;
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving...";
  try {
    await api("/api/casting/trim", {
      method: "POST",
      body: JSON.stringify({ file: clip.file, start: edit.start, end: edit.end }),
    });
    state.castingEdit = null;
    await refreshCastingLibrary();
  } catch (err) {
    alert(`Save trim failed: ${err.message}`);
    btn.disabled = false;
    btn.textContent = prev;
  }
}

function openCustomVoiceModal() {
  $("customVoiceName").value = "";
  $("customVoiceFile").value = "";
  $("customVoiceText").value = "";
  $("customVoiceStatus").textContent = "";
  $("castingVoiceModal").classList.add("open");
  $("castingVoiceModal").setAttribute("aria-hidden", "false");
  $("customVoiceName").focus();
}

function closeCustomVoiceModal() {
  $("castingVoiceModal").classList.remove("open");
  $("castingVoiceModal").setAttribute("aria-hidden", "true");
}

async function saveCustomVoice() {
  const name = $("customVoiceName").value.trim();
  const file = $("customVoiceFile").files[0];
  const refText = $("customVoiceText").value.trim();
  const status = $("customVoiceStatus");
  if (!name) {
    status.textContent = "Name is required.";
    return;
  }
  if (!file) {
    status.textContent = "Reference audio is required.";
    return;
  }
  if (!file.name.toLowerCase().endsWith(".wav")) {
    status.textContent = "Use a WAV file for the reference audio.";
    return;
  }
  if (!refText) {
    status.textContent = "Reference text is required.";
    return;
  }
  const btn = $("saveCustomVoiceBtn");
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving...";
  status.textContent = "";
  try {
    const audioData = await readFileAsDataUrl(file);
    const result = await api("/api/casting/voice", {
      method: "POST",
      body: JSON.stringify({ name, audio_name: file.name, audio_data: audioData, ref_text: refText }),
    });
    if (state.config?.casting && result.voices) {
      state.config.casting.voices = result.voices;
    }
    renderCastingStatus();
    renderCastingTable();
    closeCustomVoiceModal();
  } catch (err) {
    status.textContent = err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
}

async function loadConfig() {
  state.config = await api("/api/config");
  fillSelect($("workflowSelect"), state.config.workflows);
  fillSelect($("moveSelect"), state.config.camera_moves, "name");
  rememberCurrentWorkflow();
  $("negativePrompt").value = state.config.default_negative;
  $("comfyStatus").textContent = state.config.comfy.ok ? "ComfyUI: online" : "ComfyUI: offline";
  $("comfyStatus").className = `status-pill ${state.config.comfy.ok ? "ok" : "bad"}`;
  $("comfyStatus").title = state.config.comfy.reason || state.config.comfy.url || "";
  renderCastingStatus();
  refreshCastingLibrary();
  updateWorkflowFields();
  updateSizeReadout();
  updateMotionSizeReadout();
  resetPrompt();
  await loadHistory();
  startHistoryRefresh();
}

$("workflowSelect").addEventListener("change", () => {
  if (isDirectorWorkflow()) {
    setWorkspace("director", { syncWorkflow: false });
    return;
  }
  setWorkspace("camera", { syncWorkflow: false });
});
$("cameraWorkspaceTab").addEventListener("click", () => setWorkspace("camera"));
$("directorWorkspaceTab").addEventListener("click", () => setWorkspace("director"));
$("castingWorkspaceTab").addEventListener("click", () => { setWorkspace("casting", { syncWorkflow: false }); refreshCastingLibrary(); });
$("motionWorkspaceTab").addEventListener("click", () => setWorkspace("motion", { syncWorkflow: false }));
$("photographyWorkspaceTab").addEventListener("click", () => setWorkspace("photography", { syncWorkflow: false }));
$("motionTextTab").addEventListener("click", () => setMotionSubtab("text"));
$("motionScailTab").addEventListener("click", () => setMotionSubtab("scail"));
$("motion3dTab").addEventListener("click", () => setMotionSubtab("3d"));
$("castingAnalyzeBtn").addEventListener("click", analyzeCasting);
$("castingAddLineBtn").addEventListener("click", addCastingLine);
$("castingGenerateBtn").addEventListener("click", generateCasting);
$("castingAddVoiceBtn").addEventListener("click", openCustomVoiceModal);
$("castingOpenArchiveBtn").addEventListener("click", openCastingArchive);
$("castingRefreshLibraryBtn").addEventListener("click", refreshCastingLibrary);
$("saveCustomVoiceBtn").addEventListener("click", saveCustomVoice);
$("cancelCustomVoiceBtn").addEventListener("click", closeCustomVoiceModal);
$("closeCastingVoiceBtn").addEventListener("click", closeCustomVoiceModal);
document.querySelector("[data-close-casting-voice-modal]").addEventListener("click", closeCustomVoiceModal);
window.addEventListener("camera-lab:shot-pack-exported", (event) => importShotPackToDirector(event.detail || {}));
$("moveSelect").addEventListener("change", resetPrompt);
$("sourceInput").addEventListener("change", () => uploadImage($("sourceInput").files[0], "source").catch((err) => {
  state.sourcePath = "";
  $("sourceStatus").textContent = err.message;
}));
$("middleInput").addEventListener("change", () => uploadImage($("middleInput").files[0], "middle").catch((err) => {
  state.middlePath = "";
  $("middleStatus").textContent = err.message;
}));
$("endInput").addEventListener("change", () => uploadImage($("endInput").files[0], "end").catch((err) => {
  state.endPath = "";
  $("endStatus").textContent = err.message;
}));
$("motionRefInput").addEventListener("change", () => uploadImage($("motionRefInput").files[0], "motion_ref").catch((err) => {
  state.motionRefPath = "";
  $("motionRefStatus").textContent = err.message;
  updateMotionRunAvailability();
}));
$("motionGuideInput").addEventListener("change", () => uploadMotionGuideVideo($("motionGuideInput").files[0]).catch((err) => {
  state.motionGuideVideoPath = "";
  $("motionGuideUploadStatus").textContent = err.message;
  updateMotionRunAvailability();
}));
for (const id of ["motionTrimStart", "motionTrimEnd", "motionTrimStartRange", "motionTrimEndRange"]) {
  $(id).addEventListener("input", () => {
    if (id === "motionTrimStartRange") $("motionTrimStart").value = $("motionTrimStartRange").value;
    if (id === "motionTrimEndRange") $("motionTrimEnd").value = $("motionTrimEndRange").value;
    updateMotionTrimDisplay(id);
  });
}
$("motionGuide").addEventListener("loadedmetadata", () => {
  setMotionTrimBounds($("motionGuide").duration || motionGuideDurationFallback(), true);
});
$("motionGuide").addEventListener("timeupdate", () => {
  if (!state.motionTrimPlaying) return;
  const { end } = motionTrimValues();
  if ($("motionGuide").currentTime >= end) {
    $("motionGuide").pause();
    state.motionTrimPlaying = false;
  }
});
$("motionGuide").addEventListener("pause", () => {
  state.motionTrimPlaying = false;
});
$("motionTrimSetStart").addEventListener("click", () => {
  $("motionTrimStart").value = String(roundMotionTime($("motionGuide").currentTime || 0));
  updateMotionTrimDisplay("motionTrimStart");
});
$("motionTrimSetEnd").addEventListener("click", () => {
  const currentTime = Number($("motionGuide").currentTime);
  $("motionTrimEnd").value = String(roundMotionTime(Number.isFinite(currentTime) ? currentTime : motionGuideDurationFallback()));
  updateMotionTrimDisplay("motionTrimEnd");
});
$("motionTrimPlay").addEventListener("click", playMotionTrim);
$("motionTrimReset").addEventListener("click", () => setMotionTrimBounds(motionGuideDurationFallback(), true));
$("swapSourceEndBtn").addEventListener("click", () => swapImageSlots("source", "end"));
$("swapSourceMiddleBtn").addEventListener("click", () => swapImageSlots("source", "middle"));
$("swapMiddleEndBtn").addEventListener("click", () => swapImageSlots("middle", "end"));
$("audioInput").addEventListener("change", () => uploadAudio().catch((err) => {
  state.audioPath = "";
  $("audioStatus").textContent = err.message;
}));
$("audioLibrarySelect").addEventListener("change", () => {
  const sel = $("audioLibrarySelect");
  if (!sel.value) return;
  state.audioPath = sel.value;
  const opt = sel.options[sel.selectedIndex];
  $("audioStatus").textContent = opt ? opt.textContent : "library clip";
  $("audioInput").value = "";
});
$("sizePreset").addEventListener("change", () => onPresetSizeChange({ presetId: "sizePreset", scaleId: "sizeScale", sizeId: "customSizeInput" }));
$("sizeScale").addEventListener("input", updateSizeReadout);
$("customSizeInput").addEventListener("input", onCustomSizeInput);
$("motionSizePreset").addEventListener("change", () => {
  $("motionCustomSizeInput").value = $("motionSizePreset").value;
  updateMotionSizeReadout();
});
$("motionSizeScale").addEventListener("input", updateMotionSizeReadout);
$("motionCustomSizeInput").addEventListener("input", updateMotionSizeReadout);
$("motionPoseStrength").addEventListener("input", () => {
  $("motionPoseReadout").textContent = Number($("motionPoseStrength").value).toFixed(2);
});
$("motionCfg").addEventListener("input", () => {
  $("motionCfgReadout").textContent = Number($("motionCfg").value).toFixed(1);
});
$("motionDuration").addEventListener("input", () => {
  if (!hasMotionGuideVideo()) setMotionTrimBounds(Number($("motionDuration").value) || 4, true);
});
$("directorSizePreset").addEventListener("change", () => onPresetSizeChange({ presetId: "directorSizePreset", scaleId: "directorSizeScale", sizeId: "directorCustomSizeInput" }));
$("directorSizeScale").addEventListener("input", updateSizeReadout);
$("directorCustomSizeInput").addEventListener("input", onCustomSizeInput);
$("resetPromptsBtn").addEventListener("click", resetPrompt);
$("refreshBtn").addEventListener("click", loadConfig);
$("runBtn").addEventListener("click", startBatch);
$("motionGuideBtn").addEventListener("click", startMotionGuide);
$("motionRunBtn").addEventListener("click", startMotionFinal);
$("motionCopyRewrite").addEventListener("click", () => copyMotionRewritePrompt().catch((err) => {
  $("motionStatus").textContent = err.message;
}));
$("addDirectorSegmentBtn").addEventListener("click", () => addDirectorSegment());
$("addDirectorAudioBtn").addEventListener("click", openDirectorAudioModal);
$("openStoryboardImportBtn").addEventListener("click", openStoryboardImportModal);
$("closeStoryboardImportBtn").addEventListener("click", closeStoryboardImportModal);
$("cancelStoryboardImportBtn").addEventListener("click", closeStoryboardImportModal);
$("storyboardImportModal").addEventListener("click", (event) => {
  if (event.target.matches("[data-close-storyboard-modal]")) closeStoryboardImportModal();
});
$("closeDirectorAudioModalBtn").addEventListener("click", closeDirectorAudioModal);
$("cancelDirectorAudioModalBtn").addEventListener("click", closeDirectorAudioModal);
$("directorAudioModal").addEventListener("click", (event) => {
  if (event.target.matches("[data-close-director-audio-modal]")) closeDirectorAudioModal();
});
$("directorAudioModalInput").addEventListener("change", () => {
  $("directorAudioModalUploadStatus").textContent = $("directorAudioModalInput").files[0]?.name || "No upload selected";
});
$("addDirectorAudioClipBtn").addEventListener("click", () => addDirectorAudioFromModal());
$("closeVideoPreviewBtn").addEventListener("click", closeVideoPreview);
$("videoPreviewModal").addEventListener("click", (event) => {
  if (event.target.matches("[data-close-video-preview]")) closeVideoPreview();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("videoPreviewModal").classList.contains("open")) closeVideoPreview();
});
$("storyboardImportInput").addEventListener("change", () => {
  $("storyboardImportStatus").textContent = $("storyboardImportInput").files[0]?.name || "No storyboard selected";
});
$("applyStoryboardImportBtn").addEventListener("click", () => {
  applyStoryboardImport().catch((err) => {
    $("storyboardImportStatus").textContent = err.message;
    $("runHint").textContent = `2x2 storyboard import failed: ${err.message}`;
  });
});
$("globalAddRefBtn").addEventListener("click", addReferenceSlot);
renderReferenceSlots();
$("exampleVideo").addEventListener("loadedmetadata", () => {
  const video = $("exampleVideo");
  const start = Number(video.dataset.segmentStart || 0);
  if (start > 0) video.currentTime = start;
});
$("exampleVideo").addEventListener("timeupdate", () => {
  const video = $("exampleVideo");
  const start = Number(video.dataset.segmentStart || 0);
  const end = Number(video.dataset.segmentEnd || 0);
  if (end > start && video.currentTime >= end) video.currentTime = start;
});

loadConfig().catch((err) => {
  $("comfyStatus").textContent = err.message;
  $("comfyStatus").className = "status-pill bad";
});
