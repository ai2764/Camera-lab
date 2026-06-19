import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Film,
  Maximize2,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  RotateCcw,
  Square,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { type CameraKeyframe, sampleCameraTake } from './cameraTake';
import { makeComfyScailClient, type ComfyOutputVideo } from './comfyScailClient';
import { makeDefaultIdleTimeline } from './defaultMotion';
import { makeDemoMotionTimeline } from './demoMotion';
import { makeId } from './id';
import { makeImportedClipId, normalizeImportedClipName, type ImportedClipId } from './importedClips';
import { type ClipName, type MotionClipId, type TimelineAction } from './motionTypes';
import { prepareScailDriveVideo } from './scailDriveVideo';
import { waitForRecordingWarmup } from './recordingWarmup';
import { makeScailSeed, resolveScailSize, scailSizePresets } from './scailSettings';
import { buildScailPrompt, makeScailFrameCount } from './scailWorkflow';
import { getRecordTakeControl } from './takeControls';
import {
  appendTimelineAction,
  findActiveImportedTimelineAction,
  removeTimelineAction,
  updateTimelineActionDuration,
} from './timelineEditing';

type ExportUrls = {
  rgb?: string;
  mask?: string;
  rgbBlob?: Blob;
  maskBlob?: Blob;
};

type StageApi = {
  play: () => void;
  pause: () => void;
  reset: () => void;
  startCameraTake: () => Promise<void>;
  stopCameraTake: () => CameraKeyframe[];
  clearCameraTake: () => void;
  exportTake: (duration: number, cameraTake?: CameraKeyframe[]) => Promise<ExportUrls>;
  loadMotionGuide: (baseFile: File, addonFile?: File) => Promise<{ message: string; clips: ImportedClipMeta[] }>;
};

type ImportedClipMeta = {
  id: ImportedClipId;
  name: string;
  duration: number;
};

type ScailGeneratedVideo = ComfyOutputVideo & {
  id: string;
  createdAt: number;
};

const clipLabels: Record<ClipName, string> = {
  idle: 'Idle',
  walk_forward: 'Walk Forward',
  walk_backward: 'Walk Back',
  run_forward: 'Run Forward',
  turn_left: 'Turn Left',
  turn_right: 'Turn Right',
  step_left: 'Step Left',
  step_right: 'Step Right',
  wave_right: 'Wave Right',
  point_forward: 'Point Forward',
  point_left: 'Point Left',
  point_right: 'Point Right',
  raise_hands: 'Raise Hands',
  crouch: 'Crouch',
};

function getClipLabel(clip: MotionClipId) {
  if (clip.startsWith('imported:')) return clip.replace('imported:', '').replace(/-/g, ' ');
  return clipLabels[clip as ClipName];
}

const scailClient = makeComfyScailClient();
const scailFps = 24;
const defaultScailSizePreset = '480x832';
const defaultScailPrompt = 'a pirate character following the source motion, cinematic, detailed, high quality, smooth motion';
const defaultScailNegative = 'blurry, low quality, distorted, deformed, watermark, static';
const recordingWarmupFrames = 3;
const nodeMotionGuide = {
  basePath: `${import.meta.env.BASE_URL}mesh2motion/human-base-animations.glb`,
  addonPath: `${import.meta.env.BASE_URL}mesh2motion/human-addon-animations.glb`,
  baseFileName: 'human-base-animations.glb',
  addonFileName: 'human-addon-animations.glb',
  mimeType: 'model/gltf-binary',
  label: 'Mesh2Motion Human',
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const ease = (value: number) => value * value * (3 - 2 * value);

function getTimelineDuration(timeline: TimelineAction[]) {
  return Math.max(1, ...timeline.map((item) => item.start + item.duration));
}

function makeMaterial(color: string, roughness = 0.68) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.02 });
}

function makeSegment(
  length: number,
  radius: number,
  color: string,
  direction: 1 | -1,
): { group: THREE.Group; end: THREE.Group; mesh: THREE.Mesh } {
  const group = new THREE.Group();
  const geometry = new THREE.CylinderGeometry(radius, radius * 0.86, length, 18, 1);
  const mesh = new THREE.Mesh(geometry, makeMaterial(color));
  mesh.position.y = (length / 2) * direction;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.rgbMaterial = mesh.material;
  mesh.userData.maskMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  group.add(mesh);

  const end = new THREE.Group();
  end.position.y = length * direction;
  group.add(end);
  return { group, end, mesh };
}

function makeSphere(radius: number, color: string) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), makeMaterial(color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.rgbMaterial = mesh.material;
  mesh.userData.maskMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  return mesh;
}

class Mannequin {
  root = new THREE.Group();
  hips = new THREE.Group();
  chest = new THREE.Group();
  neck = new THREE.Group();
  head = new THREE.Group();
  leftUpperArm = new THREE.Group();
  leftLowerArm = new THREE.Group();
  leftHand = new THREE.Group();
  rightUpperArm = new THREE.Group();
  rightLowerArm = new THREE.Group();
  rightHand = new THREE.Group();
  leftUpperLeg = new THREE.Group();
  leftLowerLeg = new THREE.Group();
  leftFoot = new THREE.Group();
  rightUpperLeg = new THREE.Group();
  rightLowerLeg = new THREE.Group();
  rightFoot = new THREE.Group();
  rightTarget = new THREE.Group();
  leftTarget = new THREE.Group();

