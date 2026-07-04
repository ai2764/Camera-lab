function initialWorkspace() {
  if (window.location.hash === "#director") return "director";
  if (window.location.hash === "#edit" || window.location.hash === "#bernini" || window.location.hash === "#inpaint") return "edit";
  if (window.location.hash === "#casting") return "casting";
  if (window.location.hash === "#motion") return "motion";
  return "camera";
}

const {
  BERNINI_TASKS,
  BERNINI_DEFAULT_NEGATIVE,
  INPAINT_WORKFLOW_MODE,
  INPAINT_DEFAULT_PROMPT,
  INPAINT_DEFAULT_NEGATIVE,
  DIRECTOR_DEFAULT_GLOBAL_PROMPT,
  DIRECTOR_TIMELINE_PIXELS_PER_SECOND,
  getBerniniTask,
  isBerniniImageMode,
  createInitialState,
} = window.CameraLabWorkspace;

const state = createInitialState(initialWorkspace());

const $ = (id) => document.getElementById(id);
const imageSlots = {
  source: { pathKey: "sourcePath", previewId: "sourcePreview", statusId: "sourceStatus", empty: "No image uploaded" },
  middle: { pathKey: "middlePath", previewId: "middlePreview", statusId: "middleStatus", empty: "No image uploaded" },
  end: { pathKey: "endPath", previewId: "endPreview", statusId: "endStatus", empty: "No image uploaded" },
  motion_ref: {
    pathKey: "motionRefPath",
    previewId: "motionRefPreview",
    extraPreviewIds: ["motionScailRefPreview"],
    statusId: "motionRefStatus",
    empty: "No image uploaded",
  },
  berniniReference: {
    pathKey: "berniniReferenceImagePath",
    previewId: "berniniReferenceImagePreview",
    statusId: "berniniReferenceImageStatus",
    empty: "No image uploaded",
  },
  inpaintReference: {
    pathKey: "inpaintReferenceImagePath",
    previewId: "inpaintReferenceImagePreview",
    statusId: "inpaintReferenceImageStatus",
    empty: "Optional reference not uploaded",
  },
};

const videoSlots = {
  berniniSource: {
    pathKey: "berniniSourceVideoPath",
    nameKey: "berniniSourceVideoName",
    statusId: "berniniSourceVideoStatus",
    editId: "berniniSourceVideoEditBtn",
    previewId: "berniniSourceVideoPreview",
    previewWrapId: "berniniSourceVideoPreviewWrap",
    title: "Bernini source video",
  },
  berniniReference: {
    pathKey: "berniniReferenceVideoPath",
    nameKey: "berniniReferenceVideoName",
    statusId: "berniniReferenceVideoStatus",
    editId: "berniniReferenceVideoEditBtn",
    previewId: "berniniReferenceVideoPreview",
    previewWrapId: "berniniReferenceVideoPreviewWrap",
    title: "Bernini reference video",
  },
  inpaintSource: {
    pathKey: "inpaintSourceVideoPath",
    nameKey: "inpaintSourceVideoName",
    statusId: "inpaintSourceVideoStatus",
    editId: "inpaintSourceVideoEditBtn",
    previewId: "inpaintSourceVideoPreview",
    previewWrapId: "inpaintSourceVideoPreviewWrap",
    title: "Inpaint source video",
  },
  motionGuide: {
    pathKey: "motionGuideVideoPath",
    nameKey: "",
    statusId: "motionGuideUploadStatus",
    editId: "motionGuideEditBtn",
    extraEditIds: ["motionGuidePreviewEditBtn"],
    previewId: "motionGuideUploadPreview",
    previewWrapId: "motionGuideUploadPreviewWrap",
    title: "Motion guide video",
  },
};

const motion3dActions = [
  ["idle", "Idle loop", 3],
  ["walk_forward", "Walk forward", 2.4],
  ["run_forward", "Run forward", 1.6],
  ["turn_left", "Turn left", 1.4],
  ["turn_right", "Turn right", 1.4],
  ["step_left", "Step left", 1.2],
  ["step_right", "Step right", 1.2],
  ["wave_right", "Wave right", 2.2],
  ["point_forward", "Point forward", 1.8],
  ["raise_hands", "Raise hands", 2],
  ["crouch", "Crouch", 1.6],
  ["dance_loop", "Dance loop", 3],
  ["hit_react", "Hit react", 1.2],
  ["climb_up", "Climb up", 2.6],
  ["farm_harvest", "Farm harvest", 2.4],
].map(([id, label, duration]) => ({ id, label, duration }));

