import { describe, expect, it, vi } from 'vitest';
import { makeComfyScailClient } from './comfyScailClient';

describe('makeComfyScailClient', () => {
  it('uses the local Vite proxy by default to avoid browser CORS failures', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ name: 'ref.png' }), { status: 200 }));
    const client = makeComfyScailClient({ fetch });
    const file = new File(['x'], 'ref.png', { type: 'image/png' });

    await client.uploadInput(file);

    expect(fetch).toHaveBeenCalledWith('/comfy/upload/image', {
      method: 'POST',
      body: expect.any(FormData),
    });
  });

  it('uploads media into the 3dmotion-scail input folder', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ name: 'ref.png' }), { status: 200 }));
    const client = makeComfyScailClient({ baseUrl: 'http://127.0.0.1:8188', fetch });
    const file = new File(['x'], 'ref.png', { type: 'image/png' });

    const name = await client.uploadInput(file);

    expect(name).toBe('3dmotion-scail/ref.png');
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:8188/upload/image', {
      method: 'POST',
      body: expect.any(FormData),
    });
  });

  it('queues a prompt and returns the prompt id', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ prompt_id: 'abc', node_errors: {} }), { status: 200 }));
    const client = makeComfyScailClient({ baseUrl: 'http://127.0.0.1:8188', fetch });

    await expect(client.queuePrompt({ '1': { class_type: 'Test', inputs: {} } })).resolves.toBe('abc');

    const body = JSON.parse(String(fetch.mock.calls[0][1]?.body));
    expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:8188/prompt');
    expect(body.prompt['1'].class_type).toBe('Test');
    expect(typeof body.client_id).toBe('string');
  });

  it('reads the saved mp4 from prompt history', async () => {
    const fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: {
            outputs: {
              '17': {
                images: [{ filename: 'out.mp4', subfolder: 'scail', type: 'output' }],
              },
            },
            status: { completed: true },
          },
        }),
        { status: 200 },
      ),
    );
    const client = makeComfyScailClient({ baseUrl: 'http://127.0.0.1:8188', fetch });

    await expect(client.getOutputVideo('id')).resolves.toEqual({
      filename: 'out.mp4',
      subfolder: 'scail',
      type: 'output',
      url: 'http://127.0.0.1:8188/view?filename=out.mp4&type=output&subfolder=scail',
    });
  });
});
