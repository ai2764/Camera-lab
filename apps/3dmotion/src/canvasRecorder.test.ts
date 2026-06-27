import { describe, expect, test, vi } from 'vitest';
import { createCanvasRecorder } from './canvasRecorder';

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => false);

  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor(
    public stream: MediaStream,
    public options: MediaRecorderOptions,
  ) {}

  start = vi.fn();
  stop = vi.fn(() => {
    this.ondataavailable?.({ data: new Blob(['video'], { type: 'video/webm' }) });
    this.onstop?.();
  });
}

describe('createCanvasRecorder', () => {
  test('mirrors the source canvas before requesting an encoded frame', async () => {
    const requestFrame = vi.fn();
    const stop = vi.fn();
    const stream = {
      getVideoTracks: () => [{ requestFrame }],
      getTracks: () => [{ stop }],
    } as unknown as MediaStream;
    const drawImage = vi.fn();
    const mirrorCanvas = {
      width: 1,
      height: 1,
      captureStream: vi.fn(() => stream),
      getContext: vi.fn(() => ({ drawImage })),
    } as unknown as HTMLCanvasElement;
    const canvas = {
      width: 640,
      height: 360,
      captureStream: vi.fn(),
    } as unknown as HTMLCanvasElement;
    const prepareFrame = vi.fn();

    const recorder = createCanvasRecorder(canvas, 'guide.webm', {
      fps: 24,
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      createCanvasElement: () => mirrorCanvas,
      prepareFrame,
    });

    expect(canvas.captureStream).not.toHaveBeenCalled();
    expect(mirrorCanvas.captureStream).toHaveBeenCalledWith(0);
    recorder.start();
    expect(requestFrame).not.toHaveBeenCalled();

    recorder.requestFrame();
    expect(prepareFrame).toHaveBeenCalledBefore(drawImage);
    expect(mirrorCanvas.width).toBe(640);
    expect(mirrorCanvas.height).toBe(360);
    expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0, 640, 360);
    expect(requestFrame).toHaveBeenCalledOnce();
    const result = await recorder.stop();
    expect(result.filename).toBe('guide.webm');
    expect(result.blob.size).toBeGreaterThan(0);
  });
});
