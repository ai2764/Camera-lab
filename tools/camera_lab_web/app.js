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

function currentSize() {
  const [baseWidth, baseHeight] = $("sizePreset").value.split("x").map(Number);
  const scale = Number($("sizeScale").value) / 100;
  return {
    width: align8(baseWidth * scale),
    height: align8(baseHeight * scale),
    scale: Math.round(scale * 100),
  };
}

function align8(value) {
  return Math.max(64, Math.round(value / 8) * 8);
}

function updateSizeReadout() {
  const size = currentSize();
  $("sizeReadout").textContent = `${size.width}x${size.height} / ${size.scale}%`;
  $("sourcePreview").parentElement.style.aspectRatio = `${size.width} / ${size.height}`;
  $("middlePreview").parentElement.style.aspectRatio = `${size.width} / ${size.height}`;
  $("endPreview").parentElement.style.aspectRatio = `${size.width} / ${size.height}`;
}

function resetPrompt() {
  const move = currentMove();
  const workflow = currentWorkflow();
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
  const showMiddleImage = wf.mode === "fml" || wf.mode === "fml_native";
  const showEndImage = wf.mode === "flf" || wf.mode === "fml" || wf.mode === "fml_native";
  $("middleImageWrap").style.display = showMiddleImage ? "block" : "none";
  $("middlePreviewWrap").style.display = showMiddleImage ? "block" : "none";
  $("endImageWrap").style.display = showEndImage ? "block" : "none";
  $("endPreviewWrap").style.display = showEndImage ? "block" : "none";
  $("swapSourceEndWrap").style.display = wf.mode === "flf" ? "block" : "none";
  $("swapSourceMiddleWrap").style.display = showMiddleImage ? "block" : "none";
  $("swapMiddleEndWrap").style.display = showMiddleImage ? "block" : "none";
  $("audioUploadWrap").style.display = wf.mode === "ia2v" ? "block" : "none";
  $("promptTag").textContent = wf.mode.toUpperCase();
}

function collectPayload() {
  const size = currentSize();
  const prompt = $("promptText").value.trim();

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

function mediaUrl(path) {
  return `/media?path=${encodeURIComponent(path)}`;
}

function renderBatch(batch) {
  state.activeBatch = batch;
  updateElapsed();
  upsertRuns(batch.runs || [], true);
}

function upsertRuns(runs, newestFirst = false) {
  const grid = $("resultsGrid");
  const tpl = $("resultTemplate");
  for (const run of runs) {
    if (state.hiddenRunKeys.has(runKey(run))) continue;
    let card = grid.querySelector(`.result-card[data-run-key="${cssEscape(runKey(run))}"]`);
    if (!card) {
      const node = tpl.content.cloneNode(true);
      card = node.querySelector(".result-card");
      card.dataset.runKey = runKey(run);
      card.querySelector(".use-prompt-run").addEventListener("click", () => {
        useRunPrompt(card.dataset.prompt || "");
      });
      card.querySelector(".use-seed-run").addEventListener("click", () => {
        useRunSeed(card.dataset.seed);
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

function runKey(run) {
  return run.history_key || `${run.batch_id}:${run.run_id}`;
}

function cssEscape(value) {
  if (window.CSS && CSS.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function updateRunCard(card, run) {
  card.dataset.pinned = run.pinned ? "true" : "false";
  card.dataset.seed = run.seed || "";
  card.dataset.prompt = run.prompt || "";
  card.classList.toggle("pinned", Boolean(run.pinned));
  const mode = runModeLabel(run);
  const modeTag = card.querySelector(".mode-tag");
  modeTag.textContent = mode;
  modeTag.title = run.workflow_label || run.workflow_id || mode;
  card.querySelector(".run-status").textContent = `${run.status} ${elapsedText(run)}`;
  card.querySelector(".use-prompt-run").disabled = !run.prompt;
  card.querySelector(".use-seed-run").disabled = !run.seed;
  const pinButton = card.querySelector(".pin-run");
  pinButton.textContent = run.pinned ? "Unpin" : "Pin";
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
}

function runModeLabel(run) {
  const raw = String(run.workflow_mode || run.workflow_id || "").toLowerCase();
  if (raw.includes("ia2v")) return "IA2V";
  if (raw.includes("fml") || raw.includes("fmf")) return "FML";
  if (raw.includes("flf")) return "FLF";
  if (raw.includes("i2v")) return "I2V";
  return "GEN";
}

function useRunSeed(seed) {
  if (!seed) return;
  $("seedInput").value = seed;
  $("runHint").textContent = `Seed set to ${seed}`;
}

function useRunPrompt(prompt) {
  if (!prompt) return;
  $("promptText").value = prompt;
  $("runHint").textContent = "Prompt copied from result";
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
    const card = document.querySelector(`.result-card[data-run-key="${cssEscape(runKey(run))}"]`);
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
  if (replace) $("resultsGrid").innerHTML = "";
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
    const card = document.querySelector(`.result-card[data-run-key="${cssEscape(key)}"]`);
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
  updateWorkflowFields();
  resetPrompt();
});
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
$("sizePreset").addEventListener("change", updateSizeReadout);
$("sizeScale").addEventListener("input", updateSizeReadout);
$("resetPromptsBtn").addEventListener("click", resetPrompt);
$("refreshBtn").addEventListener("click", loadConfig);
$("runBtn").addEventListener("click", startBatch);
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
