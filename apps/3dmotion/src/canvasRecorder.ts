type CanvasVideoTrack = MediaStreamTrack & {
  requestFrame?: () => void;
};

export type CanvasRecorderOptions = {
  fps?: number;
  MediaRecorderCtor?: typeof MediaRecorder;
  isTypeSupported?: (mimeType: string) => boolean;
  createObjectUrl?: (blob: Blob) => string;
  createCanvasElement?: () => HTMLCanvasElement;
  prepareFrame?: () => void;
};

export type CanvasRecorder = {
  start: () => void;
  requestFrame: () => void;
  stop: () => Promise<{ url: string; filename: string; blob: Blob }>;
};

function stopStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

function makeCaptureStream(canvas: HTMLCanvasElement, fps: number) {
  const manualStream = canvas.captureStream(0);
  const manualTrack = manualStream.getVideoTracks()[0] as CanvasVideoTrack | undefined;
  if (manualTrack?.requestFrame) {
    return {
      stream: manualStream,
      requestFrame: () => manualTrack.requestFrame?.(),
    };
  }

  stopStream(manualStream);
  return {
    stream: canvas.captureStream(fps),
    requestFrame: () => {},
  };
}

function makeMirrorCanvasRecorderSource(sourceCanvas: HTMLCanvasElement, options: CanvasRecorderOptions) {
  const mirrorCanvas = options.createCanvasElement?.() ?? document.createElement('canvas');
  const context = mirrorCanvas.getContext('2d');

  const copyFrame = () => {
    options.prepareFrame?.();
    const width = Math.max(1, sourceCanvas.width);
    const height = Math.max(1, sourceCanvas.height);
    if (mirrorCanvas.width !== width) mirrorCanvas.width = width;
    if (mirrorCanvas.height !== height) mirrorCanvas.height = height;
    context?.drawImage(sourceCanvas, 0, 0, width, height);
  };

  return { canvas: mirrorCanvas, copyFrame };
}

export function createCanvasRecorder(
  canvas: HTMLCanvasElement,
  filename: string,
  options: CanvasRecorderOptions = {},
): CanvasRecorder {
  const fps = options.fps ?? 30;
  const MediaRecorderCtor = options.MediaRecorderCtor ?? MediaRecorder;
  const supportsMime = options.isTypeSupported ?? MediaRecorderCtor.isTypeSupported.bind(MediaRecorderCtor);
  const createObjectUrl = options.createObjectUrl ?? URL.createObjectURL.bind(URL);
  const recorderSource = makeMirrorCanvasRecorderSource(canvas, options);
  const { stream, requestFrame } = makeCaptureStream(recorderSource.canvas, fps);
  const mimeType = supportsMime('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  const recorder = new MediaRecorderCtor(stream, { mimeType, videoBitsPerSecond: 12_000_000 });
  const chunks: Blob[] = [];

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  return {
    start: () => {
      recorder.start();
    },
    requestFrame: () => {
      recorderSource.copyFrame();
      requestFrame();
    },
    stop: () =>
      new Promise<{ url: string; filename: string; blob: Blob }>((resolve) => {
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: 'video/webm' });
          stopStream(stream);
          resolve({ url: createObjectUrl(blob), filename, blob });
        };
        recorder.stop();
      }),
  };
}