  constructor() {
    this.root.position.y = 1.05;
    this.root.add(this.hips);

    const pelvis = makeSphere(0.24, '#f0a85a');
    pelvis.scale.set(1.35, 0.62, 0.78);
    this.hips.add(pelvis);

    const torso = makeSegment(0.72, 0.2, '#2f7d71', 1);
    torso.mesh.scale.x = 1.25;
    torso.mesh.scale.z = 0.78;
    this.hips.add(torso.group);
    this.chest = torso.end;

    const chestPlate = makeSphere(0.27, '#2f7d71');
    chestPlate.scale.set(1.35, 0.72, 0.82);
    this.chest.add(chestPlate);

    this.neck.position.y = 0.28;
    this.chest.add(this.neck);
    const headMesh = makeSphere(0.22, '#f3c8a1');
    headMesh.position.y = 0.22;
    this.head.add(headMesh);
    this.neck.add(this.head);

    this.buildArm('left');
    this.buildArm('right');
    this.buildLeg('left');
    this.buildLeg('right');

    const targetMaterial = new THREE.MeshBasicMaterial({ color: '#e9ff55' });
    const targetGeo = new THREE.SphereGeometry(0.045, 12, 8);
    this.rightTarget.add(new THREE.Mesh(targetGeo, targetMaterial));
    this.leftTarget.add(new THREE.Mesh(targetGeo, targetMaterial.clone()));
    this.rightTarget.visible = false;
    this.leftTarget.visible = false;
    this.root.parent?.add(this.rightTarget);
  }

  attachTargets(scene: THREE.Scene) {
    scene.add(this.rightTarget);
    scene.add(this.leftTarget);
  }

  buildArm(side: 'left' | 'right') {
    const sign = side === 'left' ? -1 : 1;
    const shoulder = new THREE.Group();
    shoulder.position.set(sign * 0.42, 0.1, 0);
    shoulder.rotation.z = sign * -0.12;
    this.chest.add(shoulder);

    const upper = makeSegment(0.48, 0.075, '#d9b156', -1);
    shoulder.add(upper.group);
    const lower = makeSegment(0.44, 0.062, '#dfbd6b', -1);
    upper.end.add(lower.group);
    const handMesh = makeSphere(0.08, '#f3c8a1');
    lower.end.add(handMesh);

    if (side === 'left') {
      this.leftUpperArm = shoulder;
      this.leftLowerArm = upper.end;
      this.leftHand = lower.end;
    } else {
      this.rightUpperArm = shoulder;
      this.rightLowerArm = upper.end;
      this.rightHand = lower.end;
    }
  }

  buildLeg(side: 'left' | 'right') {
    const sign = side === 'left' ? -1 : 1;
    const hip = new THREE.Group();
    hip.position.set(sign * 0.17, -0.06, 0);
    this.hips.add(hip);

    const upper = makeSegment(0.58, 0.09, '#263f57', -1);
    hip.add(upper.group);
    const lower = makeSegment(0.56, 0.075, '#34516e', -1);
    upper.end.add(lower.group);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.28), makeMaterial('#1f2932'));
    foot.position.set(0, -0.03, -0.08);
    foot.castShadow = true;
    foot.receiveShadow = true;
    foot.userData.rgbMaterial = foot.material;
    foot.userData.maskMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    lower.end.add(foot);

    if (side === 'left') {
      this.leftUpperLeg = hip;
      this.leftLowerLeg = upper.end;
      this.leftFoot = lower.end;
    } else {
      this.rightUpperLeg = hip;
      this.rightLowerLeg = upper.end;
      this.rightFoot = lower.end;
    }
  }

  resetPose() {
    const joints = [
      this.root,
      this.hips,
      this.chest,
      this.neck,
      this.head,
      this.leftUpperArm,
      this.leftLowerArm,
      this.leftHand,
      this.rightUpperArm,
      this.rightLowerArm,
      this.rightHand,
      this.leftUpperLeg,
      this.leftLowerLeg,
      this.leftFoot,
      this.rightUpperLeg,
      this.rightLowerLeg,
      this.rightFoot,
    ];
    joints.forEach((joint) => {
      joint.rotation.set(0, 0, 0);
      joint.quaternion.identity();
    });
    this.root.position.set(0, 1.05, 0);
    this.root.rotation.y = 0;
    this.hips.position.y = 0;
    this.leftUpperArm.rotation.z = 0.18;
    this.rightUpperArm.rotation.z = -0.18;
    this.leftFoot.rotation.x = -0.2;
    this.rightFoot.rotation.x = -0.2;
    this.rightTarget.visible = false;
    this.leftTarget.visible = false;
  }
}

function applyLocomotionEnd(action: TimelineAction, fraction: number, position: THREE.Vector3, rotation: { y: number }) {
  const f = clamp(fraction, 0, 1) * action.intensity;
  switch (action.clip) {
    case 'walk_forward':
      position.z -= action.duration * 0.66 * f;
      break;
    case 'walk_backward':
      position.z += action.duration * 0.44 * f;
      break;
    case 'run_forward':
      position.z -= action.duration * 1.18 * f;
      break;
    case 'step_left':
      position.x -= 0.55 * ease(f);
      break;
    case 'step_right':
      position.x += 0.55 * ease(f);
      break;
    case 'turn_left':
      rotation.y += (Math.PI / 2) * ease(f);
      break;
    case 'turn_right':
      rotation.y -= (Math.PI / 2) * ease(f);
      break;
  }
}

