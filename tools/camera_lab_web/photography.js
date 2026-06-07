import * as THREE from "/vendor/yedp/three.module.js";
import { OrbitControls } from "/vendor/yedp/OrbitControls.js";
import { TransformControls } from "/vendor/yedp/TransformControls.js";

const el = (id) => document.getElementById(id);

const app = {
  renderer: null,
  scene: null,
  camera: null,
  orbit: null,
  transform: null,
  actor: null,
  room: null,
  selected: null,
  playing: false,
  playStartedAt: 0,
  cannySheetUrl: "",
  subjectReference: null,
  keyframes: [],
  selectedKeyframeId: null,
  nextKeyframeId: 1,
};

function copyShotState() {
  return {
    cameraPosition: app.camera.position.toArray(),
    cameraRotation: [app.camera.rotation.x, app.camera.rotation.y, app.camera.rotation.z],
    target: app.orbit.target.toArray(),
    fov: app.camera.fov,
  };
}

function applyShotState(state) {
  app.camera.position.fromArray(state.cameraPosition);
  app.camera.rotation.set(...state.cameraRotation);
  app.orbit.target.fromArray(state.target);
  app.camera.fov = state.fov || 45;
  app.camera.updateProjectionMatrix();
  app.orbit.update();
}

function lerpArray(a, b, t) {
  return a.map((value, index) => value + (b[index] - value) * t);
}

function easeValue(t, easing) {
  if (easing === "linear") return t;
  if (easing === "easeIn") return t * t;
  if (easing === "easeOut") return 1 - ((1 - t) * (1 - t));
  if (easing === "hold") return 0;
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
}

function totalFrames() {
  return Math.max(2, Number(el("photoFramesInput").value) || 49);
}

function sortedKeyframes() {
  return [...app.keyframes].sort((a, b) => a.frame - b.frame || a.id - b.id);
}

function currentFrame() {
  return Number(el("photoFrameSlider").value) || 0;
}

function setKeyframe(frame, state = copyShotState(), easing = "easeInOut") {
  const clamped = Math.max(0, Math.min(totalFrames() - 1, Number(frame) || 0));
  const existing = app.keyframes.find((keyframe) => keyframe.frame === clamped);
  if (existing) {
    existing.state = state;
    selectKeyframe(existing.id);
    return existing;
  }
  const keyframe = {
    id: app.nextKeyframeId,
    frame: clamped,
    easing,
    state,
  };
  app.nextKeyframeId += 1;
  app.keyframes.push(keyframe);
  selectKeyframe(keyframe.id);
  return keyframe;
}

function selectedKeyframe() {
  return app.keyframes.find((keyframe) => keyframe.id === app.selectedKeyframeId) || null;
}

function selectKeyframe(id) {
  app.selectedKeyframeId = id;
  const keyframe = selectedKeyframe();
  if (keyframe) {
    el("photoEaseSelect").value = keyframe.easing || "easeInOut";
  }
  renderKeyframeUI();
}

function applyInterpolatedFrame(frame) {
  const keyframes = sortedKeyframes();
  if (!keyframes.length) return;
  if (keyframes.length === 1 || frame <= keyframes[0].frame) {
    applyShotState(keyframes[0].state);
    return;
  }
  const last = keyframes[keyframes.length - 1];
  if (frame >= last.frame) {
    applyShotState(last.state);
    return;
  }
  let start = keyframes[0];
  let end = last;
  for (let index = 0; index < keyframes.length - 1; index += 1) {
    if (frame >= keyframes[index].frame && frame <= keyframes[index + 1].frame) {
      start = keyframes[index];
      end = keyframes[index + 1];
      break;
    }
  }
  const rawT = (frame - start.frame) / Math.max(1, end.frame - start.frame);
  const t = easeValue(rawT, start.easing);
  app.camera.position.fromArray(lerpArray(start.state.cameraPosition, end.state.cameraPosition, t));
  app.camera.rotation.set(...lerpArray(start.state.cameraRotation, end.state.cameraRotation, t));
  app.orbit.target.fromArray(lerpArray(start.state.target, end.state.target, t));
  app.camera.fov = start.state.fov + ((end.state.fov - start.state.fov) * t);
  app.camera.updateProjectionMatrix();
  app.orbit.update();
}