function motion3dId() {
  return `m3d_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
}
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

function visibleWorkflowItems(items) {
  return items.filter((item) => !(isBerniniWorkflow(item) && isBerniniImageMode(item.mode)));
}

function currentMove() {
  const id = $("moveSelect").value;
  return state.config.camera_moves.find((m) => m.id === id);
}

function currentWorkflow() {
  const id = $("workflowSelect").value;
  return state.config.workflows.find((w) => w.id === id);
}

function currentDirectorWorkflow() {
  return state.config?.workflows?.find((w) => w.id === state.directorWorkflowId)
    || state.config?.workflows?.find((w) => w.mode === "director_ref")
    || null;
}

function currentBerniniWorkflow() {
  return state.config?.workflows?.find((w) => w.id === state.berniniWorkflowId) || null;
}

function currentInpaintWorkflow() {
  return state.config?.workflows?.find((w) => w.id === state.inpaintWorkflowId)
    || state.config?.workflows?.find((w) => w.mode === INPAINT_WORKFLOW_MODE)
    || null;
}

function currentEditWorkflow() {
  const wf = currentWorkflow();
  if (isInpaintWorkflow(wf) || (isBerniniWorkflow(wf) && !isBerniniImageMode(wf.mode))) return wf;
  const bernini = currentBerniniWorkflow();
  if (isBerniniWorkflow(bernini) && !isBerniniImageMode(bernini.mode)) return bernini;
  return currentInpaintWorkflow();
}

function isDirectorWorkflow() {
  const wf = currentWorkflow();
  return wf && wf.mode === "director_ref";
}

function isBerniniWorkflow(workflow = currentWorkflow()) {
  return Boolean(workflow && getBerniniTask(workflow.mode));
}

function isInpaintWorkflow(workflow = currentWorkflow()) {
  return workflow && workflow.mode === INPAINT_WORKFLOW_MODE;
}

function directorWorkflowOption() {
  return [...$("workflowSelect").options].find((opt) => {
    const workflow = state.config?.workflows?.find((item) => item.id === opt.value);
    return workflow?.mode === "director_ref";
  });
}

function berniniWorkflowOption() {
  return [...$("workflowSelect").options].find((opt) => {
    const workflow = state.config?.workflows?.find((item) => item.id === opt.value);
    return isBerniniWorkflow(workflow) && !isBerniniImageMode(workflow.mode);
  });
}

function inpaintWorkflowOption() {
  return [...$("workflowSelect").options].find((opt) => {
    const workflow = state.config?.workflows?.find((item) => item.id === opt.value);
    return isInpaintWorkflow(workflow);
  });
}

function cameraWorkflowOption() {
  return [...$("workflowSelect").options].find((opt) => {
    const workflow = state.config?.workflows?.find((item) => item.id === opt.value);
    return workflow?.mode !== "director_ref" && !isBerniniWorkflow(workflow) && !isInpaintWorkflow(workflow) && !opt.disabled;
  });
}

function workflowOptionById(id, mode) {
  if (!id) return null;
  const option = [...$("workflowSelect").options].find((opt) => opt.value === id && (["edit", "bernini", "inpaint", "director_ref"].includes(mode) || !opt.disabled));
  if (!option) return null;
  const workflow = state.config?.workflows?.find((item) => item.id === option.value);
  if (mode === "camera" && (workflow?.mode === "director_ref" || isBerniniWorkflow(workflow) || isInpaintWorkflow(workflow))) return null;
  else if (mode === "edit" && !(isInpaintWorkflow(workflow) || (isBerniniWorkflow(workflow) && !isBerniniImageMode(workflow.mode)))) return null;
  else if (mode === "bernini" && !isBerniniWorkflow(workflow)) return null;
  else if (mode === "inpaint" && !isInpaintWorkflow(workflow)) return null;
  else if (mode && !["camera", "edit", "bernini", "inpaint"].includes(mode) && workflow?.mode !== mode) return null;
  return option;
}

function rememberCurrentWorkflow() {
  const workflow = currentWorkflow();
  if (!workflow) return;
  if (workflow.mode === "director_ref") state.directorWorkflowId = workflow.id;
  else if (isBerniniWorkflow(workflow)) state.berniniWorkflowId = workflow.id;
  else if (isInpaintWorkflow(workflow)) state.inpaintWorkflowId = workflow.id;
  else state.cameraWorkflowId = workflow.id;
}

function setWorkspace(workspace, { syncWorkflow = true } = {}) {
  const requestedWorkspace = workspace;
  if (workspace === "bernini" || workspace === "inpaint") workspace = "edit";
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
    } else if (workspace === "edit") {
      const option = requestedWorkspace === "inpaint"
        ? (workflowOptionById(state.inpaintWorkflowId, "inpaint") || inpaintWorkflowOption())
        : (workflowOptionById(state.berniniWorkflowId, "edit") || berniniWorkflowOption() || inpaintWorkflowOption());
      if (option) $("workflowSelect").value = option.value;
    } else if (workspace === "camera" && isDirectorWorkflow()) {
      const option = workflowOptionById(state.cameraWorkflowId, "camera") || cameraWorkflowOption();
      if (option) $("workflowSelect").value = option.value;
    } else if (workspace === "camera" && isBerniniWorkflow()) {
      const option = workflowOptionById(state.cameraWorkflowId, "camera") || cameraWorkflowOption();
      if (option) $("workflowSelect").value = option.value;
    } else if (workspace === "camera" && isInpaintWorkflow()) {
      const option = workflowOptionById(state.cameraWorkflowId, "camera") || cameraWorkflowOption();
      if (option) $("workflowSelect").value = option.value;
    }
  }
  rememberCurrentWorkflow();
  updateWorkflowFields();
  renderScopedHistory();
  updateRunButtonLabel();
  if (workspace === "photography") {
    window.dispatchEvent(new CustomEvent("camera-lab:photography-visible"));
  }
}

function setBerniniWorkflow(id) {
  const workflow = state.config?.workflows?.find((item) => item.id === id);
  if (!isBerniniWorkflow(workflow) || isBerniniImageMode(workflow.mode)) return;
  const option = workflowOptionById(id, "edit");
  state.berniniWorkflowId = id;
  if (option) $("workflowSelect").value = id;
  setWorkspace("edit", { syncWorkflow: false });
  resetPrompt();
}

function setInpaintWorkflow() {
  const option = workflowOptionById(state.inpaintWorkflowId, "inpaint") || inpaintWorkflowOption();
  if (option) {
    $("workflowSelect").value = option.value;
    state.inpaintWorkflowId = option.value;
  }
  setWorkspace("edit", { syncWorkflow: false });
  resetPrompt();
}

function berniniResultVideoTargets() {
  const available = new Set((state.config?.workflows || []).map((workflow) => workflow.id));
  const targets = [];
  for (const [workflowId, task] of Object.entries(BERNINI_TASKS)) {
    if (!available.has(workflowId)) continue;
    if (task.sourceVideo) {
      targets.push({
        workflowId,
        slotKey: "berniniSource",
        label: `${task.tag} Source video`,
      });
    }
    if (task.referenceVideo) {
      targets.push({
        workflowId,
        slotKey: "berniniReference",
        label: `${task.tag} Reference video`,
      });
    }
  }
  if (available.has(INPAINT_WORKFLOW_MODE)) {
    targets.push({
      workflowId: INPAINT_WORKFLOW_MODE,
      slotKey: "inpaintSource",
      label: "Inpaint Source video",
      kind: "inpaint",
    });
  }
  return targets;
}

function useResultVideoForEdit(run, workflowId, slotKey, kind = "bernini") {
  if (!run?.video) return;
  if (kind === "inpaint") setInpaintWorkflow();
  else setBerniniWorkflow(workflowId);
  setVideoSlot(slotKey, run.video, fileNameFromPath(run.video));
  $("runHint").textContent = kind === "inpaint"
    ? "Loaded result video into Inpaint"
    : `Loaded result video into ${getBerniniTask(workflowId)?.tag || "Bernini"}`;
}

function useResultVideoForRetake(run) {
  if (!run?.video) return;
  state.directorRetakePendingStitch = null;
  state.directorRetakeVideo = {
    videoPath: run.video,
    videoName: fileNameFromPath(run.video),
    videoPreviewUrl: mediaUrl(run.video),
    videoPosterUrl: "",
    duration: Math.max(0.5, Number(run.duration || run.director_timeline?.duration_seconds || 2) || 2),
    width: Number(run.width || run.frame_width || run.output_width || run.director_timeline?.width) || 0,
    height: Number(run.height || run.frame_height || run.output_height || run.director_timeline?.height) || 0,
  };
  state.directorRetakeStart = 0;
  state.directorRetakeLength = Math.min(1, state.directorRetakeVideo.duration);
  state.directorRetakePrompt = "";
  state.directorMode = "retake";
  setWorkspace("director");
  setDirectorMode("retake");
  $("runHint").textContent = "Loaded result video into Director Retake";
}

function retakeBaseVideoSize(video) {
  const current = currentSize();
  return {
    width: align8(Number(video?.width) || current.width),
    height: align8(Number(video?.height) || current.height),
  };
}

function applyRetakeEditRunSettings(video, target, clipDuration) {
  const editDuration = Math.max(0.1, Number(clipDuration) || Number(video?.duration) || directorRetakeTotalSeconds());
  const size = retakeBaseVideoSize(video);
  if ($("durationInput")) $("durationInput").value = String(roundTenth(editDuration));
  if ($("customSizeInput")) $("customSizeInput").value = `${size.width}x${size.height}`;
  if ($("sizeScale")) $("sizeScale").value = "100";
  if ($("sizePreset")) {
    const matching = [...$("sizePreset").options].find((option) => option.value === `${size.width}x${size.height}`);
    if (matching) $("sizePreset").value = matching.value;
  }
  if (target?.kind === "bernini" && $("berniniPreserveAudio")) $("berniniPreserveAudio").checked = true;
  updateSizeReadout();
}

function directorRetakeEditTargets() {
  const available = new Set((state.config?.workflows || []).map((workflow) => workflow.id));
  const targets = [];
  for (const [workflowId, task] of Object.entries(BERNINI_TASKS)) {
    if (!available.has(workflowId) || !task.sourceVideo) continue;
    targets.push({
      id: workflowId,
      label: task.tag,
      kind: "bernini",
      slotKey: "berniniSource",
    });
  }
  if (available.has(INPAINT_WORKFLOW_MODE)) {
    targets.push({
      id: INPAINT_WORKFLOW_MODE,
      label: "Inpaint",
      kind: "inpaint",
      slotKey: "inpaintSource",
    });
  }
  return targets;
}

function renderResultVideoEditMenu(run) {
  const targets = berniniResultVideoTargets();
  if (!run?.video) return null;
  const wrap = document.createElement("div");
  wrap.className = "result-video-edit";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "result-video-edit-button";
  trigger.textContent = "Edit";
  trigger.setAttribute("aria-label", "Edit result video");
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    document.querySelectorAll(".result-video-edit.open").forEach((node) => {
      if (node !== wrap) node.classList.remove("open");
    });
    wrap.classList.toggle("open");
  });
  const menu = document.createElement("div");
  menu.className = "result-video-edit-menu";
  const extractItem = document.createElement("button");
  extractItem.type = "button";
  extractItem.textContent = "Extract frame";
  extractItem.addEventListener("click", (event) => {
    event.stopPropagation();
    wrap.classList.remove("open");
    openFrameExtract(run);
  });
  menu.appendChild(extractItem);
  const retakeItem = document.createElement("button");
  retakeItem.type = "button";
  retakeItem.textContent = "Retake";
  retakeItem.addEventListener("click", (event) => {
    event.stopPropagation();
    wrap.classList.remove("open");
    useResultVideoForRetake(run);
  });
  menu.appendChild(retakeItem);
  targets.forEach((target) => {
    const item = document.createElement("button");
    item.type = "button";
    item.textContent = target.label;
    item.addEventListener("click", (event) => {
      event.stopPropagation();
      wrap.classList.remove("open");
      useResultVideoForEdit(run, target.workflowId, target.slotKey, target.kind);
    });
    menu.appendChild(item);
  });
  wrap.append(trigger, menu);
  return wrap;
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
  const useDirectorSize = state.workspace === "director" && $("directorSizePreset");
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
  if ($("berniniReferenceImagePreview")) $("berniniReferenceImagePreview").parentElement.style.aspectRatio = `${size.width} / ${size.height}`;
  if ($("inpaintReferenceImagePreview")) $("inpaintReferenceImagePreview").parentElement.style.aspectRatio = `${size.width} / ${size.height}`;
  if ($("inpaintMaskStage")) $("inpaintMaskStage").style.aspectRatio = `${size.width} / ${size.height}`;
  resizeInpaintCanvas();
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

function setMotionPromptValue(value) {
  const text = value || "";
  if ($("motionPrompt")) $("motionPrompt").value = text;
  if ($("motionScailPrompt")) $("motionScailPrompt").value = text;
}

function syncMotionPrompt(sourceId) {
  const source = $(sourceId);
  if (!source) return;
  const targetId = sourceId === "motionScailPrompt" ? "motionPrompt" : "motionScailPrompt";
  const target = $(targetId);
  if (target && target.value !== source.value) target.value = source.value;
}

function currentMotionPrompt() {
  const scailPrompt = $("motionScailPrompt");
  if (state.motionSubtab === "scail" && scailPrompt) {
    return scailPrompt.value.trim() || $("motionPrompt").value.trim();
  }
  return $("motionPrompt").value.trim();
}

function ensureDirectorGlobalPromptDefault({ force = false } = {}) {
  const field = $("directorGlobalPrompt");
  if (!field) return;
  if (force || (!state.directorGlobalPromptInitialized && !field.value.trim())) {
    field.value = DIRECTOR_DEFAULT_GLOBAL_PROMPT;
  }
  state.directorGlobalPromptInitialized = true;
}

function resetPrompt() {
  const move = currentMove();
  const workflow = state.workspace === "director"
    ? currentDirectorWorkflow()
    : state.workspace === "edit"
      ? currentEditWorkflow()
        : currentWorkflow();
  if (!move || !workflow) return;
  if (isBerniniWorkflow(workflow)) {
    const task = getBerniniTask(workflow.mode);
    $("promptTag").textContent = task.tag;
    $("promptText").value = task.prompt;
    $("negativePrompt").value = BERNINI_DEFAULT_NEGATIVE;
    return;
  }
  if (isInpaintWorkflow(workflow)) {
    $("promptTag").textContent = "INPAINT";
    $("promptText").value = INPAINT_DEFAULT_PROMPT;
    $("negativePrompt").value = INPAINT_DEFAULT_NEGATIVE;
    return;
  }
  if (isDirectorWorkflow(workflow)) {
    $("promptTag").textContent = "DIRECTOR";
    $("promptText").value = "";
    const negative = state.config?.default_negative || $("negativePrompt").value || "";
    $("negativePrompt").value = negative;
    setInputValueIfPresent("directorNegativePrompt", negative);
    ensureDirectorGlobalPromptDefault({ force: true });
    renderDirectorEditor();
    return;
  }
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
  const wf = state.workspace === "director"
    ? currentDirectorWorkflow()
    : state.workspace === "edit"
      ? currentEditWorkflow()
        : currentWorkflow();
  if (!wf) return;
  const isDirector = wf.mode === "director_ref";
  const isBernini = isBerniniWorkflow(wf);
  const isInpaint = isInpaintWorkflow(wf);
  const berniniTask = isBernini ? getBerniniTask(wf.mode) : null;
  const showDirectorWorkspace = state.workspace === "director" && isDirector;
  const showEditWorkspace = state.workspace === "edit" && (isBernini || isInpaint);
  const showBerniniWorkspace = showEditWorkspace && isBernini;
  const showInpaintWorkspace = showEditWorkspace && isInpaint;
  const showPhotographyWorkspace = state.workspace === "photography";
  const showCastingWorkspace = state.workspace === "casting";
  const showMotionWorkspace = state.workspace === "motion";
  const showSourceImage = isBernini ? !!berniniTask?.sourceImage : !isInpaint && wf.mode !== "t2v" && !isDirector;
  const showDuration = !(isBernini && isBerniniImageMode(wf.mode));
  const showMiddleImage = !isBernini && !isInpaint && (wf.mode === "fml" || wf.mode === "fml_native");
  const showEndImage = !isBernini && !isInpaint && (wf.mode === "flf" || wf.mode === "fml" || wf.mode === "fml_native" || wf.mode === "flf_ia2v");
  document.body.classList.toggle("director-mode", showDirectorWorkspace);
  document.body.classList.toggle("director-workspace-active", showDirectorWorkspace);
  document.body.classList.toggle("edit-workspace-active", showEditWorkspace);
  document.body.classList.toggle("bernini-workspace-active", showBerniniWorkspace);
  document.body.classList.toggle("inpaint-workspace-active", showInpaintWorkspace);
  document.body.classList.toggle("photography-workspace-active", showPhotographyWorkspace);
  document.body.classList.toggle("casting-workspace-active", showCastingWorkspace);
  document.body.classList.toggle("motion-workspace-active", showMotionWorkspace);
  $("cameraWorkspaceTab").classList.toggle("active", state.workspace === "camera");
  $("directorWorkspaceTab").classList.toggle("active", showDirectorWorkspace);
  $("editWorkspaceTab").classList.toggle("active", showEditWorkspace);
  $("photographyWorkspaceTab").classList.toggle("active", showPhotographyWorkspace);
  $("castingWorkspaceTab").classList.toggle("active", showCastingWorkspace);
  $("motionWorkspaceTab").classList.toggle("active", showMotionWorkspace);
  $("motionWorkspace").hidden = !showMotionWorkspace;
  $("berniniModeBar").hidden = !showEditWorkspace;
  const showBerniniSourceVideo = showBerniniWorkspace && !!berniniTask?.sourceVideo;
  const showBerniniReferenceImage = showBerniniWorkspace && !!berniniTask?.referenceImage;
  const showBerniniReferenceVideo = showBerniniWorkspace && !!berniniTask?.referenceVideo;
  const showBerniniReferenceControls = showBerniniWorkspace && (showBerniniReferenceImage || showBerniniReferenceVideo);
  const showBerniniLongVideo = showBerniniWorkspace && wf.mode === "bernini_rv2v";
  $("berniniTaskPanel").hidden = !(
    showBerniniSourceVideo
    || showBerniniReferenceImage
    || showBerniniReferenceVideo
    || showBerniniReferenceControls
    || showBerniniLongVideo
  );
  $("berniniSourceVideoWrap").style.display = showBerniniSourceVideo ? "block" : "none";
  $("berniniPreserveAudioWrap").hidden = !showBerniniSourceVideo;
  $("berniniReferenceImageWrap").style.display = showBerniniReferenceImage ? "block" : "none";
  $("berniniReferenceImagePreviewWrap").style.display = showBerniniReferenceImage ? "block" : "none";
  $("berniniReferenceVideoWrap").style.display = showBerniniReferenceVideo ? "block" : "none";
  $("berniniReferenceControls").hidden = !showBerniniReferenceControls;
  $("berniniLongVideoPanel").hidden = !showBerniniLongVideo;
  $("inpaintTaskPanel").hidden = !showInpaintWorkspace;
  $("inpaintCanvasPanel").hidden = !showInpaintWorkspace;
  document.querySelectorAll(".bernini-mode-tab").forEach((button) => {
    const active = button.dataset.berniniWorkflow === wf.id;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".inpaint-mode-tab").forEach((button) => {
    button.classList.toggle("active", showInpaintWorkspace);
    button.setAttribute("aria-selected", showInpaintWorkspace ? "true" : "false");
  });
  if (showPhotographyWorkspace) return;
  if (showCastingWorkspace) return;
  if (showMotionWorkspace) {
    updateMotionSubtabs();
    return;
  }
  $("cameraMoveWrap").style.display = isDirector || isBernini || isInpaint ? "none" : "block";
  const directorReferenceWrap = $("directorReferenceWrap");
  if (directorReferenceWrap) directorReferenceWrap.style.display = showDirectorWorkspace ? "grid" : "none";
  $("directorTimelinePanel").style.display = showDirectorWorkspace ? "block" : "none";
  $("directorInlineResults").style.display = showDirectorWorkspace ? "block" : "none";
  $("sourceImageWrap").style.display = showSourceImage ? "block" : "none";
  $("sourcePreviewWrap").style.display = showSourceImage ? "block" : "none";
  $("middleImageWrap").style.display = showMiddleImage ? "block" : "none";
  $("middlePreviewWrap").style.display = showMiddleImage ? "block" : "none";
  $("endImageWrap").style.display = showEndImage ? "block" : "none";
  $("endPreviewWrap").style.display = showEndImage ? "block" : "none";
  $("durationWrap").style.display = showDuration ? "block" : "none";
  $("swapSourceEndWrap").style.display = wf.mode === "flf" || wf.mode === "flf_ia2v" ? "block" : "none";
  $("swapSourceMiddleWrap").style.display = showMiddleImage ? "block" : "none";
  $("swapMiddleEndWrap").style.display = showMiddleImage ? "block" : "none";
  const audioWrap = $("audioUploadWrap");
  const audioTarget = $("audioUploadHome");
  if (audioWrap.parentElement !== audioTarget) audioTarget.appendChild(audioWrap);
  $("audioUploadWrap").style.display = !isBernini && !isInpaint && (wf.mode === "ia2v" || wf.mode === "flf_ia2v") ? "block" : "none";
  const runStrip = $("directorRunStrip");
  const runTarget = showDirectorWorkspace ? $("directorRunSlot") : $("runStripHome");
  if (runStrip.parentElement !== runTarget) runTarget.appendChild(runStrip);
  $("promptTag").textContent = isBernini ? getBerniniTask(wf.mode).tag : isInpaint ? "INPAINT" : wf.mode.toUpperCase();
  $("promptPanelTitle").textContent = showDirectorWorkspace ? "Director" : showBerniniWorkspace ? "Bernini Prompt" : showInpaintWorkspace ? "Inpaint Prompt" : "Prompt";
  if (showDirectorWorkspace) {
    ensureDirectorGlobalPromptDefault();
    renderDirectorEditor();
  }
  updateRunButtonLabel();
}

function runButtonIdleText() {
  if (state.workspace === "director" && state.directorMode === "retake") return "Queue Director Retake";
  return "Queue Run";
}

function directorSeedValue() {
  return $("directorGlobalSeedInput")?.value.trim() || "";
}

function directorNegativePromptValue() {
  return $("directorNegativePrompt")?.value.trim() || $("negativePrompt").value.trim();
}

function directorIcLoraStrengthValue() {
  const raw = Number($("directorIcLoraStrength")?.value);
  return Math.max(0, Math.min(2, Number.isFinite(raw) ? raw : 1));
}

function directorGuideStrengthValue(value, fallback = 1) {
  const raw = Number(value);
  return Math.max(0, Math.min(1, Number.isFinite(raw) ? raw : fallback));
}

function updateRunButtonLabel({ force = false } = {}) {
  const button = $("runBtn");
  if (!button || (!force && button.textContent === "Queueing...")) return;
  button.textContent = runButtonIdleText();
}

function collectPayload() {
  const size = currentSize();
  const prompt = $("promptText").value.trim();
  const workflow = state.workspace === "director"
    ? currentDirectorWorkflow()
    : state.workspace === "edit"
      ? currentEditWorkflow()
        : currentWorkflow();

  if (isDirectorWorkflow(workflow)) {
    if (state.directorMode === "retake") {
      const retakeVideo = normalizedDirectorRetakeVideo();
      const duration = directorRetakeTotalSeconds();
      const retakeRange = normalizedDirectorRetakeRange();
      return {
        workflow_id: workflow.id,
        camera_move: "director_ref",
        source_path: "",
        middle_path: "",
        end_path: "",
        duration,
        width: size.width,
        height: size.height,
        seed: directorSeedValue(),
        negative_prompt: directorNegativePromptValue(),
        prompt,
        global_prompt: $("directorGlobalPrompt").value.trim(),
        global_reference_strength: 0,
        segments: [],
        timeline_segments: [],
        motion_segments: [],
        audio_segments: [],
        ic_lora_name: $("directorIcLora")?.value || "None",
        ic_lora_strength: directorIcLoraStrengthValue(),
        reference_images: collectReferenceImages(),
        audio_path: "",
        retake_mode: true,
        retake_video: retakeVideo ? {
          video_path: retakeVideo.videoPath,
          file_name: retakeVideo.videoName || fileNameFromPath(retakeVideo.videoPath),
          duration: retakeVideo.duration,
        } : {},
        retake_start: retakeRange.start,
        retake_length: retakeRange.length,
        retake_prompt: $("directorRetakePrompt")?.value.trim() || state.directorRetakePrompt || "",
        retake_strength: Math.max(0, Math.min(1, Number($("directorRetakeStrength")?.value ?? state.directorRetakeStrength) || 1)),
      };
    }
    const segments = collectDirectorSegments();
    const motionSegments = collectDirectorMotionSegments();
    const audioSegments = collectDirectorAudioSegments();
    // Generation length = real content extent (longest track). directorTotalSeconds()
    // adds a x1.3 ruler-only headroom and must NOT define the generated duration.
    const duration = directorOutputDurationSeconds();
    const sheetSegment = isIngredientsIcLora($("directorIcLora")?.value) ? ingredientsSheetSegment(duration) : null;
    const timelineSegments = sheetSegment ? [sheetSegment, ...segments] : segments;
    return {
      workflow_id: workflow.id,
      camera_move: "director_ref",
      source_path: "",
      middle_path: "",
      end_path: "",
      duration,
      width: size.width,
      height: size.height,
      seed: directorSeedValue(),
      negative_prompt: directorNegativePromptValue(),
      prompt,
      global_prompt: $("directorGlobalPrompt").value.trim(),
      global_reference_strength: 0,
      segments: timelineSegments,
      timeline_segments: timelineSegments,
      motion_segments: motionSegments,
      audio_segments: audioSegments,
      ic_lora_name: $("directorIcLora")?.value || "None",
      ic_lora_strength: directorIcLoraStrengthValue(),
      reference_images: collectReferenceImages(),
      audio_path: "",
    };
  }

  if (isBerniniWorkflow(workflow)) {
    const berniniTask = getBerniniTask(workflow.mode);
    const payload = {
      workflow_id: workflow.id,
      camera_move: workflow.mode,
      source_path: state.sourcePath,
      middle_path: "",
      end_path: "",
      reference_image_path: state.berniniReferenceImagePath,
      source_video_path: state.berniniSourceVideoPath,
      reference_video_path: state.berniniReferenceVideoPath,
      bernini_preserve_audio: !!(berniniTask?.sourceVideo && $("berniniPreserveAudio").checked),
      bernini_split_enabled: workflow.mode === "bernini_rv2v" && $("berniniSplitEnabled").checked,
      bernini_split_duration: Number($("berniniSplitDuration").value) || 4,
      bernini_split_merge: $("berniniSplitMerge").checked,
      global_reference_strength: Math.max(0, Math.min(1, Number($("berniniReferenceStrength").value) || 0)),
      bernini_ref_max_size: Math.max(16, Math.min(8192, Number($("berniniRefMaxSize").value) || 848)),
      width: size.width,
      height: size.height,
      seed: $("seedInput").value.trim(),
      negative_prompt: $("negativePrompt").value.trim(),
      prompt,
      audio_path: "",
    };
    const retakeContext = retakeContextForPayload(state.editRetakeContext);
    if (retakeContext && retakeContext.target_workflow === workflow.id && retakeContextMatchesVideo(retakeContext, state.berniniSourceVideoPath)) {
      payload.retake_context = retakeContext;
    }
    if (!isBerniniImageMode(workflow.mode)) {
      payload.duration = Number($("durationInput").value);
    }
    return payload;
  }

  if (isInpaintWorkflow(workflow)) {
    const payload = {
      workflow_id: workflow.id,
      camera_move: workflow.mode,
      source_path: "",
      middle_path: "",
      end_path: "",
      reference_image_path: state.inpaintReferenceImagePath,
      source_video_path: state.inpaintSourceVideoPath,
      mask_image_path: state.inpaintMaskImagePath,
      duration: Number($("durationInput").value),
      width: size.width,
      height: size.height,
      seed: $("seedInput").value.trim(),
      negative_prompt: $("negativePrompt").value.trim(),
      prompt,
      audio_path: "",
    };
    const retakeContext = retakeContextForPayload(state.editRetakeContext);
    if (retakeContext && retakeContext.target_workflow === workflow.id && retakeContextMatchesVideo(retakeContext, state.inpaintSourceVideoPath)) {
      payload.retake_context = retakeContext;
    }
    return payload;
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

function isIngredientsIcLora(name) {
  return /ingredients/i.test(String(name || ""));
}

function ingredientsSheetSegment(duration) {
  if (!state.ingredientsSheetPath) return null;
  const length = Math.max(0.5, Number(duration) || directorOutputDurationSeconds());
  return {
    id: "ingredients_reference_sheet",
    type: "image",
    prompt: $("directorGlobalPrompt")?.value.trim() || "",
    duration: length,
    reference: "",
    image_path: state.ingredientsSheetPath,
    video_path: "",
    start: 0,
    guide_frame: 0,
    strength: 1,
  };
}

function collectDirectorSegments() {
  const model = createDirectorTimelineModelFromState();
  if (model) {
    return model.items
      .filter((item) => item.track === "main")
      .filter((item) => item.prompt.trim() || item.mediaPath)
      .map((item) => {
        const start = DirectorTimelineModel.toSeconds(item.start, model.fps);
        const duration = Math.max(0.5, DirectorTimelineModel.toSeconds(item.length, model.fps));
        return {
          id: item.id,
          type: item.kind === "video" ? "video" : (item.kind === "image" ? "image" : "text"),
          prompt: item.prompt.trim(),
          duration,
          reference: "",
          image_path: item.kind === "image" ? item.mediaPath : "",
          video_path: item.kind === "video" ? item.mediaPath : "",
          start,
          guide_frame: Math.max(0, item.start + Math.round(Number(item.extra?.guideOffsetFrames) || 0)),
          trim_start: item.kind === "video" ? item.trimStart : 0,
          strength: directorGuideStrengthValue(item.strength),
        };
      });
  }
  return normalizedDirectorSegments()
    .filter((segment) => segment.prompt.trim() || segment.imagePath || segment.videoPath)
    .map((segment) => ({
      id: segment.id,
      type: segment.videoPath ? "video" : (segment.imagePath ? "image" : "text"),
      prompt: segment.prompt.trim(),
      duration: Math.max(0.5, Number(segment.duration) || 0.5),
      reference: "",
      image_path: segment.imagePath || "",
      video_path: segment.videoPath || "",
      start: Math.max(0, Number(segment.start) || 0),
      guide_frame: Math.max(0, Math.round(((Number(segment.start) || 0) * 24) + (Number(segment.guideOffsetFrames) || 0))),
      trim_start: segment.videoPath ? Math.max(0, Math.round((Number(segment.trimStart) || 0) * 24)) : 0,
      strength: directorGuideStrengthValue(segment.strength),
    }));
}

function collectDirectorAudioSegments() {
  syncDirectorVideoAudioSegments();
  const model = createDirectorTimelineModelFromState();
  if (model) {
    return model.items
      .filter((item) => (item.track === "video_audio" || item.track === "dialogue") && item.mediaPath)
      .map((item) => ({
        id: item.id,
        ...(item.track === "video_audio" ? { source: "video" } : {}),
        audio_path: item.mediaPath,
        start: DirectorTimelineModel.toSeconds(item.start, model.fps),
        duration: Math.max(0.5, DirectorTimelineModel.toSeconds(item.length, model.fps)),
        trim_start: item.trimStart,
        volume: Math.max(0, Number(item.volume ?? 1)),
      }))
      .sort((a, b) => a.start - b.start);
  }
  const videoAudioSegments = normalizedDirectorVideoAudioSegments()
    .map((segment) => ({
      id: segment.id,
      source: "video",
      audio_path: segment.audioPath,
      start: Math.max(0, Number(segment.start) || 0),
      duration: Math.max(0.5, Number(segment.duration) || 0.5),
      trim_start: Math.max(0, Math.round((Number(segment.trimStart) || 0) * 24)),
      volume: Math.max(0, Number(segment.volume ?? 1)),
    }));
  const dialogueSegments = normalizedDirectorAudioSegments()
    .filter((segment) => segment.audioPath)
    .map((segment) => ({
      id: segment.id,
      audio_path: segment.audioPath,
      start: Math.max(0, Number(segment.start) || 0),
      duration: Math.max(0.5, Number(segment.duration) || 0.5),
      trim_start: Math.max(0, Math.round((Number(segment.trimStart) || 0) * 24)),
      volume: Math.max(0, Number(segment.volume ?? 1)),
    }));
  return [...videoAudioSegments, ...dialogueSegments].sort((a, b) => a.start - b.start);
}

function collectDirectorMotionSegments() {
  const model = createDirectorTimelineModelFromState();
  if (model) {
    return model.items
      .filter((item) => item.track === "ic_video" && item.mediaPath)
      .map((item) => ({
        id: item.id,
        type: "motion_video",
        video_path: item.mediaPath,
        start: DirectorTimelineModel.toSeconds(item.start, model.fps),
        duration: Math.max(0.5, DirectorTimelineModel.toSeconds(item.length, model.fps)),
        trim_start: item.trimStart,
      }));
  }
  return normalizedDirectorIcVideoSegments()
    .filter((segment) => segment.videoPath)
    .map((segment) => ({
      id: segment.id,
      type: "motion_video",
      video_path: segment.videoPath,
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
    videoPath: values.videoPath || "",
    videoName: values.videoName || "",
    videoPreviewUrl: values.videoPreviewUrl || "",
    videoPosterUrl: values.videoPosterUrl || "",
    trimStart: Math.max(0, Number(values.trimStart) || 0),
    audioPath: values.audioPath || "",
    audioName: values.audioName || "",
    audioDuration: Number(values.audioDuration) || 0,
    strength: values.strength ?? 1,
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
  state.directorIcVideoSegments = [];
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
  state.directorGlobalPromptInitialized = true;
  $("promptText").value = prompt;
  state.directorAudioSegments = [];
  state.directorIcVideoSegments = [];
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
      trimStart: Math.max(0, Number(segment.trimStart) || 0),
      strength: directorGuideStrengthValue(segment.strength),
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

function normalizedDirectorIcVideoSegments() {
  return state.directorIcVideoSegments
    .map((segment) => ({
      ...segment,
      start: Math.max(0, Number(segment.start) || 0),
      duration: Math.max(0.5, Number(segment.duration) || 0.5),
      trimStart: Math.max(0, Number(segment.trimStart) || 0),
    }))
    .sort((a, b) => a.start - b.start);
}

function normalizedDirectorVideoAudioSegments() {
  return state.directorVideoAudioSegments
    .map((segment) => ({
      ...segment,
      start: Math.max(0, Number(segment.start) || 0),
      duration: Math.max(0.5, Number(segment.duration) || 0.5),
      trimStart: Math.max(0, Number(segment.trimStart) || 0),
      audioDuration: Math.max(0.5, Number(segment.audioDuration || segment.duration) || 0.5),
    }))
    .filter((segment) => segment.audioPath)
    .sort((a, b) => a.start - b.start);
}

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

function normalizedDirectorRetakeVideo() {
  const video = state.directorRetakeVideo;
  if (!video || !video.videoPath) return null;
  return {
    ...video,
    duration: Math.max(0.5, Number(video.duration) || 0.5),
    videoPreviewUrl: video.videoPreviewUrl || (video.videoPath ? mediaUrl(video.videoPath) : ""),
    videoPosterUrl: video.videoPosterUrl || "",
  };
}

function directorRetakeTotalSeconds() {
  const video = normalizedDirectorRetakeVideo();
  return Math.max(0.5, video?.duration || 0.5);
}

function normalizedDirectorRetakeRange() {
  const total = directorRetakeTotalSeconds();
  if (!window.DirectorTimelineModel) {
    const start = roundTenth(Math.max(0, Math.min(total - 0.1, Number(state.directorRetakeStart) || 0)));
    const length = roundTenth(Math.max(0.1, Math.min(Number(state.directorRetakeLength) || 0.1, total - start)));
    return { start, length };
  }
  const fps = directorTimelineFps();
  const range = DirectorTimelineModel.clampRange({
    start: DirectorTimelineModel.toFrame(state.directorRetakeStart, fps),
    length: Math.max(1, DirectorTimelineModel.toFrame(state.directorRetakeLength, fps)),
    total: Math.max(1, DirectorTimelineModel.toFrame(total, fps)),
    minLength: Math.max(1, DirectorTimelineModel.toFrame(0.1, fps)),
  });
  return {
    start: DirectorTimelineModel.toSeconds(range.start, fps),
    length: DirectorTimelineModel.toSeconds(range.length, fps),
  };
}

function currentDirectorPlayheadSeconds() {
  return Number(window.DirectorPreview?._state?.().currentTime) || 0;
}

function setDirectorRetakeRangeFromFrames(startFrame, lengthFrame, totalFrame) {
  if (!window.DirectorTimelineModel) {
    const fps = directorTimelineFps();
    const total = Math.max(0.1, (Number(totalFrame) || fps) / fps);
    const start = roundTenth(Math.max(0, Math.min(total - 0.1, (Number(startFrame) || 0) / fps)));
    state.directorRetakeStart = start;
    state.directorRetakeLength = roundTenth(Math.max(0.1, Math.min((Number(lengthFrame) || 1) / fps, total - start)));
    return;
  }
  const fps = directorTimelineFps();
  const range = DirectorTimelineModel.clampRange({
    start: startFrame,
    length: lengthFrame,
    total: totalFrame,
    minLength: Math.max(1, DirectorTimelineModel.toFrame(0.1, fps)),
  });
  state.directorRetakeStart = DirectorTimelineModel.toSeconds(range.start, fps);
  state.directorRetakeLength = DirectorTimelineModel.toSeconds(range.length, fps);
}

function setDirectorRetakeRangeFromSeconds(start, length, total = directorRetakeTotalSeconds()) {
  const fps = directorTimelineFps();
  if (!window.DirectorTimelineModel) {
    setDirectorRetakeRangeFromFrames(start, length, total);
    return;
  }
  setDirectorRetakeRangeFromFrames(
    DirectorTimelineModel.toFrame(start, fps),
    Math.max(1, DirectorTimelineModel.toFrame(length, fps)),
    Math.max(1, DirectorTimelineModel.toFrame(total, fps)),
  );
}

function syncDirectorVideoAudioSegments() {
  // Extract each main-track video's audio ONCE into an independent clip. After
  // extraction it is a normal audio clip with no link to the video: deleting or
  // moving the video does not touch it, the clip is never re-synced, and once a
  // segment is extracted (audioExtracted flag) it is never re-extracted — so
  // deleting the extracted clip does not bring it back.
  for (const segment of state.directorSegments) {
    if (!segment.videoPath || segment.audioExtracted) continue;
    segment.audioExtracted = true;
    state.directorVideoAudioSegments.push({
      id: `video_audio_${segment.id}_${Math.random().toString(36).slice(2, 7)}`,
      start: Math.max(0, Number(segment.start) || 0),
      duration: Math.max(0.5, Number(segment.duration) || 0.5),
      trimStart: 0,
      audioPath: segment.videoPath,
      audioName: segment.videoName || fileNameFromPath(segment.videoPath),
      audioDuration: Math.max(0.5, Number(segment.duration) || 0.5),
    });
  }
}

function directorOutputDurationSeconds() {
  const imageEnd = normalizedDirectorSegments().reduce((max, segment) => Math.max(max, segment.start + segment.duration), 0);
  const audioEnd = normalizedDirectorAudioSegments().reduce((max, segment) => Math.max(max, segment.start + segment.duration), 0);
  const videoAudioEnd = normalizedDirectorVideoAudioSegments().reduce((max, segment) => Math.max(max, segment.start + segment.duration), 0);
  const icVideoEnd = normalizedDirectorIcVideoSegments().reduce((max, segment) => Math.max(max, segment.start + segment.duration), 0);
  return Math.max(0.5, Math.ceil(Math.max(imageEnd, audioEnd, videoAudioEnd, icVideoEnd) * 2) / 2);
}

function directorTotalSeconds() {
  const end = directorOutputDurationSeconds();
  return Math.max(6, Math.ceil(end * 1.3 * 2) / 2);
}

function updateDirectorTimelineScale(total) {
  const shell = document.querySelector(".director-timeline-shell");
  if (!shell) return;
  const duration = Math.max(6, Number(total) || 6);
  const trackWidth = Math.max(520, Math.ceil(duration * DIRECTOR_TIMELINE_PIXELS_PER_SECOND));
  shell.style.setProperty("--director-timeline-track-min", `${trackWidth}px`);
}

function selectDirectorSegment(id) {
  state.directorSelectedId = id;
  state.directorSelectionType = "image";
  renderDirectorEditor();
}

function selectDirectorTimelineItem(type = "image", id = "") {
  state.directorSelectedId = id;
  state.directorSelectionType = type;
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

function removeDirectorVideoAudioSegment(id) {
  state.directorVideoAudioSegments = state.directorVideoAudioSegments.filter((item) => item.id !== id);
  if (state.directorSelectionType === "video_audio" && !state.directorVideoAudioSegments.some((item) => item.id === state.directorSelectedId)) {
    state.directorSelectionType = "image";
    state.directorSelectedId = state.directorSegments[0]?.id || "";
  }
  renderDirectorEditor();
}

function removeDirectorIcVideoSegment(id) {
  state.directorIcVideoSegments = state.directorIcVideoSegments.filter((item) => item.id !== id);
  if (state.directorSelectionType === "ic_video" && !state.directorIcVideoSegments.some((item) => item.id === state.directorSelectedId)) {
    state.directorSelectionType = "image";
    state.directorSelectedId = state.directorSegments[0]?.id || "";
  }
  renderDirectorEditor();
}

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

function isDirectorTextEditingTarget(target) {
  if (!target) return false;
  if (target.closest("input, textarea, select, [contenteditable='true']")) return true;
  return false;
}

function handleDirectorTimelineDeleteKey(event) {
  if (event.key !== "Backspace" && event.key !== "Delete") return;
  if (state.workspace !== "director" || state.directorMode === "retake") return;
  if (isDirectorTextEditingTarget(event.target)) return;
  if ($("directorSegmentModal")?.classList.contains("open")) return;
  if (removeSelectedDirectorTimelineItem()) {
    event.preventDefault();
    $("runHint").textContent = "Selected timeline segment removed";
  }
}

function directorSelectedCollection() {
  if (state.directorSelectionType === "audio") return state.directorAudioSegments;
  if (state.directorSelectionType === "video_audio") return state.directorVideoAudioSegments;
  if (state.directorSelectionType === "ic_video") return state.directorIcVideoSegments;
  return state.directorSegments;
}

function directorPreciseTime(value) {
  const numeric = Number(value) || 0;
  return Math.round(numeric * 1000) / 1000;
}

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

function selectedDirectorSegmentCanSplit() {
  const collection = directorSelectedCollection();
  const segment = collection.find((item) => item.id === state.directorSelectedId);
  if (!segment) return false;
  if (["audio", "video_audio", "ic_video"].includes(state.directorSelectionType)) return true;
  return Boolean(segment.videoPath);
}

function syncDirectorCutButtonState() {
  const button = $("directorCutAtPlayheadBtn");
  if (!button) return;
  const canSplit = selectedDirectorSegmentCanSplit();
  button.disabled = !canSplit;
  button.setAttribute("aria-disabled", String(!canSplit));
  button.title = canSplit ? "Split selected clip at playhead" : "Image timeline items cannot be split";
}

function addDirectorIcVideoSegment(values = {}) {
  const previous = normalizedDirectorIcVideoSegments();
  const last = previous[previous.length - 1];
  const duration = Math.max(0.5, Number(values.duration) || 2);
  const start = values.start ?? (last ? last.start + last.duration : 0);
  state.directorIcVideoSegments.push({
    id: values.id || `ic_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    start: Math.max(0, Number(start) || 0),
    duration,
    trimStart: Math.max(0, Number(values.trimStart) || 0),
    videoPath: values.videoPath || "",
    videoName: values.videoName || "",
    videoPreviewUrl: values.videoPreviewUrl || "",
  });
  renderDirectorEditor();
}

