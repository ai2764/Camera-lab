const { test, expect } = require("@playwright/test");

const png1x1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

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

  await page.locator("#motionPrompt").fill("A person walks forward and waves.");
  await page.setInputFiles("#motionRefInput", { name: "ref.png", mimeType: "image/png", buffer: png1x1 });
  await expect(page.locator("#motionRefStatus")).toHaveText("ref.png");

  await expect(page.locator("#motionRunBtn")).toBeDisabled();
  await page.locator("#motionGuideBtn").click();

  await expect(page.locator("#motionGuideState")).toHaveText("ready");
  await expect(page.locator("#motionGuide")).toHaveAttribute("src", /guide\.mp4/);
  await expect(page.locator("#motionRunBtn")).toBeEnabled();
  await page.locator("#motionRunBtn").click();
  await expect(page.locator("#motionResultState")).toHaveText("ready");
  await expect(page.locator("#motionResult")).toHaveAttribute("src", /final\.mp4/);
});