function makeActor() {
  const group = new THREE.Group();
  group.name = "Actor";
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xd7b46a, roughness: 0.6 });
  const headMaterial = new THREE.MeshStandardMaterial({ color: 0xf0ebe1, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.0, 0.32), bodyMaterial);
  body.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), headMaterial);
  head.position.y = 1.38;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.75, 0.16), bodyMaterial);
  const armR = armL.clone();
  armL.position.set(-0.34, 0.82, 0);
  armR.position.set(0.34, 0.82, 0);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.72, 0.18), bodyMaterial);
  const legR = legL.clone();
  legL.position.set(-0.13, 0.05, 0);
  legR.position.set(0.13, 0.05, 0);
  group.add(body, head, armL, armR, legL, legR);
  group.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  group.position.set(-1.4, 0.36, 0);
  return group;
}

function makeRoom() {
  const group = new THREE.Group();
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2c302d, roughness: 0.85 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x202a2e, roughness: 0.9 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.06, 4.0), floorMat);
  floor.receiveShadow = true;
  const back = new THREE.Mesh(new THREE.BoxGeometry(5.5, 2.5, 0.08), wallMat);
  back.position.set(0, 1.25, -2.0);
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.7, 0.8), new THREE.MeshStandardMaterial({ color: 0x8fc7c0, roughness: 0.7 }));
  block.position.set(1.3, 0.38, -0.8);
  block.castShadow = true;
  block.receiveShadow = true;
  group.add(floor, back, block);
  return group;
}

function setSelected(object) {
  app.selected = object;
  app.transform.attach(object);
  el("photoSelectCameraBtn").classList.toggle("active", object === app.camera);
}

function initScene() {
  const host = el("photoViewport");
  if (!host || app.renderer) return;

  app.scene = new THREE.Scene();
  app.scene.background = new THREE.Color(0x0a0b0c);

  app.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);
  app.camera.position.set(0, 1.4, 4.2);
  app.scene.add(app.camera);

  app.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  app.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  app.renderer.shadowMap.enabled = true;
  host.appendChild(app.renderer.domElement);

  app.orbit = new OrbitControls(app.camera, app.renderer.domElement);
  app.orbit.target.set(0, 0.8, 0);
  app.orbit.enableDamping = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 1.4);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2.5, 3.5, 3.0);
  key.castShadow = true;
  app.scene.add(hemi, key);

  app.room = makeRoom();
  app.actor = makeActor();
  app.scene.add(app.room, app.actor);

  const grid = new THREE.GridHelper(5.5, 11, 0x3d4f54, 0x1a2427);
  grid.position.y = 0.04;
  app.scene.add(grid);

  app.transform = new TransformControls(app.camera, app.renderer.domElement);
  app.transform.addEventListener("dragging-changed", (event) => {
    app.orbit.enabled = !event.value;
  });
  app.scene.add(app.transform);
  setSelected(app.camera);

  app.keyframes = [];
  app.nextKeyframeId = 1;
  setKeyframe(0, copyShotState(), "easeInOut");
  app.camera.position.set(0, 1.15, 2.6);
  setKeyframe(totalFrames() - 1, copyShotState(), "easeInOut");
  applyShotState(sortedKeyframes()[0].state);
  selectKeyframe(sortedKeyframes()[0].id);

  bindControls();
  resize();
  animate();
}

