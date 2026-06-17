const { test, expect } = require("@playwright/test");

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);
const mp4Tiny = Buffer.from("AAAAIGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQ==", "base64");

const motionHistoryRun = {
  batch_id: "motion_history",
  run_id: "01_motion",
  workflow_mode: "motion",
  prompt: "A person walks forward and waves.",
  duration: 4,
  status: "done",
  queued_at: Date.now() / 1000,
  started_at: Date.now() / 1000,
  finished_at: Date.now() / 1000,
  guide_video: "C:\\mock\\guide.mp4",
  video: "C:\\mock\\final.mp4",
};

const motionGuideHistoryRun = {
  batch_id: "motion_guide_history",
  run_id: "01_motion",
  workflow_mode: "motion",
  prompt: "A guide-only motion.",
  duration: 3,
  seed: 111,
  cfg_scale: 4.5,
  status: "guide_done",
  queued_at: Date.now() / 1000,
  started_at: Date.now() / 1000,
  finished_at: Date.now() / 1000,
  guide_video: "C:\\mock\\guide-only.mp4",
};

const motionFinalHistoryRun = {
  batch_id: "motion_final_history",
  run_id: "01_motion",
  workflow_mode: "motion",
  prompt: "A final setup motion.",
  duration: 5,
  seed: 222,
  cfg_scale: 3.5,
  width: 832,
  height: 480,
  steps: 12,
  pose_strength: 0.64,
  guide_trim_start: 1.25,
  guide_trim_end: 2.75,
  reference_image: "C:\\mock\\ref-setup.png",
  status: "done",
  queued_at: Date.now() / 1000,
  started_at: Date.now() / 1000,
  finished_at: Date.now() / 1000,
  guide_video: "C:\\mock\\guide-final.mp4",
  video: "C:\\mock\\final-setup.mp4",
};

function mockConfig(page) {
  return page.route("**/api/config", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        workflows: [{ id: "i2v_mock", label: "Mock I2V", mode: "i2v", available: true }],
        camera_moves: [{ id: "push_in", name: "Push in", prompts: { base: "A calm camera push in." } }],
        camera_examples: {
          default: {
            url: "/media?path=example.mp4",
            source_url: "#",
            title: "Example",
            description: "Motion reference",
            license: "local",
            credit: "test",
          },
          segments: {},
        },
        images: [],
        default_negative: "",
        motion_rewrite_prompt_format: "Rewrite this action as JSON: {}",
        comfy: { ok: true, url: "http://mock", reason: "" },
        casting: {
          llm: { available: true, model: "mock" },
          cosyvoice: { available: true, version: "mock" },
          voices: [],
          emotions: [],
        },
      }),
    });
  });
}

test("Camera Lab history excludes Motion runs", async ({ page }) => {
  await mockConfig(page);
  await page.route("**/api/history?limit=200", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ runs: [motionHistoryRun] }) });
  });
  await page.route("**/api/casting/library", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ clips: [] }) });
  });

  await page.goto("/");
  await expect(page.locator("#cameraWorkspaceTab")).toHaveClass(/active/);
  await expect(page.locator("#resultsGrid")).not.toContainText("A person walks forward and waves.");
  await expect(page.locator("#resultsGrid video")).toHaveCount(0);
  await page.locator("#motionWorkspaceTab").click();
  await expect(page.locator("#motionResultsGrid")).toContainText("A person walks forward and waves.");
  await expect(page.locator("#motionResultsGrid video")).toHaveCount(1);
});

