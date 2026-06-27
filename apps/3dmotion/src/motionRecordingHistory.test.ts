import { describe, expect, it, vi } from 'vitest';
import { saveMotionRecordingToHistory } from './motionRecordingHistory';

describe('saveMotionRecordingToHistory', () => {
  it('posts the recorded guide blob to Camera Lab history', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ run: { workflow_mode: 'motion_3d' } }), { status: 200 }));
    const blob = new Blob(['webm'], { type: 'video/webm' });

    await expect(saveMotionRecordingToHistory(blob, { duration: 1.75 }, request)).resolves.toEqual({ workflow_mode: 'motion_3d' });

    expect(request).toHaveBeenCalledWith('/api/3dmotion-recording?name=rendered_v2.webm&duration=1.750&prompt=3D+motion+recorded+guide', {
      method: 'POST',
      headers: { 'Content-Type': 'video/webm' },
      body: blob,
    });
  });
});