function solveCCD(chain: THREE.Object3D[], end: THREE.Object3D, target: THREE.Vector3, iterations = 9) {
  const jointWorld = new THREE.Vector3();
  const endWorld = new THREE.Vector3();
  const toEnd = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const rotateWorld = new THREE.Quaternion();
  const currentWorld = new THREE.Quaternion();
  const parentWorld = new THREE.Quaternion();

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const joint = chain[i];
      joint.updateMatrixWorld(true);
      end.updateMatrixWorld(true);

      joint.getWorldPosition(jointWorld);
      end.getWorldPosition(endWorld);
      toEnd.copy(endWorld).sub(jointWorld).normalize();
      toTarget.copy(target).sub(jointWorld).normalize();

      if (toEnd.lengthSq() < 0.0001 || toTarget.lengthSq() < 0.0001) continue;

      rotateWorld.setFromUnitVectors(toEnd, toTarget);
      joint.getWorldQuaternion(currentWorld);
      rotateWorld.multiply(currentWorld);

      if (joint.parent) {
        joint.parent.getWorldQuaternion(parentWorld).invert();
        joint.quaternion.copy(parentWorld.multiply(rotateWorld));
      } else {
        joint.quaternion.copy(rotateWorld);
      }
    }
  }
}

function applyClipPose(rig: Mannequin, action: TimelineAction, localTime: number) {
  const progress = clamp(localTime / Math.max(action.duration, 0.001), 0, 1);
  const phase = progress * Math.PI * 2;
  const swing = Math.sin(phase * (action.clip === 'run_forward' ? 2 : 1));
  const lift = Math.abs(Math.sin(phase));
  const amount = action.intensity;

  const walking = action.clip === 'walk_forward' || action.clip === 'walk_backward' || action.clip === 'run_forward';
  if (walking) {
    const speed = action.clip === 'run_forward' ? 1.45 : 0.9;
    rig.hips.position.y = 0.04 * lift * speed;
    rig.leftUpperLeg.rotation.x = swing * 0.55 * speed;
    rig.rightUpperLeg.rotation.x = -swing * 0.55 * speed;
    rig.leftLowerLeg.rotation.x = Math.max(0, -swing) * 0.65 * speed;
    rig.rightLowerLeg.rotation.x = Math.max(0, swing) * 0.65 * speed;
    rig.leftUpperArm.rotation.x = -swing * 0.42 * speed;
    rig.rightUpperArm.rotation.x = swing * 0.42 * speed;
    rig.chest.rotation.y = swing * 0.07;
  }

  if (action.clip === 'idle') {
    rig.hips.position.y = Math.sin(phase) * 0.012;
    rig.chest.rotation.y = Math.sin(phase) * 0.03;
    rig.leftUpperArm.rotation.x = Math.sin(phase) * 0.08;
    rig.rightUpperArm.rotation.x = -Math.sin(phase) * 0.08;
  }

  if (action.clip === 'turn_left' || action.clip === 'turn_right') {
    const direction = action.clip === 'turn_left' ? 1 : -1;
    rig.chest.rotation.y = direction * Math.sin(progress * Math.PI) * 0.26;
    rig.head.rotation.y = direction * Math.sin(progress * Math.PI) * 0.32;
    rig.leftUpperArm.rotation.x = direction * 0.16;
    rig.rightUpperArm.rotation.x = -direction * 0.16;
  }

  if (action.clip === 'wave_right') {
    rig.rightUpperArm.rotation.set(-0.55, 0.08, -1.05);
    rig.rightLowerArm.rotation.z = -0.65 + Math.sin(phase * 2.2) * 0.55;
    rig.rightHand.rotation.z = Math.sin(phase * 4.4) * 0.24;
    rig.head.rotation.y = Math.sin(phase * 0.5) * 0.12;
  }

  if (action.clip === 'raise_hands') {
    const raised = ease(Math.sin(progress * Math.PI) * 0.5 + 0.5);
    rig.leftUpperArm.rotation.set(-0.72 * raised, 0.08, 1.2 * raised);
    rig.rightUpperArm.rotation.set(-0.72 * raised, -0.08, -1.2 * raised);
    rig.leftLowerArm.rotation.z = 0.25 * raised;
    rig.rightLowerArm.rotation.z = -0.25 * raised;
  }

  if (action.clip === 'crouch') {
    const down = Math.sin(progress * Math.PI);
    rig.root.position.y -= 0.32 * down;
    rig.hips.rotation.x = 0.2 * down;
    rig.chest.rotation.x = -0.18 * down;
    rig.leftUpperLeg.rotation.x = -0.82 * down;
    rig.rightUpperLeg.rotation.x = -0.82 * down;
    rig.leftLowerLeg.rotation.x = 1.25 * down;
    rig.rightLowerLeg.rotation.x = 1.25 * down;
  }

  if (action.clip.startsWith('point_')) {
    const worldTarget = new THREE.Vector3();
    if (action.clip === 'point_forward') worldTarget.set(0, 1.45, -1.35);
    if (action.clip === 'point_left') worldTarget.set(-1.15, 1.48, -0.55);
    if (action.clip === 'point_right') worldTarget.set(1.15, 1.48, -0.55);
    worldTarget.applyAxisAngle(new THREE.Vector3(0, 1, 0), rig.root.rotation.y).add(rig.root.position);
    rig.rightTarget.position.copy(worldTarget);
    rig.chest.rotation.y = (action.clip === 'point_left' ? 0.18 : action.clip === 'point_right' ? -0.18 : 0) * amount;
    solveCCD([rig.rightUpperArm, rig.rightLowerArm], rig.rightHand, worldTarget, 10);
  }
}

function applyTimelinePose(rig: Mannequin, timeline: TimelineAction[], time: number) {
  rig.resetPose();
  const position = new THREE.Vector3(0, 1.05, 0);
  const rotation = { y: 0 };
  const sorted = [...timeline].sort((a, b) => a.start - b.start);
  let active: TimelineAction | null = null;
  let activeLocal = 0;

  for (const action of sorted) {
    const end = action.start + action.duration;
    if (time >= end) {
      applyLocomotionEnd(action, 1, position, rotation);
      continue;
    }
    if (time >= action.start && time < end) {
      active = action;
      activeLocal = time - action.start;
      applyLocomotionEnd(action, activeLocal / action.duration, position, rotation);
      break;
    }
  }

  rig.root.position.copy(position);
  rig.root.rotation.y = rotation.y;
  if (active) applyClipPose(rig, active, activeLocal);

  rig.root.updateMatrixWorld(true);
}

