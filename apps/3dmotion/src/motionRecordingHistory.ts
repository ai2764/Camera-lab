type FetchLike = typeof fetch;

export type MotionRecordingHistoryOptions = {
  duration: number;
  filename?: string;
  prompt?: string;
};

export async function saveMotionRecordingToHistory(
  blob: Blob,
  options: MotionRecordingHistoryOptions,
  request: FetchLike = fetch,
) {
  const params = new URLSearchParams({
    name: options.filename ?? 'rendered_v2.webm',
    duration: Math.max(0.1, options.duration).toFixed(3),
    prompt: options.prompt ?? '3D motion recorded guide',
  });
  const response = await request(`/api/3dmotion-recording?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'video/webm' },
    body: blob,
  });
  if (!response.ok) throw new Error(`Saving 3D Motion recording failed: HTTP ${response.status}`);
  const result = (await response.json()) as { run?: unknown };
  if (!result.run) throw new Error('Saving 3D Motion recording did not return a run.');
  return result.run;
}