function createDirectorBlock(segment, index, total) {
  const block = document.createElement("div");
  block.className = "director-block ref-none";
  block.classList.toggle("selected", segment.id === state.directorSelectedId && state.directorSelectionType !== "audio");
  block.classList.toggle("has-image-guide", Boolean(segment.imagePath || segment.videoPath));
  block.classList.toggle("has-video-guide", Boolean(segment.videoPath));
  block.dataset.id = segment.id;
  block.setAttribute("role", "group");
  block.setAttribute("aria-label", `Segment S${index + 1}`);
  block.style.left = `${(segment.start / total) * 100}%`;
  block.style.width = `${(segment.duration / total) * 100}%`;
  const imagePreview = segment.imagePreviewUrl || (segment.imagePath ? mediaUrl(segment.imagePath) : "");
  const videoPreview = segment.videoPreviewUrl || (segment.videoPath ? mediaUrl(segment.videoPath) : "");
  const videoPoster = segment.videoPosterUrl || "";
  const mediaLabel = segment.videoPath ? "timeline video" : (segment.imagePath ? "timeline image" : "text only");
  block.innerHTML = `
    ${videoPoster ? `<img class="director-block-image" src="${escapeHtml(videoPoster)}" alt="timeline video first frame">` : (videoPreview ? directorVideoPosterCanvasHtml(videoPreview, segment.trimStart || 0, "timeline video first frame") : (imagePreview ? `<img class="director-block-image" src="${escapeHtml(imagePreview)}" alt="timeline image guide">` : ""))}
    <button class="director-block-edit" type="button" aria-label="Edit segment S${index + 1}" title="Edit segment">Edit</button>
    <button class="director-block-remove" type="button" aria-label="Remove segment S${index + 1}">x</button>
    <span class="director-block-index">S${index + 1}</span>
    <span class="director-block-prompt">${escapeHtml(segment.prompt || "empty prompt")}</span>
    <span class="director-block-ref">${mediaLabel}</span>
    <i class="resize-handle left" data-edge="left"></i>
    <i class="resize-handle right" data-edge="right"></i>
  `;
  block.addEventListener("click", () => selectDirectorTimelineItem("image", segment.id));
  const editButton = block.querySelector(".director-block-edit");
  editButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openDirectorSegmentModal("image", segment.id);
  });
  editButton.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });
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
  const segmentDuration = Number(segment.duration);
  if (Number.isFinite(segmentDuration) && segmentDuration > 0) return Math.max(0.5, segmentDuration);
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

function addDirectorVideoAudioClip(audio = {}, start = 0) {
  const duration = Number(audio.duration) || 0;
  const roundedDuration = roundUpHalf(duration);
  const startTime = Math.max(0, Number(start) || 0);
  const existing = state.directorVideoAudioSegments.find((item) => !item.sourceSegmentId && Math.abs((Number(item.start) || 0) - startTime) < 0.01);
  const segment = existing || {
    id: `video_audio_manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    start: startTime,
    duration: roundedDuration || 1,
    trimStart: 0,
  };
  segment.audioPath = audio.path || "";
  segment.audioName = audio.name || "";
  segment.audioDuration = duration > 0 ? duration : 0;
  segment.duration = roundedDuration || Math.max(0.5, Number(segment.duration) || 0.5);
  if (!existing) state.directorVideoAudioSegments.push(segment);
  state.directorSelectedId = segment.id;
  state.directorSelectionType = "video_audio";
  renderDirectorEditor();
}

const directorWaveformCache = new Map();
const directorVideoPosterCache = new Map();

function directorVideoPosterCanvasHtml(videoSrc, trimStart = 0, label = "video first frame") {
  return `<canvas class="director-block-image director-video-poster-canvas" data-video-src="${escapeHtml(videoSrc || "")}" data-trim-start="${escapeHtml(trimStart || 0)}" data-video-poster-status="pending" aria-label="${escapeHtml(label)}"></canvas>`;
}

function directorWaveformHtml(audioSrc, trimStart = 0, duration = 0, audioDuration = 0) {
  return `
    <div class="director-waveform" aria-hidden="true">
      <canvas class="director-waveform-canvas" data-audio-src="${escapeHtml(audioSrc || "")}" data-trim-start="${escapeHtml(trimStart || 0)}" data-duration="${escapeHtml(duration || 0)}" data-audio-duration="${escapeHtml(audioDuration || 0)}"></canvas>
    </div>
  `;
}

function drawDirectorWaveform(canvas, peaks = []) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || canvas.parentElement?.clientWidth || 180));
  const height = Math.max(1, Math.round(rect.height || canvas.parentElement?.clientHeight || 64));
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const center = height / 2;
  ctx.strokeStyle = "rgba(240,235,225,.14)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, center);
  ctx.lineTo(width, center);
  ctx.stroke();
  const usable = peaks.length ? peaks : Array.from({ length: 96 }, (_, index) => {
    const amp = 0.18 + Math.abs(Math.sin(index * 0.31)) * 0.22;
    return [-amp, amp];
  });
  ctx.fillStyle = "rgba(143,199,192,.32)";
  ctx.strokeStyle = "rgba(215,180,106,.78)";
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  usable.forEach(([min, max], index) => {
    const x = (index / Math.max(1, usable.length - 1)) * width;
    const y = center + min * center * 0.9;
    index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  [...usable].reverse().forEach(([min, max], reverseIndex) => {
    const index = usable.length - 1 - reverseIndex;
    const x = (index / Math.max(1, usable.length - 1)) * width;
    const y = center + max * center * 0.9;
    ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  usable.forEach(([min], index) => {
    const x = (index / Math.max(1, usable.length - 1)) * width;
    const y = center + min * center * 0.9;
    index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  ctx.beginPath();
  usable.forEach(([, max], index) => {
    const x = (index / Math.max(1, usable.length - 1)) * width;
    const y = center + max * center * 0.9;
    index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
}

function waveformPeaksFromAudioBuffer(buffer, count = 128) {
  const data = buffer.getChannelData(0);
  const bucketSize = Math.max(1, Math.floor(data.length / count));
  return Array.from({ length: count }, (_, index) => {
    const start = index * bucketSize;
    const end = Math.min(data.length, start + bucketSize);
    let min = 0;
    let max = 0;
    for (let i = start; i < end; i += 1) {
      const value = data[i] || 0;
      if (value < min) min = value;
      if (value > max) max = value;
    }
    return [Math.max(-1, min), Math.min(1, max)];
  });
}

function trimDirectorWaveformPeaks(peaks = [], trimStart = 0, duration = 0, audioDuration = 0) {
  if (!peaks.length || !audioDuration || !duration) return peaks;
  const startRatio = Math.max(0, Math.min(1, trimStart / audioDuration));
  const endRatio = Math.max(startRatio, Math.min(1, (trimStart + duration) / audioDuration));
  const startIndex = Math.floor(startRatio * peaks.length);
  const endIndex = Math.max(startIndex + 2, Math.ceil(endRatio * peaks.length));
  return peaks.slice(startIndex, Math.min(peaks.length, endIndex));
}

async function hydrateDirectorWaveforms() {
  const canvases = Array.from(document.querySelectorAll(".director-waveform-canvas:not([data-hydrated])"));
  if (!canvases.length) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  for (const canvas of canvases) {
    canvas.dataset.hydrated = "pending";
    const src = canvas.dataset.audioSrc || "";
    if (!src || !AudioContextClass) {
      drawDirectorWaveform(canvas);
      canvas.dataset.hydrated = "fallback";
      continue;
    }
    try {
      if (!directorWaveformCache.has(src)) {
        const response = await fetch(src);
        const bytes = await response.arrayBuffer();
        const ctx = new AudioContextClass();
        const buffer = await ctx.decodeAudioData(bytes.slice(0));
        try { await ctx.close(); } catch (e) {}
        directorWaveformCache.set(src, waveformPeaksFromAudioBuffer(buffer));
      }
      const trimStart = Math.max(0, Number(canvas.dataset.trimStart) || 0);
      const duration = Math.max(0, Number(canvas.dataset.duration) || 0);
      const audioDuration = Math.max(0, Number(canvas.dataset.audioDuration) || 0);
      drawDirectorWaveform(canvas, trimDirectorWaveformPeaks(directorWaveformCache.get(src), trimStart, duration, audioDuration));
      canvas.dataset.hydrated = "true";
    } catch (e) {
      drawDirectorWaveform(canvas);
      canvas.dataset.hydrated = "fallback";
    }
  }
}

function drawDirectorVideoPosterFallback(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || canvas.parentElement?.clientWidth || 240));
  const height = Math.max(1, Math.round(rect.height || canvas.parentElement?.clientHeight || 120));
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#1a1a16");
  gradient.addColorStop(1, "#090907");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(215,180,106,.24)";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += Math.max(18, width / 8)) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + width * 0.15, height);
    ctx.stroke();
  }
}

function captureDirectorVideoPoster(canvas, video, cacheKey) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || canvas.parentElement?.clientWidth || video.videoWidth || 240));
  const height = Math.max(1, Math.round(rect.height || canvas.parentElement?.clientHeight || video.videoHeight || 120));
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(video, 0, 0, width, height);
  try {
    directorVideoPosterCache.set(cacheKey, canvas.toDataURL("image/jpeg", 0.82));
  } catch (e) {}
  canvas.dataset.videoPosterStatus = "ready";
}

function hydrateDirectorVideoPosters() {
  const canvases = Array.from(document.querySelectorAll(".director-video-poster-canvas[data-video-poster-status='pending']"));
  for (const canvas of canvases) {
    const src = canvas.dataset.videoSrc || "";
    const trimStart = Math.max(0, Number(canvas.dataset.trimStart) || 0);
    const cacheKey = `${src}#${trimStart.toFixed(3)}`;
    if (!src) {
      drawDirectorVideoPosterFallback(canvas);
      canvas.dataset.videoPosterStatus = "fallback";
      continue;
    }
    const cached = directorVideoPosterCache.get(cacheKey);
    if (cached) {
      const image = new Image();
      image.onload = () => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width || canvas.parentElement?.clientWidth || image.width));
        const height = Math.max(1, Math.round(rect.height || canvas.parentElement?.clientHeight || image.height));
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.drawImage(image, 0, 0, width, height);
        canvas.dataset.videoPosterStatus = "ready";
      };
      image.src = cached;
      continue;
    }
    canvas.dataset.videoPosterStatus = "loading";
    drawDirectorVideoPosterFallback(canvas);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const fail = () => {
      drawDirectorVideoPosterFallback(canvas);
      canvas.dataset.videoPosterStatus = "fallback";
    };
    video.addEventListener("loadeddata", () => {
      const targetTime = Math.min(Math.max(0.001, trimStart), Math.max(0.001, (video.duration || trimStart + 0.001) - 0.001));
      const draw = () => captureDirectorVideoPoster(canvas, video, cacheKey);
      if (Math.abs((video.currentTime || 0) - targetTime) < 0.02) {
        draw();
      } else {
        video.addEventListener("seeked", draw, { once: true });
        try { video.currentTime = targetTime; } catch (e) { draw(); }
      }
    }, { once: true });
    video.addEventListener("error", fail, { once: true });
    video.src = src;
    try { video.load(); } catch (e) { fail(); }
  }
}

function defaultDirectorAudioStart() {
  const end = normalizedDirectorAudioSegments().reduce((max, segment) => Math.max(max, segment.start + segment.duration), 0);
  return roundHalf(end);
}

function defaultDirectorVideoAudioStart() {
  syncDirectorVideoAudioSegments();
  const end = normalizedDirectorVideoAudioSegments().reduce((max, segment) => Math.max(max, segment.start + segment.duration), 0);
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

function openDirectorAudioModal(target = "dialogue") {
  state.directorAudioModalTarget = target;
  populateDirectorAudioModalLibrary();
  const isVideoAudio = target === "video_audio";
  $("directorAudioModalTitle").textContent = isVideoAudio ? "Add video audio clip" : "Add audio clip";
  $("directorAudioModalStart").value = isVideoAudio ? defaultDirectorVideoAudioStart() : defaultDirectorAudioStart();
  $("directorAudioModalInput").value = "";
  $("directorAudioModalUploadStatus").textContent = "No upload selected";
  $("directorAudioModalStatus").textContent = isVideoAudio ? "Choose a library clip or upload video audio." : "Choose a library clip or upload audio.";
  $("directorAudioModal").classList.add("open");
  $("directorAudioModal").setAttribute("aria-hidden", "false");
}

function closeDirectorAudioModal() {
  $("directorAudioModal").classList.remove("open");
  $("directorAudioModal").setAttribute("aria-hidden", "true");
}

function openDirectorSegmentModal(selectionType = "image", id = "") {
  if (id) state.directorSelectedId = id;
  state.directorSelectionType = selectionType;
  renderDirectorEditor();
  const modal = $("directorSegmentModal");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
}

function closeDirectorSegmentModal() {
  const modal = $("directorSegmentModal");
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

async function addDirectorAudioFromModal() {
  const status = $("directorAudioModalStatus");
  const start = Number($("directorAudioModalStart").value) || 0;
  const file = $("directorAudioModalInput").files[0];
  const selectedFile = $("directorAudioLibrarySelect").value;
  const isVideoAudio = state.directorAudioModalTarget === "video_audio";
  const addClip = isVideoAudio ? addDirectorVideoAudioClip : addDirectorAudioClip;
  try {
    if (file) {
      status.textContent = "Uploading audio...";
      const duration = await readAudioDuration(file);
      const data = await readFileAsDataUrl(file);
      const uploaded = await api("/api/upload-audio", {
        method: "POST",
        body: JSON.stringify({ name: file.name, data }),
      });
      addClip({ path: uploaded.path, name: uploaded.name, duration }, start);
      closeDirectorAudioModal();
      $("runHint").textContent = isVideoAudio ? "Video audio clip added to timeline" : "Audio clip added to timeline";
      return;
    }
    if (selectedFile) {
      const clip = findCastingClipByFile(selectedFile);
      const option = $("directorAudioLibrarySelect").options[$("directorAudioLibrarySelect").selectedIndex];
      addClip({
        path: selectedFile,
        name: option ? option.textContent : fileNameFromPath(selectedFile),
        duration: clip?.duration || 0,
      }, start);
      closeDirectorAudioModal();
      $("runHint").textContent = isVideoAudio ? "Video audio clip added to timeline" : "Audio clip added to timeline";
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
  const waveformSrc = hasAudio ? directorAudioUrl(segment) : "";
  const clipDuration = fixedDirectorAudioDuration(segment);
  const sourceDuration = directorAudioDuration(segment);
  block.innerHTML = `
    ${hasAudio ? directorWaveformHtml(waveformSrc, segment.trimStart || 0, clipDuration, sourceDuration) : ""}
    ${hasAudio ? `<button class="director-block-edit" type="button" aria-label="Edit audio clip S${index + 1}" title="Edit audio clip">Edit</button>` : ""}
    ${hasAudio ? `<button class="director-audio-clear compact-icon-button" type="button" title="Delete audio clip" aria-label="Delete audio clip S${index + 1}">x</button>` : ""}
  `;
  const select = () => {
    selectDirectorTimelineItem("audio", segment.id);
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
  const editButton = block.querySelector(".director-block-edit");
  if (editButton) {
    editButton.addEventListener("mousedown", (event) => event.stopPropagation());
    editButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openDirectorSegmentModal("audio", segment.id);
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

function createDirectorVideoAudioBlock(segment, index, total) {
  const block = document.createElement("div");
  block.className = "director-video-audio-block has-audio";
  block.classList.toggle("selected", segment.id === state.directorSelectedId && state.directorSelectionType === "video_audio");
  block.dataset.id = segment.id;
  block.setAttribute("role", "button");
  block.setAttribute("tabindex", "0");
  block.setAttribute("aria-label", `Video audio ${index + 1}`);
  block.style.left = `${(segment.start / total) * 100}%`;
  block.style.width = `${(segment.duration / total) * 100}%`;
  const waveformSrc = segment.audioPath ? mediaUrl(segment.audioPath) : "";
  block.innerHTML = `
    ${directorWaveformHtml(waveformSrc, segment.trimStart || 0, segment.duration || 0, segment.audioDuration || 0)}
    <button class="director-block-edit" type="button" aria-label="Edit video audio ${index + 1}" title="Edit video audio">Edit</button>
    <button class="director-audio-clear compact-icon-button" type="button" title="Delete audio clip" aria-label="Delete video audio ${index + 1}">x</button>
  `;
  const select = () => {
    selectDirectorTimelineItem("video_audio", segment.id);
  };
  const clearButton = block.querySelector(".director-audio-clear");
  if (clearButton) {
    clearButton.addEventListener("mousedown", (event) => event.stopPropagation());
    clearButton.addEventListener("click", (event) => {
      event.stopPropagation();
      removeDirectorVideoAudioSegment(segment.id);
    });
  }
  const editButton = block.querySelector(".director-block-edit");
  editButton.addEventListener("mousedown", (event) => event.stopPropagation());
  editButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openDirectorSegmentModal("video_audio", segment.id);
  });
  block.addEventListener("click", select);
  block.addEventListener("mousedown", (event) => startDirectorDrag(event, segment.id, "video_audio"));
  block.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select();
    }
  });
  return block;
}

function createDirectorIcVideoBlock(segment, index, total) {
  const block = document.createElement("div");
  block.className = "director-ic-video-block";
  block.classList.toggle("selected", segment.id === state.directorSelectedId && state.directorSelectionType === "ic_video");
  block.dataset.id = segment.id;
  block.style.left = `${(segment.start / total) * 100}%`;
  block.style.width = `${(segment.duration / total) * 100}%`;
  const poster = segment.videoPosterUrl || "";
  const preview = segment.videoPreviewUrl || (segment.videoPath ? mediaUrl(segment.videoPath) : "");
  block.innerHTML = `
    ${poster ? `<img class="director-block-image" src="${escapeHtml(poster)}" alt="IC video first frame">` : (preview ? directorVideoPosterCanvasHtml(preview, segment.trimStart || 0, "IC video first frame") : "")}
    <button class="director-block-edit" type="button" aria-label="Edit IC video ${index + 1}" title="Edit IC video">Edit</button>
    <button class="director-block-remove" type="button" aria-label="Remove IC video ${index + 1}">x</button>
    <span class="director-block-index">IC${index + 1}</span>
    <span class="director-block-prompt">${escapeHtml(segment.videoName || fileNameFromPath(segment.videoPath) || "IC video")}</span>
    <span class="director-block-ref">motionSegments</span>
  `;
  block.querySelector(".director-block-edit").addEventListener("click", (event) => {
    event.stopPropagation();
    openDirectorSegmentModal("ic_video", segment.id);
  });
  block.querySelector(".director-block-edit").addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });
  block.querySelector(".director-block-remove").addEventListener("click", (event) => {
    event.stopPropagation();
    removeDirectorIcVideoSegment(segment.id);
  });
  block.querySelector(".director-block-remove").addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });
  block.addEventListener("click", () => {
    selectDirectorTimelineItem("ic_video", segment.id);
  });
  block.addEventListener("mousedown", (event) => startDirectorDrag(event, segment.id, "ic_video"));
  return block;
}

function directorPreviewClips() {
  if (state.directorMode === "retake") {
    const video = normalizedDirectorRetakeVideo();
    if (!video) return [];
    return [{
      start: 0,
      duration: video.duration,
      kind: "video",
      src: video.videoPreviewUrl || mediaUrl(video.videoPath),
      prompt: state.directorRetakePrompt || "",
      trimStart: 0,
    }];
  }
  const model = createDirectorTimelineModelFromState();
  if (model) {
    return model.items
      .filter((item) => item.track === "main")
      .map((item) => {
        let kind = "text";
        let src = "";
        if (item.kind === "video") { kind = "video"; src = item.previewUrl || mediaUrl(item.mediaPath); }
        else if (item.kind === "image") { kind = "image"; src = item.previewUrl || mediaUrl(item.mediaPath); }
        return {
          start: DirectorTimelineModel.toSeconds(item.start, model.fps),
          duration: DirectorTimelineModel.toSeconds(item.length, model.fps),
          kind,
          src,
          prompt: item.prompt || "",
          trimStart: item.kind === "video" ? DirectorTimelineModel.toSeconds(item.trimStart, model.fps) : 0,
        };
      });
  }
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
      trimStart: segment.videoPath ? Math.max(0, Number(segment.trimStart) || 0) : 0,
    };
  });
}

function directorPreviewAudioClips() {
  if (state.directorMode === "retake") {
    const video = normalizedDirectorRetakeVideo();
    if (!video?.videoPath) return [];
    return [{
      start: 0,
      duration: video.duration,
      trimStart: 0,
      src: video.videoPreviewUrl || mediaUrl(video.videoPath),
      volume: 1,
    }];
  }
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
    playheadFrameEl: $("directorPlayheadFrame"),
    timelineEl: document.querySelector(".director-timeline-shell"),
  });
  const size = currentSize();
  DirectorPreview.setTimeline({
    clips: directorPreviewClips(),
    audioClips: directorPreviewAudioClips(),
    duration: state.directorMode === "retake" ? directorRetakeTotalSeconds() : directorOutputDurationSeconds(),
    displayDuration: state.directorMode === "retake" ? directorRetakeTotalSeconds() : directorTotalSeconds(),
    width: size.width,
    height: size.height,
    fps: directorTimelineFps(),
  });
}

function updateDirectorModeUi() {
  const isRetake = state.directorMode === "retake";
  $("directorModeGenerateBtn")?.classList.toggle("active", !isRetake);
  $("directorModeRetakeBtn")?.classList.toggle("active", isRetake);
  $("directorModeGenerateBtn")?.setAttribute("aria-selected", String(!isRetake));
  $("directorModeRetakeBtn")?.setAttribute("aria-selected", String(isRetake));
  document.querySelectorAll(".director-lane").forEach((lane) => {
    const laneName = lane.dataset.lane;
    const shouldHide = isRetake ? laneName !== "retake" : laneName === "retake";
    lane.hidden = shouldHide;
    lane.style.display = shouldHide ? "none" : "";
  });
  if ($("directorRetakePanel")) $("directorRetakePanel").hidden = !isRetake;
  if ($("directorCutAtPlayheadBtn")) $("directorCutAtPlayheadBtn").style.display = isRetake ? "none" : "";
  updateRunButtonLabel();
}

function renderDirectorRetakePanel() {
  const prompt = $("directorRetakePrompt");
  const strength = $("directorRetakeStrength");
  if (prompt && document.activeElement !== prompt) prompt.value = state.directorRetakePrompt || "";
  if (strength && document.activeElement !== strength) strength.value = state.directorRetakeStrength ?? 1;
  if ($("directorRetakeAutoStitch")) $("directorRetakeAutoStitch").checked = Boolean(state.directorRetakeAutoStitch);
  renderDirectorRetakeSelectionPreview();
  renderDirectorRetakeEditModes();
  const video = normalizedDirectorRetakeVideo();
  const status = $("directorRetakeStatus");
  if (status) {
    const range = normalizedDirectorRetakeRange();
    const start = range.start;
    const end = start + range.length;
    status.textContent = video
      ? `${video.videoName || fileNameFromPath(video.videoPath)} | Retake ${formatSeconds(start)} - ${formatSeconds(end)}`
      : "Upload a base video, then use { and } at the playhead to set the retake range.";
  }
}

function renderDirectorRetakeSelectionPreview() {
  const preview = $("directorRetakeSelectionPreview");
  const label = $("directorRetakeSelectionLabel");
  if (!preview || !label) return;
  const video = normalizedDirectorRetakeVideo();
  if (!video?.videoPath) {
    preview.removeAttribute("src");
    label.textContent = "No retake selection preview";
    return;
  }
  const range = normalizedDirectorRetakeRange();
  const end = Math.min(directorRetakeTotalSeconds(), range.start + range.length);
  const src = video.videoPreviewUrl || mediaUrl(video.videoPath);
  if (preview.getAttribute("src") !== src) preview.setAttribute("src", src);
  preview.muted = true;
  label.textContent = `${video.videoName || fileNameFromPath(video.videoPath)} | ${formatSeconds(range.start)} - ${formatSeconds(end)}`;
  try {
    if (Math.abs(preview.currentTime - range.start) > 0.1) preview.currentTime = range.start;
  } catch (e) {}
}

function renderDirectorRetakeEditModes() {
  const wrap = $("directorRetakeEditModes");
  if (!wrap) return;
  const targets = directorRetakeEditTargets();
  const video = normalizedDirectorRetakeVideo();
  wrap.innerHTML = "";
  if (!targets.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  targets.forEach((target) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "director-retake-edit-mode";
    button.textContent = target.label;
    button.disabled = !video;
    button.title = video
      ? `Trim the retake selection and open ${target.label}`
      : "Add a retake video first";
    button.addEventListener("click", () => sendDirectorRetakeSelectionToEdit(target));
    wrap.appendChild(button);
  });
}

