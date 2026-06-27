type FetchLike = typeof fetch;

export type CameraLabMotionRun = {
  batch_id?: string;
  run_id?: string;
  status?: string;
  video?: string;
  error?: string;
};

export type CameraLabMotionBatch = {
  batch_id: string;
  status?: string;
  runs?: CameraLabMotionRun[];
};

export type CameraLabScailOutput = {
  filename: string;
  subfolder: string;
  type: string;
  url: string;
};

export type SubmitCameraLabScailFinalOptions = {
  reference: File;
  guide: Blob;
  guideName: string;
  duration: number;
  width: number;
  height: number;
  steps: number;
  seed: string | number;
  poseStrength: number;
  usePoseVideoMask: boolean;
};

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function encodeBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function fileToDataUrl(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return `data:${file.type || 'application/octet-stream'};base64,${encodeBase64(bytes)}`;
}

async function uploadReferenceImage(reference: File, request: FetchLike) {
  const response = await request('/api/upload-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: reference.name || 'reference.png',
      data: await fileToDataUrl(reference),
    }),
  });
  if (!response.ok) throw new Error(`Reference image upload failed: HTTP ${response.status}`);
  const result = (await readJson(response)) as { path?: string };
  if (!result.path) throw new Error('Reference image upload did not return a path.');
  return result.path;
}

async function uploadGuideVideo(guide: Blob, guideName: string, request: FetchLike) {
  const body = new FormData();
  body.append('file', guide, guideName || 'guide.webm');
  const response = await request('/api/upload-video', { method: 'POST', body });
  if (!response.ok) throw new Error(`Guide video upload failed: HTTP ${response.status}`);
  const result = (await readJson(response)) as { path?: string };
  if (!result.path) throw new Error('Guide video upload did not return a path.');
  return result.path;
}

export async function submitCameraLabScailFinal(
  options: SubmitCameraLabScailFinalOptions,
  request: FetchLike = fetch,
): Promise<CameraLabMotionBatch> {
  const referencePath = await uploadReferenceImage(options.reference, request);
  const guideVideoPath = await uploadGuideVideo(options.guide, options.guideName, request);
  const response = await request('/api/text-to-motion-video-final', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: '3D motion guide driving video',
      reference_path: referencePath,
      guide_video_path: guideVideoPath,
      guide_trim_start: 0,
      guide_trim_end: Math.max(0.1, options.duration),
      width: options.width,
      height: options.height,
      steps: options.steps,
      seed: options.seed,
      pose_strength: options.poseStrength,
      use_pose_video_mask: options.usePoseVideoMask,
      motion_type: '3d',
    }),
  });
  if (!response.ok) throw new Error(`SCAIL2 job submit failed: HTTP ${response.status}`);
  const batch = (await readJson(response)) as CameraLabMotionBatch;
  if (!batch.batch_id) throw new Error('SCAIL2 job submit did not return a batch.');
  return batch;
}

export function cameraLabMediaUrl(path: string) {
  return `/media?path=${encodeURIComponent(path)}`;
}

export function filenameFromPath(path: string) {
  return path.split(/[\\/]/).pop() || 'motion_final.mp4';
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export async function waitForCameraLabScailOutput(
  batchId: string,
  onTick: (message: string) => void,
  request: FetchLike = fetch,
  intervalMs = 3000,
  maxAttempts = 240,
): Promise<CameraLabScailOutput> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await request(`/api/batches/${encodeURIComponent(batchId)}`);
    if (!response.ok) throw new Error(`SCAIL2 status check failed: HTTP ${response.status}`);
    const batch = (await readJson(response)) as CameraLabMotionBatch;
    const run = batch.runs?.[0] ?? {};
    if (run.error) throw new Error(run.error);
    if (run.video) {
      return {
        filename: filenameFromPath(run.video),
        subfolder: '',
        type: 'output',
        url: cameraLabMediaUrl(run.video),
      };
    }
    onTick(`SCAIL2 is running... ${run.status || batch.status || batchId}`);
    if (intervalMs > 0) await wait(intervalMs);
  }
  throw new Error('SCAIL2 generation timed out.');
}