function bindControls() {
  el("photoSelectCameraBtn").addEventListener("click", () => setSelected(app.camera));
  el("photoResetBtn").addEventListener("click", resetShot);
  el("photoSetStartBtn").addEventListener("click", () => {
    setKeyframe(0);
    renderKeyframeUI();
    el("photoStatus").textContent = "Saved camera keyframe at frame 1.";
  });
  el("photoSetEndBtn").addEventListener("click", () => {
    setKeyframe(totalFrames() - 1);
    renderKeyframeUI();
    el("photoStatus").textContent = `Saved camera keyframe at frame ${totalFrames()}.`;
  });
  el("photoAddKeyframeBtn").addEventListener("click", () => {
    setKeyframe(currentFrame(), copyShotState(), el("photoEaseSelect").value || "easeInOut");
    renderKeyframeUI();
    el("photoStatus").textContent = `Saved camera keyframe at frame ${currentFrame() + 1}.`;
  });
  el("photoDeleteKeyframeBtn").addEventListener("click", deleteSelectedKeyframe);
  el("photoEaseSelect").addEventListener("change", () => {
    const keyframe = selectedKeyframe();
    if (!keyframe) return;
    keyframe.easing = el("photoEaseSelect").value;
    renderKeyframeUI();
    el("photoStatus").textContent = `Updated easing from frame ${keyframe.frame + 1}.`;
  });
  el("photoPlayBtn").addEventListener("click", togglePlay);
  el("photoFrameSlider").addEventListener("input", () => {
    app.playing = false;
    el("photoPlayBtn").textContent = "Play";
    const frame = Number(el("photoFrameSlider").value);
    applyInterpolatedFrame(frame);
    updateFrameReadout(frame);
    const keyframe = app.keyframes.find((item) => item.frame === frame);
    if (keyframe) selectKeyframe(keyframe.id);
  });
  el("photoFramesInput").addEventListener("input", syncFrameRange);
  el("photoSubjectInput").addEventListener("change", handleSubjectUpload);
  el("photoBakeBtn").addEventListener("click", bakeCannyPreview);
  el("photoSendComfyBtn").addEventListener("click", sendFramesToComfy);
  el("photoExportShotPackBtn").addEventListener("click", exportShotPack);
  el("photoDownloadSheetBtn").addEventListener("click", () => {
    if (!app.cannySheetUrl) return;
    const a = document.createElement("a");
    a.href = app.cannySheetUrl;
    a.download = "camera-lab-canny-sheet.png";
    a.click();
  });
}

function renderKeyframeUI() {
  const list = el("photoKeyframeList");
  const markers = el("photoKeyframeMarkers");
  if (!list || !markers) return;
  const keyframes = sortedKeyframes();
  const maxFrame = Math.max(1, totalFrames() - 1);
  list.innerHTML = "";
  markers.innerHTML = "";
  for (const keyframe of keyframes) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "photo-keyframe-marker";
    marker.classList.toggle("active", keyframe.id === app.selectedKeyframeId);
    marker.style.left = `${(keyframe.frame / maxFrame) * 100}%`;
    marker.title = `Frame ${keyframe.frame + 1}`;
    marker.addEventListener("click", () => {
      el("photoFrameSlider").value = String(keyframe.frame);
      applyInterpolatedFrame(keyframe.frame);
      updateFrameReadout(keyframe.frame);
      selectKeyframe(keyframe.id);
    });
    markers.appendChild(marker);

    const row = document.createElement("button");
    row.type = "button";
    row.className = "photo-keyframe-row";
    row.classList.toggle("active", keyframe.id === app.selectedKeyframeId);
    row.innerHTML = `<span>F${keyframe.frame + 1}</span><strong>${keyframe.easing || "easeInOut"}</strong>`;
    row.addEventListener("click", () => {
      el("photoFrameSlider").value = String(keyframe.frame);
      applyInterpolatedFrame(keyframe.frame);
      updateFrameReadout(keyframe.frame);
      selectKeyframe(keyframe.id);
    });
    list.appendChild(row);
  }
  const selected = selectedKeyframe();
  el("photoDeleteKeyframeBtn").disabled = keyframes.length <= 2 || !selected;
}