function renderDirectorRetakeTrack(track, total) {
  track.onmousedown = startDirectorRetakeTrackMouseDown;
  const video = normalizedDirectorRetakeVideo();
  if (!video) {
    track.innerHTML = "<span>Drop one generated video here for retake</span>";
    return;
  }
  const block = document.createElement("div");
  block.className = "director-retake-block";
  block.style.left = "0%";
  block.style.width = "100%";
  const poster = video.videoPosterUrl || "";
  const preview = video.videoPreviewUrl || (video.videoPath ? mediaUrl(video.videoPath) : "");
  block.innerHTML = `
    ${poster ? `<img class="director-block-image" src="${escapeHtml(poster)}" alt="retake video first frame">` : (preview ? directorVideoPosterCanvasHtml(preview, 0, "retake video first frame") : "")}
    <button class="director-retake-remove" type="button" aria-label="Remove Retake video">x</button>
    <span class="director-block-index">BASE</span>
    <span class="director-block-prompt">${escapeHtml(video.videoName || fileNameFromPath(video.videoPath) || "Retake video")}</span>
    <span class="director-block-ref">retakeVideo</span>
  `;
  block.querySelector(".director-retake-remove").addEventListener("click", (event) => {
    event.stopPropagation();
    removeDirectorRetakeVideo();
  });
  track.appendChild(block);
  const range = normalizedDirectorRetakeRange();
  const start = Math.max(0, Math.min(total, range.start));
  const length = Math.max(0.1, range.length);
  const end = Math.max(start + 0.1, Math.min(total, start + length));
  const selection = document.createElement("div");
  selection.className = "director-retake-selection";
  selection.style.left = `${(start / total) * 100}%`;
  selection.style.width = `${((end - start) / total) * 100}%`;
  selection.innerHTML = `
    <span class="director-retake-handle director-retake-handle-left" data-retake-handle="left" aria-hidden="true"></span>
    <span class="director-retake-handle director-retake-handle-right" data-retake-handle="right" aria-hidden="true"></span>
  `;
  selection.addEventListener("pointerdown", startDirectorRetakeSelectionDrag);
  selection.addEventListener("mousedown", startDirectorRetakeSelectionDrag);
  track.appendChild(selection);
}

function renderDirectorEditor() {
  const track = $("directorTrack");
  const audioTrack = $("directorAudioTrack");
  const videoAudioTrack = $("directorVideoAudioTrack");
  const icVideoTrack = $("directorIcVideoTrack");
  const retakeTrack = $("directorRetakeTrack");
  const ruler = $("directorRuler");
  if (!track || !audioTrack || !videoAudioTrack || !icVideoTrack || !retakeTrack || !ruler) return;
  syncDirectorVideoAudioSegments();
  const segments = normalizedDirectorSegments();
  const audioSegments = normalizedDirectorAudioSegments();
  const videoAudioSegments = normalizedDirectorVideoAudioSegments();
  const icVideoSegments = normalizedDirectorIcVideoSegments();
  const isRetake = state.directorMode === "retake";
  const total = isRetake ? directorRetakeTotalSeconds() : directorTotalSeconds();
  updateDirectorTimelineScale(total);
  updateDirectorModeUi();
  ruler.innerHTML = "";
  for (let sec = 0; sec <= total; sec += 1) {
    const tick = document.createElement("span");
    tick.style.left = `${(sec / total) * 100}%`;
    tick.textContent = `${sec}s`;
    ruler.appendChild(tick);
  }

  track.innerHTML = "";
  audioTrack.innerHTML = "";
  videoAudioTrack.innerHTML = "";
  icVideoTrack.innerHTML = "";
  retakeTrack.innerHTML = "";
  if (isRetake) {
    renderDirectorRetakeTrack(retakeTrack, total);
    renderDirectorRetakePanel();
    renderDirectorInspector();
    syncDirectorPreview();
    hydrateDirectorVideoPosters();
    return;
  }
  for (const [index, segment] of segments.entries()) {
    track.appendChild(createDirectorBlock(segment, index, total));
  }
  if (videoAudioSegments.length) {
    for (const [index, segment] of videoAudioSegments.entries()) {
      videoAudioTrack.appendChild(createDirectorVideoAudioBlock(segment, index, total));
    }
  } else {
    videoAudioTrack.innerHTML = "<span>Main video guide audio appears here automatically</span>";
  }
  for (const [index, segment] of audioSegments.entries()) {
    audioTrack.appendChild(createDirectorAudioBlock(segment, index, total));
  }
  if (icVideoSegments.length) {
    for (const [index, segment] of icVideoSegments.entries()) {
      icVideoTrack.appendChild(createDirectorIcVideoBlock(segment, index, total));
    }
  } else {
    icVideoTrack.innerHTML = "<span>IC reference clips land here in the IC-LoRA block</span>";
  }
  track.ondragover = null;
  track.ondrop = null;

  renderDirectorInspector();
  syncDirectorPreview();
  syncDirectorCutButtonState();
  hydrateDirectorVideoPosters();
  hydrateDirectorWaveforms();
}

function renderDirectorInspector() {
  const inspector = $("directorSegmentInspector");
  if (!inspector) return;
  if (state.directorSelectionType === "video_audio") {
    renderDirectorVideoAudioInspector(inspector);
    return;
  }
  if (state.directorSelectionType === "audio") {
    renderDirectorAudioInspector(inspector);
    return;
  }
  if (state.directorSelectionType === "ic_video") {
    renderDirectorIcVideoInspector(inspector);
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
      Timeline media guide
      <span id="directorSegmentImageStatus" class="hint segment-image-status">No media guide on this segment</span>
    </label>
    <label class="selected-segment-upload">
      <span class="selected-segment-upload-label">Upload / replace image or video guide</span>
      <input id="directorSegmentImageInput" type="file" accept="image/*,video/*">
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
    </div>
  `;
  $("directorSegmentPrompt").value = segment.prompt || "";
  $("directorSegmentStart").value = segment.start;
  $("directorSegmentDuration").value = segment.duration;
  $("directorSegmentStrength").value = segment.strength ?? 1;
  $("directorSegmentImageStatus").textContent = segment.videoName || segment.imageName || (segment.videoPath ? "Timeline video guide" : (segment.imagePath ? "Timeline image guide" : "No media guide on this segment"));
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
  $("directorSegmentImageInput").addEventListener("change", () => uploadDirectorSegmentGuide(segment.id, $("directorSegmentImageInput").files[0]).catch((err) => {
    $("directorSegmentImageStatus").textContent = err.message;
    $("runHint").textContent = `Timeline media upload failed: ${err.message}`;
  }));
  $("removeDirectorSegmentBtn").addEventListener("click", () => removeDirectorSegment(segment.id));
}

function renderDirectorIcVideoInspector(inspector) {
  const segment = state.directorIcVideoSegments.find((item) => item.id === state.directorSelectedId) || state.directorIcVideoSegments[0];
  if (!segment) {
    state.directorSelectionType = "image";
    renderDirectorInspector();
    return;
  }
  state.directorSelectedId = segment.id;
  inspector.innerHTML = `
    <div class="director-inspector-head">
      <span>Selected IC video</span>
      <button id="removeDirectorIcVideoBtn" type="button">Remove</button>
    </div>
    <div class="director-audio-readonly">
      <b>${escapeHtml(segment.videoName || fileNameFromPath(segment.videoPath) || "IC video")}</b>
      <span>${formatSeconds(segment.start)} - ${formatSeconds(segment.start + segment.duration)}</span>
    </div>
    <div class="director-segment-grid">
      <label>
        Start
        <input id="directorIcVideoStart" type="number" min="0" step="0.5">
      </label>
      <label>
        Duration
        <input id="directorIcVideoDuration" type="number" min="0.5" step="0.5">
      </label>
      <label>
        Trim start
        <input id="directorIcVideoTrimStart" type="number" min="0" step="0.25">
      </label>
    </div>
  `;
  $("directorIcVideoStart").value = segment.start;
  $("directorIcVideoDuration").value = segment.duration;
  $("directorIcVideoTrimStart").value = segment.trimStart || 0;
  $("directorIcVideoStart").addEventListener("input", (event) => {
    segment.start = Math.max(0, Number(event.target.value) || 0);
    renderDirectorTimelineOnly();
  });
  $("directorIcVideoDuration").addEventListener("input", (event) => {
    segment.duration = Math.max(0.5, Number(event.target.value) || 0.5);
    renderDirectorTimelineOnly();
  });
  $("directorIcVideoTrimStart").addEventListener("input", (event) => {
    segment.trimStart = Math.max(0, Number(event.target.value) || 0);
  });
  $("removeDirectorIcVideoBtn").addEventListener("click", () => removeDirectorIcVideoSegment(segment.id));
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
      <label class="director-audio-volume">
        Volume <span id="directorAudioVolumeReadout">${Math.round((segment.volume ?? 1) * 100)}%</span>
        <input id="directorAudioVolume" type="range" min="0" max="150" step="5">
      </label>
    </div>
  `;
  $("directorAudioStart").value = segment.start;
  $("directorAudioTrimStart").value = segment.trimStart || 0;
  $("directorAudioVolume").value = Math.round((segment.volume ?? 1) * 100);
  $("directorAudioStart").addEventListener("input", (event) => updateDirectorAudioSegment(segment.id, { start: Number(event.target.value) || 0 }, false));
  $("directorAudioTrimStart").addEventListener("input", (event) => updateDirectorAudioSegment(segment.id, { trimStart: Number(event.target.value) || 0 }, false));
  $("directorAudioVolume").addEventListener("input", (event) => {
    const pct = Number(event.target.value) || 0;
    $("directorAudioVolumeReadout").textContent = `${pct}%`;
    updateDirectorAudioSegment(segment.id, { volume: pct / 100 }, false);
  });
  $("removeDirectorAudioBtn").addEventListener("click", () => removeDirectorAudioSegment(segment.id));
}

function renderDirectorVideoAudioInspector(inspector) {
  const segment = state.directorVideoAudioSegments.find((item) => item.id === state.directorSelectedId) || state.directorVideoAudioSegments[0];
  if (!segment) {
    state.directorSelectionType = "image";
    renderDirectorInspector();
    return;
  }
  state.directorSelectedId = segment.id;
  inspector.innerHTML = `
    <div class="director-inspector-head">
      <span>Selected video audio</span>
      <button id="removeDirectorVideoAudioBtn" type="button">Remove</button>
    </div>
    <div class="director-segment-audio-card">
      <div class="director-segment-audio-head">
        <span>${escapeHtml(segment.audioName || fileNameFromPath(segment.audioPath) || "Video audio")}</span>
      </div>
      <span class="hint segment-audio-status">Follows main video guide</span>
    </div>
    <div class="director-segment-grid">
      <label>
        Start
        <input id="directorVideoAudioStart" type="number" min="0" max="120" step="0.5">
      </label>
      <div class="director-audio-readonly">
        Duration
        <b>${escapeHtml(formatDurationPrecise(segment.duration) || "0.5s")}</b>
      </div>
      <label>
        Trim start
        <input id="directorVideoAudioTrimStart" type="number" min="0" max="60" step="0.25">
      </label>
      <label class="director-audio-volume">
        Volume <span id="directorVideoAudioVolumeReadout">${Math.round((segment.volume ?? 1) * 100)}%</span>
        <input id="directorVideoAudioVolume" type="range" min="0" max="150" step="5">
      </label>
    </div>
  `;
  $("directorVideoAudioStart").value = segment.start;
  $("directorVideoAudioTrimStart").value = segment.trimStart || 0;
  $("directorVideoAudioVolume").value = Math.round((segment.volume ?? 1) * 100);
  $("directorVideoAudioStart").addEventListener("input", (event) => updateDirectorVideoAudioSegment(segment.id, { start: Number(event.target.value) || 0 }, false));
  $("directorVideoAudioTrimStart").addEventListener("input", (event) => updateDirectorVideoAudioSegment(segment.id, { trimStart: Number(event.target.value) || 0 }, false));
  $("directorVideoAudioVolume").addEventListener("input", (event) => {
    const pct = Number(event.target.value) || 0;
    $("directorVideoAudioVolumeReadout").textContent = `${pct}%`;
    updateDirectorVideoAudioSegment(segment.id, { volume: pct / 100 }, false);
  });
  $("removeDirectorVideoAudioBtn").addEventListener("click", () => removeDirectorVideoAudioSegment(segment.id));
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

function updateDirectorVideoAudioSegment(id, patch, rerenderInspector = true) {
  const segment = state.directorVideoAudioSegments.find((item) => item.id === id);
  if (!segment) return;
  const { duration: _duration, audioPath: _audioPath, audioName: _audioName, ...safePatch } = patch;
  Object.assign(segment, safePatch);
  segment.start = Math.max(0, Number(segment.start) || 0);
  segment.duration = Math.max(0.5, Number(segment.duration) || 0.5);
  segment.trimStart = Math.max(0, Number(segment.trimStart) || 0);
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
  const videoAudioTrack = $("directorVideoAudioTrack");
  const icVideoTrack = $("directorIcVideoTrack");
  const retakeTrack = $("directorRetakeTrack");
  const ruler = $("directorRuler");
  if (!track || !audioTrack || !videoAudioTrack || !icVideoTrack || !retakeTrack || !ruler) return;
  syncDirectorVideoAudioSegments();
  const segments = normalizedDirectorSegments();
  const audioSegments = normalizedDirectorAudioSegments();
  const videoAudioSegments = normalizedDirectorVideoAudioSegments();
  const icVideoSegments = normalizedDirectorIcVideoSegments();
  const isRetake = state.directorMode === "retake";
  const total = isRetake ? directorRetakeTotalSeconds() : directorTotalSeconds();
  updateDirectorTimelineScale(total);
  updateDirectorModeUi();
  ruler.innerHTML = "";
  for (let sec = 0; sec <= total; sec += 1) {
    const tick = document.createElement("span");
    tick.style.left = `${(sec / total) * 100}%`;
    tick.textContent = `${sec}s`;
    ruler.appendChild(tick);
  }
  track.innerHTML = "";
  audioTrack.innerHTML = "";
  videoAudioTrack.innerHTML = "";
  icVideoTrack.innerHTML = "";
  retakeTrack.innerHTML = "";
  if (isRetake) {
    renderDirectorRetakeTrack(retakeTrack, total);
    renderDirectorRetakePanel();
    syncDirectorCutButtonState();
    hydrateDirectorVideoPosters();
    return;
  }
  for (const [index, segment] of segments.entries()) {
    track.appendChild(createDirectorBlock(segment, index, total));
  }
  if (videoAudioSegments.length) {
    for (const [index, segment] of videoAudioSegments.entries()) {
      videoAudioTrack.appendChild(createDirectorVideoAudioBlock(segment, index, total));
    }
  } else {
    videoAudioTrack.innerHTML = "<span>Main video guide audio appears here automatically</span>";
  }
  for (const [index, segment] of audioSegments.entries()) {
    audioTrack.appendChild(createDirectorAudioBlock(segment, index, total));
  }
  if (icVideoSegments.length) {
    for (const [index, segment] of icVideoSegments.entries()) {
      icVideoTrack.appendChild(createDirectorIcVideoBlock(segment, index, total));
    }
  } else {
    icVideoTrack.innerHTML = "<span>IC reference clips land here in the IC-LoRA block</span>";
  }
  track.ondragover = null;
  track.ondrop = null;
  syncDirectorCutButtonState();
  hydrateDirectorVideoPosters();
  hydrateDirectorWaveforms();
}

function startDirectorDrag(event, id, type = "image") {
  if (event.button !== 0) return;
  const isAudio = type === "audio";
  const isVideoAudio = type === "video_audio";
  const isIcVideo = type === "ic_video";
  const segments = isIcVideo
    ? state.directorIcVideoSegments
    : (isVideoAudio ? state.directorVideoAudioSegments : (isAudio ? state.directorAudioSegments : state.directorSegments));
  const segment = segments.find((item) => item.id === id);
  if (!segment) return;
  event.preventDefault();
  state.directorSelectedId = id;
  state.directorSelectionType = isIcVideo ? "ic_video" : (isVideoAudio ? "video_audio" : (isAudio ? "audio" : "image"));
  const trackId = isIcVideo ? "directorIcVideoTrack" : (isVideoAudio ? "directorVideoAudioTrack" : (isAudio ? "directorAudioTrack" : "directorTrack"));
  const trackRect = $(trackId).getBoundingClientRect();
  const edge = (isAudio || isVideoAudio || isIcVideo) ? "" : directorEdgeFromEvent(event, event.currentTarget);
  state.directorDrag = {
    id,
    type: isIcVideo ? "ic_video" : (isVideoAudio ? "video_audio" : (isAudio ? "audio" : "image")),
    edge,
    rect: trackRect,
    total: directorTotalSeconds(),
    startX: event.clientX,
    originalStart: segment.start,
    originalDuration: segment.duration,
    moved: false,
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
  const model = createDirectorTimelineModelFromState();
  if (!model) return;
  const deltaSeconds = ((event.clientX - drag.startX) / Math.max(1, drag.rect.width)) * drag.total;
  const deltaFrames = Math.round(deltaSeconds * directorTimelineFps());
  if (Math.abs(event.clientX - drag.startX) > 3) drag.moved = true;
  const track = drag.type === "audio" ? "dialogue" : drag.type === "video_audio" ? "video_audio" : drag.type === "ic_video" ? "ic_video" : "main";
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

function stopDirectorDrag() {
  const drag = state.directorDrag;
  state.directorDrag = null;
  document.body.classList.remove("director-dragging");
  document.body.style.cursor = "";
  window.removeEventListener("mousemove", onDirectorDrag);
  if (!drag) return;
  renderDirectorEditor();
}

function roundHalf(value) {
  return Math.round(value * 2) / 2;
}

function roundTenth(value) {
  return Math.round(value * 10) / 10;
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
  if (!Array.isArray(state.referenceMeta)) state.referenceMeta = [];
  while (state.referenceMeta.length < state.referencePaths.length) {
    state.referenceMeta.push({ type: "character", subject: state.referenceMeta.length ? "shared" : "person_a" });
  }
  if (state.referenceMeta.length > state.referencePaths.length) {
    state.referenceMeta = state.referenceMeta.slice(0, state.referencePaths.length);
  }
}

function addReferenceSlot() {
  ensureReferenceSlot();
  state.referencePaths.push("");
  state.referenceNames.push("");
  state.referencePreviewUrls.push("");
  state.referenceMeta.push({ type: "prop", subject: "shared" });
  renderReferenceSlots();
}

function clearReferenceSlot(index) {
  ensureReferenceSlot();
  if (state.referencePaths.length <= 1) {
    state.referencePaths = [""];
    state.referenceNames = [""];
    state.referencePreviewUrls = [""];
    state.referenceMeta = [{ type: "character", subject: "person_a" }];
  } else {
    state.referencePaths.splice(index, 1);
    state.referenceNames.splice(index, 1);
    state.referencePreviewUrls.splice(index, 1);
    state.referenceMeta.splice(index, 1);
  }
  clearIngredientsSheet();
  renderReferenceSlots();
  $("runHint").textContent = "Global reference removed";
}

const REFERENCE_TYPES = [
  ["character", "Character"],
  ["face", "Face / detail"],
  ["outfit", "Outfit"],
  ["prop", "Prop"],
  ["environment", "Environment"],
  ["style", "Style / mood"],
];

const REFERENCE_SUBJECTS = [
  ["person_a", "Person A"],
  ["person_b", "Person B"],
  ["person_c", "Person C"],
  ["shared", "Shared"],
  ["none", "None"],
];

function referenceSelectOptions(options, value) {
  return options
    .map(([key, label]) => `<option value="${key}"${key === value ? " selected" : ""}>${label}</option>`)
    .join("");
}

function clearIngredientsSheet() {
  state.ingredientsSheetPath = "";
  state.ingredientsSheetName = "";
  state.ingredientsSheetPreviewUrl = "";
  const status = $("directorIngredientsSheetStatus");
  if (status) status.textContent = "Builds automatically for Ingredients";
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
      <div class="reference-meta-controls">
        <label>
          Type
          <select id="globalRefType_${index}">${referenceSelectOptions(REFERENCE_TYPES, state.referenceMeta[index]?.type || "character")}</select>
        </label>
        <label>
          Subject
          <select id="globalRefSubject_${index}">${referenceSelectOptions(REFERENCE_SUBJECTS, state.referenceMeta[index]?.subject || "shared")}</select>
        </label>
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
    $(`globalRefType_${index}`).addEventListener("change", (event) => {
      state.referenceMeta[index] = { ...(state.referenceMeta[index] || {}), type: event.target.value };
      clearIngredientsSheet();
    });
    $(`globalRefSubject_${index}`).addEventListener("change", (event) => {
      state.referenceMeta[index] = { ...(state.referenceMeta[index] || {}), subject: event.target.value };
      clearIngredientsSheet();
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
  clearIngredientsSheet();
  renderReferenceSlots();
  $("runHint").textContent = "Global reference uploaded";
}

function referenceItemsForIngredients() {
  ensureReferenceSlot();
  return state.referencePaths
    .map((path, index) => ({
      path,
      previewUrl: state.referencePreviewUrls[index] || (path ? mediaUrl(path) : ""),
      type: state.referenceMeta[index]?.type || "character",
      subject: state.referenceMeta[index]?.subject || "shared",
    }))
    .filter((item) => item.path && item.previewUrl);
}

function loadSheetImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function containRect(srcW, srcH, dst) {
  const scale = Math.min(dst.w / Math.max(1, srcW), dst.h / Math.max(1, srcH));
  const w = srcW * scale;
  const h = srcH * scale;
  return {
    x: dst.x + (dst.w - w) / 2,
    y: dst.y + (dst.h - h) / 2,
    w,
    h,
  };
}

function drawReferenceTile(ctx, image, rect, index) {
  ctx.fillStyle = "#111";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = "rgba(255,255,255,.16)";
  ctx.lineWidth = 2;
  ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
  if (!image) {
    ctx.fillStyle = `hsl(${(index * 67) % 360} 18% 28%)`;
    ctx.fillRect(rect.x + 12, rect.y + 12, rect.w - 24, rect.h - 24);
    return;
  }
  const inset = 12;
  const fit = containRect(image.naturalWidth || image.width, image.naturalHeight || image.height, {
    x: rect.x + inset,
    y: rect.y + inset,
    w: Math.max(1, rect.w - inset * 2),
    h: Math.max(1, rect.h - inset * 2),
  });
  ctx.drawImage(image, fit.x, fit.y, fit.w, fit.h);
}

function gridRects(count, bounds, gap) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const cellW = (bounds.w - gap * (cols - 1)) / cols;
  const cellH = (bounds.h - gap * (rows - 1)) / rows;
  return Array.from({ length: count }, (_, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      x: bounds.x + col * (cellW + gap),
      y: bounds.y + row * (cellH + gap),
      w: cellW,
      h: cellH,
    };
  });
}

async function buildIngredientsSheetDataUrl() {
  const items = referenceItemsForIngredients();
  if (!items.length) return "";
  const size = currentSize();
  const width = Math.max(512, Number(size.width) || 768);
  const height = Math.max(320, Number(size.height) || 448);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, width, height);
  const images = await Promise.all(items.map((item) => loadSheetImage(item.previewUrl)));
  const gap = Math.max(10, Math.round(Math.min(width, height) * 0.025));
  const pad = gap;
  const subjectKeys = ["person_a", "person_b", "person_c"].filter((subject) => items.some((item) => item.subject === subject));
  if (subjectKeys.length > 1) {
    const shared = items.map((item, index) => ({ item, image: images[index], index })).filter(({ item }) => item.subject === "shared" || item.subject === "none");
    const subjectH = shared.length ? Math.round((height - pad * 2 - gap) * 0.7) : height - pad * 2;
    const subjectW = (width - pad * 2 - gap * (subjectKeys.length - 1)) / subjectKeys.length;
    subjectKeys.forEach((subject, subjectIndex) => {
      const group = items
        .map((item, index) => ({ item, image: images[index], index }))
        .filter(({ item }) => item.subject === subject);
      const rects = gridRects(group.length, {
        x: pad + subjectIndex * (subjectW + gap),
        y: pad,
        w: subjectW,
        h: subjectH,
      }, gap);
      group.forEach((entry, index) => drawReferenceTile(ctx, entry.image, rects[index], entry.index));
    });
    if (shared.length) {
      const rects = gridRects(shared.length, {
        x: pad,
        y: pad + subjectH + gap,
        w: width - pad * 2,
        h: height - pad * 2 - subjectH - gap,
      }, gap);
      shared.forEach((entry, index) => drawReferenceTile(ctx, entry.image, rects[index], entry.index));
    }
  } else {
    const entries = items.map((item, index) => ({ item, image: images[index], index }));
    const rects = gridRects(entries.length, { x: pad, y: pad, w: width - pad * 2, h: height - pad * 2 }, gap);
    entries.forEach((entry, index) => drawReferenceTile(ctx, entry.image, rects[index], entry.index));
  }
  return canvas.toDataURL("image/png");
}

async function prepareDirectorIngredientsSheetForRun() {
  const workflow = state.workspace === "director" ? currentDirectorWorkflow() : null;
  if (!workflow || !isDirectorWorkflow(workflow) || !isIngredientsIcLora($("directorIcLora")?.value)) {
    return;
  }
  const refs = referenceItemsForIngredients();
  if (!refs.length) return;
  $("runHint").textContent = "Building Ingredients reference sheet...";
  const data = await buildIngredientsSheetDataUrl();
  if (!data) return;
  const uploaded = await api("/api/upload-image", {
    method: "POST",
    body: JSON.stringify({ name: "director_ingredients_reference_sheet.png", data }),
  });
  state.ingredientsSheetPath = uploaded.path;
  state.ingredientsSheetName = uploaded.name;
  state.ingredientsSheetPreviewUrl = mediaUrl(uploaded.path);
  const status = $("directorIngredientsSheetStatus");
  if (status) status.textContent = "Ingredients sheet ready";
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
    videoPath: "",
    videoName: "",
    videoPreviewUrl: "",
    videoPosterUrl: "",
  });
  $("runHint").textContent = "Image guide added to selected timeline segment";
}

function isVideoFile(file) {
  if (!file) return false;
  if (String(file.type || "").startsWith("video/")) return true;
  return /\.(mp4|webm|mkv|avi|mov|m4v|flv|wmv)$/i.test(String(file.name || ""));
}

async function uploadDirectorSegmentGuide(segmentId, file) {
  if (!file) return;
  if (isVideoFile(file)) {
    await uploadDirectorSegmentVideo(segmentId, file);
    return;
  }
  await uploadDirectorSegmentImage(segmentId, file);
}

async function uploadDirectorSegmentVideo(segmentId, file) {
  if (!file) return;
  $("directorSegmentImageStatus").textContent = "Uploading video guide...";
  const previewUrl = URL.createObjectURL(file);
  const localDuration = await readVideoDuration(file);
  const form = new FormData();
  form.append("file", file);
  const uploaded = await uploadFile("/api/upload-video", form);
  const duration = Number(localDuration) || Number(uploaded.duration) || 0;
  updateDirectorSegment(segmentId, {
    imagePath: "",
    imageName: "",
    imagePreviewUrl: "",
    videoPath: uploaded.path,
    videoName: uploaded.name,
    videoPreviewUrl: mediaUrl(uploaded.path) || previewUrl,
    videoPosterUrl: mediaUrl(uploaded.poster_path || uploaded.posterPath || ""),
    ...(duration > 0 ? { duration } : {}),
    // Reset so this freshly uploaded video extracts its audio once (also covers
    // replacing a video on a segment that was already extracted).
    audioExtracted: false,
  });
  // Extract the video's audio once into an independent clip on the video-audio
  // track, then render so it appears immediately.
  syncDirectorVideoAudioSegments();
  renderDirectorEditor();
  $("runHint").textContent = "Video guide added; audio extracted to its own track";
}

async function uploadDirectorIcVideo(file) {
  if (!file) return;
  if (!isVideoFile(file)) throw new Error("Choose a video file for the IC video track");
  $("runHint").textContent = "Uploading IC video guide...";
  const previewUrl = URL.createObjectURL(file);
  const localDuration = await readVideoDuration(file);
  const form = new FormData();
  form.append("file", file);
  const uploaded = await uploadFile("/api/upload-video", form);
  const duration = Number(localDuration) || Number(uploaded.duration) || 2;
  addDirectorIcVideoSegment({
    duration,
    videoPath: uploaded.path,
    videoName: uploaded.name,
    videoPreviewUrl: mediaUrl(uploaded.path) || previewUrl,
    videoPosterUrl: mediaUrl(uploaded.poster_path || uploaded.posterPath || ""),
  });
  $("runHint").textContent = "IC video guide added";
}

async function uploadDirectorRetakeVideo(file) {
  if (!file) return;
  if (!isVideoFile(file)) throw new Error("Choose a video file for Retake");
  $("runHint").textContent = "Uploading Retake base video...";
  const previewUrl = URL.createObjectURL(file);
  const metadata = await readVideoMetadata(file);
  const form = new FormData();
  form.append("file", file);
  const uploaded = await uploadFile("/api/upload-video", form);
  const videoDuration = Number(metadata.duration) || Number(uploaded.duration) || 2;
  state.directorRetakeVideo = {
    videoPath: uploaded.path,
    videoName: uploaded.name,
    videoPreviewUrl: mediaUrl(uploaded.path) || previewUrl,
    videoPosterUrl: mediaUrl(uploaded.poster_path || uploaded.posterPath || ""),
    duration: videoDuration,
    width: metadata.width,
    height: metadata.height,
  };
  setDirectorRetakeRangeFromSeconds(state.directorRetakeStart || 0, state.directorRetakeLength || Math.min(1, videoDuration), videoDuration);
  renderDirectorEditor();
  $("runHint").textContent = "Retake base video added";
}

function setDirectorMode(mode) {
  state.directorMode = mode === "retake" ? "retake" : "generate";
  renderDirectorEditor();
}

function setDirectorRetakeStartAtPlayhead() {
  const total = directorRetakeTotalSeconds();
  const fps = directorTimelineFps();
  const totalFrame = DirectorTimelineModel.toFrame(total, fps);
  const minLengthFrame = Math.max(1, DirectorTimelineModel.toFrame(0.1, fps));
  const playheadFrame = Math.max(0, Math.min(totalFrame, DirectorTimelineModel.toFrame(currentDirectorPlayheadSeconds(), fps)));
  const currentEndFrame = Math.min(totalFrame, DirectorTimelineModel.toFrame((Number(state.directorRetakeStart) || 0) + (Number(state.directorRetakeLength) || 1), fps));
  const endFrame = Math.max(playheadFrame + minLengthFrame, currentEndFrame);
  setDirectorRetakeRangeFromFrames(playheadFrame, endFrame - playheadFrame, totalFrame);
  renderDirectorEditor();
}

function setDirectorRetakeEndAtPlayhead() {
  const total = directorRetakeTotalSeconds();
  const fps = directorTimelineFps();
  const totalFrame = DirectorTimelineModel.toFrame(total, fps);
  const minLengthFrame = Math.max(1, DirectorTimelineModel.toFrame(0.1, fps));
  const startFrame = DirectorTimelineModel.toFrame(state.directorRetakeStart, fps);
  const playheadFrame = Math.max(0, Math.min(totalFrame, DirectorTimelineModel.toFrame(currentDirectorPlayheadSeconds(), fps)));
  const endFrame = Math.max(startFrame + minLengthFrame, playheadFrame);
  setDirectorRetakeRangeFromFrames(startFrame, Math.min(totalFrame - startFrame, endFrame - startFrame), totalFrame);
  renderDirectorEditor();
}

function removeDirectorRetakeVideo() {
  state.directorRetakeVideo = null;
  state.directorRetakeStart = 0;
  state.directorRetakeLength = 1;
  state.directorRetakePendingStitch = null;
  renderDirectorEditor();
}

function startDirectorRetakeSelectionDrag(event) {
  if (event.button !== 0 || !state.directorRetakeVideo) return;
  if (state.directorRetakeDrag) return;
  event.preventDefault();
  event.stopPropagation();
  const track = $("directorRetakeTrack");
  const rect = track.getBoundingClientRect();
  const mode = directorRetakeDragModeFromEvent(event);
  const originalStart = Number(state.directorRetakeStart) || 0;
  const length = Math.max(0.1, Number(state.directorRetakeLength) || 0.1);
  const fps = directorTimelineFps();
  const originalStartFrame = DirectorTimelineModel.toFrame(originalStart, fps);
  const lengthFrame = Math.max(1, DirectorTimelineModel.toFrame(length, fps));
  state.directorRetakeDrag = {
    mode,
    startX: event.clientX,
    originalStart,
    originalEnd: originalStart + length,
    length,
    total: directorRetakeTotalSeconds(),
    originalStartFrame,
    originalEndFrame: originalStartFrame + lengthFrame,
    lengthFrame,
    totalFrame: Math.max(1, DirectorTimelineModel.toFrame(directorRetakeTotalSeconds(), fps)),
    width: Math.max(1, rect.width),
  };
  document.body.classList.add("director-dragging");
  document.body.style.cursor = mode === "move" ? "grabbing" : "ew-resize";
  window.addEventListener("pointermove", onDirectorRetakeSelectionDrag);
  window.addEventListener("pointerup", stopDirectorRetakeSelectionDrag, { once: true });
  window.addEventListener("pointercancel", stopDirectorRetakeSelectionDrag, { once: true });
  window.addEventListener("mousemove", onDirectorRetakeSelectionDrag);
  window.addEventListener("mouseup", stopDirectorRetakeSelectionDrag, { once: true });
}

function directorRetakeDragModeFromEvent(event) {
  const handle = event.target.closest?.("[data-retake-handle]")?.dataset?.retakeHandle || "";
  if (handle === "left" || handle === "right") return handle;
  const selection = document.querySelector("#directorRetakeTrack .director-retake-selection");
  if (!selection) return "move";
  const rect = selection.getBoundingClientRect();
  const edge = Math.min(18, Math.max(10, rect.width * 0.2));
  if (event.clientX <= rect.left + edge) return "left";
  if (event.clientX >= rect.right - edge) return "right";
  return "move";
}

function maybeStartDirectorRetakeSelectionDrag(event) {
  if (state.directorMode !== "retake" || event.button !== 0 || !state.directorRetakeVideo) return;
  if (event.target.closest?.(".director-retake-remove")) return;
  const selection = document.querySelector("#directorRetakeTrack .director-retake-selection");
  if (!selection) return;
  const rect = selection.getBoundingClientRect();
  const inside = event.clientX >= rect.left
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom;
  if (!inside) return;
  startDirectorRetakeSelectionDrag(event);
}

function startDirectorRetakeTrackMouseDown(event) {
  if (event.button !== 0 || !state.directorRetakeVideo) return;
  if (event.target.closest?.(".director-retake-remove")) return;
  const track = $("directorRetakeTrack");
  const rect = track.getBoundingClientRect();
  const total = directorRetakeTotalSeconds();
  const x = event.clientX - rect.left;
  const start = Math.max(0, Number(state.directorRetakeStart) || 0);
  const length = Math.max(0.1, Number(state.directorRetakeLength) || 0.1);
  const selLeft = (start / total) * rect.width;
  const selRight = ((start + length) / total) * rect.width;
  if (x < selLeft || x > selRight) return;
  startDirectorRetakeSelectionDrag(event);
}

function onDirectorRetakeSelectionDrag(event) {
  const drag = state.directorRetakeDrag;
  if (!drag) return;
  const deltaSeconds = ((event.clientX - drag.startX) / drag.width) * drag.total;
  const fps = directorTimelineFps();
  const deltaFrames = Math.round(deltaSeconds * fps);
  const minLengthFrame = Math.max(1, DirectorTimelineModel.toFrame(0.1, fps));
  if (drag.mode === "left") {
    const nextStart = Math.max(0, Math.min(drag.originalEndFrame - minLengthFrame, drag.originalStartFrame + deltaFrames));
    setDirectorRetakeRangeFromFrames(nextStart, drag.originalEndFrame - nextStart, drag.totalFrame);
  } else if (drag.mode === "right") {
    const nextEnd = Math.max(drag.originalStartFrame + minLengthFrame, Math.min(drag.totalFrame, drag.originalEndFrame + deltaFrames));
    setDirectorRetakeRangeFromFrames(drag.originalStartFrame, nextEnd - drag.originalStartFrame, drag.totalFrame);
  } else {
    setDirectorRetakeRangeFromFrames(drag.originalStartFrame + deltaFrames, drag.lengthFrame, drag.totalFrame);
  }
  renderDirectorTimelineOnly();
}

function stopDirectorRetakeSelectionDrag() {
  if (!state.directorRetakeDrag) return;
  state.directorRetakeDrag = null;
  document.body.classList.remove("director-dragging");
  document.body.style.cursor = "";
  window.removeEventListener("pointermove", onDirectorRetakeSelectionDrag);
  window.removeEventListener("mousemove", onDirectorRetakeSelectionDrag);
  renderDirectorEditor();
}

async function sendDirectorRetakeSelectionToEdit(target) {
  const video = normalizedDirectorRetakeVideo();
  if (!video?.videoPath || !target) return;
  const range = normalizedDirectorRetakeRange();
  const start = range.start;
  const length = range.length;
  const end = Math.min(directorRetakeTotalSeconds(), start + length);
  const prompt = $("directorRetakePrompt")?.value.trim() || state.directorRetakePrompt || "";
  const buttons = [...document.querySelectorAll("#directorRetakeEditModes button")];
  buttons.forEach((button) => { button.disabled = true; });
  $("runHint").textContent = `Creating ${target.label} clip from retake selection...`;
  try {
    const clipped = await api("/api/trim-video", {
      method: "POST",
      body: JSON.stringify({ video_path: video.videoPath, start, end }),
    });
    const clippedDuration = Math.max(0.1, Number(clipped.duration) || (end - start));
    if (target.kind === "inpaint") setInpaintWorkflow();
    else setBerniniWorkflow(target.id);
    applyRetakeEditRunSettings(video, target, clippedDuration);
    setVideoSlot(target.slotKey, clipped.path, clipped.name, { duration: clippedDuration, trimmed: true });
    if ($("promptText")) $("promptText").value = prompt;
    state.directorRetakeAutoStitch = Boolean($("directorRetakeAutoStitch")?.checked);
    const retakeContext = {
      retake_id: newRetakeId(),
      base_video_path: video.videoPath,
      base_video_name: video.videoName || fileNameFromPath(video.videoPath),
      base_video_duration: Number(video.duration) || directorRetakeTotalSeconds(),
      clipped_path: clipped.path,
      clipped_name: clipped.name,
      start,
      end,
      prompt,
      target_workflow: target.id,
      target_kind: target.kind,
      target_label: target.label,
      auto_stitch: state.directorRetakeAutoStitch,
      createdAt: Date.now(),
      stitching: false,
      baseVideoPath: video.videoPath,
      targetId: target.id,
      targetKind: target.kind,
    };
    state.editRetakeContext = retakeContext;
    if (state.directorRetakeAutoStitch) {
      state.directorRetakeStitches[retakeContext.retake_id] = retakeContext;
      state.directorRetakePendingStitch = retakeContext;
    } else {
      state.directorRetakePendingStitch = null;
    }
    $("runHint").textContent = `Loaded retake selection into ${target.label} (${formatSeconds(start)} - ${formatSeconds(end)})`;
  } catch (err) {
    $("runHint").textContent = `Retake edit handoff failed: ${err.message}`;
    buttons.forEach((button) => { button.disabled = false; });
  }
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
  if (!path) return "";
  return `/media?path=${encodeURIComponent(path)}`;
}

function newRetakeId() {
  return `retake-${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36).slice(-3)}`;
}

function retakeContextForPayload(context) {
  if (!context?.retake_id) return null;
  return {
    retake_id: context.retake_id,
    base_video_path: context.base_video_path,
    base_video_name: context.base_video_name || fileNameFromPath(context.base_video_path || ""),
    base_video_duration: Number(context.base_video_duration) || 0,
    clipped_path: context.clipped_path || "",
    clipped_name: context.clipped_name || "",
    start: Number(context.start) || 0,
    end: Number(context.end) || 0,
    prompt: context.prompt || "",
    target_workflow: context.target_workflow || "",
    target_label: context.target_label || "",
    target_kind: context.target_kind || "",
    auto_stitch: context.auto_stitch !== false,
  };
}

function retakeContextForQueue(context) {
  const retake = retakeContextForPayload(context);
  return retake ? { ...retake, retake_id: newRetakeId() } : null;
}

function retakeContextMatchesVideo(context, videoPath) {
  const retake = retakeContextForPayload(context);
  return Boolean(retake?.retake_id && retake.clipped_path && retake.clipped_path === videoPath);
}

function pendingRetakeStitchRun(context, status = "queued") {
  const retake = retakeContextForPayload(context);
  if (!retake) return null;
  return {
    batch_id: `director_${retake.retake_id}`,
    run_id: "pending_stitch",
    workflow_id: "ltx_director_2",
    workflow_mode: "director_ref",
    workflow_label: "LTX Director Reference V2",
    status,
    prompt: `${retake.retake_id} waiting for ${retake.target_label || retake.target_workflow || "Edit"} result`,
    duration: Number(retake.base_video_duration) || 0,
    retake_stitch_pending: true,
    retake_stitch: {
      retake_id: retake.retake_id,
      base_video: retake.base_video_path,
      start: retake.start,
      end: retake.end,
      target_workflow: retake.target_workflow,
    },
  };
}

function renderBatch(batch) {
  state.activeBatch = batch;
  mergeHistoryRuns(batch.runs || [], true);
  renderScopedHistory();
  updateElapsed();
}

function upsertRuns(runs, newestFirst = false) {
  for (const run of runs) {
    if (isMotionRun(run)) continue;
    if (state.hiddenRunKeys.has(runKey(run))) continue;
    if (!isDirectorRun(run) && !runBelongsInCurrentResults(run)) continue;
    const grid = resultsGridForRun(run);
    const card = ensureRunCard(grid, run, newestFirst);
    updateRunCard(card, run);
  }
}

function upsertMotionRuns(runs, newestFirst = false) {
  for (const run of runs) {
    if (!isMotionRun(run)) continue;
    if (state.hiddenRunKeys.has(runKey(run))) continue;
    for (const displayRun of motionDisplayRunsForRun(run)) {
      const grid = motionResultsGridForRun(displayRun);
      if (!grid) continue;
      removeMotionRunFromOtherGrids(displayRun, grid);
      const card = ensureRunCard(grid, displayRun, newestFirst);
      updateRunCard(card, displayRun);
    }
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
      useRunSeed(card.dataset.seed, card._run || null);
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
      updateHistoryState(card._run?.base_history_key || card.dataset.runKey, action);
    });
    card.querySelector(".delete-run").addEventListener("click", () => {
      updateHistoryState(card._run?.base_history_key || card.dataset.runKey, "delete");
    });
    if (newestFirst) grid.prepend(node);
    else grid.appendChild(node);
  }
  return card;
}

