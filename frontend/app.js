function initialWorkspace() {
  if (window.location.hash === "#director") return "director";
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
  audioPath: "",
  referencePaths: [""],
  referenceNames: [""],
  referencePreviewUrls: [""],
  directorSegments: [],
  directorSelectedId: "",
  directorDrag: null,
  workspace: initialWorkspace(),
  cameraWorkflowId: "",
  directorWorkflowId: "",
};

const $ = (id) => document.getElementById(id);
const imageSlots = {
  source: { pathKey: "sourcePath", previewId: "sourcePreview", statusId: "sourceStatus", empty: "No image uploaded" },
  middle: { pathKey: "middlePath", previewId: "middlePreview", statusId: "middleStatus", empty: "No image uploaded" },
  end: { pathKey: "endPath", previewId: "endPreview", statusId: "endStatus", empty: "No image uploaded" },
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
  const showSourceImage = wf.mode !== "t2v" && !isDirector;
  const showMiddleImage = wf.mode === "fml" || wf.mode === "fml_native";
  const showEndImage = wf.mode === "flf" || wf.mode === "fml" || wf.mode === "fml_native";
  document.body.classList.toggle("director-mode", showDirectorWorkspace);
  document.body.classList.toggle("director-workspace-active", showDirectorWorkspace);
  document.body.classList.toggle("photography-workspace-active", showPhotographyWorkspace);
  $("cameraWorkspaceTab").classList.toggle("active", state.workspace === "camera");
  $("directorWorkspaceTab").classList.toggle("active", showDirectorWorkspace);
  $("photographyWorkspaceTab").classList.toggle("active", showPhotographyWorkspace);
  if (showPhotographyWorkspace) return;
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
  $("swapSourceEndWrap").style.display = wf.mode === "flf" ? "block" : "none";
  $("swapSourceMiddleWrap").style.display = showMiddleImage ? "block" : "none";
  $("swapMiddleEndWrap").style.display = showMiddleImage ? "block" : "none";
  const audioWrap = $("audioUploadWrap");
  const audioTarget = showDirectorWorkspace ? $("directorAudioSlot") : $("audioUploadHome");
  if (audioWrap.parentElement !== audioTarget) audioTarget.appendChild(audioWrap);
  $("audioUploadWrap").style.display = wf.mode === "ia2v" || showDirectorWorkspace ? "block" : "none";
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
    const duration = segments.reduce((sum, item) => sum + item.duration, 0);
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
      reference_images: collectReferenceImages(),
      audio_path: state.audioPath,
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
      prompt: segment.prompt.trim(),
      duration: Math.max(0.5, Number(segment.duration) || 0.5),
      reference: "",
      image_path: segment.imagePath || "",
      guide_frame: Math.max(0, Math.round((Number(segment.start) || 0) * 24)),
      strength: Math.max(0, Math.min(1, Number(segment.strength) || 0.65)),
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

function directorTotalSeconds() {
  const end = normalizedDirectorSegments().reduce((max, segment) => Math.max(max, segment.start + segment.duration), 0);
  return Math.max(6, Math.ceil(end * 2) / 2);
}

function selectDirectorSegment(id) {
  state.directorSelectedId = id;
  renderDirectorEditor();
}

function removeDirectorSegment(id) {
  state.directorSegments = state.directorSegments.filter((item) => item.id !== id);
  if (!state.directorSegments.some((item) => item.id === state.directorSelectedId)) {
    state.directorSelectedId = state.directorSegments[0]?.id || "";
  }
  renderDirectorEditor();
}

function createDirectorBlock(segment, index, total) {
  const block = document.createElement("div");
  block.className = "director-block ref-none";
  block.classList.toggle("selected", segment.id === state.directorSelectedId);
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

function renderDirectorEditor() {
  const track = $("directorTrack");
  const ruler = $("directorRuler");
  const list = $("directorSegments");
  if (!track || !ruler || !list) return;
  const segments = normalizedDirectorSegments();
  const total = directorTotalSeconds();
  ruler.innerHTML = "";
  for (let sec = 0; sec <= total; sec += 1) {
    const tick = document.createElement("span");
    tick.style.left = `${(sec / total) * 100}%`;
    tick.textContent = `${sec}s`;
    ruler.appendChild(tick);
  }

  track.innerHTML = "";
  for (const [index, segment] of segments.entries()) {
    track.appendChild(createDirectorBlock(segment, index, total));
  }
  track.ondragover = null;
  track.ondrop = null;

  list.innerHTML = "";
  segments.forEach((segment, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "director-segment-chip";
    chip.classList.toggle("selected", segment.id === state.directorSelectedId);
    chip.textContent = `S${index + 1} ${formatSeconds(segment.start)}-${formatSeconds(segment.start + segment.duration)}`;
    chip.addEventListener("click", () => {
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

function renderDirectorTimelineOnly() {
  const track = $("directorTrack");
  const ruler = $("directorRuler");
  const list = $("directorSegments");
  if (!track || !ruler || !list) return;
  const segments = normalizedDirectorSegments();
  const total = directorTotalSeconds();
  ruler.innerHTML = "";
  for (let sec = 0; sec <= total; sec += 1) {
    const tick = document.createElement("span");
    tick.style.left = `${(sec / total) * 100}%`;
    tick.textContent = `${sec}s`;
    ruler.appendChild(tick);
  }
  track.innerHTML = "";
  for (const [index, segment] of segments.entries()) {
    track.appendChild(createDirectorBlock(segment, index, total));
  }
  track.ondragover = null;
  track.ondrop = null;
  list.innerHTML = "";
  segments.forEach((segment, index) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "director-segment-chip";
    chip.classList.toggle("selected", segment.id === state.directorSelectedId);
    chip.textContent = `S${index + 1} ${formatSeconds(segment.start)}-${formatSeconds(segment.start + segment.duration)}`;
    chip.addEventListener("click", () => {
      state.directorSelectedId = segment.id;
      renderDirectorEditor();
    });
    list.appendChild(chip);
  });
}

function startDirectorDrag(event, id) {
  if (event.button !== 0) return;
  const segment = state.directorSegments.find((item) => item.id === id);
  if (!segment) return;
  event.preventDefault();
  state.directorSelectedId = id;
  const trackRect = $("directorTrack").getBoundingClientRect();
  const edge = directorEdgeFromEvent(event, event.currentTarget);
  state.directorDrag = {
    id,
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
  const segment = state.directorSegments.find((item) => item.id === drag.id);
  if (!segment) return;
  const deltaSeconds = ((event.clientX - drag.startX) / Math.max(1, drag.rect.width)) * drag.total;
  if (drag.edge === "left") {
    const nextStart = Math.max(0, drag.originalStart + deltaSeconds);
    const end = drag.originalStart + drag.originalDuration;
    segment.start = roundHalf(Math.min(nextStart, end - 0.5));
    segment.duration = roundHalf(end - segment.start);
  } else if (drag.edge === "right") {
    segment.duration = roundHalf(Math.max(0.5, drag.originalDuration + deltaSeconds));
  } else {
    segment.start = roundHalf(Math.max(0, drag.originalStart + deltaSeconds));
  }
  renderDirectorTimelineOnly();
}

function stopDirectorDrag() {
  state.directorDrag = null;
  document.body.classList.remove("director-dragging");
  document.body.style.cursor = "";
  window.removeEventListener("mousemove", onDirectorDrag);
}

function roundHalf(value) {
  return Math.round(value * 2) / 2;
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
  const tpl = $("resultTemplate");
  for (const run of runs) {
    if (state.hiddenRunKeys.has(runKey(run))) continue;
    const grid = resultsGridForRun(run);
    let card = grid.querySelector(`.result-card[data-run-key="${cssEscape(runKey(run))}"]`);
    if (!card) {
      const node = tpl.content.cloneNode(true);
      card = node.querySelector(".result-card");
      card.dataset.runKey = runKey(run);
      card.querySelector(".use-prompt-run").addEventListener("click", () => {
        if (card._run && isDirectorRun(card._run)) useRunTimeline(card._run);
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
    updateRunCard(card, run);
  }
}

function resultsGridForRun(run) {
  return isDirectorRun(run) ? $("directorResultsGrid") : $("resultsGrid");
}

function isDirectorRun(run) {
  const raw = String(run.workflow_mode || run.workflow_id || run.workflow_label || "").toLowerCase();
  return raw.includes("director");
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
  usePromptButton.textContent = directorRun ? "Use Timeline" : "Use Prompt";
  usePromptButton.disabled = directorRun
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
      : `status:${run.status}:${run.error || ""}`;
  if (card.dataset.mediaKey !== mediaKey) {
    card.dataset.mediaKey = mediaKey;
    media.textContent = run.error || "waiting";
    if (run.video) {
      media.innerHTML = "";
      const video = document.createElement("video");
      video.src = mediaUrl(run.video);
      video.controls = true;
      video.muted = false;
      video.loop = true;
      media.appendChild(video);
    } else if (run.contact_sheet) {
      media.innerHTML = "";
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

function fileNameFromPath(path) {
  return String(path || "").split(/[\\/]/).pop() || "";
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
  let cursor = 0;
  state.directorSegments = timeline.segments.map((segment, index) => {
    const duration = Math.max(0.5, Number(segment.duration) || Number(segment.frames || 0) / 24 || 4);
    const start = Number.isFinite(Number(segment.guide_frame))
      ? Number(segment.guide_frame) / 24
      : Number.isFinite(Number(segment.start_frame))
        ? Number(segment.start_frame) / 24
        : cursor;
    cursor = start + duration;
    const imagePath = segment.image_path || "";
    return {
      id: `seg_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      start,
      duration,
      prompt: segment.prompt || "",
      reference: "",
      imagePath,
      imageName: fileNameFromPath(imagePath),
      imagePreviewUrl: imagePath ? mediaUrl(imagePath) : "",
      strength: segment.strength ?? (index === 0 ? 1 : 0.85),
    };
  });
  state.directorSelectedId = state.directorSegments[0]?.id || "";
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
  }
  upsertRuns(data.runs || [], false);
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
    const card = document.querySelector(`#resultsGrid .result-card[data-run-key="${cssEscape(key)}"], #directorResultsGrid .result-card[data-run-key="${cssEscape(key)}"]`);
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

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
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

async function uploadImage(file, kind) {
  if (!file) return;
  const status = kind === "source" ? $("sourceStatus") : kind === "middle" ? $("middleStatus") : $("endStatus");
  status.textContent = "Uploading...";
  const data = await readFileAsDataUrl(file);
  const uploaded = await api("/api/upload-image", {
    method: "POST",
    body: JSON.stringify({ name: file.name, data }),
  });
  if (kind === "source") {
    state.sourcePath = uploaded.path;
  } else if (kind === "middle") {
    state.middlePath = uploaded.path;
  } else {
    state.endPath = uploaded.path;
  }
  setImagePreview(kind, mediaUrl(uploaded.path));
  status.textContent = uploaded.name;
}

async function loadConfig() {
  state.config = await api("/api/config");
  fillSelect($("workflowSelect"), state.config.workflows);
  fillSelect($("moveSelect"), state.config.camera_moves, "name");
  rememberCurrentWorkflow();
  $("negativePrompt").value = state.config.default_negative;
  $("comfyStatus").textContent = state.config.comfy.ok ? "ComfyUI: online" : "ComfyUI: offline";
  $("comfyStatus").className = `status-pill ${state.config.comfy.ok ? "ok" : "bad"}`;
  updateWorkflowFields();
  updateSizeReadout();
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
$("photographyWorkspaceTab").addEventListener("click", () => setWorkspace("photography", { syncWorkflow: false }));
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
$("swapSourceEndBtn").addEventListener("click", () => swapImageSlots("source", "end"));
$("swapSourceMiddleBtn").addEventListener("click", () => swapImageSlots("source", "middle"));
$("swapMiddleEndBtn").addEventListener("click", () => swapImageSlots("middle", "end"));
$("audioInput").addEventListener("change", () => uploadAudio().catch((err) => {
  state.audioPath = "";
  $("audioStatus").textContent = err.message;
}));
$("sizePreset").addEventListener("change", () => onPresetSizeChange({ presetId: "sizePreset", scaleId: "sizeScale", sizeId: "customSizeInput" }));
$("sizeScale").addEventListener("input", updateSizeReadout);
$("customSizeInput").addEventListener("input", onCustomSizeInput);
$("directorSizePreset").addEventListener("change", () => onPresetSizeChange({ presetId: "directorSizePreset", scaleId: "directorSizeScale", sizeId: "directorCustomSizeInput" }));
$("directorSizeScale").addEventListener("input", updateSizeReadout);
$("directorCustomSizeInput").addEventListener("input", onCustomSizeInput);
$("resetPromptsBtn").addEventListener("click", resetPrompt);
$("refreshBtn").addEventListener("click", loadConfig);
$("runBtn").addEventListener("click", startBatch);
$("addDirectorSegmentBtn").addEventListener("click", () => addDirectorSegment());
$("openStoryboardImportBtn").addEventListener("click", openStoryboardImportModal);
$("closeStoryboardImportBtn").addEventListener("click", closeStoryboardImportModal);
$("cancelStoryboardImportBtn").addEventListener("click", closeStoryboardImportModal);
$("storyboardImportModal").addEventListener("click", (event) => {
  if (event.target.matches("[data-close-storyboard-modal]")) closeStoryboardImportModal();
});
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