function deleteSelectedKeyframe() {
  if (app.keyframes.length <= 2) {
    el("photoStatus").textContent = "Keep at least two camera keyframes.";
    return;
  }
  const keyframe = selectedKeyframe();
  if (!keyframe) return;
  app.keyframes = app.keyframes.filter((item) => item.id !== keyframe.id);
  const next = sortedKeyframes().find((item) => item.frame >= currentFrame()) || sortedKeyframes()[0];
  selectKeyframe(next.id);
  applyInterpolatedFrame(currentFrame());
  renderKeyframeUI();
  el("photoStatus").textContent = `Deleted keyframe at frame ${keyframe.frame + 1}.`;
}

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || response.statusText);
  return data;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("could not read file"));
    reader.readAsDataURL(file);
  });
}

async function handleSubjectUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const status = el("photoSubjectStatus");
  const preview = el("photoSubjectPreview");
  try {
    status.textContent = "Uploading subject reference...";
    const dataUrl = await readFileAsDataUrl(file);
    preview.innerHTML = "";
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "subject reference";
    preview.appendChild(img);
    const result = await postJson("/api/photography-subject", {
      name: file.name,
      data: dataUrl,
    });
    app.subjectReference = result;
    status.textContent = `Subject reference: ${result.comfy_input_name}`;
  } catch (error) {
    app.subjectReference = null;
    preview.innerHTML = "";
    status.textContent = `Subject upload failed: ${error.message}`;
  }
}

function resetShot() {
  app.actor.position.set(-1.4, 0.36, 0);
  app.actor.rotation.set(0, 0, 0);
  app.camera.position.set(0, 1.4, 4.2);
  app.camera.rotation.set(0, 0, 0);
  app.orbit.target.set(0, 0.8, 0);
  app.orbit.update();
  app.keyframes = [];
  app.nextKeyframeId = 1;
  setKeyframe(0, copyShotState(), "easeInOut");
  app.camera.position.set(0, 1.15, 2.6);
  setKeyframe(totalFrames() - 1, copyShotState(), "easeInOut");
  applyShotState(sortedKeyframes()[0].state);
  selectKeyframe(sortedKeyframes()[0].id);
  setSelected(app.camera);
  el("photoFrameSlider").value = "0";
  updateFrameReadout(0);
  renderKeyframeUI();
  el("photoStatus").textContent = "Reset to a camera push-in test.";
}

function syncFrameRange() {
  const previousLast = Math.max(1, Number(el("photoFrameSlider").max) || 48);
  const frames = Math.max(2, Math.min(120, Number(el("photoFramesInput").value) || 49));
  el("photoFramesInput").value = String(frames);
  el("photoFrameSlider").max = String(frames - 1);
  for (const keyframe of app.keyframes) {
    if (keyframe.frame === previousLast) keyframe.frame = frames - 1;
    keyframe.frame = Math.max(0, Math.min(frames - 1, keyframe.frame));
  }
  const byFrame = new Map();
  for (const keyframe of sortedKeyframes()) byFrame.set(keyframe.frame, keyframe);
  app.keyframes = [...byFrame.values()];
  el("photoFrameSlider").value = "0";
  applyInterpolatedFrame(0);
  updateFrameReadout(0);
  selectKeyframe(sortedKeyframes()[0].id);
  renderKeyframeUI();
}

function updateFrameReadout(frame) {
  el("photoFrameReadout").textContent = `Frame ${frame + 1} / ${totalFrames()}`;
}

function togglePlay() {
  app.playing = !app.playing;
  app.playStartedAt = performance.now() - Number(el("photoFrameSlider").value) * 80;
  el("photoPlayBtn").textContent = app.playing ? "Pause" : "Play";
}

function resize() {
  if (!app.renderer) return;
  const host = el("photoViewport");
  const rect = host.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width));
  const height = Math.max(240, Math.round(rect.height));
  app.camera.aspect = width / height;
  app.camera.updateProjectionMatrix();
  app.renderer.setSize(width, height, false);
}