function motionDisplayRun(run) {
  const kind = motionRunKind(run);
  return {
    ...run,
    motion_result_video: run.video || "",
    video: kind === "scail" ? (run.video || "") : (run.video || run.guide_video || ""),
  };
}

function motionOutputPath(record) {
  if (!record) return "";
  if (typeof record === "string") return record;
  return String(record.path || record.file || record.video || "");
}

function motionOutputType(record) {
  if (!record || typeof record === "string") return "output";
  return String(record.type || record.comfy_type || "output");
}

function motionOutputMediaType(record) {
  if (record && typeof record === "object" && record.media_type) return String(record.media_type);
  const path = motionOutputPath(record);
  return /\.(mp4|webm|mov)$/i.test(path) ? "video" : "";
}

function motionRunExplicitlyUsesGuideAsInput(run) {
  const raw = String(run.workflow_mode || run.workflow_id || run.workflow_label || "").toLowerCase();
  return raw.includes("scail")
    || raw.includes("uploaded_motion_to_scail")
    || raw.includes("motion_3d")
    || raw.includes("3d motion")
    || raw.includes("motion-3d");
}

function motionVideoOutputRecords(run, stage) {
  const records = [];
  const seen = new Set();
  const add = (record) => {
    const path = motionOutputPath(record);
    if (!path || seen.has(path)) return;
    if (motionOutputType(record) !== "output") return;
    if (motionOutputMediaType(record) !== "video") return;
    seen.add(path);
    records.push(typeof record === "object" ? record : { path, type: "output", media_type: "video" });
  };
  if (stage === "guide") {
    const guideOutputs = Array.isArray(run.guide_outputs) ? run.guide_outputs : [];
    const guideVideos = Array.isArray(run.guide_videos) ? run.guide_videos : [];
    guideOutputs.forEach(add);
    guideVideos.forEach(add);
    if (!guideOutputs.length && !guideVideos.length && !motionRunExplicitlyUsesGuideAsInput(run)) add(run.guide_video);
  } else {
    (Array.isArray(run.video_outputs) ? run.video_outputs : []).forEach(add);
    (Array.isArray(run.videos) ? run.videos : []).forEach(add);
    if (run.video && run.video !== run.guide_video) add(run.video);
  }
  return records;
}

function motionOutputDisplayRun(run, record, kind, index) {
  const path = motionOutputPath(record);
  const baseKey = run.base_history_key || runKey(run);
  const isGuide = kind === "guide";
  const workflowMode = isGuide ? "motion_text" : kind === "3d" ? "motion_3d" : "motion_scail";
  const workflowLabel = isGuide ? "Motion Guide" : kind === "3d" ? "3D Motion" : "SCAIL2";
  return {
    ...run,
    history_key: `${baseKey}:${kind}:${index + 1}`,
    base_history_key: baseKey,
    workflow_id: isGuide ? "text_to_motion" : kind === "3d" ? "motion_3d_to_scail" : "uploaded_motion_to_scail",
    workflow_mode: workflowMode,
    workflow_label: workflowLabel,
    output_path: path,
    output_bucket: record?.bucket || "",
    output_type: motionOutputType(record),
    output_media_type: "video",
    video: path,
    motion_result_video: isGuide ? "" : path,
    guide_video: isGuide ? path : (run.guide_video || ""),
  };
}

function motionDisplayRunsForRun(run) {
  const kind = motionRunKind(run);
  const displayRuns = [];
  const guideRecords = motionVideoOutputRecords(run, "guide");
  const finalRecords = motionVideoOutputRecords(run, "video");
  guideRecords.forEach((record, index) => {
    displayRuns.push(motionOutputDisplayRun(run, record, "guide", index));
  });
  finalRecords.forEach((record, index) => {
    displayRuns.push(motionOutputDisplayRun(run, record, kind === "3d" ? "3d" : "scail", index));
  });
  const status = String(run.status || "").toLowerCase();
  const waitingForFinal = ["scail", "3d"].includes(kind)
    && !finalRecords.length
    && ["queued", "queued_video", "guide_done", "running_video"].includes(status);
  if (waitingForFinal || !displayRuns.length) displayRuns.push(motionDisplayRun(run));
  return displayRuns;
}

function motionRunKind(run) {
  const raw = String(run.workflow_mode || run.workflow_id || run.workflow_label || "").toLowerCase();
  if (raw.includes("motion_3d") || raw.includes("3d motion") || raw.includes("motion-3d")) return "3d";
  if (raw.includes("scail") || raw.includes("uploaded_motion_to_scail")) return "scail";
  if (motionFinalVideo(run)) return "scail";
  return "text";
}

function motionResultsGridForRun(run) {
  const kind = motionRunKind(run);
  if (kind === "3d") return $("motion3dResultsGrid");
  if (kind === "scail") return $("motionScailResultsGrid");
  return $("motionResultsGrid");
}

function removeMotionRunFromOtherGrids(run, targetGrid) {
  for (const gridId of ["motionResultsGrid", "motionScailResultsGrid", "motion3dResultsGrid"]) {
    const grid = $(gridId);
    if (!grid || grid === targetGrid) continue;
    const card = grid.querySelector(`.result-card[data-run-key="${cssEscape(runKey(run))}"]`);
    if (card) card.remove();
  }
}

function removeMotionRunCard(run) {
  for (const gridId of ["motionResultsGrid", "motionScailResultsGrid", "motion3dResultsGrid"]) {
    const grid = $(gridId);
    if (!grid) continue;
    const card = grid.querySelector(`.result-card[data-run-key="${cssEscape(runKey(run))}"]`);
    if (card) card.remove();
  }
}

function optimisticScailRun(payload, guideVideoPath) {
  state.motionPendingCounter += 1;
  return {
    batch_id: `motion_pending_${Date.now()}_${state.motionPendingCounter}`,
    run_id: "01_motion",
    history_key: `motion_pending:${Date.now()}:${state.motionPendingCounter}`,
    workflow_id: "uploaded_motion_to_scail",
    workflow_mode: "motion_scail",
    workflow_label: "SCAIL2",
    status: "queued_video",
    guide_video: guideVideoPath,
    reference_image: payload.reference_path || "",
    prompt: payload.prompt || "SCAIL2 final video",
    duration: payload.duration || state.motionGuideDuration || 4,
    width: payload.width,
    height: payload.height,
    seed: payload.seed || "",
    steps: payload.steps,
    pose_strength: payload.pose_strength,
    queued_at: Date.now() / 1000,
  };
}

function resultsGridForRun(run) {
  return isDirectorRun(run) ? $("directorResultsGrid") : $("resultsGrid");
}

function mergeHistoryRuns(runs, newestFirst = false) {
  if (!Array.isArray(runs) || !runs.length) return;
  for (const run of runs) {
    if (run?.retake_stitch_pending) continue;
    const stitchedRetakeId = run?.retake_stitch?.retake_id;
    if (stitchedRetakeId) state.directorRetakeCompletedStitches[stitchedRetakeId] = true;
  }
  const existing = new Map(state.historyRuns.map((run) => [runKey(run), run]));
  const incoming = runs.map((run) => ({ ...existing.get(runKey(run)), ...run }));
  const incomingKeys = new Set(incoming.map((run) => runKey(run)));
  const rest = state.historyRuns.filter((run) => !incomingKeys.has(runKey(run)));
  state.historyRuns = newestFirst ? [...incoming, ...rest] : [...rest, ...incoming];
  for (const run of incoming) maybeAutoStitchDirectorRetake(run);
}

