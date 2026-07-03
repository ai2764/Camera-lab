import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => Boolean(window.CameraLabWorkspace), null, { timeout: 3000 });
});

test("workspace module exposes edit mode metadata from a single browser API", async ({ page }) => {
  const result = await page.evaluate(() => {
    const workspace = window.CameraLabWorkspace;
    return {
      berniniTags: Object.fromEntries(Object.entries(workspace.BERNINI_TASKS).map(([key, value]) => [key, value.tag])),
      imageModes: [...workspace.BERNINI_IMAGE_MODES],
      visibleEditModes: workspace.visibleBerniniModes(),
      defaults: {
        berniniNegative: workspace.BERNINI_DEFAULT_NEGATIVE,
        inpaintMode: workspace.INPAINT_WORKFLOW_MODE,
        directorPrompt: workspace.DIRECTOR_DEFAULT_GLOBAL_PROMPT,
        timelinePixelsPerSecond: workspace.DIRECTOR_TIMELINE_PIXELS_PER_SECOND,
      },
    };
  });

  expect(result.berniniTags).toMatchObject({
    bernini_t2v: "T2V",
    bernini_v2v: "V2V",
    bernini_rv2v: "RV2V",
    bernini_ads2v: "ADS2V",
  });
  expect(result.imageModes).toEqual(["bernini_t2i", "bernini_i2i", "bernini_r2i"]);
  expect(result.visibleEditModes).toContain("bernini_v2v");
  expect(result.visibleEditModes).not.toContain("bernini_t2i");
  expect(result.defaults).toMatchObject({
    berniniNegative: "bad video",
    inpaintMode: "wan_vace_inpaint",
    timelinePixelsPerSecond: 96,
  });
  expect(result.defaults.directorPrompt).toContain("continuous cinematic video");
});

test("workspace module resolves Bernini tasks through helper functions", async ({ page }) => {
  const result = await page.evaluate(() => {
    const workspace = window.CameraLabWorkspace;
    return {
      v2v: workspace.getBerniniTask("bernini_v2v"),
      missing: workspace.getBerniniTask("missing_mode"),
      imageMode: workspace.isBerniniImageMode("bernini_t2i"),
      videoMode: workspace.isBerniniImageMode("bernini_v2v"),
      visibleModes: workspace.getVisibleBerniniModes(),
      rv2vPrompt: workspace.getBerniniDefaultPrompt("bernini_rv2v"),
      missingPrompt: workspace.getBerniniDefaultPrompt("missing_mode"),
    };
  });

  expect(result.v2v).toMatchObject({
    tag: "V2V",
    sourceVideo: true,
    sourceImage: false,
  });
  expect(result.missing).toBeNull();
  expect(result.imageMode).toBe(true);
  expect(result.videoMode).toBe(false);
  expect(result.visibleModes).toContain("bernini_ads2v");
  expect(result.visibleModes).not.toContain("bernini_r2i");
  expect(result.rv2vPrompt).toContain("Replace the girl");
  expect(result.missingPrompt).toBe("");
});

test("workspace module creates the default app state used by the monolithic app", async ({ page }) => {
  const state = await page.evaluate(() => {
    const created = window.CameraLabWorkspace.createInitialState("director");
    return {
      workspace: created.workspace,
      directorMode: created.directorMode,
      directorTracks: {
        main: created.directorSegments,
        videoAudio: created.directorVideoAudioSegments,
        icVideo: created.directorIcVideoSegments,
        dialogue: created.directorAudioSegments,
      },
      retake: {
        start: created.directorRetakeStart,
        length: created.directorRetakeLength,
        strength: created.directorRetakeStrength,
        autoStitch: created.directorRetakeAutoStitch,
      },
      edit: {
        berniniWorkflowId: created.berniniWorkflowId,
        inpaintWorkflowId: created.inpaintWorkflowId,
      },
      motion3d: created.motion3d,
      castingLines: created.castingLines,
    };
  });

  expect(state.workspace).toBe("director");
  expect(state.directorMode).toBe("generate");
  expect(state.directorTracks).toEqual({ main: [], videoAudio: [], icVideo: [], dialogue: [] });
  expect(state.retake).toEqual({ start: 0, length: 1, strength: 1, autoStitch: true });
  expect(state.edit).toEqual({ berniniWorkflowId: "bernini_t2v", inpaintWorkflowId: "wan_vace_inpaint" });
  expect(state.motion3d.timeline).toEqual([]);
  expect(state.motion3d.duration).toBe(3);
  expect(state.castingLines).toEqual([]);
});