function animate() {
  requestAnimationFrame(animate);
  if (!app.renderer) return;
  if (app.playing) {
    const frames = totalFrames();
    const frame = Math.min(frames - 1, Math.floor((performance.now() - app.playStartedAt) / 80));
    el("photoFrameSlider").value = String(frame);
    applyInterpolatedFrame(frame);
    updateFrameReadout(frame);
    if (frame >= frames - 1) {
      app.playing = false;
      el("photoPlayBtn").textContent = "Play";
    }
  }
  app.orbit.update();
  app.renderer.render(app.scene, app.camera);
}

function parseSize() {
  const [w, h] = el("photoSizeSelect").value.split("x").map((part) => Number(part));
  return { width: w || 768, height: h || 512 };
}

function drawReferenceFrame(targetCanvas, frame) {
  const { width, height } = parseSize();
  targetCanvas.width = width;
  targetCanvas.height = height;
  const previousAspect = app.camera.aspect;
  const previousSize = new THREE.Vector2();
  app.renderer.getSize(previousSize);
  const transformVisible = app.transform?.visible ?? false;

  if (app.transform) app.transform.visible = false;
  app.camera.aspect = width / height;
  app.camera.updateProjectionMatrix();
  applyInterpolatedFrame(frame);
  app.renderer.setSize(width, height, false);
  app.renderer.render(app.scene, app.camera);

  const ctx = targetCanvas.getContext("2d");
  ctx.drawImage(app.renderer.domElement, 0, 0, width, height);

  if (app.transform) app.transform.visible = transformVisible;
  app.camera.aspect = previousAspect;
  app.camera.updateProjectionMatrix();
  app.renderer.setSize(previousSize.x, previousSize.y, false);
}

function drawCannyFrame(targetCanvas, frame) {
  const { width, height } = parseSize();
  targetCanvas.width = width;
  targetCanvas.height = height;
  const previousAspect = app.camera.aspect;
  const previousSize = new THREE.Vector2();
  app.renderer.getSize(previousSize);

  app.camera.aspect = width / height;
  app.camera.updateProjectionMatrix();
  applyInterpolatedFrame(frame);
  app.renderer.setSize(width, height, false);
  app.renderer.render(app.scene, app.camera);

  const source = app.renderer.domElement;
  const ctx = targetCanvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = (y * width + x) * 4;
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const right = ((y * width + x + 1) * 4);
      const down = (((y + 1) * width + x) * 4);
      const lumRight = (data[right] + data[right + 1] + data[right + 2]) / 3;
      const lumDown = (data[down] + data[down + 1] + data[down + 2]) / 3;
      const edge = Math.abs(lum - lumRight) + Math.abs(lum - lumDown) > 28 ? 255 : 0;
      data[i] = edge;
      data[i + 1] = edge;
      data[i + 2] = edge;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);

  app.camera.aspect = previousAspect;
  app.camera.updateProjectionMatrix();
  app.renderer.setSize(previousSize.x, previousSize.y, false);
}

function roundNumber(value) {
  return Math.round(value * 1000) / 1000;
}

function serializeShotState(state) {
  return {
    cameraPosition: state.cameraPosition.map(roundNumber),
    cameraRotation: state.cameraRotation.map(roundNumber),
    target: state.target.map(roundNumber),
    fov: roundNumber(state.fov),
  };
}

function sampleShotFrames() {
  const frames = totalFrames();
  const samples = [
    { label: "start", frame: 0 },
    { label: "middle", frame: Math.floor((frames - 1) / 2) },
    { label: "end", frame: frames - 1 },
  ];
  const seen = new Set();
  return samples.filter((sample) => {
    if (seen.has(sample.frame)) return false;
    seen.add(sample.frame);
    return true;
  });
}

function cameraPromptFor(samples) {
  if (samples.length < 2) return "Static camera reference shot.";
  const first = samples[0].state.cameraPosition;
  const last = samples[samples.length - 1].state.cameraPosition;
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const dz = last[2] - first[2];
  const moves = [];
  if (Math.abs(dx) > 0.4) moves.push(dx > 0 ? "orbits toward camera right" : "orbits toward camera left");
  if (Math.abs(dy) > 0.25) moves.push(dy > 0 ? "cranes upward" : "cranes downward");
  if (Math.abs(dz) > 0.4) moves.push(dz < 0 ? "dollies in" : "dollies out");
  const moveText = moves.length ? moves.join(", ") : "holds a steady composition";
  return `Camera ${moveText} from the start reference to the end reference. Keep the subject placement, room perspective, lens feel, and framing consistent with the 3D references.`;
}

