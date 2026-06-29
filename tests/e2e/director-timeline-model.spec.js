import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.DirectorTimelineModel), null, { timeout: 3000 });
});

test("director timeline model converts seconds state to frame items", async ({ page }) => {
  const result = await page.evaluate(() => {
    return DirectorTimelineModel.fromAppState({
      fps: 24,
      main: [{ id: "seg_1", start: 1.5, duration: 2.5, trimStart: 0.5, prompt: "shot", videoPath: "guide.mp4", videoName: "guide.mp4" }],
      videoAudio: [{ id: "va_1", start: 0, duration: 1, trimStart: 0.25, audioPath: "guide.mp4", audioName: "guide.mp4", audioDuration: 3 }],
      dialogue: [{ id: "aud_1", start: 3, duration: 1.5, trimStart: 0.75, audioPath: "line.wav", audioName: "line.wav", audioDuration: 4 }],
      icVideo: [{ id: "ic_1", start: 4, duration: 2, trimStart: 1, videoPath: "motion.mp4", videoName: "motion.mp4", videoDuration: 8 }],
    });
  });

  expect(result.items.map(({ id, track, kind, start, length, trimStart, sourceDuration }) => ({
    id, track, kind, start, length, trimStart, sourceDuration,
  }))).toEqual([
    { id: "seg_1", track: "main", kind: "video", start: 36, length: 60, trimStart: 12, sourceDuration: 0 },
    { id: "va_1", track: "video_audio", kind: "audio", start: 0, length: 24, trimStart: 6, sourceDuration: 72 },
    { id: "aud_1", track: "dialogue", kind: "audio", start: 72, length: 36, trimStart: 18, sourceDuration: 96 },
    { id: "ic_1", track: "ic_video", kind: "motion_video", start: 96, length: 48, trimStart: 24, sourceDuration: 192 },
  ]);
});

test("director timeline model splits trim-aware clips at a frame", async ({ page }) => {
  const result = await page.evaluate(() => {
    const model = DirectorTimelineModel.create({
      fps: 24,
      items: [{ id: "aud_1", track: "dialogue", kind: "audio", start: 24, length: 96, trimStart: 12, mediaPath: "line.wav" }],
    });
    model.split("dialogue", "aud_1", 60);
    return model.items.map(({ id, start, length, trimStart }) => ({ id, start, length, trimStart }));
  });

  expect(result).toEqual([
    { id: "aud_1", start: 24, length: 36, trimStart: 12 },
    { id: expect.stringMatching(/^aud_1_split_/), start: 60, length: 60, trimStart: 48 },
  ]);
});

test("director timeline model refuses to split image clips", async ({ page }) => {
  const result = await page.evaluate(() => {
    const model = DirectorTimelineModel.create({
      fps: 24,
      items: [{ id: "img_1", track: "main", kind: "image", start: 0, length: 48, mediaPath: "guide.png" }],
    });
    return model.split("main", "img_1", 24);
  });

  expect(result).toBe(false);
});

test("director timeline model moves and resizes in frame space", async ({ page }) => {
  const result = await page.evaluate(() => {
    const model = DirectorTimelineModel.create({
      fps: 24,
      items: [{ id: "seg_1", track: "main", kind: "video", start: 0, length: 48, trimStart: 0 }],
    });
    model.move("main", "seg_1", 12);
    model.resizeLeft("main", "seg_1", 24);
    model.resizeRight("main", "seg_1", 84);
    return model.items.map(({ start, length, trimStart }) => ({ start, length, trimStart }));
  });

  expect(result).toEqual([{ start: 24, length: 60, trimStart: 12 }]);
});

test("director timeline model serializes back to app seconds", async ({ page }) => {
  const result = await page.evaluate(() => {
    const model = DirectorTimelineModel.create({
      fps: 24,
      items: [
        { id: "seg_1", track: "main", kind: "video", start: 24, length: 48, trimStart: 12, prompt: "shot", mediaPath: "guide.mp4", mediaName: "guide.mp4", strength: 0.65 },
        { id: "aud_1", track: "dialogue", kind: "audio", start: 72, length: 24, trimStart: 6, mediaPath: "line.wav", mediaName: "line.wav", sourceDuration: 96, volume: 0.5 },
      ],
    });
    return model.toAppState();
  });

  expect(result.main).toEqual([expect.objectContaining({ id: "seg_1", start: 1, duration: 2, trimStart: 0.5, videoPath: "guide.mp4" })]);
  expect(result.dialogue).toEqual([expect.objectContaining({ id: "aud_1", start: 3, duration: 1, trimStart: 0.25, audioPath: "line.wav", audioDuration: 4, volume: 0.5 })]);
});

test("director timeline model clamps retake range in frames", async ({ page }) => {
  const result = await page.evaluate(() => {
    return DirectorTimelineModel.clampRange({ start: 90, length: 80, total: 120, minLength: 3 });
  });

  expect(result).toEqual({ start: 90, length: 30 });
});