test("Motion tab exposes Text to Motion, SCAIL2, and 3D Motion sub tabs", async ({ page }) => {
  await mockConfig(page);
  await page.route("**/api/history?limit=200", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ runs: [] }) });
  });
  await page.route("**/api/casting/library", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ clips: [] }) });
  });

  await page.goto("/#motion");
  await expect(page.locator("#motionWorkspace")).toBeVisible();
  await expect(page.locator("#motionTextTab")).toHaveClass(/active/);
  await expect(page.locator("#motionTextPanel")).toBeVisible();
  await expect(page.locator("#motionPrompt")).toBeVisible();
  await expect(page.locator("#motionTextPanel #motionGuideInput")).toHaveCount(0);
  await expect(page.locator("#motionTextPanel .motion-video-panel")).toHaveCount(0);

  await page.locator("#motionScailTab").click();
  await expect(page.locator("#motionScailTab")).toHaveClass(/active/);
  await expect(page.locator("#motionScailPanel")).toBeVisible();
  await expect(page.locator("#motionTextPanel")).toBeHidden();
  await expect(page.locator("#motionScailPanel #motionGuideInput")).toBeVisible();
  await expect(page.locator("#motionScailPanel #motionRefInput")).toBeVisible();
  await expect(page.locator("#motionScailPanel #motionResult")).toBeVisible();

  await page.locator("#motion3dTab").click();
  await expect(page.locator("#motion3dTab")).toHaveClass(/active/);
  await expect(page.locator("#motion3dPanel")).toBeVisible();
  await expect(page.locator("#motionScailPanel")).toBeHidden();

  await page.locator("#motionTextTab").click();
  await expect(page.locator("#motionTextPanel")).toBeVisible();
  await expect(page.locator("#motionPrompt")).toBeVisible();
  await expect(page.locator("#motionScailPanel")).toBeHidden();
});

test("Motion history restores motion guides and complete final setups", async ({ page }) => {
  await mockConfig(page);
  await page.route("**/api/history?limit=200", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ runs: [motionGuideHistoryRun, motionFinalHistoryRun] }),
    });
  });
  await page.route("**/api/casting/library", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ clips: [] }) });
  });

  await page.goto("/#motion");
  await expect(page.locator("#motionWorkspace")).toBeVisible();

  const guideCard = page.locator("#motionResultsGrid .result-card").filter({ hasText: "A guide-only motion." });
  await expect(guideCard.locator(".use-prompt-run")).toHaveText("Use Motion");
  await guideCard.locator(".use-prompt-run").click();
  await expect(page.locator("#motionPrompt")).toHaveValue("A guide-only motion.");
  await expect(page.locator("#motionGuide")).toHaveAttribute("src", /guide-only\.mp4/);
  await expect(page.locator("#motionGuideUploadStatus")).toHaveText("guide-only.mp4");
  await expect(page.locator("#motionGuideState")).toHaveText("ready");
  await expect(page.locator("#motionRunBtn")).toBeDisabled();

  const finalCard = page.locator("#motionResultsGrid .result-card").filter({ hasText: "A final setup motion." });
  await expect(finalCard.locator(".use-prompt-run")).toHaveText("Use Same Setup");
  await finalCard.locator(".use-prompt-run").click();
  await expect(page.locator("#motionScailTab")).toHaveClass(/active/);
  await expect(page.locator("#motionPrompt")).toHaveValue("A final setup motion.");
  await expect(page.locator("#motionGuide")).toHaveAttribute("src", /guide-final\.mp4/);
  await expect(page.locator("#motionResult")).toHaveAttribute("src", /final-setup\.mp4/);
  await expect(page.locator("#motionRefPreviewWrap")).toHaveClass(/has-image/);
  await expect(page.locator("#motionRefStatus")).toHaveText("ref-setup.png");
  await expect(page.locator("#motionDuration")).toHaveValue("5");
  await expect(page.locator("#motionSeed")).toHaveValue("222");
  await expect(page.locator("#motionCustomSizeInput")).toHaveValue("832x480");
  await expect(page.locator("#motionSteps")).toHaveValue("12");
  await expect(page.locator("#motionPoseStrength")).toHaveValue("0.64");
  await expect(page.locator("#motionCfg")).toHaveValue("3.5");
  await expect(page.locator("#motionTrimStart")).toHaveValue("1.25");
  await expect(page.locator("#motionTrimEnd")).toHaveValue("2.75");
  await expect(page.locator("#motionRunBtn")).toBeEnabled();
});