async function exportShotPack() {
  const button = el("photoExportShotPackBtn");
  const { width, height } = parseSize();
  const previousFrame = Number(el("photoFrameSlider").value);
  try {
    button.disabled = true;
    el("photoStatus").textContent = "Exporting director shot pack...";
    const frames = [];
    const samples = [];
    for (const sample of sampleShotFrames()) {
      const canvas = document.createElement("canvas");
      drawReferenceFrame(canvas, sample.frame);
      const state = serializeShotState(copyShotState());
      samples.push({ ...sample, state });
      frames.push({
        label: sample.label,
        frame: sample.frame,
        data: canvas.toDataURL("image/png"),
      });
    }
    const plan = {
      mode: "photography_shot_pack",
      total_frames: totalFrames(),
      output_size: { width, height },
      camera_prompt: cameraPromptFor(samples),
      keyframes: sortedKeyframes().map((keyframe) => ({
        id: keyframe.id,
        frame: keyframe.frame,
        easing: keyframe.easing,
        state: serializeShotState(keyframe.state),
      })),
      samples,
      subject_reference: app.subjectReference?.comfy_input_name || "",
    };
    const result = await postJson("/api/shot-pack", { width, height, frames, plan });
    const output = el("photoCannyFrames");
    output.innerHTML = "";
    for (const frame of frames) {
      const item = document.createElement("figure");
      item.className = "photo-canny-frame";
      const img = document.createElement("img");
      img.src = frame.data;
      const cap = document.createElement("figcaption");
      cap.textContent = `${frame.label} F${frame.frame + 1}`;
      item.append(img, cap);
      output.appendChild(item);
    }
    el("photoStatus").textContent = `Exported shot pack ${result.shot_id}: ${result.path}`;
    window.dispatchEvent(new CustomEvent("camera-lab:shot-pack-exported", {
      detail: { ...result, plan_payload: plan },
    }));
  } catch (error) {
    el("photoStatus").textContent = `Shot pack export failed: ${error.message}`;
  } finally {
    button.disabled = false;
    el("photoFrameSlider").value = String(previousFrame);
    applyInterpolatedFrame(previousFrame);
    resize();
  }
}

