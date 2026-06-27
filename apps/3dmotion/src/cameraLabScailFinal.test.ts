import { describe, expect, it, vi } from 'vitest';
import { submitCameraLabScailFinal, waitForCameraLabScailOutput } from './cameraLabScailFinal';

describe('submitCameraLabScailFinal', () => {
  it('uploads the reference and guide before submitting a masked 3D Motion SCAIL2 job', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const path = String(url);
      requests.push({ url: path, init });
      if (path === '/api/upload-image') {
        return new Response(JSON.stringify({ path: 'C:\\mock\\ref.png', name: 'ref.png' }), { status: 200 });
      }
      if (path === '/api/upload-video') {
        return new Response(JSON.stringify({ path: 'C:\\mock\\guide.webm', name: 'guide.webm' }), { status: 200 });
      }
      if (path === '/api/text-to-motion-video-final') {
        return new Response(JSON.stringify({ batch_id: 'motion_3d', runs: [] }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as unknown as typeof fetch;

    const reference = new File([new Uint8Array([1, 2, 3])], 'ref.png', { type: 'image/png' });
    const guide = new Blob([new Uint8Array([4, 5, 6])], { type: 'video/webm' });

    await expect(submitCameraLabScailFinal({
      reference,
      guide,
      guideName: 'guide.webm',
      duration: 2.5,
      width: 480,
      height: 832,
      steps: 8,
      seed: '123',
      poseStrength: 0.7,
      usePoseVideoMask: true,
    }, request)).resolves.toMatchObject({ batch_id: 'motion_3d' });

    const finalRequest = requests.find((item) => item.url === '/api/text-to-motion-video-final');
    expect(finalRequest).toBeTruthy();
    expect(JSON.parse(String(finalRequest?.init?.body))).toMatchObject({
      reference_path: 'C:\\mock\\ref.png',
      guide_video_path: 'C:\\mock\\guide.webm',
      guide_trim_start: 0,
      guide_trim_end: 2.5,
      width: 480,
      height: 832,
      steps: 8,
      seed: '123',
      pose_strength: 0.7,
      use_pose_video_mask: true,
      motion_type: '3d',
    });
  });

  it('returns the finished Camera Lab video as a previewable output', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({
      batch_id: 'motion_3d',
      status: 'done',
      runs: [{
        status: 'done',
        video: 'C:\\mock\\motion_final.mp4',
      }],
    }), { status: 200 })) as unknown as typeof fetch;

    await expect(waitForCameraLabScailOutput('motion_3d', () => {}, request, 0, 1)).resolves.toEqual({
      filename: 'motion_final.mp4',
      subfolder: '',
      type: 'output',
      url: '/media?path=C%3A%5Cmock%5Cmotion_final.mp4',
    });
  });
});