test("Motion tab generates guide before rendering final result", async ({ page }) => {
  let finalRequested = false;
  await mockConfig(page);
  await page.route("**/api/history?limit=200", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ runs: [] }) });
  });
  await page.route("**/api/casting/library", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ clips: [] }) });
  });
  await page.route("**/api/upload-image", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ path: "C:\\mock\\ref.png", name: "ref.png" }),
    });
  });
  await page.route("**/api/text-to-motion-guide", async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.prompt).toContain("waves");
    expect(payload.reference_path).toBe("");
    expect(payload.rewrite).toBe(false);
    expect(payload.duration).toBe(4);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        batch_id: "motion_e2e",
        status: "running",
        queued_at: Date.now() / 1000,
        runs: [{
          batch_id: "motion_e2e",
          run_id: "01_motion",
          workflow_mode: "motion",
          prompt: payload.prompt,
          status: "running_motion",
          queued_at: Date.now() / 1000,
          started_at: Date.now() / 1000,
        }],
      }),
    });
  });
  await page.route("**/api/text-to-motion-final", async (route) => {
    finalRequested = true;
    const payload = route.request().postDataJSON();
    expect(payload.batch_id).toBe("motion_e2e");
    expect(payload.reference_path).toBe("C:\\mock\\ref.png");
    expect(payload.guide_trim_start).toBe(2.95);
    expect(payload.guide_trim_end).toBe(3);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        batch_id: "motion_e2e",
        status: "running",
        queued_at: Date.now() / 1000,
        runs: [{
          batch_id: "motion_e2e",
          run_id: "01_motion",
          workflow_mode: "motion",
          prompt: "A person walks forward and waves.",
          duration: 4,
          status: "running_video",
          queued_at: Date.now() / 1000,
          started_at: Date.now() / 1000,
          guide_video: "C:\\mock\\guide.mp4",
        }],
      }),
    });
  });
  await page.route("**/api/batches/motion_e2e", async (route) => {
    const run = finalRequested
      ? {
          batch_id: "motion_e2e",
          run_id: "01_motion",
          workflow_mode: "motion",
          prompt: "A person walks forward and waves.",
          duration: 4,
          status: "done",
          queued_at: Date.now() / 1000,
          started_at: Date.now() / 1000,
          finished_at: Date.now() / 1000,
          guide_video: "C:\\mock\\guide.mp4",
          video: "C:\\mock\\final.mp4",
        }
      : {
          batch_id: "motion_e2e",
          run_id: "01_motion",
          workflow_mode: "motion",
          prompt: "A person walks forward and waves.",
          duration: 4,
          status: "guide_done",
          queued_at: Date.now() / 1000,
          started_at: Date.now() / 1000,
          finished_at: Date.now() / 1000,
          guide_video: "C:\\mock\\guide.mp4",
        };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        batch_id: "motion_e2e",
        status: "done",
        queued_at: Date.now() / 1000,
        finished_at: Date.now() / 1000,
        runs: [run],
      }),
    });
  });
  await page.route("**/media?path=*", async (route) => {
    await route.fulfill({ contentType: "video/mp4", body: Buffer.from([]) });
  });

  await page.goto("/");
  await page.locator("#motionWorkspaceTab").click();
  await expect(page.locator("#motionWorkspace")).toBeVisible();
  await expect(page.locator(".motion-guide-panel #motionPrompt")).toBeVisible();
  await expect(page.locator(".motion-guide-panel #motionGuide")).toBeVisible();
  await page.locator("#motionScailTab").click();
  await expect(page.locator("#motionScailPanel .motion-video-panel #motionRefInput")).toBeVisible();
  await expect(page.locator("#motionScailPanel .motion-video-panel #motionResult")).toBeVisible();
  await expect(page.locator("#motionScailSettings")).toHaveAttribute("open", "");
  const videoPanelBox = await page.locator(".motion-video-panel").boundingBox();
  const finalBodyBox = await page.locator(".motion-video-panel .motion-panel-body").boundingBox();
  const refPreviewBox = await page.locator(".motion-reference-preview-card").boundingBox();
  const finalPreviewBox = await page.locator(".motion-video-panel .motion-preview-card").boundingBox();
  expect(videoPanelBox.width).toBeGreaterThan(900);
  expect(finalPreviewBox.x).toBeGreaterThan(finalBodyBox.x);
  expect(refPreviewBox.x).toBeGreaterThan(finalBodyBox.x);
  expect(finalPreviewBox.x).toBeGreaterThan(refPreviewBox.x);
  expect(Math.abs(refPreviewBox.y - finalPreviewBox.y)).toBeLessThan(2);
  expect(Math.abs(refPreviewBox.width - finalPreviewBox.width)).toBeLessThan(2);
  expect(Math.abs(refPreviewBox.height - finalPreviewBox.height)).toBeLessThan(2);
  await page.locator("#motionTextTab").click();
  const guideBodyBox = await page.locator(".motion-guide-panel .motion-panel-body").boundingBox();
  const guidePreviewBox = await page.locator(".motion-guide-panel .motion-preview-card").boundingBox();
  expect(guidePreviewBox.x).toBeGreaterThan(guideBodyBox.x);
  expect(Math.abs(guidePreviewBox.width - guideBodyBox.width)).toBeLessThan(80);
  expect(guidePreviewBox.height).toBeGreaterThan(440);

  await page.locator("#motionPrompt").fill("A person walks forward and waves.");

  await expect(page.locator("#motionRunBtn")).toBeDisabled();
  await page.locator("#motionGuideBtn").click();

  await expect(page.locator("#motionGuideState")).toHaveText("ready");
  await expect(page.locator("#motionGuide")).toHaveAttribute("src", /guide\.mp4/);
  await expect(page.locator("#motionTrimPanel")).toBeVisible();
  await page.locator("#motionTrimStart").fill("0.5");
  await page.locator("#motionTrimEnd").fill("3");
  await expect(page.locator("#motionTrimDuration")).toHaveText("2.50s");
  await page.evaluate(() => {
    document.querySelector("#motionGuide").currentTime = 3.5;
  });
  await page.locator("#motionTrimSetStart").click();
  await expect(page.locator("#motionTrimStart")).toHaveValue("2.95");
  await expect(page.locator("#motionTrimEnd")).toHaveValue("3");
  await page.evaluate(() => {
    document.querySelector("#motionGuide").currentTime = 1;
  });
  await page.locator("#motionTrimSetEnd").click();
  await expect(page.locator("#motionTrimStart")).toHaveValue("2.95");
  await expect(page.locator("#motionTrimEnd")).toHaveValue("3");
  await expect(page.locator("#motionResultsGrid")).toContainText("A person walks forward and waves.");
  await expect(page.locator("#motionResultsGrid video")).toHaveCount(1);
  await expect(page.locator("#motionRunBtn")).toBeDisabled();
  await page.locator("#motionScailTab").click();
  await page.setInputFiles("#motionRefInput", { name: "ref.png", mimeType: "image/png", buffer: png1x1 });
  await expect(page.locator("#motionRefStatus")).toHaveText("ref.png");
  await expect(page.locator("#motionRefPreviewWrap")).toHaveClass(/has-image/);
  await expect(page.locator("#motionRunBtn")).toBeEnabled();
  await page.locator("#motionRunBtn").click();
  await expect(page.locator("#motionResultState")).toHaveText("ready");
  await expect(page.locator("#motionResult")).toHaveAttribute("src", /final\.mp4/);
  await expect(page.locator("#motionResultsGrid video")).toHaveCount(1);

  await page.locator("#cameraWorkspaceTab").click();
  await expect(page.locator("#resultsGrid")).not.toContainText("A person walks forward and waves.");
  await expect(page.locator("#resultsGrid video")).toHaveCount(0);
});