function setMaskMode(scene: THREE.Scene, enabled: boolean) {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || !mesh.userData.rgbMaterial || !mesh.userData.maskMaterial) return;
    mesh.material = enabled ? mesh.userData.maskMaterial : mesh.userData.rgbMaterial;
  });
}

function setRigVisible(rig: Mannequin, visible: boolean) {
  rig.root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) mesh.visible = visible;
  });
}

function disposeObjectTree(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[];
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
}

function createRecorder(canvas: HTMLCanvasElement, filename: string) {
  const stream = canvas.captureStream(30);
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  return {
    start: () => recorder.start(),
    stop: () =>
      new Promise<{ url: string; filename: string; blob: Blob }>((resolve) => {
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          resolve({ url: URL.createObjectURL(blob), filename, blob });
        };
        recorder.stop();
      }),
  };
}

function downloadUrl(url: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForScailOutput(promptId: string, onTick: (message: string) => void): Promise<ComfyOutputVideo> {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const output = await scailClient.getOutputVideo(promptId);
    if (output) return output;
    onTick(`SCAIL is running... ${promptId.slice(0, 8)}`);
    await wait(3000);
  }
  throw new Error('SCAIL generation timed out.');
}

function useStage(
  mountRef: React.RefObject<HTMLDivElement>,
  timelineRef: React.RefObject<TimelineAction[]>,
  onTime: (time: number) => void,
  onPlaying: (playing: boolean) => void,
  onStageError: (message: string) => void,
) {
  const apiRef = useRef<StageApi | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let renderer: THREE.WebGLRenderer;
    let maskRenderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      maskRenderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
    } catch (error) {
      onStageError(error instanceof Error ? error.message : 'WebGL renderer failed to initialize.');
      return;
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#15181a');
    scene.fog = new THREE.Fog('#15181a', 9, 18);

    const maskScene = scene;
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    camera.position.set(2.6, 1.7, 3.2);

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    maskRenderer.setPixelRatio(1);
    maskRenderer.domElement.className = 'mask-canvas';
    mount.appendChild(maskRenderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1.1, 0);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    const keyLight = new THREE.DirectionalLight('#fff3de', 3);
    keyLight.position.set(3, 4, 2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    scene.add(keyLight);
    scene.add(new THREE.HemisphereLight('#c8ecff', '#2f322f', 1.8));

    const grid = new THREE.GridHelper(8, 16, '#44525a', '#242b30');
    grid.position.y = 0;
    scene.add(grid);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshStandardMaterial({ color: '#1c2022', roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const rig = new Mannequin();
    scene.add(rig.root);
    rig.attachTargets(scene);

    const clock = new THREE.Clock();
    let playhead = 0;
    let playing = false;
    let exporting = false;
    let exportStopAt = 0;
    let frame = 0;
    let rgbRecorder: ReturnType<typeof createRecorder> | null = null;
    let maskRecorder: ReturnType<typeof createRecorder> | null = null;
    let exportResolve: ((urls: ExportUrls) => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let rafId = 0;
    let disposed = false;
    let loadedAvatar: THREE.Object3D | null = null;
    let loadedMixer: THREE.AnimationMixer | null = null;
    let loadedActions = new Map<ImportedClipId, THREE.AnimationAction>();
    let currentImportedClip: ImportedClipId | null = null;
    let recordingCameraTake = false;
    let cameraTakeStart = 0;
    let cameraTake: CameraKeyframe[] = [];
    let replayCameraTake: CameraKeyframe[] | null = null;

    function resize() {
      const rect = mount.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width));
      const height = Math.max(240, Math.floor(rect.height));
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      maskRenderer.setSize(width, height, false);
    }

    if ('ResizeObserver' in window) {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(mount);
    } else {
      window.addEventListener('resize', resize);
    }
    resize();

    async function finishExport() {
      if (!rgbRecorder || !maskRecorder || !exportResolve) return;
      exporting = false;
      playing = false;
      onPlaying(false);
      const [rgb, mask] = await Promise.all([rgbRecorder.stop(), maskRecorder.stop()]);
      exportResolve({ rgb: rgb.url, mask: mask.url, rgbBlob: rgb.blob, maskBlob: mask.blob });
      rgbRecorder = null;
      maskRecorder = null;
      exportResolve = null;
    }

    function animate() {
      if (disposed) return;
      const delta = Math.min(clock.getDelta(), 1 / 20);
      const duration = getTimelineDuration(timelineRef.current);
      if (playing || exporting) {
        playhead += delta;
        if (!exporting && playhead > duration) playhead = 0;
      }
      if (exporting && playhead >= exportStopAt) void finishExport();

      const importedSegment = findActiveImportedTimelineAction(timelineRef.current, playhead);
      if (loadedMixer && importedSegment) {
        const importedClip = importedSegment.action.clip;
        if (importedClip !== currentImportedClip) {
          loadedMixer.stopAllAction();
          currentImportedClip = importedClip;
          const nextAction = loadedActions.get(currentImportedClip);
          nextAction?.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).play();
        }
        const action = loadedActions.get(importedClip);
        if (action) {
          const clipDuration = Math.max(action.getClip().duration, 0.001);
          action.time = importedSegment.localTime % clipDuration;
          loadedMixer.update(0);
        }
      } else {
        if (currentImportedClip) {
          loadedMixer?.stopAllAction();
          currentImportedClip = null;
        }
        applyTimelinePose(rig, timelineRef.current, playhead);
      }

      if (replayCameraTake) {
        const sample = sampleCameraTake(replayCameraTake, playhead);
        camera.position.set(...sample.position);
        controls.target.set(...sample.target);
      }
      controls.update();

      if (recordingCameraTake && frame % 2 === 0) {
        cameraTake.push({
          time: Math.max(0, playhead - cameraTakeStart),
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: [controls.target.x, controls.target.y, controls.target.z],
        });
      }

      setMaskMode(scene, false);
      scene.background = new THREE.Color('#15181a');
      renderer.render(scene, camera);

      setMaskMode(maskScene, true);
      scene.background = new THREE.Color('#000000');
      maskRenderer.render(maskScene, camera);

      setMaskMode(scene, false);
      if (frame % 3 === 0) onTime(playhead);
      frame += 1;
      rafId = requestAnimationFrame(animate);
    }
    animate();

    function makeCameraKeyframe(time: number): CameraKeyframe {
      return {
        time,
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
      };
    }

    apiRef.current = {
      play: () => {
        playing = true;
        onPlaying(true);
      },
      pause: () => {
        playing = false;
        onPlaying(false);
      },
      reset: () => {
        playhead = 0;
        replayCameraTake = null;
        currentImportedClip = null;
        onTime(0);
      },
      startCameraTake: async () => {
        playhead = 0;
        cameraTake = [];
        cameraTakeStart = 0;
        recordingCameraTake = false;
        playing = false;
        onPlaying(false);
        onTime(0);
        clock.getDelta();
        await waitForRecordingWarmup(requestAnimationFrame, recordingWarmupFrames);
        if (disposed) return;
        cameraTake = [makeCameraKeyframe(0)];
        recordingCameraTake = true;
        playing = true;
        clock.getDelta();
        onPlaying(true);
      },
      stopCameraTake: () => {
        recordingCameraTake = false;
        return [...cameraTake];
      },
      clearCameraTake: () => {
        recordingCameraTake = false;
        cameraTake = [];
      },
      exportTake: async (duration: number, recordedCameraTake?: CameraKeyframe[]) => {
        playhead = 0;
        exportStopAt = duration;
        currentImportedClip = null;
        replayCameraTake = recordedCameraTake && recordedCameraTake.length > 0 ? recordedCameraTake : null;
        exporting = false;
        playing = false;
        onTime(0);
        onPlaying(false);
        clock.getDelta();
        await waitForRecordingWarmup(requestAnimationFrame, recordingWarmupFrames);
        if (disposed) throw new Error('3D stage was closed before export started.');
        rgbRecorder = createRecorder(renderer.domElement, 'rendered_v2.webm');
        maskRecorder = createRecorder(maskRenderer.domElement, 'rendered_mask_v2.webm');
        rgbRecorder.start();
        maskRecorder.start();
        exporting = true;
        playing = true;
        clock.getDelta();
        onPlaying(true);
        return new Promise((resolve) => {
          exportResolve = (urls) => {
            replayCameraTake = null;
            resolve(urls);
          };
        });
      },
      loadMotionGuide: async (baseFile: File, addonFile?: File) => {
        const baseUrl = URL.createObjectURL(baseFile);
        const addonUrl = addonFile ? URL.createObjectURL(addonFile) : '';
        const loader = new GLTFLoader();

        try {
          const gltf = await loader.loadAsync(baseUrl);
          if (loadedAvatar) {
            scene.remove(loadedAvatar);
            loadedMixer?.stopAllAction();
            loadedMixer = null;
            loadedActions = new Map();
            currentImportedClip = null;
            disposeObjectTree(loadedAvatar);
          }

          loadedAvatar = gltf.scene;
          loadedMixer = new THREE.AnimationMixer(loadedAvatar);
          loadedAvatar.scale.setScalar(1.2);
          loadedAvatar.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.rgbMaterial = mesh.material;
            mesh.userData.maskMaterial = new THREE.MeshBasicMaterial({ color: '#ffffff' });
          });
          scene.add(loadedAvatar);
          setRigVisible(rig, false);

          const addClips = (clips: THREE.AnimationClip[]) =>
            clips.map((clip) => {
              const name = normalizeImportedClipName(clip.name);
              const id = makeImportedClipId(name);
              loadedActions.set(id, loadedMixer!.clipAction(clip));
              return { id, name, duration: clip.duration };
            });

          const clips = addClips(gltf.animations);
          if (addonUrl) {
            const addonGltf = await loader.loadAsync(addonUrl);
            clips.push(...addClips(addonGltf.animations));
            disposeObjectTree(addonGltf.scene);
          }

          return { message: `Loaded ${baseFile.name} with ${clips.length} node actions.`, clips };
        } finally {
          URL.revokeObjectURL(baseUrl);
          if (addonUrl) URL.revokeObjectURL(addonUrl);
        }
      },
    };

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      loadedMixer?.stopAllAction();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      controls.dispose();
      renderer.dispose();
      maskRenderer.dispose();
      mount.innerHTML = '';
      apiRef.current = null;
    };
  }, [mountRef, onPlaying, onStageError, onTime, timelineRef]);

  return apiRef;
}

