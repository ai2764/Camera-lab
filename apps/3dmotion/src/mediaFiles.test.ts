import { describe, expect, it } from 'vitest';
import { makeFileFromBlob } from './mediaFiles';

describe('makeFileFromBlob', () => {
  it('wraps an exported blob as a named file without fetching a blob URL', async () => {
    const blob = new Blob(['video-data'], { type: 'video/webm' });

    const file = makeFileFromBlob(blob, 'rendered_v2.webm', 'video/webm');

    expect(file.name).toBe('rendered_v2.webm');
    expect(file.type).toBe('video/webm');
    expect(await file.text()).toBe('video-data');
  });
});
