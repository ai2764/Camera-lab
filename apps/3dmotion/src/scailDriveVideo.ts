export async function prepareScailDriveVideo(blob: Blob, filename: string, request: typeof fetch = fetch) {
  const response = await request(`/api/scail-drive-video?name=${encodeURIComponent(filename)}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'video/webm' },
    body: blob,
  });
  if (!response.ok) throw new Error(`Drive video conversion failed: HTTP ${response.status}`);
  const result = (await response.json()) as { path?: string };
  if (!result.path) throw new Error('Drive video conversion did not return a Comfy input path.');
  return result.path;
}