test("Motion tab uploads a guide video and renders directly with SCAIL2", async ({ page }) => {
  await mockConfig(page);
  await page.route("**/api/history?limit=200", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ runs: [] }) });
  });
  await page.route("**/api/casting/library", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ clips: [] }) });
  });
  await page.route("**/api/upload-image", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ path: "C:\\mock\\ref.png", name: "ref.png" }),
    });
  });
  await page.route("**/api/upload-video", async (route) => {
    expect(route.request().headers()["content-type"]).toContain("multipart/form-data");
    expect(route.request().postDataBuffer().toString("utf8")).toContain("guide.mp4");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ path: "C:\\mock\\guide-upload.mp4", name: "guide.mp4" }),
    });
  });
  await page.route("**/api/text-to-motion-video-final", async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.guide_video_path).toBe("C:\\mock\\guide-upload.mp4");
    expect(payload.reference_path).toBe("C:\\mock\\ref.png");
    expect(payload.seed).toBe("777");
    expect(payload.guide_trim_start).toBe(0);
    expect(payload.guide_trim_end).toBe(4);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        batch_id: "motion_upload_e2e",
        status: "running",
        queued_at: Date.now() / 1000,
        runs: [{
          batch_id: "motion_upload_e2e",
          run_id: "01_motion",
          workflow_mode: "motion",
          prompt: "uploaded guide video",
          duration: 4,
          status: "running_video",
          queued_at: Date.now() / 1000,
          started_at: Date.now() / 1000,
          guide_video: "C:\\mock\\guide-upload.mp4",
        }],
      }),
    });
  });
  await page.route("**/api/batches/motion_upload_e2e", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        batch_id: "motion_upload_e2e",
        status: "done",
        queued_at: Date.now() / 1000,
        finished_at: Date.now() / 1000,
        runs: [{
          batch_id: "motion_upload_e2e",
          run_id: "01_motion",
          workflow_mode: "motion",
          prompt: "uploaded guide video",
          duration: 4,
          status: "done",
          queued_at: Date.now() / 1000,
          started_at: Date.now() / 1000,
          finished_at: Date.now() / 1000,
          guide_video: "C:\\mock\\guide-upload.mp4",
          video: "C:\\mock\\final-upload.mp4",
        }],
      }),
    });
  });
  await page.route("**/media?path=*", async (route) => {
    await route.fulfill({ contentType: "video/mp4", body: Buffer.from([]) });
  });

  await page.goto("/#motion");
  await expect(page.locator("#motionWorkspace")).toBeVisible();
  await page.locator("#motionScailTab").click();
  await expect(page.locator("#motionScailSeed")).toBeVisible();
  await page.locator("#motionScailSeed").fill("777");
  await page.setInputFiles("#motionRefInput", { name: "ref.png", mimeType: "image/png", buffer: png1x1 });
  await expect(page.locator("#motionRefStatus")).toHaveText("ref.png");
  await expect(page.locator("#motionRefPreviewWrap")).toHaveClass(/has-image/);
  await page.setInputFiles("#motionGuideInput", { name: "guide.mp4", mimeType: "video/mp4", buffer: mp4Tiny });
  await expect(page.locator("#motionGuideUploadStatus")).toHaveText("guide.mp4");
  await expect(page.locator("#motionGuideState")).toHaveText("uploaded");
  await expect(page.locator("#motionGuide")).toHaveAttribute("src", /guide-upload\.mp4/);
  await expect(page.locator("#motionRunBtn")).toBeEnabled();

  await page.locator("#motionRunBtn").click();
  await expect(page.locator("#motionResultState")).toHaveText("ready");
  await expect(page.locator("#motionResult")).toHaveAttribute("src", /final-upload\.mp4/);
  await expect(page.locator("#motionResultsGrid")).toContainText("uploaded guide video");
  await expect(page.locator("#motionResultsGrid video")).toHaveCount(1);
});
