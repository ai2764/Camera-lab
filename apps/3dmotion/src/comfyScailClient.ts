import type { ScailPrompt } from './scailWorkflow';

type FetchLike = typeof fetch;

export type ComfyOutputVideo = {
  filename: string;
  subfolder: string;
  type: string;
  url: string;
};

type MakeClientOptions = {
  baseUrl?: string;
  fetch?: FetchLike;
};

function cleanBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, '');
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function requestWithContext(request: FetchLike, url: string, init: RequestInit | undefined, label: string) {
  try {
    return await request(url, init);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${message}`);
  }
}

function makeViewUrl(baseUrl: string, filename: string, type: string, subfolder: string) {
  const params = new URLSearchParams({ filename, type, subfolder });
  return `${baseUrl}/view?${params.toString()}`;
}

export function makeComfyScailClient(options: MakeClientOptions = {}) {
  const baseUrl = cleanBaseUrl(options.baseUrl ?? '/comfy');
  const request = options.fetch ?? fetch;

  return {
    async uploadInput(file: File) {
      const body = new FormData();
      body.append('image', file);
      body.append('subfolder', '3dmotion-scail');
      body.append('type', 'input');
      body.append('overwrite', 'true');

      const response = await requestWithContext(request, `${baseUrl}/upload/image`, { method: 'POST', body }, 'Comfy upload request failed');
      if (!response.ok) throw new Error(`Comfy upload failed: HTTP ${response.status}`);
      const result = (await readJson(response)) as { name?: string };
      const name = result.name || file.name;
      return `3dmotion-scail/${name}`;
    },

    async queuePrompt(prompt: ScailPrompt) {
      const response = await requestWithContext(request, `${baseUrl}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          client_id: crypto.randomUUID(),
        }),
      }, 'Comfy prompt request failed');
      if (!response.ok) throw new Error(`Comfy prompt failed: HTTP ${response.status}`);
      const result = (await readJson(response)) as { prompt_id?: string; node_errors?: Record<string, unknown> };
      if (result.node_errors && Object.keys(result.node_errors).length > 0) {
        throw new Error(`Comfy prompt rejected: ${JSON.stringify(result.node_errors)}`);
      }
      if (!result.prompt_id) throw new Error('Comfy prompt did not return a prompt id.');
      return result.prompt_id;
    },

    async getOutputVideo(promptId: string): Promise<ComfyOutputVideo | null> {
      const response = await requestWithContext(
        request,
        `${baseUrl}/history/${encodeURIComponent(promptId)}`,
        undefined,
        'Comfy history request failed',
      );
      if (!response.ok) throw new Error(`Comfy history failed: HTTP ${response.status}`);
      const history = (await readJson(response)) as Record<string, { outputs?: Record<string, { images?: ComfyOutputVideo[] }> }>;
      const entry = history[promptId];
      const files = Object.values(entry?.outputs ?? {}).flatMap((output) => output.images ?? []);
      const video = files.find((file) => file.filename.toLowerCase().endsWith('.mp4')) ?? null;
      return video ? { ...video, url: makeViewUrl(baseUrl, video.filename, video.type, video.subfolder) } : null;
    },
  };
}
