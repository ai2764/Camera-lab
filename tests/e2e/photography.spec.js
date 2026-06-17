const { test, expect } = require("@playwright/test");

test("photography workspace supports camera keyframes and canny preview", async ({ page }) => {
  let uploadedSubject = "";
  let shotPackPayload = null;
  await page.route("**/api/photography-frames", async (route) => {
    const payload = route.request().postDataJSON();
    uploadedSubject = payload.subject_image || "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        run_id: "photo_e2e",
        frame_count: payload.frames.length,
        width: payload.width,
        height: payload.height,
        comfy_input_subdir: "camera_lab_photography/photo_e2e",
        first_frame: "camera_lab_photography/photo_e2e/frame_0001.png",
        manifest: "ComfyUI/input/camera_lab_photography/photo_e2e/manifest.json",
        workflow: "ComfyUI/user/default/workflows/Photography_LTX-2.3_ICLoRA_Union_Control_Canny.local.json",
        subject_image: payload.subject_image || "",
      }),
    });
  });
  await page.route("**/api/photography-subject", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        name: "subject.png",
        comfy_input_name: "camera_lab_photography_subjects/subject_e2e.png",
        path: "tasks/camera_lab_uploads/photography_subjects/subject_e2e.png",
      }),
    });
  });
  await page.route("**/api/shot-pack", async (route) => {
    shotPackPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        shot_id: "shot_e2e",
        path: "tasks/camera_lab_shots/shot_e2e",
        plan: "tasks/camera_lab_shots/shot_e2e/shot_plan.json",
        frames: shotPackPayload.frames.map((frame, index) => ({
          label: frame.label,
          frame: frame.frame,
          filename: `${index + 1}_${frame.label}.png`,
          path: `tasks/camera_lab_shots/shot_e2e/${index + 1}_${frame.label}.png`,
        })),
      }),
    });
  });

  await page.goto("/#photography");
  await expect(page.locator("#comfyStatus")).toContainText(/ComfyUI:/);
  await expect(page.locator("body")).toHaveClass(/photography-workspace-active/);

  const viewport = page.locator("#photoViewport canvas");
  await expect(viewport).toBeVisible();
  await expect
    .poll(async () =>
      viewport.evaluate((canvas) => ({
        width: canvas.width,
        height: canvas.height,
        nonEmpty: Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl")),
      })),
    )
    .toMatchObject({ nonEmpty: true });

  await page.locator("#photoFramesInput").fill("12");
  await page.locator("#photoSubjectInput").setInputFiles({
    name: "subject.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.locator("#photoSubjectStatus")).toContainText("camera_lab_photography_subjects/subject_e2e.png");
  await page.locator("#photoFrameSlider").evaluate((slider) => {
    slider.value = "5";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await page.getByRole("button", { name: "Add / Update Current Frame" }).click();
  await expect(page.locator(".photo-keyframe-row")).toHaveCount(3);
  await expect(page.locator(".photo-keyframe-marker")).toHaveCount(3);

  await page.locator("#photoEaseSelect").selectOption("linear");
  await expect(page.locator(".photo-keyframe-row.active strong")).toHaveText("linear");

  await page.getByRole("button", { name: "Bake Canny Preview" }).click();
  await expect(page.locator(".photo-canny-frame")).toHaveCount(12);

  await page.locator("#photoSendComfyBtn").scrollIntoViewIfNeeded();
  await page.locator("#photoSendComfyBtn").click();
  await expect(page.locator("#photoStatus")).toContainText("Photography_LTX-2.3_ICLoRA_Union_Control_Canny.local.json updated");
  expect(uploadedSubject).toBe("camera_lab_photography_subjects/subject_e2e.png");

  await page.locator("#photoExportShotPackBtn").scrollIntoViewIfNeeded();
  await page.locator("#photoExportShotPackBtn").click();
  await expect(page.locator("#photoStatus")).toContainText("Exported shot pack shot_e2e");
  expect(shotPackPayload.frames).toHaveLength(3);
  expect(shotPackPayload.frames.map((frame) => frame.label)).toEqual(["start", "middle", "end"]);
  expect(shotPackPayload.plan.camera_prompt).toContain("Camera");
  await expect(page.locator("body")).toHaveClass(/director-workspace-active/);
  await expect(page.locator("#directorTrack .director-block")).toHaveCount(3);
  await expect(page.locator("#directorGlobalPrompt")).toHaveValue(/Camera/);
  await expect(page.locator("#runHint")).toContainText("Imported 3 shot-pack reference frames into Director");
});
