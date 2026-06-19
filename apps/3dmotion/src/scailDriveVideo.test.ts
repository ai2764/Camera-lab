import { describe, expect, it, vi } from 'vitest';
import { prepareScailDriveVideo } from './scailDriveVideo';

describe('prepareScailDriveVideo', () => {
  it('posts the exported video blob to the local mp4 conversion endpoint', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ path: '3dmotion-scail/drive_1.mp4' }), { status: 200 }));
    const blob = new Blob(['webm'], { type: 'video/webm' });

    await expect(prepareScailDriveVideo(blob, 'drive_1.webm', fetch)).resolves.toBe('3dmotion-scail/drive_1.mp4');

    expect(fetch).toHaveBeenCalledWith('/api/scail-drive-video?name=drive_1.webm', {
      method: 'POST',
      headers: { 'Content-Type': 'video/webm' },
      body: blob,
    });
  });
});