async function bakeCannyPreview() {
  const frames = totalFrames();
  const sampleCount = Math.min(12, frames);
  const output = el("photoCannyFrames");
  output.innerHTML = "";
  el("photoStatus").textContent = `Baking ${sampleCount} preview frame(s)...`;

  const thumbs = [];
  for (let i = 0; i < sampleCount; i += 1) {
    const frame = Math.round((i / Math.max(1, sampleCount - 1)) * (frames - 1));
    const canvas = document.createElement("canvas");
    drawCannyFrame(canvas, frame);
    const item = document.createElement("figure");
    item.className = "photo-canny-frame";
    const img = document.createElement("img");
    img.src = canvas.toDataURL("image/png");
    const cap = document.createElement("figcaption");
    cap.textContent = `F${frame + 1}`;
    item.append(img, cap);
    output.appendChild(item);
    thumbs.push({ canvas, frame });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  buildContactSheet(thumbs);
  applyInterpolatedFrame(Number(el("photoFrameSlider").value));
  resize();
  el("photoStatus").textContent = `Baked ${sampleCount} Canny preview frame(s).`;
}

async function renderCannySequence({ includePreview = false } = {}) {
  const frames = totalFrames();
  const rendered = [];
  const previewFrames = [];
  for (let frame = 0; frame < frames; frame += 1) {
    const canvas = document.createElement("canvas");
    drawCannyFrame(canvas, frame);
    rendered.push(canvas.toDataURL("image/png"));
    if (includePreview && (frame === 0 || frame === frames - 1 || frame % Math.ceil(frames / 10) === 0)) {
      previewFrames.push({ canvas, frame });
    }
    if (frame % 4 === 0) {
      el("photoStatus").textContent = `Rendered Canny frame ${frame + 1} / ${frames}...`;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return { frames: rendered, previewFrames };
}

async function sendFramesToComfy() {
  const button = el("photoSendComfyBtn");
  const { width, height } = parseSize();
  try {
    button.disabled = true;
    el("photoBakeBtn").disabled = true;
    el("photoStatus").textContent = "Rendering full Canny sequence...";
    const sequence = await renderCannySequence({ includePreview: true });
    el("photoStatus").textContent = "Uploading frames to ComfyUI input...";
    const result = await postJson("/api/photography-frames", {
      width,
      height,
      frames: sequence.frames,
      subject_image: app.subjectReference?.comfy_input_name || "",
    });
    if (sequence.previewFrames.length) {
      const output = el("photoCannyFrames");
      output.innerHTML = "";
      for (const { canvas, frame } of sequence.previewFrames.slice(0, 12)) {
        const item = document.createElement("figure");
        item.className = "photo-canny-frame";
        const img = document.createElement("img");
        img.src = canvas.toDataURL("image/png");
        const cap = document.createElement("figcaption");
        cap.textContent = `F${frame + 1}`;
        item.append(img, cap);
        output.appendChild(item);
      }
      buildContactSheet(sequence.previewFrames.slice(0, 12));
    }
    const workflowName = result.workflow ? result.workflow.split(/[\\/]/).pop() : "Photography workflow";
    const subjectNote = result.subject_image ? ` Subject: ${result.subject_image}.` : "";
    el("photoStatus").textContent = `Sent ${result.frame_count} frame(s) to ComfyUI input/${result.comfy_input_subdir}. ${workflowName} updated.${subjectNote}`;
  } catch (error) {
    el("photoStatus").textContent = `Send failed: ${error.message}`;
  } finally {
    button.disabled = false;
    el("photoBakeBtn").disabled = false;
    applyInterpolatedFrame(Number(el("photoFrameSlider").value));
    resize();
  }
}

function buildContactSheet(thumbs) {
  if (app.cannySheetUrl) URL.revokeObjectURL(app.cannySheetUrl);
  const columns = 4;
  const cellW = 240;
  const cellH = 170;
  const rows = Math.ceil(thumbs.length / columns);
  const sheet = document.createElement("canvas");
  sheet.width = columns * cellW;
  sheet.height = rows * cellH;
  const ctx = sheet.getContext("2d");
  ctx.fillStyle = "#050505";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  thumbs.forEach(({ canvas, frame }, index) => {
    const x = (index % columns) * cellW;
    const y = Math.floor(index / columns) * cellH;
    ctx.drawImage(canvas, x, y, cellW, cellH - 24);
    ctx.fillStyle = "#d7b46a";
    ctx.font = "14px Consolas, monospace";
    ctx.fillText(`Frame ${frame + 1}`, x + 10, y + cellH - 8);
  });
  sheet.toBlob((blob) => {
    if (!blob) return;
    app.cannySheetUrl = URL.createObjectURL(blob);
    el("photoDownloadSheetBtn").disabled = false;
  }, "image/png");
}

window.cameraLabPhotography = {
  THREE,
  app,
  applyInterpolatedFrame,
  applyShotState,
  copyShotState,
  renderCannySequence,
  setKeyframe,
  totalFrames,
};

window.addEventListener("resize", resize);
window.addEventListener("camera-lab:photography-visible", () => {
  initScene();
  setTimeout(resize, 50);
});

el("photographyWorkspaceTab")?.addEventListener("click", () => {
  document.body.classList.add("photography-workspace-active");
  el("cameraWorkspaceTab")?.classList.remove("active");
  el("directorWorkspaceTab")?.classList.remove("active");
  el("photographyWorkspaceTab")?.classList.add("active");
  initScene();
  setTimeout(resize, 50);
});

initScene();