export function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [timeline, setTimeline] = useState<TimelineAction[]>(() => makeDefaultIdleTimeline());
  const timelineRef = useRef<TimelineAction[]>(timeline);
  const didAutoLoadMotionGuide = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exports, setExports] = useState<ExportUrls>({});
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [scailReference, setScailReference] = useState<File | null>(null);
  const [scailStatus, setScailStatus] = useState('Choose a reference image, then generate with local SCAIL-2.');
  const [scailOutputs, setScailOutputs] = useState<ScailGeneratedVideo[]>([]);
  const [scailPreview, setScailPreview] = useState<ScailGeneratedVideo | null>(null);
  const [isGeneratingScail, setIsGeneratingScail] = useState(false);
  const [scailSizePreset, setScailSizePreset] = useState(defaultScailSizePreset);
  const [scailSizeText, setScailSizeText] = useState(defaultScailSizePreset);
  const [scailSizeScale, setScailSizeScale] = useState(100);
  const [scailSteps, setScailSteps] = useState(8);
  const [scailSeedText, setScailSeedText] = useState('');
  const [scailPoseStrength, setScailPoseStrength] = useState(1);
  const [importedClips, setImportedClips] = useState<ImportedClipMeta[]>([]);
  const [stageError, setStageError] = useState('');
  const [isRecordingTake, setIsRecordingTake] = useState(false);
  const [cameraTake, setCameraTake] = useState<CameraKeyframe[]>([]);
  const duration = useMemo(() => getTimelineDuration(timeline), [timeline]);
  const recordTakeControl = getRecordTakeControl({ isRecordingTake, isExporting });
  const scailSize = useMemo(() => resolveScailSize(scailSizeText, scailSizeScale), [scailSizeText, scailSizeScale]);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  const onTime = useMemo(() => (time: number) => setCurrentTime(time), []);
  const onPlaying = useMemo(() => (playing: boolean) => setIsPlaying(playing), []);
  const onStageError = useMemo(() => (message: string) => setStageError(message), []);
  const stageApi = useStage(mountRef, timelineRef, onTime, onPlaying, onStageError);

  function commitTimeline(nextTimeline: TimelineAction[]) {
    timelineRef.current = nextTimeline;
    setTimeline(nextTimeline);
  }

  function addClip(clip: MotionClipId, clipDuration: number) {
    const nextTimeline = appendTimelineAction(timelineRef.current, clip, clipDuration, makeId());
    commitTimeline(nextTimeline);
    stageApi.current?.reset();
    stageApi.current?.play();
  }

  function changeActionDuration(id: string, value: string) {
    const nextDuration = Number.parseFloat(value);
    if (!Number.isFinite(nextDuration)) return;
    const nextTimeline = updateTimelineActionDuration(timelineRef.current, id, nextDuration);
    commitTimeline(nextTimeline);
    stageApi.current?.reset();
  }

  function removeAction(id: string) {
    const removed = removeTimelineAction(timelineRef.current, id);
    const nextTimeline = removed.length > 0 ? removed : makeDefaultIdleTimeline();
    commitTimeline(nextTimeline);
    stageApi.current?.reset();
  }

  async function renderTake(recordedCameraTake: CameraKeyframe[]) {
    if (!stageApi.current || isExporting) return;
    setIsExporting(true);
    setExports({});
    setIsPreviewOpen(false);
    try {
      const urls = await stageApi.current.exportTake(duration, recordedCameraTake);
      setExports(urls);
      if (urls.rgb) setIsPreviewOpen(true);
    } finally {
      setIsExporting(false);
    }
  }

  async function recordTake() {
    if (!stageApi.current || isExporting) return;

    if (isRecordingTake) {
      const recordedCameraTake = stageApi.current.stopCameraTake();
      setCameraTake(recordedCameraTake);
      setIsRecordingTake(false);
      await renderTake(recordedCameraTake);
      return;
    }

    setExports({});
    setIsPreviewOpen(false);
    setCameraTake([]);
    await stageApi.current.startCameraTake();
    setIsRecordingTake(true);
  }

  async function generateScailVideo() {
    if (!stageApi.current || !scailReference || isGeneratingScail || isRecordingTake || isExporting) return;
    setIsGeneratingScail(true);
    setScailStatus('Exporting the current motion guide...');
    try {
      const timestamp = Date.now();
      const urls = await stageApi.current.exportTake(duration, cameraTake);
      if (!urls.rgb || !urls.rgbBlob) throw new Error('Motion guide export did not return a video.');
      setExports(urls);

      setScailStatus('Uploading reference image and preparing MP4 motion guide...');
      const referenceImage = await scailClient.uploadInput(scailReference);
      const driveVideo = await prepareScailDriveVideo(urls.rgbBlob, `drive_${timestamp}.webm`);

      const frameCount = makeScailFrameCount(duration, scailFps);
      const steps = Math.max(1, Math.min(100, Math.round(scailSteps)));
      const poseStrength = clamp(scailPoseStrength, 0, 1);
      const prompt = buildScailPrompt({
        referenceImage,
        driveVideo,
        positivePrompt: defaultScailPrompt,
        negativePrompt: defaultScailNegative,
        width: scailSize.width,
        height: scailSize.height,
        fps: scailFps,
        frameCount,
        seed: makeScailSeed(scailSeedText),
        steps,
        poseStrength,
        outputPrefix: `scail/3dmotion_${timestamp}`,
      });

      setScailStatus(`Submitting SCAIL-2 job (${frameCount} frames, ${scailSize.width}x${scailSize.height})...`);
      const promptId = await scailClient.queuePrompt(prompt);
      const output = await waitForScailOutput(promptId, setScailStatus);
      setScailOutputs((items) => [{ ...output, id: `${timestamp}-${items.length}`, createdAt: timestamp }, ...items]);
      setScailStatus('SCAIL-2 video is ready.');
    } catch (error) {
      setScailStatus(error instanceof Error ? error.message : 'SCAIL-2 generation failed.');
    } finally {
      setIsGeneratingScail(false);
    }
  }

  function resetTimeline() {
    commitTimeline(makeDefaultIdleTimeline());
    stageApi.current?.reset();
    stageApi.current?.pause();
  }

  async function loadNodeMotionGuide() {
    if (!stageApi.current) return;
    try {
      const [baseResponse, addonResponse] = await Promise.all([
        fetch(nodeMotionGuide.basePath),
        fetch(nodeMotionGuide.addonPath),
      ]);
      if (!baseResponse.ok) throw new Error(`Motion guide failed to load: HTTP ${baseResponse.status}`);
      if (!addonResponse.ok) throw new Error(`Motion actions failed to load: HTTP ${addonResponse.status}`);

      const [baseBlob, addonBlob] = await Promise.all([baseResponse.blob(), addonResponse.blob()]);
      const result = await stageApi.current.loadMotionGuide(
        new File([baseBlob], nodeMotionGuide.baseFileName, { type: nodeMotionGuide.mimeType }),
        new File([addonBlob], nodeMotionGuide.addonFileName, { type: nodeMotionGuide.mimeType }),
      );
      setImportedClips(result.clips);
      const nextTimeline = makeDemoMotionTimeline(result.clips);
      if (nextTimeline.length > 0) {
        commitTimeline(nextTimeline);
        stageApi.current.reset();
        stageApi.current.play();
      }
    } catch (error) {
      setImportedClips([]);
      console.warn(error instanceof Error ? error.message : 'Motion guide load failed.');
    }
  }

  useEffect(() => {
    if (didAutoLoadMotionGuide.current || !stageApi.current) return;
    didAutoLoadMotionGuide.current = true;
    void loadNodeMotionGuide();
  }, [stageApi]);

  const generatedVideosPanel = (
    <section className="stage-results" aria-label="Generated videos">
      <div className="stage-results-header">
        <p className="eyebrow">Generated videos</p>
        <span>{scailOutputs.length} saved</span>
      </div>
      {scailOutputs.length > 0 ? (
        <div className="stage-result-strip">
          {scailOutputs.map((item, index) => (
            <article className="stage-result-card" key={item.id}>
              <div className="preview-heading">
                <Video size={14} />
                <span>{index === 0 ? 'Latest final' : `Final ${scailOutputs.length - index}`}</span>
              </div>
              <video className="stage-result-video" src={item.url} muted playsInline preload="metadata" onClick={() => setScailPreview(item)}>
                <a href={item.url}>Open generated video</a>
              </video>
              <div className="stage-result-actions">
                <button className="download-button stage-result-preview-button" type="button" onClick={() => setScailPreview(item)}>
                  <Maximize2 size={15} />
                  <span>Preview</span>
                </button>
                <button className="download-button stage-result-download" type="button" title={item.filename} onClick={() => downloadUrl(item.url, item.filename)}>
                  <Download size={15} />
                  <span className="stage-result-filename">{item.filename}</span>
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="stage-results-empty">Generated final videos appear here.</div>
      )}
    </section>
  );

  return (
    <main className="app-page">
      <div className="app-shell">
        <aside className="action-sidebar">
          <div className="panel-header">
            <p className="eyebrow">Action Library</p>
            <button className="ghost-button" type="button" onClick={resetTimeline}>
              <RefreshCcw size={15} />
              Reset
            </button>
          </div>

          <div className="clip-grid">
            {importedClips.map((item) => (
              <button key={item.id} className="clip-button" type="button" onClick={() => addClip(item.id, item.duration)}>
                <Plus size={14} />
                {item.name}
              </button>
            ))}
          </div>
        </aside>

        <section className="stage-panel">
          <div className="stage-toolbar">
            <div>
              <p className="eyebrow">SCAIL-2 Driving Source</p>
              <h1>3D Motion Stage</h1>
            </div>
            <div className="transport">
              <button
                className="icon-button"
                type="button"
                onClick={() => (isPlaying ? stageApi.current?.pause() : stageApi.current?.play())}
                title={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button className="icon-button" type="button" onClick={() => stageApi.current?.reset()} title="Reset playhead">
                <RotateCcw size={18} />
              </button>
              <button className="primary-button" type="button" onClick={() => void recordTake()} disabled={recordTakeControl.disabled}>
                {recordTakeControl.icon === 'square' ? <Square size={17} /> : <Video size={17} />}
                {recordTakeControl.label}
              </button>
            </div>
          </div>

          <div className="stage-wrap" ref={mountRef} />
          {stageError && <div className="stage-error">WebGL failed: {stageError}</div>}

          <div className="time-strip">
            <span>{currentTime.toFixed(2)}s</span>
            <div className="rail">
              <div className="rail-fill" style={{ width: `${clamp((currentTime / duration) * 100, 0, 100)}%` }} />
            </div>
            <span>{duration.toFixed(2)}s</span>
          </div>
        </section>

        <aside className="control-panel">
        <div className="timeline-card">
          <div className="panel-header">
            <p className="eyebrow">Timeline</p>
            <span>{timeline.length} clips</span>
          </div>
          <div className="timeline-list">
            {timeline.map((item, index) => (
              <div className="timeline-row" key={item.id}>
                <span className="row-index">{String(index + 1).padStart(2, '0')}</span>
                <div className="timeline-meta">
                  <strong>{getClipLabel(item.clip)}</strong>
                  <small>
                    {item.start.toFixed(1)}s - {(item.start + item.duration).toFixed(1)}s
                  </small>
                </div>
                <label className="duration-field" title="Clip duration in seconds">
                  <input
                    aria-label={`Duration for ${getClipLabel(item.clip)}`}
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={Number(item.duration.toFixed(2))}
                    onChange={(event) => changeActionDuration(item.id, event.target.value)}
                  />
                  <span aria-hidden="true">s</span>
                </label>
                <button
                  className="icon-button timeline-delete"
                  type="button"
                  title={`Delete ${getClipLabel(item.clip)}`}
                  onClick={() => removeAction(item.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <section className="video-card" aria-label="SCAIL-2 video generation">
          <div className="video-card-header">
            <div>
              <p className="eyebrow">Video</p>
              <h2>Generate with SCAIL-2</h2>
            </div>
            <span className="video-duration">{duration.toFixed(2)}s</span>
          </div>

          <label className="reference-picker">
            <span className="reference-picker-copy">
              <strong>{scailReference ? scailReference.name : 'Reference image'}</strong>
              <small>{scailReference ? 'Ready for the current take' : 'Choose the character or subject image'}</small>
            </span>
            <span className="reference-picker-button">Choose</span>
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setScailReference(file);
                setScailStatus(file ? 'Reference image ready.' : 'Choose a reference image, then generate with local SCAIL-2.');
              }}
            />
          </label>

          <div className="video-settings">
            <label>
              Preset
              <select
                value={scailSizePreset}
                onChange={(event) => {
                  setScailSizePreset(event.target.value);
                  setScailSizeText(event.target.value);
                }}
              >
                {scailSizePresets.map((preset) => (
                  <option key={preset.value} value={preset.value}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Size
              <input
                type="text"
                value={scailSizeText}
                placeholder="480x832"
                onChange={(event) => {
                  setScailSizeText(event.target.value);
                  if (scailSizePresets.some((preset) => preset.value === event.target.value)) {
                    setScailSizePreset(event.target.value);
                  }
                }}
              />
            </label>
            <label>
              Steps
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={scailSteps}
                onChange={(event) => setScailSteps(Number(event.target.value))}
              />
            </label>
            <label>
              Seed
              <input
                type="number"
                min="1"
                max="2147000000"
                step="1"
                value={scailSeedText}
                placeholder="Random"
                onChange={(event) => setScailSeedText(event.target.value)}
              />
            </label>
          </div>

          <details className="advanced-drawer">
            <summary>Advanced settings</summary>
            <div className="video-slider-stack">
              <label className="settings-field">
                <span className="settings-label-row">
                  Scale
                  <span>{`${scailSize.width}x${scailSize.height} / ${scailSizeScale}%`}</span>
                </span>
                <input
                  type="range"
                  min="50"
                  max="150"
                  step="5"
                  value={scailSizeScale}
                  onChange={(event) => setScailSizeScale(Number(event.target.value))}
                />
              </label>
              <label className="settings-field">
                <span className="settings-label-row">
                  Pose strength
                  <span>{scailPoseStrength.toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={scailPoseStrength}
                  onChange={(event) => setScailPoseStrength(Number(event.target.value))}
                />
              </label>
            </div>
          </details>

          <button
            className="primary-button wide"
            type="button"
            onClick={() => void generateScailVideo()}
            disabled={!scailReference || isGeneratingScail || isRecordingTake || isExporting}
          >
            <Video size={16} />
            {isGeneratingScail ? 'Generating' : 'Generate video'}
          </button>
          <small className="video-status">{scailStatus}</small>

          {exports.rgb && (
            <div className="video-preview-stack">
              <div className="scail-result">
                <div className="preview-heading">
                  <Film size={14} />
                  <span>Motion guide</span>
                </div>
                <video className="scail-preview" src={exports.rgb} controls playsInline preload="metadata">
                  <a href={exports.rgb}>Open guide video</a>
                </video>
              </div>
            </div>
          )}

          <details className="export-drawer">
            <summary>RGB + mask exports</summary>
            <div className="download-stack">
              <button className="download-button" type="button" disabled={!exports.rgb} onClick={() => setIsPreviewOpen(true)}>
                <Video size={16} />
                Open preview
              </button>
              <button className="download-button" type="button" disabled={!exports.rgb} onClick={() => exports.rgb && downloadUrl(exports.rgb, 'rendered_v2.webm')}>
                <Film size={16} />
                rendered_v2.webm
                <Download size={15} />
              </button>
              <button className="download-button" type="button" disabled={!exports.mask} onClick={() => exports.mask && downloadUrl(exports.mask, 'rendered_mask_v2.webm')}>
                <Film size={16} />
                rendered_mask_v2.webm
                <Download size={15} />
              </button>
            </div>
          </details>
        </section>
        </aside>
      </div>
      {generatedVideosPanel}
      {scailPreview && (
        <div className="preview-window" role="dialog" aria-label="Generated video preview">
          <div className="preview-window-panel">
            <div className="preview-window-header">
              <div>
                <p className="eyebrow">Generated preview</p>
                <h2>{scailPreview.filename}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setScailPreview(null)} title="Close preview">
                <X size={18} />
              </button>
            </div>
            <video className="preview-window-video" src={scailPreview.url} controls autoPlay playsInline preload="metadata">
              <a href={scailPreview.url}>Open generated video</a>
            </video>
            <button className="download-button" type="button" onClick={() => downloadUrl(scailPreview.url, scailPreview.filename)}>
              <Download size={15} />
              Download {scailPreview.filename}
            </button>
          </div>
        </div>
      )}
      {isPreviewOpen && exports.rgb && (
        <div className="preview-window" role="dialog" aria-label="Recorded video preview">
          <div className="preview-window-panel">
            <div className="preview-window-header">
              <div>
                <p className="eyebrow">Recorded preview</p>
                <h2>rendered_v2.webm</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setIsPreviewOpen(false)} title="Close preview">
                <X size={18} />
              </button>
            </div>
            <video className="preview-window-video" src={exports.rgb} controls autoPlay playsInline preload="metadata">
              <a href={exports.rgb}>Open recorded video</a>
            </video>
            <button className="download-button" type="button" onClick={() => downloadUrl(exports.rgb!, 'rendered_v2.webm')}>
              <Download size={15} />
              Download rendered_v2.webm
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