async function maybeAutoStitchDirectorRetake(run) {
  const runRetake = retakeContextForPayload(run?.retake_context);
  if (runRetake?.retake_id && state.directorRetakeCompletedStitches[runRetake.retake_id]) return;
  const pending = runRetake?.retake_id
    ? { ...(state.directorRetakeStitches[runRetake.retake_id] || {}), ...runRetake }
    : state.directorRetakePendingStitch;
  if (pending?.retake_id && state.directorRetakeCompletedStitches[pending.retake_id]) return;
  if (!pending || pending.stitching || pending.stitch_failed || pending.stitched || run?.retake_stitch || !run?.video) return;
  if (pending.auto_stitch === false) return;
  const workflows = new Set([run.workflow_id, run.workflow_mode].filter(Boolean).map(String));
  const targetWorkflow = pending.target_workflow || pending.targetId;
  if (targetWorkflow && !workflows.has(String(targetWorkflow))) return;
  pending.stitching = true;
  if (pending.retake_id) state.directorRetakeStitches[pending.retake_id] = pending;
  const hint = $("runHint");
  if (hint) hint.textContent = "Stitching retake edit back into Director output...";
  try {
    const result = await api("/api/stitch-retake-video", {
      method: "POST",
      body: JSON.stringify({
        base_video_path: pending.base_video_path || pending.baseVideoPath,
        edited_video_path: run.video,
        start: pending.start,
        end: pending.end,
        prompt: pending.prompt,
        retake_id: pending.retake_id || "",
        edit_mode: pending.target_label || pending.target_workflow || pending.targetId || "",
        edit_run_key: runKey(run),
      }),
    });
    const stitchedRun = result?.run || result?.batch?.runs?.[0] || null;
    if (!runRetake?.retake_id) state.directorRetakePendingStitch = null;
    if (pending.retake_id) {
      state.directorRetakeCompletedStitches[pending.retake_id] = true;
      delete state.directorRetakeStitches[pending.retake_id];
      state.historyRuns = state.historyRuns.filter((item) => runKey(item) !== `director_${pending.retake_id}:pending_stitch`);
    }
    if (stitchedRun) {
      mergeHistoryRuns([stitchedRun], true);
      renderScopedHistory();
    }
    if (hint) hint.textContent = "Retake edit stitched into Director output";
  } catch (err) {
    pending.stitching = false;
    pending.stitch_failed = true;
    if (pending.retake_id) state.directorRetakeStitches[pending.retake_id] = pending;
    if (hint) hint.textContent = `Retake stitch failed: ${err.message}`;
  }
}

function renderScopedHistory() {
  const visibleRuns = sortRunsNewestFirst(state.historyRuns.filter((run) => !state.hiddenRunKeys.has(runKey(run))));
  const directorRuns = visibleRuns.filter((run) => isDirectorRun(run));
  const motionRuns = visibleRuns.filter((run) => isMotionRun(run));
  const motionDisplayRuns = motionRuns.flatMap(motionDisplayRunsForRun);
  const resultRuns = visibleRuns.filter((run) => !isDirectorRun(run) && !isMotionRun(run) && runBelongsInCurrentResults(run));
  syncRunGrid($("resultsGrid"), resultRuns);
  syncRunGrid($("directorResultsGrid"), directorRuns);
  syncRunGrid($("motionResultsGrid"), motionDisplayRuns.filter((run) => motionRunKind(run) === "text"));
  syncRunGrid($("motionScailResultsGrid"), motionDisplayRuns.filter((run) => motionRunKind(run) === "scail"));
  syncRunGrid($("motion3dResultsGrid"), motionDisplayRuns.filter((run) => motionRunKind(run) === "3d"));
  upsertRuns(resultRuns, false);
  upsertRuns(directorRuns, false);
  upsertMotionRuns(motionRuns, false);
  orderRunGrid($("resultsGrid"), resultRuns);
  orderRunGrid($("directorResultsGrid"), directorRuns);
  orderRunGrid($("motionResultsGrid"), motionDisplayRuns.filter((run) => motionRunKind(run) === "text"));
  orderRunGrid($("motionScailResultsGrid"), motionDisplayRuns.filter((run) => motionRunKind(run) === "scail"));
  orderRunGrid($("motion3dResultsGrid"), motionDisplayRuns.filter((run) => motionRunKind(run) === "3d"));
}

function syncRunGrid(grid, runs) {
  if (!grid) return;
  const keep = new Set(runs.map((run) => runKey(run)));
  grid.querySelectorAll(".result-card").forEach((card) => {
    if (!keep.has(card.dataset.runKey || "")) card.remove();
  });
}

function runSortTimestamp(run) {
  const candidates = [run.finished_at, run.started_at, run.queued_at, run.created_at];
  return candidates.map(Number).find((value) => Number.isFinite(value) && value > 0) || 0;
}

function sortRunsNewestFirst(runs) {
  return runs
    .map((run, index) => ({ run, index }))
    .sort((a, b) => {
      const delta = runSortTimestamp(b.run) - runSortTimestamp(a.run);
      return delta || a.index - b.index;
    })
    .map((item) => item.run);
}

function orderRunGrid(grid, runs) {
  if (!grid) return;
  for (const run of runs) {
    const card = grid.querySelector(`.result-card[data-run-key="${cssEscape(runKey(run))}"]`);
    if (card) grid.appendChild(card);
  }
}

function runWorkflowToken(run) {
  return String(run.workflow_id || run.workflow_mode || run.workflow_label || "").toLowerCase();
}

function isBerniniRun(run) {
  const id = String(run.workflow_id || "");
  const mode = String(run.workflow_mode || "");
  return Boolean(getBerniniTask(id))
    || Boolean(getBerniniTask(mode))
    || runWorkflowToken(run).includes("bernini");
}

function berniniRunWorkflowId(run) {
  const id = String(run.workflow_id || "");
  const mode = String(run.workflow_mode || "");
  if (getBerniniTask(id)) return id;
  if (getBerniniTask(mode)) return mode;
  const raw = runWorkflowToken(run);
  return Object.keys(BERNINI_TASKS).find((workflowId) => raw.includes(workflowId)) || "";
}

function isInpaintRun(run) {
  const id = String(run.workflow_id || "");
  const mode = String(run.workflow_mode || "");
  return id === INPAINT_WORKFLOW_MODE || mode === INPAINT_WORKFLOW_MODE || runWorkflowToken(run).includes("inpaint");
}

function runBelongsInCurrentResults(run) {
  if (state.workspace === "edit") {
    const workflow = currentEditWorkflow();
    if (isInpaintWorkflow(workflow)) return isInpaintRun(run);
    if (isBerniniWorkflow(workflow)) return isBerniniRun(run) && berniniRunWorkflowId(run) === state.berniniWorkflowId;
    return isBerniniRun(run) || isInpaintRun(run);
  }
  if (state.workspace === "camera") {
    return !isBerniniRun(run) && !isInpaintRun(run);
  }
  return false;
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
  const actions = card.querySelector(".result-text-actions");
  const existingEditMenu = actions.querySelector(".result-video-edit");
  const editMenuKey = [
    run.video || "",
    run.duration || "",
    run.workflow_id || "",
    run.workflow_mode || "",
    run.workflow_label || "",
  ].join("|");
  if (card.dataset.editMenuKey !== editMenuKey) {
    card.dataset.editMenuKey = editMenuKey;
    if (existingEditMenu) existingEditMenu.remove();
    const editMenu = renderResultVideoEditMenu(run);
    if (editMenu) actions.appendChild(editMenu);
  }
  const pinButton = card.querySelector(".pin-run");
  pinButton.title = run.pinned ? "Unpin" : "Pin";
  pinButton.setAttribute("aria-label", run.pinned ? "Unpin" : "Pin");
  pinButton.classList.toggle("active", Boolean(run.pinned));

  const media = card.querySelector(".media-box");
  const placeholderText = runPlaceholderText(run);
  const mediaKey = run.video
    ? `video:${run.video}`
    : run.image
      ? `image:${run.image}`
    : run.contact_sheet
      ? `contact:${run.contact_sheet}`
      : `status:${run.status}:${run.error || placeholderText}`;
  if (card.dataset.mediaKey !== mediaKey) {
    card.dataset.mediaKey = mediaKey;
    media.textContent = run.error || placeholderText;
    if (run.video) {
      media.innerHTML = "";
      const video = document.createElement("video");
      video.src = mediaUrl(run.video);
      video.controls = true;
      video.muted = false;
      video.loop = true;
      media.appendChild(video);
    } else if (run.image) {
      media.innerHTML = "";
      const img = document.createElement("img");
      img.src = mediaUrl(run.image);
      img.alt = "result image";
      media.appendChild(img);
    } else if (run.contact_sheet) {
      media.innerHTML = "";
      const img = document.createElement("img");
      img.src = mediaUrl(run.contact_sheet);
      img.alt = "contact sheet";
      media.appendChild(img);
    }
  }

  const promptLine = card.querySelector(".paths");
  const promptKey = run.retake_stitch && run.variant_name
    ? [run.variant_name, run.prompt].filter(Boolean).join(" | ")
    : run.prompt || "";
  if (card.dataset.promptKey !== promptKey) {
    card.dataset.promptKey = promptKey;
    promptLine.textContent = promptKey;
  }
  renderDirectorSegments(card, run);
}

function runPlaceholderText(run) {
  if (isMotionRun(run)) {
    const kind = motionRunKind(run);
    const status = String(run.status || "").toLowerCase();
    if (kind === "scail" && ["queued", "queued_video", "guide_done", "running_video"].includes(status)) {
      return "Rendering final video";
    }
    if (status === "running_motion") return "Rendering motion guide";
    if (status === "guide_done") return "Guide ready";
    if (status.includes("queued")) return "Queued";
  }
  return "waiting";
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

function videoPreviewAspect(run = {}) {
  const player = $("videoPreviewPlayer");
  const width = Number(run.width || run.frame_width || run.output_width || player.videoWidth);
  const height = Number(run.height || run.frame_height || run.output_height || player.videoHeight);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 0;
  return width / height;
}

function clearVideoPreviewLayout() {
  const panel = document.querySelector(".video-preview-panel");
  const frame = document.querySelector(".video-preview-frame");
  if (!panel || !frame) return;
  ["--video-preview-panel-width", "--video-preview-panel-height"].forEach((name) => {
    panel.style.removeProperty(name);
  });
  ["--video-preview-frame-width", "--video-preview-frame-height"].forEach((name) => {
    frame.style.removeProperty(name);
  });
}

function updateVideoPreviewLayout(run = state.videoPreviewRun || {}) {
  const modal = $("videoPreviewModal");
  if (!modal.classList.contains("open")) return;
  const panel = document.querySelector(".video-preview-panel");
  const frame = document.querySelector(".video-preview-frame");
  const head = panel?.querySelector(".director-modal-head");
  if (!panel || !frame || !head) return;
  const aspect = videoPreviewAspect(run);
  if (!aspect) {
    clearVideoPreviewLayout();
    return;
  }

  const maxPanelWidth = Math.min(1380, Math.max(280, window.innerWidth - 32));
  const maxPanelHeight = Math.min(860, Math.max(260, window.innerHeight - 32));
  const panelStyle = getComputedStyle(panel);
  const headStyle = getComputedStyle(head);
  const paddingX = parseFloat(panelStyle.paddingLeft) + parseFloat(panelStyle.paddingRight);
  const paddingY = parseFloat(panelStyle.paddingTop) + parseFloat(panelStyle.paddingBottom);
  const headHeight = head.getBoundingClientRect().height
    + parseFloat(headStyle.marginTop)
    + parseFloat(headStyle.marginBottom);
  const availableWidth = Math.max(220, maxPanelWidth - paddingX);
  const availableHeight = Math.max(160, maxPanelHeight - paddingY - headHeight);

  let frameWidth = availableWidth;
  let frameHeight = frameWidth / aspect;
  if (frameHeight > availableHeight) {
    frameHeight = availableHeight;
    frameWidth = frameHeight * aspect;
  }

  panel.style.setProperty("--video-preview-panel-width", `${Math.ceil(frameWidth + paddingX)}px`);
  panel.style.setProperty("--video-preview-panel-height", `${Math.ceil(frameHeight + paddingY + headHeight)}px`);
  frame.style.setProperty("--video-preview-frame-width", `${Math.ceil(frameWidth)}px`);
  frame.style.setProperty("--video-preview-frame-height", `${Math.ceil(frameHeight)}px`);
}

function openVideoPreview(run) {
  if (!run.video) return;
  const modal = $("videoPreviewModal");
  const player = $("videoPreviewPlayer");
  state.videoPreviewRun = run;
  $("videoPreviewTitle").textContent = run.run_id || run.batch_id || "Preview";
  clearVideoPreviewLayout();
  player.src = mediaUrl(run.video);
  player.loop = true;
  player.onloadedmetadata = () => updateVideoPreviewLayout(state.videoPreviewRun || {});
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => updateVideoPreviewLayout(run));
  player.focus();
}

function closeVideoPreview() {
  const modal = $("videoPreviewModal");
  const player = $("videoPreviewPlayer");
  state.videoPreviewRun = null;
  player.onloadedmetadata = null;
  player.pause();
  player.removeAttribute("src");
  player.load();
  clearVideoPreviewLayout();
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function frameExtractDuration(run = state.frameExtractRun || {}) {
  const player = $("frameExtractPlayer");
  const candidates = [
    player.duration,
    run.duration,
    run.duration_seconds,
    run.director_timeline?.duration_seconds,
  ];
  return candidates.map(Number).find((value) => Number.isFinite(value) && value > 0) || 0;
}

function updateFrameExtractReadout(value = $("frameExtractTime").value) {
  const time = Math.max(0, Number(value) || 0);
  $("frameExtractTimeReadout").textContent = `${time.toFixed(2)}s`;
}

function syncFrameExtractTime(value) {
  const player = $("frameExtractPlayer");
  const duration = frameExtractDuration();
  const time = Math.max(0, Math.min(duration || Number.MAX_SAFE_INTEGER, Number(value) || 0));
  $("frameExtractTime").value = String(time);
  updateFrameExtractReadout(time);
  if (Number.isFinite(time)) player.currentTime = time;
}

function updateFrameExtractBounds() {
  const duration = frameExtractDuration();
  const slider = $("frameExtractTime");
  slider.max = duration ? String(duration) : "0";
  slider.step = "0.01";
  updateFrameExtractReadout(slider.value);
}

function openFrameExtract(run) {
  if (!run?.video) return;
  const modal = $("frameExtractModal");
  const player = $("frameExtractPlayer");
  state.frameExtractRun = run;
  $("frameExtractTitle").textContent = run.run_id || run.batch_id || "Frame";
  $("frameExtractStatus").textContent = "";
  player.src = mediaUrl(run.video);
  player.loop = false;
  $("frameExtractTime").value = "0";
  updateFrameExtractBounds();
  player.onloadedmetadata = () => {
    updateFrameExtractBounds();
    syncFrameExtractTime(Math.min(player.currentTime || 0, frameExtractDuration(run)));
  };
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  player.focus();
}

function closeFrameExtract() {
  const modal = $("frameExtractModal");
  const player = $("frameExtractPlayer");
  state.frameExtractRun = null;
  player.onloadedmetadata = null;
  player.pause();
  player.removeAttribute("src");
  player.load();
  $("frameExtractStatus").textContent = "";
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
}

function frameExtractFilename(run, time) {
  const base = String(run.run_id || run.batch_id || "frame").replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `${base}_${time.toFixed(2)}s.png`;
}

function saveFrameExtract() {
  const run = state.frameExtractRun || {};
  const player = $("frameExtractPlayer");
  if (!run.video) return;
  const width = player.videoWidth || Number(run.width) || 1280;
  const height = player.videoHeight || Number(run.height) || 720;
  const time = Math.max(0, Number($("frameExtractTime").value) || player.currentTime || 0);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(player, 0, 0, width, height);
  canvas.toBlob((blob) => {
    if (!blob) {
      $("frameExtractStatus").textContent = "Frame save failed";
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = frameExtractFilename(run, time);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("frameExtractStatus").textContent = "Frame downloaded";
  }, "image/png");
}

function runModeLabel(run) {
  const raw = String(run.workflow_mode || run.workflow_id || "").toLowerCase();
  const berniniWorkflowId = berniniRunWorkflowId(run);
  const isDirectorRetake = run?.retake_mode === true || String(run?.retake_mode).toLowerCase() === "true"
    || run?.director_timeline?.retake_mode === true || String(run?.director_timeline?.retake_mode).toLowerCase() === "true";
  if (run?.retake_stitch) return "retake";
  if (isDirectorRetake) return "retake";
  if (run?.retake_context && berniniWorkflowId && getBerniniTask(berniniWorkflowId)) return `retake-${getBerniniTask(berniniWorkflowId).tag}`;
  if (run?.retake_context && isInpaintRun(run)) return "retake-Inpaint";
  if (run?.retake_context) return "retake";
  if (berniniWorkflowId && getBerniniTask(berniniWorkflowId)) return getBerniniTask(berniniWorkflowId).tag;
  if (isInpaintRun(run)) return "Inpaint";
  if (isMotionRun(run)) {
    const kind = motionRunKind(run);
    if (kind === "3d") return "3D";
    if (kind === "scail") return "SCAIL2";
    return "GUIDE";
  }
  if (raw.includes("director")) return "DIR";
  if (raw.includes("ads2v")) return "ADS2V";
  if (raw.includes("vrc2v")) return "VRC2V";
  if (raw.includes("rv2v")) return "RV2V";
  if (raw.includes("mv2v")) return "MV2V";
  if (raw.includes("vi2v")) return "VI2V";
  if (raw.includes("r2v")) return "R2V";
  if (raw.includes("r2i")) return "R2I";
  if (raw.includes("i2i")) return "I2I";
  if (raw.includes("t2i")) return "T2I";
  if (raw.includes("ia2v")) return "IA2V";
  if (raw.includes("fml") || raw.includes("fmf")) return "FML";
  if (raw.includes("flf")) return "FLF";
  if (raw.includes("v2v")) return "V2V";
  if (raw.includes("t2v")) return "T2V";
  if (raw.includes("i2v")) return "I2V";
  if (raw) return raw.replace(/^bernini_/, "").replace(/[_-]+/g, " ").toUpperCase();
  return "MODE";
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

function setInputValueIfPresent(id, value) {
  const input = $(id);
  if (input) input.value = value;
}

function useRunSeed(seed, run = null) {
  if (!seed) return;
  setInputValueIfPresent("seedInput", seed);
  setInputValueIfPresent("directorGlobalSeedInput", seed);
  if (run && isMotionRun(run)) {
    const kind = motionRunKind(run);
    if (kind === "text") setInputValueIfPresent("motionSeed", seed);
    if (kind === "scail") setInputValueIfPresent("motionScailSeed", seed);
    if (kind === "3d") {
      setInputValueIfPresent("motion3dSeed", seed);
      setInputValueIfPresent("motionScailSeed", seed);
    }
  }
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

function restoreMotionGuide(run) {
  if (!run.guide_video) return false;
  state.motionBatch = null;
  state.motionGuideVideoPath = run.guide_video;
  const guide = $("motionGuide");
  guide.pause();
  guide.src = mediaUrl(run.guide_video);
  $("motionGuideUploadStatus").textContent = fileNameFromPath(run.guide_video);
  $("motionGuideState").textContent = "ready";
  state.motionGuideDuration = Number(run.duration) || motionGuideDurationFallback();
  updateVideoClipperButtons();
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
  if (run.prompt) setMotionPromptValue(run.prompt);
  setInputIfPresent("motionDuration", run.duration);
  setInputIfPresent("motionSeed", run.seed);
  setInputIfPresent("motionScailSeed", run.seed);
  setInputIfPresent("motionSteps", run.steps);
  setInputIfPresent("motionPoseStrength", run.pose_strength);
  setInputIfPresent("motionCfg", run.cfg_scale);
  if (run.use_pose_video_mask !== undefined) $("motionUsePoseMask").checked = run.use_pose_video_mask !== false;
  $("motionPoseReadout").textContent = Number($("motionPoseStrength").value).toFixed(2);
  $("motionCfgReadout").textContent = Number($("motionCfg").value).toFixed(1);
  restoreMotionSize(run);
  restoreMotionGuide(run);
  const finalVideo = motionFinalVideo(run);
  setMotionSubtab("scail");
  if (finalVideo) {
    restoreMotionReference(run);
    const result = $("motionResult");
    result.pause();
    result.src = mediaUrl(finalVideo);
    $("motionResultState").textContent = "ready";
    $("motionStatus").textContent = `Setup restored from ${run.batch_id || "result"}`;
  } else {
    clearMotionResult();
    $("motionStatus").textContent = `Motion guide loaded for SCAIL2 from ${run.batch_id || "result"}`;
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
  moveMotionVideoPanel();
  moveMotionGuidePreview();
  moveMotionPreviewCards();
  if (state.motionSubtab === "scail" && $("motionScailPrompt") && !$("motionScailPrompt").value) {
    $("motionScailPrompt").value = $("motionPrompt").value;
  }
  if (state.motionSubtab === "3d") {
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 0);
  }
}

function moveMotionGuidePreview() {
  const panel = $("motionGuidePreviewCard");
  const target = $(state.motionSubtab === "scail" ? "motionHiddenPreviewParking" : "motionTextGuideMount");
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

function moveMotionPreviewCards() {
  const inScail = state.motionSubtab === "scail";
  const resultCard = $("motionResultPreviewCard");
  const resultTarget = $(inScail ? "motionHiddenPreviewParking" : "motionTextResultMount");
  if (resultCard && resultTarget && resultCard.parentElement !== resultTarget) {
    resultTarget.appendChild(resultCard);
  }

  const referenceCard = $("motionReferencePreviewCard");
  const referenceTarget = $(inScail ? "motionHiddenPreviewParking" : "motionTextReferenceMount");
  if (referenceCard && referenceTarget && referenceCard.parentElement !== referenceTarget) {
    referenceTarget.appendChild(referenceCard);
  }
}

function initMotion3d() {
  if (state.motion3d.initialized) {
    resizeMotion3dCanvas();
    renderMotion3d();
    return;
  }
  state.motion3d.initialized = true;
  state.motion3d.timeline = [{ id: motion3dId(), clip: "idle", label: "Idle loop", start: 0, duration: 3 }];
  renderMotion3dActions();
  renderMotion3dTimeline();
  resizeMotion3dCanvas();
  renderMotion3d();
}

function motion3dTotalDuration() {
  return Math.max(0.5, ...state.motion3d.timeline.map((item) => item.start + item.duration));
}

function renderMotion3dActions() {
  const root = $("motion3dActionLibrary");
  if (!root) return;
  root.innerHTML = "";
  for (const action of motion3dActions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `+ ${action.label}`;
    button.addEventListener("click", () => addMotion3dAction(action));
    root.appendChild(button);
  }
}

function relayoutMotion3dTimeline(items) {
  let cursor = 0;
  return items.map((item) => {
    const next = { ...item, start: cursor };
    cursor += next.duration;
    return next;
  });
}

function addMotion3dAction(action) {
  const timeline = state.motion3d.timeline.filter((item) => item.clip !== "idle" || state.motion3d.timeline.length > 1);
  timeline.push({ id: motion3dId(), clip: action.id, label: action.label, start: 0, duration: action.duration });
  state.motion3d.timeline = relayoutMotion3dTimeline(timeline);
  state.motion3d.time = 0;
  renderMotion3dTimeline();
  renderMotion3d();
}

function resetMotion3dTimeline() {
  state.motion3d.timeline = [{ id: motion3dId(), clip: "idle", label: "Idle loop", start: 0, duration: 3 }];
  state.motion3d.time = 0;
  state.motion3d.playing = false;
  renderMotion3dTimeline();
  renderMotion3d();
}

function renderMotion3dTimeline() {
  const root = $("motion3dTimeline");
  if (!root) return;
  state.motion3d.duration = motion3dTotalDuration();
  $("motion3dClipCount").textContent = `${state.motion3d.timeline.length} clip${state.motion3d.timeline.length === 1 ? "" : "s"}`;
  $("motion3dDuration").textContent = `${state.motion3d.duration.toFixed(2)}s`;
  root.innerHTML = "";
  state.motion3d.timeline.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "motion-3d-row";
    row.innerHTML = `
      <span class="row-index">${String(index + 1).padStart(2, "0")}</span>
      <div><strong>${escapeHtml(item.label)}</strong><small>${item.start.toFixed(1)}s - ${(item.start + item.duration).toFixed(1)}s</small></div>
      <input type="number" min="0.1" step="0.1" value="${Number(item.duration.toFixed(2))}" aria-label="Clip duration">
      <button type="button" aria-label="Delete clip">x</button>
    `;
    row.querySelector("input").addEventListener("input", (event) => {
      const duration = Math.max(0.1, Number(event.target.value) || item.duration);
      state.motion3d.timeline = relayoutMotion3dTimeline(state.motion3d.timeline.map((clip) => clip.id === item.id ? { ...clip, duration } : clip));
      renderMotion3dTimeline();
      renderMotion3d();
    });
    row.querySelector("button").addEventListener("click", () => {
      const next = state.motion3d.timeline.filter((clip) => clip.id !== item.id);
      state.motion3d.timeline = relayoutMotion3dTimeline(next.length ? next : [{ id: motion3dId(), clip: "idle", label: "Idle loop", start: 0, duration: 3 }]);
      renderMotion3dTimeline();
      renderMotion3d();
    });
    root.appendChild(row);
  });
  updateMotion3dTimebar();
}

function resizeMotion3dCanvas() {
  const canvas = $("motion3dCanvas");
  if (!canvas) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(260, Math.floor(rect.height));
  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
}

function activeMotion3dClip() {
  const time = state.motion3d.time;
  return state.motion3d.timeline.find((item) => time >= item.start && time <= item.start + item.duration) || state.motion3d.timeline.at(-1);
}

function drawMotion3dLimb(ctx, x, y, length, angle, width, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, length);
  ctx.stroke();
  ctx.restore();
}

function renderMotion3d() {
  const canvas = $("motion3dCanvas");
  if (!canvas) return;
  resizeMotion3dCanvas();
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.save();
  ctx.scale(dpr, dpr);
  const cssW = w / dpr;
  const cssH = h / dpr;
  const gradient = ctx.createLinearGradient(0, 0, 0, cssH);
  gradient.addColorStop(0, "#121718");
  gradient.addColorStop(1, "#0b0d0d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, cssW, cssH);

  ctx.strokeStyle = "rgba(143,199,192,.15)";
  ctx.lineWidth = 1;
  const horizon = cssH * 0.72;
  for (let i = -8; i <= 8; i += 1) {
    const x = cssW / 2 + i * 42;
    ctx.beginPath();
    ctx.moveTo(x, horizon);
    ctx.lineTo(x + i * 25, cssH);
    ctx.stroke();
  }
  for (let i = 0; i < 8; i += 1) {
    const y = horizon + i * 24;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(cssW, y);
    ctx.stroke();
  }

  const clip = activeMotion3dClip();
  const local = clip ? state.motion3d.time - clip.start : 0;
  const progress = clip ? local / Math.max(clip.duration, 0.1) : 0;
  const phase = progress * Math.PI * 2;
  const swing = Math.sin(phase);
  const bounce = Math.abs(Math.sin(phase)) * 10;
  const cx = cssW / 2;
  const feetY = cssH * 0.76;
  const scale = Math.min(cssW, cssH) / 390;
  const torsoY = feetY - 145 * scale - bounce;
  let arm = swing * 0.55;
  let leg = -swing * 0.48;
  let lean = 0;
  if (clip?.clip === "wave_right") arm = -1.8 + Math.sin(phase * 2) * 0.45;
  if (clip?.clip === "raise_hands") arm = -2.2;
  if (clip?.clip === "crouch") lean = 0.28;
  if (clip?.clip === "dance_loop") { arm = Math.sin(phase * 1.5) * 1.2; leg = Math.cos(phase) * 0.7; }

  ctx.shadowColor = "rgba(0,0,0,.5)";
  ctx.shadowBlur = 16;
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.beginPath();
  ctx.ellipse(cx + 20 * scale, feetY + 10, 70 * scale, 16 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  const joint = (x, y, r, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const blue = "#285aa5";
  const orange = "#d66f29";
  drawMotion3dLimb(ctx, cx - 22 * scale, torsoY + 80 * scale, 62 * scale, 0.12 + leg, 18 * scale, blue);
  drawMotion3dLimb(ctx, cx + 22 * scale, torsoY + 80 * scale, 62 * scale, -0.12 - leg, 18 * scale, orange);
  drawMotion3dLimb(ctx, cx - 30 * scale, torsoY + 138 * scale, 55 * scale, -0.14 - leg * .8, 15 * scale, blue);
  drawMotion3dLimb(ctx, cx + 30 * scale, torsoY + 138 * scale, 55 * scale, 0.14 + leg * .8, 15 * scale, orange);
  ctx.save();
  ctx.translate(cx, torsoY + 64 * scale);
  ctx.rotate(lean);
  ctx.fillStyle = orange;
  ctx.fillRect(-32 * scale, -48 * scale, 64 * scale, 92 * scale);
  ctx.fillStyle = blue;
  ctx.fillRect(-6 * scale, -48 * scale, 16 * scale, 92 * scale);
  drawMotion3dLimb(ctx, -38 * scale, -28 * scale, 58 * scale, 0.4 - arm * .4, 16 * scale, blue);
  drawMotion3dLimb(ctx, 38 * scale, -28 * scale, 58 * scale, -0.4 + arm, 16 * scale, orange);
  ctx.fillStyle = orange;
  ctx.beginPath();
  ctx.ellipse(0, -74 * scale, 22 * scale, 28 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  joint(cx - 28 * scale, torsoY + 198 * scale, 8 * scale, blue);
  joint(cx + 28 * scale, torsoY + 198 * scale, 8 * scale, orange);
  ctx.restore();
  updateMotion3dTimebar();
}

function updateMotion3dTimebar() {
  if (!$("motion3dTime")) return;
  const duration = motion3dTotalDuration();
  $("motion3dTime").textContent = `${state.motion3d.time.toFixed(2)}s`;
  $("motion3dDuration").textContent = `${duration.toFixed(2)}s`;
  $("motion3dRailFill").style.width = `${Math.min(100, Math.max(0, (state.motion3d.time / duration) * 100))}%`;
  $("motion3dPlay").textContent = state.motion3d.playing ? "Pause" : "Play";
}

function tickMotion3d(now) {
  if (!state.motion3d.playing) return;
  const elapsed = state.motion3d.lastTick ? (now - state.motion3d.lastTick) / 1000 : 0;
  state.motion3d.lastTick = now;
  state.motion3d.time += elapsed;
  const duration = motion3dTotalDuration();
  if (state.motion3d.time > duration) state.motion3d.time = 0;
  renderMotion3d();
  state.motion3d.animationFrame = requestAnimationFrame(tickMotion3d);
}

function toggleMotion3dPlayback() {
  state.motion3d.playing = !state.motion3d.playing;
  state.motion3d.lastTick = 0;
  if (state.motion3d.playing) state.motion3d.animationFrame = requestAnimationFrame(tickMotion3d);
  else cancelAnimationFrame(state.motion3d.animationFrame);
  updateMotion3dTimebar();
}

function resetMotion3dPlayhead() {
  state.motion3d.playing = false;
  state.motion3d.time = 0;
  cancelAnimationFrame(state.motion3d.animationFrame);
  renderMotion3d();
}

function currentMotion3dSize() {
  const base = parseSizeText($("motion3dSizeText").value);
  return { width: align8(base.width), height: align8(base.height) };
}

async function uploadMotion3dReference(file) {
  if (!file) return;
  $("motion3dRefStatus").textContent = "Uploading...";
  const data = await readFileAsDataUrl(file);
  const uploaded = await api("/api/upload-image", {
    method: "POST",
    body: JSON.stringify({ name: file.name, data }),
  });
  state.motion3d.refPath = uploaded.path;
  $("motion3dRefStatus").textContent = uploaded.name;
  $("motion3dGenerate").disabled = false;
  $("motion3dStatus").textContent = "Reference image ready.";
}

function recordMotion3dGuide() {
  return new Promise((resolve, reject) => {
    const canvas = $("motion3dCanvas");
    if (!canvas?.captureStream || typeof MediaRecorder === "undefined") {
      reject(new Error("Browser recording is unavailable"));
      return;
    }
    const stream = canvas.captureStream(24);
    const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm" });
    const chunks = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
    recorder.onerror = () => reject(new Error("Motion guide recording failed"));
    const previousPlaying = state.motion3d.playing;
    state.motion3d.playing = true;
    state.motion3d.time = 0;
    state.motion3d.lastTick = 0;
    recorder.start();
    state.motion3d.animationFrame = requestAnimationFrame(tickMotion3d);
    window.setTimeout(() => {
      state.motion3d.playing = previousPlaying;
      cancelAnimationFrame(state.motion3d.animationFrame);
      recorder.stop();
      renderMotion3d();
    }, Math.min(12000, motion3dTotalDuration() * 1000));
  });
}

async function generateMotion3dScail() {
  if (!state.motion3d.refPath || state.motion3d.generating) return;
  state.motion3d.generating = true;
  $("motion3dGenerate").disabled = true;
  $("motion3dStatus").textContent = "Recording motion guide...";
  try {
    const blob = await recordMotion3dGuide();
    const form = new FormData();
    form.append("file", blob, `motion3d_${Date.now()}.webm`);
    $("motion3dStatus").textContent = "Uploading guide video...";
    const uploaded = await uploadFile("/api/upload-video", form);
    state.motion3d.guideUrl = mediaUrl(uploaded.path);
    const size = currentMotion3dSize();
    const payload = {
      prompt: "3D motion guide driving video",
      reference_path: state.motion3d.refPath,
      guide_video_path: uploaded.path,
      guide_trim_start: 0,
      guide_trim_end: motion3dTotalDuration(),
      width: size.width,
      height: size.height,
      steps: Math.max(1, Number($("motion3dSteps").value) || 8),
      seed: $("motion3dSeed").value.trim(),
      pose_strength: Math.max(0, Math.min(1, Number($("motion3dPoseStrength").value) || 1)),
      use_pose_video_mask: $("motionUsePoseMask").checked,
      motion_type: "3d",
    };
    $("motion3dStatus").textContent = "Submitting SCAIL2 job...";
    const batch = await api("/api/text-to-motion-video-final", { method: "POST", body: JSON.stringify(payload) });
    state.motionBatch = batch;
    renderMotionBatch(batch);
    if (state.clockTimer) clearInterval(state.clockTimer);
    state.clockTimer = setInterval(updateElapsed, 1000);
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(pollMotion, 1500);
    $("motion3dStatus").textContent = "SCAIL2 job queued.";
  } catch (err) {
    $("motion3dStatus").textContent = err.message;
  } finally {
    state.motion3d.generating = false;
    $("motion3dGenerate").disabled = !state.motion3d.refPath;
  }
}

function savedFrameSeconds(value, fallback = 0) {
  const frame = Number(value);
  return Number.isFinite(frame) ? frame / 24 : fallback;
}

function isVideoMediaPath(path) {
  return /\.(mp4|webm|mkv|avi|mov|m4v|flv|wmv)$/i.test(String(path || ""));
}

function isDirectorVideoAudioTimelineSegment(segment = {}) {
  const source = String(segment.source || "").toLowerCase();
  const id = String(segment.id || "");
  const audioPath = segment.audio_path || segment.file || "";
  return source === "video" || id.startsWith("video_audio") || isVideoMediaPath(audioPath);
}

function restoredDirectorAudioSegment(segment, index, prefix) {
  const duration = Math.max(0.5, Number(segment.duration) || Number(segment.length || 0) / 24 || 1);
  const start = Number.isFinite(Number(segment.start_frame))
    ? savedFrameSeconds(segment.start_frame)
    : Number.isFinite(Number(segment.start))
      ? savedFrameSeconds(segment.start)
      : 0;
  const audioPath = segment.audio_path || segment.file || "";
  return {
    id: segment.id || `${prefix}_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    start,
    duration,
    audioPath,
    audioName: segment.fileName || fileNameFromPath(audioPath),
    audioDuration: Number(segment.audio_duration || segment.audioDuration || 0) || duration,
    trimStart: savedFrameSeconds(segment.trim_start ?? segment.trimStart, 0),
    volume: Math.max(0, Number(segment.volume ?? 1)),
  };
}

function useRunTimeline(run) {
  const timeline = run.director_timeline || null;
  if (!timeline || !Array.isArray(timeline.segments) || !timeline.segments.length) {
    $("runHint").textContent = "No director timeline saved on this result";
    return;
  }
  setWorkspace("director");
  $("directorGlobalPrompt").value = timeline.global_prompt || run.global_prompt || "";
  if (run.negative_prompt) setInputValueIfPresent("directorNegativePrompt", run.negative_prompt);
  state.directorGlobalPromptInitialized = true;
  if (run.seed) useRunSeed(run.seed);
  const refs = Array.isArray(run.reference_images) ? run.reference_images.filter(Boolean) : [];
  state.referencePaths = refs.length ? refs : [""];
  state.referenceNames = state.referencePaths.map(fileNameFromPath);
  state.referencePreviewUrls = state.referencePaths.map((path) => (path ? mediaUrl(path) : ""));
  state.referenceMeta = state.referencePaths.map((_, index) => ({ type: index === 0 ? "character" : "prop", subject: index === 0 ? "person_a" : "shared" }));
  clearIngredientsSheet();
  const rawAudioSegments = timeline.audio_segments || timeline.audioSegments || [];
  const restoredVideoAudioPaths = new Set(
    rawAudioSegments
      .filter(isDirectorVideoAudioTimelineSegment)
      .map((segment) => segment.audio_path || segment.file || "")
      .filter(Boolean)
  );
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
    const videoPath = segment.video_path || "";
    const videoPosterPath = segment.poster_path || segment.video_poster_path || segment.videoPosterPath || "";
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
      videoPath,
      videoName: fileNameFromPath(videoPath),
      videoPreviewUrl: videoPath ? mediaUrl(videoPath) : "",
      videoPosterUrl: videoPosterPath ? mediaUrl(videoPosterPath) : "",
      audioExtracted: Boolean(videoPath && restoredVideoAudioPaths.has(videoPath)),
      strength: segment.strength ?? (index === 0 ? 1 : 0.85),
    };
  });
  state.directorVideoAudioSegments = rawAudioSegments
    .filter(isDirectorVideoAudioTimelineSegment)
    .map((segment, index) => restoredDirectorAudioSegment(segment, index, "video_audio"));
  state.directorAudioSegments = rawAudioSegments
    .filter((segment) => !isDirectorVideoAudioTimelineSegment(segment))
    .map((segment, index) => restoredDirectorAudioSegment(segment, index, "aud"));
  state.directorIcVideoSegments = (timeline.motion_segments || timeline.motionSegments || []).map((segment, index) => {
    const duration = Math.max(0.5, Number(segment.duration) || Number(segment.length || 0) / 24 || 2);
    const start = Number.isFinite(Number(segment.start_frame))
      ? savedFrameSeconds(segment.start_frame)
      : Number.isFinite(Number(segment.start))
        ? savedFrameSeconds(segment.start)
        : 0;
    const videoPath = segment.video_path || segment.videoFile || segment.file || "";
    const videoPosterPath = segment.poster_path || segment.video_poster_path || segment.videoPosterPath || "";
    return {
      id: segment.id || `ic_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
      start,
      duration,
      trimStart: savedFrameSeconds(segment.trim_start ?? segment.trimStart, 0),
      videoPath,
      videoName: segment.fileName || fileNameFromPath(videoPath),
      videoPreviewUrl: videoPath ? mediaUrl(videoPath) : "",
      videoPosterUrl: videoPosterPath ? mediaUrl(videoPosterPath) : "",
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
  const previewIds = [slot.previewId, ...(slot.extraPreviewIds || [])].filter(Boolean);
  for (const previewId of previewIds) {
    const preview = $(previewId);
    if (!preview) continue;
    const previewBox = preview.parentElement;
    if (src) {
      preview.src = src;
      previewBox.classList.add("has-image");
    } else {
      preview.removeAttribute("src");
      previewBox.classList.remove("has-image");
    }
  }
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

function runHasPreviewOutput(run) {
  return Boolean(run && (run.video || run.image || run.contact_sheet));
}

function resultPlaybackIsActive() {
  if ($("videoPreviewModal")?.classList.contains("open")) return true;
  return Array.from(document.querySelectorAll(".result-card video")).some((video) => {
    return !video.paused && !video.ended && Number(video.readyState || 0) > 0;
  });
}

function doneBatchNeedsPreview(batch) {
  if (!batch || batch.status !== "done") return false;
  return (batch.runs || []).some((run) => {
    if (!run || run.error || run.status === "canceled") return false;
    if (!["done", "running_video"].includes(run.status)) return false;
    return !runHasPreviewOutput(run);
  });
}

function shouldPollForLatePreview(batch, waits, limit = 8) {
  if (!doneBatchNeedsPreview(batch)) return false;
  const key = batch.batch_id || "active";
  const count = waits[key] || 0;
  if (count >= limit) return false;
  waits[key] = count + 1;
  return true;
}

async function pollBatch() {
  if (!state.activeBatch) return;
  if (resultPlaybackIsActive()) {
    state.pollTimer = setTimeout(pollBatch, 2000);
    return;
  }
  try {
    const batch = await api(`/api/batches/${state.activeBatch.batch_id}`);
    renderBatch(batch);
    if (!["done", "error"].includes(batch.status) || shouldPollForLatePreview(batch, state.batchPreviewWaits)) {
      state.pollTimer = setTimeout(pollBatch, batch.status === "done" ? 1000 : 5000);
    } else {
      await loadHistory({ replace: false });
    }
  } catch (err) {
    $("runHint").textContent = err.message;
    state.pollTimer = setTimeout(pollBatch, 5000);
  }
}

async function loadHistory({ replace = true } = {}) {
  if (!replace && resultPlaybackIsActive()) return;
  const data = await api("/api/history?limit=200");
  if (replace) {
    state.historyRuns = data.runs || [];
  } else {
    mergeHistoryRuns(data.runs || [], false);
  }
  renderScopedHistory();
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
    renderScopedHistory();
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

function inpaintCanvasHasPaint() {
  return !!state.inpaintMaskPainted;
}

function exportInpaintMaskDataUrl() {
  const canvas = $("inpaintMaskCanvas");
  if (!canvas || !canvas.width || !canvas.height) throw new Error("Mask canvas is not ready");
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  return out.toDataURL("image/png");
}

async function prepareInpaintMaskForRun() {
  if (!state.inpaintSourceVideoPath) throw new Error("Upload a source video first");
  if (!inpaintCanvasHasPaint()) throw new Error("Paint the area to replace first");
  const data = exportInpaintMaskDataUrl();
  const uploaded = await api("/api/upload-image", {
    method: "POST",
    body: JSON.stringify({ name: "inpaint_mask.png", data }),
  });
  state.inpaintMaskImagePath = uploaded.path;
  $("inpaintMaskStatus").textContent = "Mask ready";
}

function validateDirectorRunMode() {
  if (state.workspace !== "director" || !isDirectorWorkflow(currentDirectorWorkflow())) return;
  const retakeVideo = normalizedDirectorRetakeVideo();
  if (state.directorMode === "retake" && !retakeVideo) {
    throw new Error("Add a retake base video before queueing Director Retake.");
  }
}

async function startBatch() {
  $("runBtn").disabled = true;
  $("runBtn").textContent = "Queueing...";
  try {
    validateDirectorRunMode();
    if (isInpaintWorkflow(state.workspace === "edit" ? currentEditWorkflow() : currentWorkflow())) {
      await prepareInpaintMaskForRun();
    }
    if (state.workspace === "director") {
      await prepareDirectorIngredientsSheetForRun();
    }
    const payload = collectPayload();
    if (payload.retake_context?.retake_id) {
      payload.retake_context = retakeContextForQueue(payload.retake_context);
    }
    const batch = await api("/api/run", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.batchPreviewWaits[batch.batch_id] = 0;
    renderBatch(batch);
    if (payload.retake_context?.retake_id) {
      const context = { ...state.editRetakeContext, ...payload.retake_context };
      state.directorRetakeStitches[context.retake_id] = context;
      const pendingRun = pendingRetakeStitchRun(context, "queued");
      if (pendingRun) mergeHistoryRuns([pendingRun], true);
      setWorkspace("director");
      setDirectorMode("retake");
      renderScopedHistory();
      $("runHint").textContent = `${context.retake_id} queued in ${context.target_label || context.target_workflow}; waiting to stitch`;
    }
    if (state.clockTimer) clearInterval(state.clockTimer);
    state.clockTimer = setInterval(updateElapsed, 1000);
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(pollBatch, 1500);
  } catch (err) {
    $("runHint").textContent = err.message;
  } finally {
    $("runBtn").disabled = false;
    updateRunButtonLabel({ force: true });
  }
}

function motionPayload(seedInputId = "motionSeed") {
  const size = currentMotionSize();
  const duration = Number($("motionDuration").value);
  const steps = Number($("motionSteps").value);
  const poseStrength = Number($("motionPoseStrength").value);
  const cfgScale = Number($("motionCfg").value);
  return {
    prompt: currentMotionPrompt(),
    reference_path: state.motionRefPath,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 4,
    width: size.width,
    height: size.height,
    steps: Number.isFinite(steps) && steps > 0 ? steps : 8,
    seed: $(seedInputId).value.trim(),
    rewrite: $("motionRewrite").checked,
    pose_strength: Number.isFinite(poseStrength) ? poseStrength : 1,
    use_pose_video_mask: $("motionUsePoseMask").checked,
    cfg_scale: Number.isFinite(cfgScale) ? cfgScale : 5,
  };
}

function roundMotionTime(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(Math.max(0, number) * 100) / 100 : 0;
}

function motionGuideDurationFallback() {
  const videoDuration = Number($("motionGuide").duration);
  if (Number.isFinite(videoDuration) && videoDuration > 0) return videoDuration;
  const inputDuration = Number($("motionDuration").value);
  if (Number.isFinite(inputDuration) && inputDuration > 0) return inputDuration;
  return state.motionGuideDuration || 4;
}

function videoClipperDurationFallback() {
  const duration = Number($("videoClipperPlayer").duration);
  if (Number.isFinite(duration) && duration > 0) return duration;
  return state.videoClipper.duration || 1;
}

function setVideoClipperBounds(duration, reset = false) {
  const max = Math.max(0.05, roundMotionTime(duration || videoClipperDurationFallback()));
  state.videoClipper.duration = max;
  for (const id of ["videoClipperStart", "videoClipperEnd", "videoClipperStartRange", "videoClipperEndRange"]) {
    $(id).max = String(max);
  }
  if (reset || Number($("videoClipperEnd").value) <= 0) {
    $("videoClipperStart").value = "0";
    $("videoClipperStartRange").value = "0";
    $("videoClipperEnd").value = String(max);
    $("videoClipperEndRange").value = String(max);
  }
  updateVideoClipperDisplay();
}

function videoClipperValues(sourceId = "") {
  const max = videoClipperDurationFallback();
  let start = roundMotionTime($("videoClipperStart").value);
  let end = roundMotionTime($("videoClipperEnd").value);
  const startChanged = sourceId === "videoClipperStart" || sourceId === "videoClipperStartRange";
  const endChanged = sourceId === "videoClipperEnd" || sourceId === "videoClipperEndRange";
  start = Math.max(0, Math.min(start, Math.max(0, max - 0.05)));
  end = Math.max(0.05, Math.min(end || max, max));
  if (start >= end) {
    if (startChanged) end = Math.min(max, start + 0.05);
    else if (endChanged) start = Math.max(0, end - 0.05);
    else end = Math.min(max, start + 0.05);
  }
  return { start, end, duration: Math.max(0.05, roundMotionTime(end - start)) };
}

function updateVideoClipperDisplay(sourceId = "") {
  const { start, end, duration } = videoClipperValues(sourceId);
  $("videoClipperStart").value = String(start);
  $("videoClipperEnd").value = String(end);
  $("videoClipperStartRange").value = String(start);
  $("videoClipperEndRange").value = String(end);
  $("videoClipperStartReadout").textContent = `${start.toFixed(2)}s`;
  $("videoClipperEndReadout").textContent = `${end.toFixed(2)}s`;
  $("videoClipperDurationReadout").textContent = `${duration.toFixed(2)}s`;
}

function renderVideoClipperPlaceholders() {
  const filmstrip = $("videoClipperFilmstrip");
  filmstrip.innerHTML = "";
  for (let i = 0; i < 8; i += 1) {
    const placeholder = document.createElement("div");
    placeholder.className = "clipper-frame-placeholder";
    filmstrip.appendChild(placeholder);
  }
}

function resetVideoClipperLayout() {
  const preview = document.querySelector(".video-clipper-preview");
  if (!preview) return;
  preview.style.removeProperty("--video-clipper-preview-width");
  preview.style.removeProperty("--video-clipper-preview-height");
}

function videoClipperAspectRatio() {
  const video = $("videoClipperPlayer");
  const width = Number(video.videoWidth);
  const height = Number(video.videoHeight);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return width / height;
  }
  return 16 / 9;
}

function updateVideoClipperLayout() {
  const modal = $("videoClipperModal");
  if (!modal?.classList.contains("open")) return;
  const preview = document.querySelector(".video-clipper-preview");
  const grid = document.querySelector(".video-clipper-grid");
  if (!preview || !grid) return;

  const compact = window.matchMedia("(max-width: 620px), (max-height: 620px)").matches;
  const maxHeight = compact
    ? Math.min(170, Math.max(120, window.innerHeight * 0.30))
    : Math.min(360, Math.max(150, window.innerHeight * 0.36));
  const firstColumn = parseFloat(getComputedStyle(grid).gridTemplateColumns.split(" ")[0]);
  const maxWidth = Number.isFinite(firstColumn) && firstColumn > 0
    ? firstColumn
    : grid.getBoundingClientRect().width;
  const aspect = Math.max(0.1, Math.min(8, videoClipperAspectRatio()));
  let width = maxWidth;
  let height = width / aspect;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspect;
  }
  preview.style.setProperty("--video-clipper-preview-width", `${Math.max(80, Math.floor(width))}px`);
  preview.style.setProperty("--video-clipper-preview-height", `${Math.max(80, Math.floor(height))}px`);
}

function openVideoClipper(slotKey) {
  const slot = videoSlots[slotKey];
  const path = slot ? state[slot.pathKey] : "";
  if (!slot || !path) return;
  state.videoClipper.slot = slotKey;
  state.videoClipper.path = path;
  state.videoClipper.name = state[slot.nameKey] || fileNameFromPath(path);
  state.videoClipper.duration = 0;
  $("videoClipperTitle").textContent = slot.title;
  $("videoClipperStatus").textContent = state.videoClipper.name;
  const modal = $("videoClipperModal");
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  resetVideoClipperLayout();
  const video = $("videoClipperPlayer");
  video.src = mediaUrl(path);
  video.load();
  setVideoClipperBounds(1, true);
  requestAnimationFrame(updateVideoClipperLayout);
  renderVideoClipperPlaceholders();
}

function closeVideoClipper() {
  const modal = $("videoClipperModal");
  const video = $("videoClipperPlayer");
  video.pause();
  video.removeAttribute("src");
  video.load();
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
  state.videoClipper.playing = false;
  state.videoClipper.slot = "";
  state.videoClipper.path = "";
  state.videoClipper.name = "";
  $("videoClipperStatus").textContent = "Choose a range.";
  resetVideoClipperLayout();
}

function drawVideoFrameContain(ctx, source, width, height) {
  const sourceWidth = Number(source.videoWidth) || width;
  const sourceHeight = Number(source.videoHeight) || height;
  const sourceAspect = sourceWidth / Math.max(1, sourceHeight);
  const targetAspect = width / Math.max(1, height);
  let drawWidth = width;
  let drawHeight = height;
  if (sourceAspect > targetAspect) {
    drawHeight = width / sourceAspect;
  } else {
    drawWidth = height * sourceAspect;
  }
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  ctx.fillStyle = "#070706";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, x, y, drawWidth, drawHeight);
}

async function renderVideoClipperFilmstrip() {
  if (state.videoClipper.renderingFilmstrip || !state.videoClipper.path) return;
  const duration = videoClipperDurationFallback();
  if (!Number.isFinite(duration) || duration <= 0) return;
  state.videoClipper.renderingFilmstrip = true;
  const filmstrip = $("videoClipperFilmstrip");
  renderVideoClipperPlaceholders();
  const source = document.createElement("video");
  source.muted = true;
  source.playsInline = true;
  source.preload = "auto";
  source.src = mediaUrl(state.videoClipper.path);
  try {
    await new Promise((resolve, reject) => {
      source.addEventListener("loadedmetadata", resolve, { once: true });
      source.addEventListener("error", reject, { once: true });
      source.load();
    });
    filmstrip.innerHTML = "";
    const count = 8;
    for (let i = 0; i < count; i += 1) {
      const time = Math.max(0, Math.min(duration - 0.02, (duration * (i + 0.5)) / count));
      await new Promise((resolve, reject) => {
        source.addEventListener("seeked", resolve, { once: true });
        source.addEventListener("error", reject, { once: true });
        source.currentTime = time;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 180;
      canvas.height = 102;
      const ctx = canvas.getContext("2d");
      drawVideoFrameContain(ctx, source, canvas.width, canvas.height);
      filmstrip.appendChild(canvas);
    }
  } catch (_err) {
    renderVideoClipperPlaceholders();
  } finally {
    state.videoClipper.renderingFilmstrip = false;
  }
}

function playVideoClipperSelection() {
  const video = $("videoClipperPlayer");
  const { start } = videoClipperValues();
  state.videoClipper.playing = true;
  video.currentTime = start;
  const promise = video.play();
  if (promise?.catch) promise.catch(() => {
    state.videoClipper.playing = false;
  });
}

async function saveVideoClipperSelection() {
  const slotKey = state.videoClipper.slot;
  const path = state.videoClipper.path;
  if (!slotKey || !path) return;
  const { start, end, duration } = videoClipperValues();
  $("videoClipperUseBtn").disabled = true;
  $("videoClipperStatus").textContent = "Creating clip...";
  try {
    const clipped = await api("/api/trim-video", {
      method: "POST",
      body: JSON.stringify({ video_path: path, start, end }),
    });
    setVideoSlot(slotKey, clipped.path, clipped.name, { duration: clipped.duration || duration, trimmed: true });
    closeVideoClipper();
  } catch (err) {
    $("videoClipperStatus").textContent = err.message;
  } finally {
    $("videoClipperUseBtn").disabled = false;
  }
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
  updateVideoClipperButtons();
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
    state.motionGuideVideoPath = run.guide_video;
    const guideSrc = mediaUrl(run.guide_video);
    if ($("motionGuide").getAttribute("src") !== guideSrc) {
      $("motionGuide").src = guideSrc;
    }
    $("motionGuideUploadStatus").textContent = fileNameFromPath(run.guide_video);
    state.motionGuideDuration = Number(run.duration) || motionGuideDurationFallback();
    $("motionGuideState").textContent = "ready";
    updateVideoClipperButtons();
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
    if (!["done", "error"].includes(batch.status) || shouldPollForLatePreview(batch, state.motionPreviewWaits)) {
      state.pollTimer = setTimeout(pollMotion, batch.status === "done" ? 1000 : 5000);
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
  const pendingRun = optimisticScailRun(payload, guideVideoPath);
  upsertMotionRuns([pendingRun], true);
  try {
    const endpoint = state.motionBatch && run.guide_video ? "/api/text-to-motion-final" : "/api/text-to-motion-video-final";
    const body = endpoint === "/api/text-to-motion-final"
      ? { ...payload, batch_id: state.motionBatch.batch_id, run_id: run.run_id }
      : { ...payload, guide_video_path: guideVideoPath, motion_type: "scail" };
    const batch = await api(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
    });
    state.motionPreviewWaits[batch.batch_id] = 0;
    removeMotionRunCard(pendingRun);
    renderMotionBatch(batch);
    if (state.clockTimer) clearInterval(state.clockTimer);
    state.clockTimer = setInterval(updateElapsed, 1000);
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = setTimeout(pollMotion, 1500);
  } catch (err) {
    $("motionStatus").textContent = err.message;
    updateRunCard(ensureRunCard(motionResultsGridForRun(pendingRun), pendingRun, true), {
      ...pendingRun,
      status: "error",
      error: err.message,
    });
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
  setVideoSlot("motionGuide", uploaded.path, uploaded.name);
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

function readVideoMetadata(file) {
  return new Promise((resolve) => {
    if (!file) {
      resolve({ duration: 0, width: 0, height: 0 });
      return;
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = "metadata";
    video.muted = true;
    video.addEventListener("loadedmetadata", () => {
      finish({
        duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0,
        width: Number(video.videoWidth) || 0,
        height: Number(video.videoHeight) || 0,
      });
    }, { once: true });
    video.addEventListener("error", () => finish({ duration: 0, width: 0, height: 0 }), { once: true });
    setTimeout(() => finish({ duration: 0, width: 0, height: 0 }), 1500);
    video.src = url;
  });
}

async function readVideoDuration(file) {
  const metadata = await readVideoMetadata(file);
  return metadata.duration || 0;
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

function updateVideoClipperButtons() {
  for (const [key, slot] of Object.entries(videoSlots)) {
    const buttonIds = [slot.editId, ...(slot.extraEditIds || [])].filter(Boolean);
    for (const id of buttonIds) {
      const button = $(id);
      if (!button) continue;
      button.disabled = !state[slot.pathKey];
      button.dataset.videoSlot = key;
    }
  }
}

function updateVideoUploadPreview(slot, path) {
  if (!slot.previewId) return;
  const video = $(slot.previewId);
  const wrap = slot.previewWrapId ? $(slot.previewWrapId) : video?.parentElement;
  if (!video || !wrap) return;
  if (!path) {
    video.pause();
    video.removeAttribute("src");
    video.load();
    wrap.hidden = true;
    return;
  }
  const src = mediaUrl(path);
  if (video.getAttribute("src") !== src) {
    video.src = src;
    video.load();
  }
  wrap.hidden = false;
}

function setVideoSlot(slotKey, path, name, options = {}) {
  const slot = videoSlots[slotKey];
  if (!slot) throw new Error("unknown video slot");
  state[slot.pathKey] = path || "";
  if (slot.nameKey) state[slot.nameKey] = name || "";
  const status = $(slot.statusId);
  if (status) status.textContent = name || (path ? fileNameFromPath(path) : "No video uploaded");
  updateVideoUploadPreview(slot, path);

  if (slotKey === "inpaintSource") {
    state.inpaintMaskImagePath = "";
    const video = $("inpaintMaskVideo");
    if (video && path) {
      video.src = mediaUrl(path);
      video.load();
    }
    if (path) clearInpaintMask();
  }

  if (slotKey === "motionGuide") {
    state.motionBatch = null;
    const video = $("motionGuide");
    if (video && path) {
      video.pause();
      video.src = mediaUrl(path);
      video.load();
    }
    state.motionGuideDuration = Number(options.duration) || Number($("motionDuration").value) || 4;
    $("motionGuideState").textContent = options.trimmed ? "clipped" : "uploaded";
    clearMotionResult();
    $("motionStatus").textContent = options.trimmed ? "Guide video clipped. Ready for SCAIL2." : "Guide video uploaded. Ready for SCAIL2.";
    updateMotionRunAvailability();
  }

  updateVideoClipperButtons();
}

async function uploadVideo(file, slotKey) {
  if (!file) return;
  const slot = videoSlots[slotKey];
  if (!slot) throw new Error("unknown video slot");
  const status = $(slot.statusId);
  status.textContent = "Uploading...";
  const data = await readFileAsDataUrl(file);
  const uploaded = await api("/api/upload-video", {
    method: "POST",
    body: JSON.stringify({ name: file.name, data }),
  });
  setVideoSlot(slotKey, uploaded.path, uploaded.name);
}

function resizeInpaintCanvas() {
  const canvas = $("inpaintMaskCanvas");
  if (!canvas) return;
  const size = currentSize();
  const width = Math.max(8, size.width);
  const height = Math.max(8, size.height);
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
  state.inpaintMaskPainted = false;
  state.inpaintMaskImagePath = "";
  if ($("inpaintMaskStatus")) $("inpaintMaskStatus").textContent = "No mask painted";
}

function inpaintPointerPoint(event) {
  const canvas = $("inpaintMaskCanvas");
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function drawInpaintStroke(from, to) {
  const canvas = $("inpaintMaskCanvas");
  const ctx = canvas.getContext("2d");
  const brush = Math.max(4, Number($("inpaintBrushSize").value) || 48);
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#fff";
  ctx.lineWidth = brush;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(to.x, to.y, brush / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  state.inpaintMaskPainted = true;
  state.inpaintMaskImagePath = "";
  $("inpaintMaskStatus").textContent = "Mask painted";
}

function beginInpaintDraw(event) {
  if (!state.inpaintSourceVideoPath) return;
  event.preventDefault();
  resizeInpaintCanvas();
  const point = inpaintPointerPoint(event);
  state.inpaintDrawing = true;
  state.inpaintLastPoint = point;
  drawInpaintStroke(point, point);
  $("inpaintMaskCanvas").setPointerCapture(event.pointerId);
}

function moveInpaintDraw(event) {
  if (!state.inpaintDrawing || !state.inpaintLastPoint) return;
  event.preventDefault();
  const point = inpaintPointerPoint(event);
  drawInpaintStroke(state.inpaintLastPoint, point);
  state.inpaintLastPoint = point;
}

function endInpaintDraw(event) {
  if (!state.inpaintDrawing) return;
  state.inpaintDrawing = false;
  state.inpaintLastPoint = null;
  try {
    $("inpaintMaskCanvas").releasePointerCapture(event.pointerId);
  } catch (_err) {
    // Pointer capture may already be released by the browser.
  }
}

function clearInpaintMask() {
  const canvas = $("inpaintMaskCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  state.inpaintMaskPainted = false;
  state.inpaintMaskImagePath = "";
  $("inpaintMaskStatus").textContent = "No mask painted";
}

function updateInpaintBrushReadout() {
  if ($("inpaintBrushReadout")) $("inpaintBrushReadout").textContent = `${$("inpaintBrushSize").value}px`;
}

async function uploadInpaintSourceVideo(file) {
  if (!file) return;
  $("inpaintSourceVideoStatus").textContent = "Uploading...";
  const data = await readFileAsDataUrl(file);
  const uploaded = await api("/api/upload-video", {
    method: "POST",
    body: JSON.stringify({ name: file.name, data }),
  });
  setVideoSlot("inpaintSource", uploaded.path, uploaded.name);
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
  scissors: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.6 9.8 19 4.5l.9 1.8-8.2 4.2 8.2 4.2-.9 1.8-10.4-5.3A3.5 3.5 0 1 1 8.6 9.8zM5.5 10A1.5 1.5 0 1 0 5.5 7a1.5 1.5 0 0 0 0 3zm0 7A1.5 1.5 0 1 0 5.5 14a1.5 1.5 0 0 0 0 3zM8.6 14.2l3.1-1.6 1.9 1-5 2.6a3.5 3.5 0 1 1 0-2z"></path></svg>',
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

function fillDirectorIcLoras() {
  const select = $("directorIcLora");
  if (!select) return;
  const options = state.config?.director?.ic_loras?.length ? state.config.director.ic_loras : ["None"];
  const current = select.value || "None";
  select.innerHTML = options
    .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name === "None" ? "No IC-LoRA" : fileNameFromPath(name))}</option>`)
    .join("");
  select.value = options.includes(current) ? current : "None";
}

async function loadConfig() {
  state.config = await api("/api/config");
  fillDirectorIcLoras();
  fillSelect($("workflowSelect"), visibleWorkflowItems(state.config.workflows));
  fillSelect($("moveSelect"), state.config.camera_moves, "name");
  if (state.workspace === "edit") {
    const option = workflowOptionById(state.berniniWorkflowId, "edit") || berniniWorkflowOption() || inpaintWorkflowOption();
    if (option) $("workflowSelect").value = option.value;
  } else if (state.workspace === "director") {
    const option = workflowOptionById(state.directorWorkflowId, "director_ref") || directorWorkflowOption();
    if (option) $("workflowSelect").value = option.value;
  }
  rememberCurrentWorkflow();
  $("negativePrompt").value = state.config.default_negative;
  setInputValueIfPresent("directorNegativePrompt", state.config.default_negative);
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
  if (isBerniniWorkflow()) {
    setWorkspace("edit", { syncWorkflow: false });
    resetPrompt();
    return;
  }
  if (isInpaintWorkflow()) {
    setWorkspace("edit", { syncWorkflow: false });
    resetPrompt();
    return;
  }
  setWorkspace("camera", { syncWorkflow: false });
});
$("cameraWorkspaceTab").addEventListener("click", () => setWorkspace("camera"));
$("directorWorkspaceTab").addEventListener("click", () => setWorkspace("director"));
$("editWorkspaceTab").addEventListener("click", () => {
  setWorkspace("edit");
  resetPrompt();
});
$("castingWorkspaceTab").addEventListener("click", () => { setWorkspace("casting", { syncWorkflow: false }); refreshCastingLibrary(); });
$("motionWorkspaceTab").addEventListener("click", () => setWorkspace("motion", { syncWorkflow: false }));
$("photographyWorkspaceTab").addEventListener("click", () => setWorkspace("photography", { syncWorkflow: false }));
$("motionTextTab").addEventListener("click", () => setMotionSubtab("text"));
$("motionScailTab").addEventListener("click", () => setMotionSubtab("scail"));
$("motion3dTab").addEventListener("click", () => setMotionSubtab("3d"));
document.querySelectorAll(".bernini-mode-tab").forEach((button) => {
  button.addEventListener("click", () => setBerniniWorkflow(button.dataset.berniniWorkflow));
});
document.querySelectorAll(".inpaint-mode-tab").forEach((button) => {
  button.addEventListener("click", () => setInpaintWorkflow());
});
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
  updateVideoClipperButtons();
  updateMotionRunAvailability();
}));
$("addDirectorIcVideoBtn").addEventListener("click", () => $("directorIcVideoInput").click());
$("directorIcVideoInput").addEventListener("change", () => uploadDirectorIcVideo($("directorIcVideoInput").files[0]).catch((err) => {
  $("runHint").textContent = `IC video upload failed: ${err.message}`;
}).finally(() => {
  $("directorIcVideoInput").value = "";
}));
$("directorModeGenerateBtn").addEventListener("click", () => setDirectorMode("generate"));
$("directorModeRetakeBtn").addEventListener("click", () => setDirectorMode("retake"));
$("addDirectorRetakeVideoBtn").addEventListener("click", () => $("directorRetakeVideoInput").click());
$("directorRetakeVideoInput").addEventListener("change", () => uploadDirectorRetakeVideo($("directorRetakeVideoInput").files[0]).catch((err) => {
  $("runHint").textContent = `Retake video upload failed: ${err.message}`;
}).finally(() => {
  $("directorRetakeVideoInput").value = "";
}));
$("directorRetakeSetStartBtn").addEventListener("click", setDirectorRetakeStartAtPlayhead);
$("directorRetakeSetEndBtn").addEventListener("click", setDirectorRetakeEndAtPlayhead);
$("directorRetakePrompt").addEventListener("input", (event) => {
  state.directorRetakePrompt = event.target.value;
});
$("directorRetakeStrength").addEventListener("input", (event) => {
  state.directorRetakeStrength = Math.max(0, Math.min(1, Number(event.target.value) || 0));
});
$("directorRetakeAutoStitch")?.addEventListener("change", (event) => {
  state.directorRetakeAutoStitch = Boolean(event.target.checked);
  if (!state.directorRetakeAutoStitch) state.directorRetakePendingStitch = null;
});
$("motionGuide").addEventListener("loadedmetadata", () => {
  state.motionGuideDuration = $("motionGuide").duration || motionGuideDurationFallback();
});
for (const [slotKey, slot] of Object.entries(videoSlots)) {
  const buttonIds = [slot.editId, ...(slot.extraEditIds || [])].filter(Boolean);
  for (const id of buttonIds) {
    const button = $(id);
    if (button) button.addEventListener("click", () => openVideoClipper(slotKey));
  }
}
for (const id of ["videoClipperStart", "videoClipperEnd", "videoClipperStartRange", "videoClipperEndRange"]) {
  $(id).addEventListener("input", () => {
    if (id === "videoClipperStartRange") $("videoClipperStart").value = $("videoClipperStartRange").value;
    if (id === "videoClipperEndRange") $("videoClipperEnd").value = $("videoClipperEndRange").value;
    updateVideoClipperDisplay(id);
  });
}
$("videoClipperPlayer").addEventListener("loadedmetadata", () => {
  setVideoClipperBounds($("videoClipperPlayer").duration || 1, true);
  updateVideoClipperLayout();
  renderVideoClipperFilmstrip();
});
$("videoClipperPlayer").addEventListener("timeupdate", () => {
  if (!state.videoClipper.playing) return;
  const { end } = videoClipperValues();
  if ($("videoClipperPlayer").currentTime >= end) {
    $("videoClipperPlayer").pause();
    state.videoClipper.playing = false;
  }
});
$("videoClipperPlayer").addEventListener("pause", () => {
  state.videoClipper.playing = false;
});
$("videoClipperPlayBtn").addEventListener("click", playVideoClipperSelection);
$("videoClipperUseBtn").addEventListener("click", () => saveVideoClipperSelection());
$("videoClipperCancelBtn").addEventListener("click", closeVideoClipper);
$("closeVideoClipperBtn").addEventListener("click", closeVideoClipper);
$("videoClipperModal").addEventListener("click", (event) => {
  if (event.target.matches("[data-close-video-clipper]")) closeVideoClipper();
});
$("berniniReferenceImageInput").addEventListener("change", () => uploadImage($("berniniReferenceImageInput").files[0], "berniniReference").catch((err) => {
  state.berniniReferenceImagePath = "";
  $("berniniReferenceImageStatus").textContent = err.message;
}));
$("berniniSourceVideoInput").addEventListener("change", () => uploadVideo($("berniniSourceVideoInput").files[0], "berniniSource").catch((err) => {
  state.berniniSourceVideoPath = "";
  $("berniniSourceVideoStatus").textContent = err.message;
  updateVideoClipperButtons();
}));
$("berniniReferenceVideoInput").addEventListener("change", () => uploadVideo($("berniniReferenceVideoInput").files[0], "berniniReference").catch((err) => {
  state.berniniReferenceVideoPath = "";
  $("berniniReferenceVideoStatus").textContent = err.message;
  updateVideoClipperButtons();
}));
$("inpaintSourceVideoInput").addEventListener("change", () => uploadInpaintSourceVideo($("inpaintSourceVideoInput").files[0]).catch((err) => {
  state.inpaintSourceVideoPath = "";
  $("inpaintSourceVideoStatus").textContent = err.message;
  updateVideoClipperButtons();
}));
$("inpaintReferenceImageInput").addEventListener("change", () => uploadImage($("inpaintReferenceImageInput").files[0], "inpaintReference").catch((err) => {
  state.inpaintReferenceImagePath = "";
  $("inpaintReferenceImageStatus").textContent = err.message;
}));
$("inpaintMaskVideo").addEventListener("loadedmetadata", resizeInpaintCanvas);
$("inpaintMaskCanvas").addEventListener("pointerdown", beginInpaintDraw);
$("inpaintMaskCanvas").addEventListener("pointermove", moveInpaintDraw);
$("inpaintMaskCanvas").addEventListener("pointerup", endInpaintDraw);
$("inpaintMaskCanvas").addEventListener("pointercancel", endInpaintDraw);
$("inpaintMaskCanvas").addEventListener("pointerleave", endInpaintDraw);
$("inpaintClearMaskBtn").addEventListener("click", clearInpaintMask);
$("inpaintBrushSize").addEventListener("input", updateInpaintBrushReadout);
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
  if (!hasMotionGuideVideo()) state.motionGuideDuration = Number($("motionDuration").value) || 4;
});
$("motionPrompt").addEventListener("input", () => syncMotionPrompt("motionPrompt"));
$("motionScailPrompt").addEventListener("input", () => syncMotionPrompt("motionScailPrompt"));
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
$("directorCutAtPlayheadBtn").innerHTML = ACTION_ICONS.scissors;
$("directorCutAtPlayheadBtn").addEventListener("click", (event) => {
  event.stopPropagation();
  splitSelectedDirectorSegmentAtPlayhead();
});
$("addDirectorAudioBtn").addEventListener("click", () => openDirectorAudioModal("dialogue"));
$("addDirectorVideoAudioBtn").addEventListener("click", () => openDirectorAudioModal("video_audio"));
$("openStoryboardImportBtn").addEventListener("click", openStoryboardImportModal);
$("closeDirectorSegmentModalBtn").addEventListener("click", closeDirectorSegmentModal);
$("directorSegmentModal").addEventListener("click", (event) => {
  if (event.target.matches("[data-close-director-segment-modal]")) closeDirectorSegmentModal();
});
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
$("closeFrameExtractBtn").addEventListener("click", closeFrameExtract);
$("frameExtractModal").addEventListener("click", (event) => {
  if (event.target.matches("[data-close-frame-extract]")) closeFrameExtract();
});
$("frameExtractTime").addEventListener("input", () => syncFrameExtractTime($("frameExtractTime").value));
$("frameExtractPlayer").addEventListener("timeupdate", () => {
  if ($("frameExtractPlayer").seeking) return;
  const time = $("frameExtractPlayer").currentTime || 0;
  $("frameExtractTime").value = String(time);
  updateFrameExtractReadout(time);
});
$("saveFrameExtractBtn").addEventListener("click", saveFrameExtract);
document.addEventListener("mousedown", maybeStartDirectorRetakeSelectionDrag, true);
window.addEventListener("resize", () => {
  updateVideoPreviewLayout();
  updateVideoClipperLayout();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("videoPreviewModal").classList.contains("open")) closeVideoPreview();
  if (event.key === "Escape" && $("frameExtractModal").classList.contains("open")) closeFrameExtract();
  if (event.key === "Escape" && $("videoClipperModal").classList.contains("open")) closeVideoClipper();
  handleDirectorTimelineDeleteKey(event);
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
$("globalAddRefBtn")?.addEventListener("click", addReferenceSlot);
renderReferenceSlots();
updateVideoClipperButtons();
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
