const { test, expect } = require("@playwright/test");

test("home screen loads public Camera Lab controls", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator(".topbar h1")).toContainText("Camera Lab");
  await expect(page.locator("#workflowSelect")).toBeVisible();
  await expect(page.locator("#directorWorkspaceTab")).toBeVisible();
  await expect(page.locator("#editWorkspaceTab")).toBeVisible();
  await expect(page.locator("#editWorkspaceTab")).toHaveText("Edit");
  await expect(page.locator("#berniniWorkspaceTab")).toHaveCount(0);
  await expect(page.locator("#inpaintWorkspaceTab")).toHaveCount(0);
  await expect(page.locator("#photographyWorkspaceTab")).toBeHidden();
});

test("edit workspace combines Bernini video modes and Inpaint", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_ads2v']")).toHaveCount(1);
  await expect(page.locator("#workflowSelect option[value='bernini_t2i']")).toHaveCount(0);
  await expect(page.locator("#workflowSelect option[value='bernini_i2i']")).toHaveCount(0);
  await expect(page.locator("#workflowSelect option[value='bernini_r2i']")).toHaveCount(0);
  await page.locator("#editWorkspaceTab").click();

  await expect(page.locator("#berniniModeBar")).toBeVisible();
  await expect(page.locator("#berniniModeBar #berniniTaskTabs")).toHaveCount(1);
  await expect(page.locator("#berniniTaskPanel #berniniTaskTabs")).toHaveCount(0);
  await expect(page.locator("#berniniTaskTabs")).toHaveClass(/motion-subtabs/);
  await expect(page.locator("#berniniTaskTabs .motion-subtab")).toHaveCount(10);
  await expect(page.locator("[data-bernini-workflow='bernini_default']")).toHaveCount(0);
  await expect(page.locator("[data-bernini-workflow='bernini_t2i']")).toHaveCount(0);
  await expect(page.locator("[data-bernini-workflow='bernini_i2i']")).toHaveCount(0);
  await expect(page.locator("[data-bernini-workflow='bernini_r2i']")).toHaveCount(0);
  await expect(page.locator("[data-edit-workflow='wan_vace_inpaint']")).toBeVisible();
  await expect(page.locator("#berniniTaskTabs .bernini-task-tab")).toHaveCount(0);
  await expect(page.locator("#promptText")).toHaveValue("A cat walking through a sunny garden, cinematic");
  await expect(page.locator("#negativePrompt")).toHaveValue("bad video");
  await page.locator("[data-bernini-workflow='bernini_i2v']").click();
  await expect(page.locator("#promptTag")).toHaveText("I2V");
  await expect(page.locator("#durationWrap")).toBeVisible();
  await page.locator("[data-bernini-workflow='bernini_v2v']").click();
  await expect(page.locator("#durationWrap")).toBeVisible();
  await expect(page.locator("#berniniTaskPanel")).toBeVisible();
  await expect(page.locator("#berniniSourceVideoWrap")).toBeVisible();
  await expect(page.locator("#berniniPreserveAudioWrap")).toBeVisible();
  await expect(page.locator("#inpaintTaskPanel")).toBeHidden();
  await expect(page.locator("#berniniReferenceVideoWrap")).toBeHidden();
  await expect(page.locator("#berniniReferenceImageWrap")).toBeHidden();
  await page.locator("[data-bernini-workflow='bernini_mv2v']").click();
  await expect(page.locator("#promptTag")).toHaveText("MV2V");
  await expect(page.locator("#berniniSourceVideoWrap")).toBeVisible();
  await expect(page.locator("#berniniReferenceVideoWrap")).toBeHidden();
  await expect(page.locator("#berniniReferenceImageWrap")).toBeHidden();

  await page.locator("[data-bernini-workflow='bernini_vi2v']").click();
  await expect(page.locator("#promptTag")).toHaveText("VI2V");
  await expect(page.locator("#berniniSourceVideoWrap")).toBeVisible();
  await expect(page.locator("#berniniReferenceImageWrap")).toBeVisible();
  await expect(page.locator("#berniniReferenceVideoWrap")).toBeHidden();

  await page.locator("[data-bernini-workflow='bernini_ads2v']").click();
  await expect(page.locator("#promptText")).toHaveValue("Insert the product naturally onto the table");
  await expect(page.locator("#berniniTaskPanel")).toBeVisible();
  await expect(page.locator("#berniniSourceVideoWrap")).toBeVisible();
  await expect(page.locator("#berniniReferenceVideoWrap")).toBeVisible();
  await expect(page.locator("#berniniReferenceImageWrap")).toBeHidden();

  await page.locator("[data-edit-workflow='wan_vace_inpaint']").click();
  await expect(page.locator("#promptTag")).toHaveText("INPAINT");
  await expect(page.locator("#inpaintTaskPanel")).toBeVisible();
  await expect(page.locator("#inpaintCanvasPanel")).toBeVisible();
  await expect(page.locator("#berniniTaskPanel")).toBeHidden();
});

test("bernini task tabs load workflow default user prompts", async ({ page }) => {
  const expectedPrompts = {
    bernini_t2v: "A cat walking through a sunny garden, cinematic",
    bernini_i2v: "Animate this image with gentle camera push-in",
    bernini_v2v: "Restyle the video into a watercolor look",
    bernini_mv2v: "change the lighting to warm golden hour",
    bernini_vi2v: "propagate the edit consistently across the whole clip",
    bernini_vrc2v: "make the subject raise their right hand",
    bernini_r2v: "This subject dancing on a neon stage",
    bernini_rv2v: "Replace the girl in the video with a girl dressed in student attire",
    bernini_ads2v: "Insert the product naturally onto the table",
  };
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_default']")).toHaveCount(0);
  await expect(page.locator("#workflowSelect option[value='bernini_t2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();

  for (const [workflowId, prompt] of Object.entries(expectedPrompts)) {
    await page.evaluate((id) => setBerniniWorkflow(id), workflowId);
    await expect(page.locator("#promptText")).toHaveValue(prompt);
    await expect(page.locator("#negativePrompt")).toHaveValue("bad video");
  }
});

test("bernini payload maps image and video inputs by task", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_rv2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await page.locator("[data-bernini-workflow='bernini_rv2v']").click();
  await expect(page.locator("#berniniReferenceControls")).toBeVisible();
  await page.locator("#berniniReferenceStrength").fill("0.8");
  await page.locator("#berniniRefMaxSize").fill("1024");
  await page.evaluate(() => {
    state.berniniSourceVideoPath = "tasks/camera_lab_uploads/videos/source.mp4";
    state.berniniReferenceImagePath = "tasks/camera_lab_uploads/images/ref.png";
    document.getElementById("promptText").value = "replace the actor";
  });
  await page.locator("#berniniPreserveAudio").check();

  const payload = await page.evaluate(() => collectPayload());

  expect(payload.workflow_id).toBe("bernini_rv2v");
  expect(payload.source_video_path).toContain("source.mp4");
  expect(payload.reference_image_path).toContain("ref.png");
  expect(payload.reference_video_path).toBe("");
  expect(payload.bernini_preserve_audio).toBe(true);
  expect(payload.global_reference_strength).toBe(0.8);
  expect(payload.bernini_ref_max_size).toBe(1024);

  await page.locator("[data-bernini-workflow='bernini_v2v']").click();
  await expect(page.locator("#berniniReferenceControls")).toBeHidden();

  await page.locator("[data-bernini-workflow='bernini_vi2v']").click();
  await expect(page.locator("#berniniReferenceControls")).toBeVisible();
  await page.evaluate(() => {
    state.berniniSourceVideoPath = "tasks/camera_lab_uploads/videos/source.mp4";
    state.berniniReferenceImagePath = "tasks/camera_lab_uploads/images/guide.png";
    document.getElementById("promptText").value = "propagate the edit";
  });

  const vi2vPayload = await page.evaluate(() => collectPayload());

  expect(vi2vPayload.workflow_id).toBe("bernini_vi2v");
  expect(vi2vPayload.source_video_path).toContain("source.mp4");
  expect(vi2vPayload.reference_image_path).toContain("guide.png");
});

test("bernini rv2v exposes long video split controls in payload", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_rv2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await page.locator("[data-bernini-workflow='bernini_v2v']").click();
  await expect(page.locator("#berniniLongVideoPanel")).toBeHidden();

  await page.locator("[data-bernini-workflow='bernini_rv2v']").click();
  await expect(page.locator("#berniniLongVideoPanel")).toBeVisible();
  await page.locator("#berniniSplitEnabled").check();
  await page.locator("#berniniSplitDuration").fill("4.5");
  await page.evaluate(() => {
    state.berniniSourceVideoPath = "tasks/camera_lab_uploads/videos/long.mp4";
    state.berniniReferenceImagePath = "tasks/camera_lab_uploads/images/ref.png";
    document.getElementById("promptText").value = "replace the actor";
  });

  const payload = await page.evaluate(() => collectPayload());

  expect(payload.workflow_id).toBe("bernini_rv2v");
  expect(payload.bernini_split_enabled).toBe(true);
  expect(payload.bernini_split_duration).toBe(4.5);
  expect(payload.bernini_split_merge).toBe(true);
});

test("bernini source video can be trimmed with modal clipper", async ({ page }) => {
  let trimPayload = null;
  await page.route("**/api/trim-video", async (route) => {
    trimPayload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        path: "C:\\mock\\clips\\source_1_3.mp4",
        name: "source_1_3.mp4",
        duration: 2,
      }),
    });
  });

  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_v2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await expect(page.locator("#berniniModeBar")).toBeVisible();
  await page.locator("[data-bernini-workflow='bernini_v2v']").click();
  await page.evaluate(() => {
    state.berniniSourceVideoPath = "tasks/camera_lab_uploads/videos/source.mp4";
    state.berniniSourceVideoName = "source.mp4";
    document.getElementById("berniniSourceVideoStatus").textContent = "source.mp4";
    updateVideoClipperButtons();
  });

  await expect(page.locator("#berniniSourceVideoEditBtn")).toBeEnabled();
  await page.locator("#berniniSourceVideoEditBtn").click();
  await expect(page.locator("#videoClipperModal")).toHaveClass(/open/);
  await expect(page.locator("#videoClipperSetStartBtn")).toHaveCount(0);
  await expect(page.locator("#videoClipperSetEndBtn")).toHaveCount(0);
  await page.evaluate(() => {
    const video = document.getElementById("videoClipperPlayer");
    Object.defineProperty(video, "duration", { configurable: true, value: 5 });
    video.dispatchEvent(new Event("loadedmetadata"));
  });
  await page.locator("#videoClipperStart").fill("1");
  await page.locator("#videoClipperEnd").fill("3");
  await page.locator("#videoClipperUseBtn").click();

  expect(trimPayload.video_path).toContain("source.mp4");
  expect(trimPayload.start).toBe(1);
  expect(trimPayload.end).toBe(3);
  await expect(page.locator("#videoClipperModal")).not.toHaveClass(/open/);
  await expect(page.locator("#berniniSourceVideoStatus")).toContainText("source_1_3.mp4");
  await expect(page.locator("#berniniSourceVideoPreview")).toHaveAttribute("src", /source_1_3\.mp4/);
  const payload = await page.evaluate(() => collectPayload());
  expect(payload.source_video_path).toContain("source_1_3.mp4");
});

test("video clipper fits the edit panel at 512 square viewport", async ({ page }) => {
  await page.setViewportSize({ width: 512, height: 512 });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_v2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await page.locator("[data-bernini-workflow='bernini_v2v']").click();
  await page.locator("#sizePreset").selectOption("512x512");
  await page.evaluate(() => {
    setVideoSlot("berniniSource", "tasks/camera_lab_uploads/videos/source.mp4", "source.mp4");
  });

  await page.locator("#berniniSourceVideoEditBtn").click();
  await expect(page.locator("#videoClipperModal")).toHaveClass(/open/);
  const metrics = await page.locator(".video-clipper-panel").evaluate((panel) => {
    const preview = panel.querySelector(".video-clipper-preview");
    const useButton = panel.querySelector("#videoClipperUseBtn");
    const panelBox = panel.getBoundingClientRect();
    const previewBox = preview.getBoundingClientRect();
    const buttonBox = useButton.getBoundingClientRect();
    return {
      panelBottom: panelBox.bottom,
      panelHeight: panelBox.height,
      previewHeight: previewBox.height,
      buttonBottom: buttonBox.bottom,
      viewportHeight: window.innerHeight,
    };
  });

  expect(metrics.panelBottom).toBeLessThanOrEqual(metrics.viewportHeight - 10);
  expect(metrics.previewHeight).toBeLessThanOrEqual(210);
  expect(metrics.buttonBottom).toBeLessThanOrEqual(metrics.viewportHeight - 10);
});

test("video clipper preview follows the source aspect ratio", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_v2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await page.locator("[data-bernini-workflow='bernini_v2v']").click();
  await page.evaluate(() => {
    setVideoSlot("berniniSource", "tasks/camera_lab_uploads/videos/portrait.mp4", "portrait.mp4");
  });

  await page.locator("#berniniSourceVideoEditBtn").click();
  await expect(page.locator("#videoClipperModal")).toHaveClass(/open/);
  await page.evaluate(() => {
    const video = document.getElementById("videoClipperPlayer");
    Object.defineProperty(video, "duration", { configurable: true, value: 5 });
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 720 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 1280 });
    video.dispatchEvent(new Event("loadedmetadata"));
  });

  const portraitMetrics = await page.locator(".video-clipper-preview").evaluate((preview) => {
    const box = preview.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      ratio: box.width / box.height,
    };
  });
  expect(portraitMetrics.ratio).toBeGreaterThan(0.52);
  expect(portraitMetrics.ratio).toBeLessThan(0.62);
  expect(portraitMetrics.height).toBeGreaterThan(portraitMetrics.width);

  await page.evaluate(() => {
    const video = document.getElementById("videoClipperPlayer");
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 512 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 512 });
    video.dispatchEvent(new Event("loadedmetadata"));
  });

  const squareMetrics = await page.locator(".video-clipper-preview").evaluate((preview) => {
    const box = preview.getBoundingClientRect();
    return box.width / box.height;
  });
  expect(squareMetrics).toBeGreaterThan(0.96);
  expect(squareMetrics).toBeLessThan(1.04);
});

test("uploaded motion media inputs show inline previews below the upload fields", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_v2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await page.locator("[data-bernini-workflow='bernini_v2v']").click();
  await page.evaluate(() => {
    setVideoSlot("berniniSource", "tasks/camera_lab_uploads/videos/source.mp4", "source.mp4");
  });
  const berniniPreview = page.locator("#berniniSourceVideoPreview");
  await expect(berniniPreview).toBeVisible();
  await expect(berniniPreview).toHaveAttribute("src", /\/media\?path=.*source\.mp4/);
  await expect(berniniPreview.locator("xpath=ancestor::*[@id='berniniSourceVideoWrap']")).toHaveCount(1);

  await page.locator("#editWorkspaceTab").click();
  await page.locator("[data-edit-workflow='wan_vace_inpaint']").click();
  await page.evaluate(() => {
    setVideoSlot("inpaintSource", "tasks/camera_lab_uploads/videos/inpaint.mp4", "inpaint.mp4");
  });
  const inpaintPreview = page.locator("#inpaintSourceVideoPreview");
  await expect(inpaintPreview).toBeVisible();
  await expect(inpaintPreview).toHaveAttribute("src", /\/media\?path=.*inpaint\.mp4/);
  await expect(inpaintPreview.locator("xpath=ancestor::*[@id='inpaintSourceVideoWrap']")).toHaveCount(1);

  await page.locator("#motionWorkspaceTab").click();
  await page.locator("#motionScailTab").click();
  await page.evaluate(() => {
    setVideoSlot("motionGuide", "tasks/camera_lab_uploads/videos/guide.mp4", "guide.mp4");
  });
  const motionPreview = page.locator("#motionGuideUploadPreview");
  await expect(motionPreview).toBeVisible();
  await expect(motionPreview).toHaveAttribute("src", /\/media\?path=.*guide\.mp4/);
  await expect(motionPreview.locator("xpath=ancestor::*[@id='motionGuideUploadPreviewWrap']")).toHaveCount(1);

  await page.evaluate(() => {
    const path = "tasks/camera_lab_uploads/images/scail_ref.png";
    state.motionRefPath = path;
    setImagePreview("motion_ref", mediaUrl(path));
    $("motionRefStatus").textContent = "scail_ref.png";
  });
  const scailRefPreview = page.locator("#motionScailRefPreview");
  await expect(page.locator("#motionScailRefPreviewWrap")).toBeVisible();
  await expect(scailRefPreview).toHaveAttribute("src", /\/media\?path=.*scail_ref\.png/);
});

test("motion guide uses the shared video clipper", async ({ page }) => {
  let trimPayload = null;
  let finalPayload = null;
  await page.route("**/api/trim-video", async (route) => {
    trimPayload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        path: "tasks/camera_lab_uploads/videos/guide_1_3.mp4",
        name: "guide_1_3.mp4",
        duration: 2,
      }),
    });
  });
  await page.route("**/api/text-to-motion-video-final", async (route) => {
    finalPayload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        batch_id: "motion_final_batch",
        status: "done",
        runs: [{
          run_id: "01_final",
          status: "done",
          guide_video: finalPayload.guide_video_path,
          video: "tasks/camera_lab_runs/motion_final_batch/01/final.mp4",
        }],
      }),
    });
  });

  await page.goto("/#motion");
  await expect(page.locator("#motionWorkspaceTab")).toHaveClass(/active/);
  await page.evaluate(() => {
    renderMotionBatch({
      batch_id: "motion_guide_batch",
      status: "guide_done",
      runs: [{
        run_id: "01_guide",
        status: "guide_done",
        guide_video: "tasks/camera_lab_runs/motion_guide_batch/01/guide.mp4",
        duration: 5,
        prompt: "walk forward",
      }],
    });
  });

  await expect(page.locator("#motionTrimPanel")).toHaveCount(0);
  await expect(page.locator("#motionGuidePreviewEditBtn")).toBeEnabled();
  await expect(page.locator("#motionGuideEditBtn")).toBeEnabled();
  await page.locator("#motionGuidePreviewEditBtn").click();
  await expect(page.locator("#videoClipperModal")).toHaveClass(/open/);
  await expect(page.locator("#videoClipperTitle")).toHaveText("Motion guide video");
  await page.evaluate(() => {
    const video = document.getElementById("videoClipperPlayer");
    Object.defineProperty(video, "duration", { configurable: true, value: 5 });
    video.dispatchEvent(new Event("loadedmetadata"));
  });
  await page.locator("#videoClipperStart").fill("1");
  await page.locator("#videoClipperEnd").fill("3");
  await page.locator("#videoClipperUseBtn").click();

  expect(trimPayload.video_path).toContain("guide.mp4");
  expect(trimPayload.start).toBe(1);
  expect(trimPayload.end).toBe(3);
  await expect(page.locator("#videoClipperModal")).not.toHaveClass(/open/);
  await expect(page.locator("#motionGuideUploadStatus")).toContainText("guide_1_3.mp4");

  await page.evaluate(() => {
    state.motionRefPath = "tasks/camera_lab_uploads/images/ref.png";
    updateMotionRunAvailability();
  });
  await page.locator("#motionScailTab").click();
  await page.locator("#motionRunBtn").click();

  expect(finalPayload.guide_video_path).toContain("guide_1_3.mp4");
  expect(finalPayload.guide_trim_start).toBeUndefined();
  expect(finalPayload.guide_trim_end).toBeUndefined();
});

test("motion results are typed and scoped by motion subtab", async ({ page }) => {
  await page.route("**/api/history?limit=200", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          {
            batch_id: "motion_text_batch",
            run_id: "01_text",
            workflow_id: "text_to_motion",
            workflow_mode: "motion_text",
            workflow_label: "Motion Guide",
            status: "guide_done",
            guide_video: "tasks/camera_lab_runs/motion_text_batch/01/guide.mp4",
            prompt: "text guide result",
            duration: 4,
          },
          {
            batch_id: "motion_scail_batch",
            run_id: "01_scail",
            workflow_id: "uploaded_motion_to_scail",
            workflow_mode: "motion_scail",
            workflow_label: "SCAIL2",
            status: "done",
            guide_video: "tasks/camera_lab_runs/motion_scail_batch/01/guide.mp4",
            video: "tasks/camera_lab_runs/motion_scail_batch/01/final.mp4",
            prompt: "scail final result",
            seed: 246810,
            duration: 4,
          },
          {
            batch_id: "motion_scail_pending_batch",
            run_id: "01_scail_pending",
            workflow_id: "uploaded_motion_to_scail",
            workflow_mode: "motion_scail",
            workflow_label: "SCAIL2",
            status: "running_video",
            guide_video: "tasks/camera_lab_runs/motion_scail_pending_batch/01/guide.mp4",
            prompt: "scail pending result",
            duration: 4,
          },
          {
            batch_id: "motion_3d_batch",
            run_id: "01_3d",
            workflow_id: "motion_3d_to_scail",
            workflow_mode: "motion_3d",
            workflow_label: "3D Motion",
            status: "done",
            guide_video: "tasks/camera_lab_runs/motion_3d_batch/01/guide.mp4",
            video: "tasks/camera_lab_runs/motion_3d_batch/01/final.mp4",
            prompt: "3d final result",
            duration: 4,
          },
        ],
      }),
    });
  });

  await page.goto("/#motion");
  await expect(page.locator("#motionResultsGrid")).toContainText("text guide result");
  await expect(page.locator("#motionResultsGrid")).not.toContainText("scail final result");
  await expect(page.locator("#motionResultsGrid")).not.toContainText("3d final result");
  await expect(page.locator("#motionResultsGrid .result-card").filter({ hasText: "text guide result" }).locator(".mode-tag")).toHaveText("GUIDE");

  await page.locator("#motionScailTab").click();
  await expect(page.locator("#motionScailPreviewRow")).toHaveCount(0);
  await expect(page.locator("#motionGuidePreviewCard")).toBeHidden();
  await expect(page.locator("#motionResultPreviewCard")).toBeHidden();
  await expect(page.locator("#motionScailOutputSection")).toBeVisible();
  await expect(page.locator("#motionScailResultsGrid")).toContainText("scail final result");
  const pendingCard = page.locator("#motionScailResultsGrid .result-card").filter({ hasText: "scail pending result" });
  await expect(pendingCard).toBeVisible();
  await expect(pendingCard.locator(".media-box")).toContainText("Rendering final video");
  await expect(pendingCard.locator(".media-box video")).toHaveCount(0);
  await expect(page.locator("#motionScailResultsGrid")).not.toContainText("text guide result");
  await expect(page.locator("#motionScailResultsGrid")).not.toContainText("3d final result");
  await expect(page.locator("#motionScailResultsGrid .result-card").filter({ hasText: "scail final result" }).locator(".mode-tag")).toHaveText("SCAIL2");
  await page.locator("#motionScailResultsGrid .result-card").filter({ hasText: "scail final result" }).locator(".use-seed-run").click();
  await expect(page.locator("#motionScailSeed")).toHaveValue("246810");

  await page.locator("#motion3dTab").click();
  await expect(page.locator("#motion3dOutputSection")).toBeVisible();
  await expect(page.locator("#motion3dResultsGrid")).toContainText("3d final result");
  await expect(page.locator("#motion3dResultsGrid")).not.toContainText("text guide result");
  await expect(page.locator("#motion3dResultsGrid")).not.toContainText("scail final result");
  await expect(page.locator("#motion3dResultsGrid .result-card").filter({ hasText: "3d final result" }).locator(".mode-tag")).toHaveText("3D");
});

test("delete removes motion 3d output cards from the visible panel", async ({ page }) => {
  await page.route("**/api/history?limit=200", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          {
            batch_id: "motion_3d_delete_batch",
            run_id: "01_3d",
            history_key: "motion_3d_delete_batch:01_3d",
            workflow_id: "motion_3d_to_scail",
            workflow_mode: "motion_3d",
            workflow_label: "3D Motion",
            status: "done",
            video: "tasks/camera_lab_runs/motion_3d_delete_batch/01_3d/final.mp4",
            prompt: "3d delete result",
            duration: 4,
          },
        ],
      }),
    });
  });
  await page.route("**/api/history-state", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, recycled: ["final.mp4"], cancel: [] }),
    });
  });

  await page.goto("/#motion");
  await page.locator("#motion3dTab").click();
  const card = page.locator("#motion3dResultsGrid .result-card").filter({ hasText: "3d delete result" });
  await expect(card).toBeVisible();

  await card.locator(".delete-run").click();

  await expect(card).toHaveCount(0);
  await expect(page.locator("#runHint")).toContainText("Moved 1 file(s) to Recycle Bin");
});

test("scail render adds a pending result before the API returns", async ({ page }) => {
  let releaseFinal;
  let finalPayload = null;
  const routeSeen = new Promise((resolveSeen) => {
    page.route("**/api/text-to-motion-video-final", async (route) => {
      finalPayload = route.request().postDataJSON();
      resolveSeen();
      await new Promise((resolve) => {
        releaseFinal = resolve;
      });
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          batch_id: "motion_final_delayed_batch",
          status: "queued",
          runs: [{
            run_id: "01_motion",
            workflow_id: "uploaded_motion_to_scail",
            workflow_mode: "motion_scail",
            workflow_label: "SCAIL2",
            status: "queued_video",
            guide_video: "tasks/camera_lab_uploads/videos/guide.mp4",
            prompt: "delayed final render",
            duration: 4,
          }],
        }),
      });
    });
  });

  await page.goto("/#motion");
  await page.locator("#motionScailTab").click();
  await page.evaluate(() => {
    setVideoSlot("motionGuide", "tasks/camera_lab_uploads/videos/guide.mp4", "guide.mp4");
    state.motionRefPath = "tasks/camera_lab_uploads/images/ref.png";
    updateMotionRunAvailability();
  });
  await expect(page.locator("#motionScailPrompt")).toBeVisible();
  await page.locator("#motionScailPrompt").fill("delayed final render");

  await page.locator("#motionRunBtn").click();

  const pendingCard = page.locator("#motionScailResultsGrid .result-card").filter({ hasText: "delayed final render" });
  await expect(pendingCard).toBeVisible();
  await expect(pendingCard.locator(".media-box")).toContainText("Rendering final video");
  await expect(pendingCard.locator(".media-box video")).toHaveCount(0);

  await routeSeen;
  expect(finalPayload.prompt).toBe("delayed final render");
  if (releaseFinal) releaseFinal();
});

test("motion guide subtypes can be sent to edit video inputs", async ({ page }) => {
  await page.route("**/api/history?limit=200", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          {
            batch_id: "motion_text_edit_batch",
            run_id: "01_text",
            workflow_id: "text_to_motion",
            workflow_mode: "motion_text",
            workflow_label: "Motion Guide",
            status: "guide_done",
            guide_video: "tasks/camera_lab_runs/motion_text_edit_batch/01/text_skeleton.mp4",
            prompt: "text skeleton guide",
            duration: 4,
          },
          {
            batch_id: "motion_3d_edit_batch",
            run_id: "01_3d",
            workflow_id: "motion_3d_to_scail",
            workflow_mode: "motion_3d",
            workflow_label: "3D Motion",
            status: "guide_done",
            guide_video: "tasks/camera_lab_runs/motion_3d_edit_batch/01/recorded_3d.mp4",
            prompt: "3d recorded guide",
            duration: 4,
          },
        ],
      }),
    });
  });

  await page.goto("/#motion");
  const textCard = page.locator("#motionResultsGrid .result-card").filter({ hasText: "text skeleton guide" });
  await textCard.locator(".result-video-edit-button").click();
  await textCard.locator(".result-video-edit-menu button", { hasText: /^V2V Source video$/ }).click();
  await expect(page.locator("#editWorkspaceTab")).toHaveClass(/active/);
  await expect(page.locator("#promptTag")).toHaveText("V2V");
  await expect(page.locator("#berniniSourceVideoStatus")).toContainText("text_skeleton.mp4");
  await expect(page.locator("#berniniSourceVideoPreview")).toHaveAttribute("src", /text_skeleton\.mp4/);

  await page.locator("#motionWorkspaceTab").click();
  await page.locator("#motion3dTab").click();
  const recordedCard = page.locator("#motion3dResultsGrid .result-card").filter({ hasText: "3d recorded guide" });
  await recordedCard.locator(".result-video-edit-button").click();
  await recordedCard.locator(".result-video-edit-menu button", { hasText: "Inpaint Source video" }).click();
  await expect(page.locator("#editWorkspaceTab")).toHaveClass(/active/);
  await expect(page.locator("#promptTag")).toHaveText("INPAINT");
  await expect(page.locator("#inpaintSourceVideoStatus")).toContainText("recorded_3d.mp4");
  await expect(page.locator("#inpaintSourceVideoPreview")).toHaveAttribute("src", /recorded_3d\.mp4/);
});

test("result video edit menu only offers Bernini video input modes", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_ads2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await page.evaluate(() => {
    mergeHistoryRuns([{
      batch_id: "batch_result_video",
      run_id: "01_result",
      workflow_id: "bernini_t2v",
      workflow_mode: "bernini_t2v",
      workflow_label: "WAN2.2 Bernini T2V",
      status: "done",
      video: "tasks/camera_lab_runs/batch_result_video/01_result/output.mp4",
      prompt: "source prompt",
      duration: 4,
    }], true);
    renderScopedHistory();
  });

  const card = page.locator("#resultsGrid .result-card").filter({ hasText: "source prompt" });
  await expect(card.locator(".result-video-edit-button")).toBeVisible();
  await expect(card.locator(".media-box .result-video-edit-button")).toHaveCount(0);
  await expect(card.locator(".result-text-actions .last-frame-run + .result-video-edit .result-video-edit-button")).toHaveCount(1);
  await card.locator(".result-video-edit-button").click();
  await expect(card.locator(".result-video-edit-menu")).toContainText("V2V Source video");
  await expect(card.locator(".result-video-edit-menu")).toContainText("MV2V Source video");
  await expect(card.locator(".result-video-edit-menu")).toContainText("VI2V Source video");
  await expect(card.locator(".result-video-edit-menu")).toContainText("VRC2V Source video");
  await expect(card.locator(".result-video-edit-menu")).toContainText("RV2V Source video");
  await expect(card.locator(".result-video-edit-menu")).toContainText("ADS2V Source video");
  await expect(card.locator(".result-video-edit-menu")).toContainText("ADS2V Reference video");
  await expect(card.locator(".result-video-edit-menu")).toContainText("Inpaint Source video");
  await expect(card.locator(".result-video-edit-menu button", { hasText: /^T2V Source video$/ })).toHaveCount(0);
  await expect(card.locator(".result-video-edit-menu button", { hasText: /^I2V Source video$/ })).toHaveCount(0);
  await expect(card.locator(".result-video-edit-menu button", { hasText: /^R2V Source video$/ })).toHaveCount(0);

  await card.locator("button", { hasText: "ADS2V Reference video" }).click();

  await expect(page.locator("#editWorkspaceTab")).toHaveClass(/active/);
  await expect(page.locator("#promptTag")).toHaveText("ADS2V");
  await expect(page.locator("#berniniReferenceVideoWrap")).toBeVisible();
  await expect(page.locator("#berniniReferenceVideoStatus")).toContainText("output.mp4");
  await expect(page.locator("#berniniReferenceVideoEditBtn")).toBeEnabled();
  const payload = await page.evaluate(() => collectPayload());
  expect(payload.workflow_id).toBe("bernini_ads2v");
  expect(payload.reference_video_path).toContain("output.mp4");

  await page.evaluate(() => setBerniniWorkflow("bernini_t2v"));
  await card.locator(".result-video-edit-button").click();
  await card.locator("button", { hasText: "Inpaint Source video" }).click();

  await expect(page.locator("#editWorkspaceTab")).toHaveClass(/active/);
  await expect(page.locator("#promptTag")).toHaveText("INPAINT");
  await expect(page.locator("#inpaintSourceVideoWrap")).toBeVisible();
  await expect(page.locator("#inpaintSourceVideoStatus")).toContainText("output.mp4");
  await expect(page.locator("#inpaintSourceVideoPreview")).toHaveAttribute("src", /output\.mp4/);
  const inpaintPayload = await page.evaluate(() => collectPayload());
  expect(inpaintPayload.workflow_id).toBe("wan_vace_inpaint");
  expect(inpaintPayload.source_video_path).toContain("output.mp4");
});

test("result video edit menu can extract a frame from the playback timeline", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "duration", {
      configurable: true,
      get() { return 4; },
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
      configurable: true,
      get() { return 320; },
    });
    Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
      configurable: true,
      get() { return 180; },
    });
    HTMLCanvasElement.prototype.getContext = () => ({
      drawImage() {},
      fillRect() {},
      set fillStyle(_value) {},
    });
    HTMLCanvasElement.prototype.toBlob = function toBlob(callback) {
      callback(new Blob(["frame"], { type: "image/png" }));
    };
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_t2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await page.evaluate(() => {
    mergeHistoryRuns([{
      batch_id: "frame_extract_batch",
      run_id: "01_frame_extract",
      workflow_id: "bernini_t2v",
      workflow_mode: "bernini_t2v",
      workflow_label: "WAN2.2 Bernini T2V",
      status: "done",
      video: "tasks/camera_lab_runs/frame_extract_batch/01/output.mp4",
      prompt: "frame extraction prompt",
      duration: 4,
    }], true);
    renderScopedHistory();
  });

  const card = page.locator("#resultsGrid .result-card").filter({ hasText: "frame extraction prompt" });
  await card.locator(".result-video-edit-button").click();
  await card.locator(".result-video-edit-menu button", { hasText: "Extract frame" }).click();
  await expect(page.locator("#frameExtractModal")).toHaveClass(/open/);
  await expect(page.locator("#frameExtractTitle")).toContainText("01_frame_extract");
  await page.locator("#frameExtractTime").fill("2");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#saveFrameExtractBtn").click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe("01_frame_extract_2.00s.png");
});

test("results are sorted by newest time first", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_t2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await page.evaluate(() => {
    mergeHistoryRuns([
      {
        batch_id: "old_result_batch",
        run_id: "01_old",
        workflow_id: "bernini_t2v",
        workflow_mode: "bernini_t2v",
        workflow_label: "WAN2.2 Bernini T2V",
        status: "done",
        video: "tasks/camera_lab_runs/old_result_batch/01/output.mp4",
        prompt: "old result prompt",
        queued_at: 100,
        finished_at: 110,
      },
      {
        batch_id: "new_result_batch",
        run_id: "01_new",
        workflow_id: "bernini_t2v",
        workflow_mode: "bernini_t2v",
        workflow_label: "WAN2.2 Bernini T2V",
        status: "done",
        video: "tasks/camera_lab_runs/new_result_batch/01/output.mp4",
        prompt: "new result prompt",
        queued_at: 200,
        finished_at: 210,
      },
    ], false);
    renderScopedHistory();
  });

  const prompts = await page.locator("#resultsGrid .result-card .paths").evaluateAll((nodes) =>
    nodes.map((node) => node.textContent.trim())
  );
  expect(prompts.slice(0, 2)).toEqual(["new result prompt", "old result prompt"]);
});

test("video preview modal scales to the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_t2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await page.evaluate(() => {
    mergeHistoryRuns([{
      batch_id: "preview_batch",
      run_id: "01_preview",
      workflow_id: "bernini_t2v",
      workflow_mode: "bernini_t2v",
      workflow_label: "WAN2.2 Bernini T2V",
      status: "done",
      video: "tasks/camera_lab_runs/preview_batch/01/output.mp4",
      prompt: "preview sizing prompt",
      duration: 4,
    }], true);
    renderScopedHistory();
  });

  const card = page.locator("#resultsGrid .result-card").filter({ hasText: "preview sizing prompt" });
  await card.locator(".preview-run").click();
  await expect(page.locator("#videoPreviewModal")).toHaveClass(/open/);
  const metrics = await page.locator(".video-preview-panel").evaluate((panel) => {
    const frame = panel.querySelector(".video-preview-frame");
    const video = panel.querySelector("video");
    const panelBox = panel.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    const videoBox = video.getBoundingClientRect();
    return {
      panelWidth: panelBox.width,
      panelHeight: panelBox.height,
      frameHeight: frameBox.height,
      videoWidth: videoBox.width,
      videoHeight: videoBox.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });

  expect(metrics.panelWidth).toBeGreaterThan(1200);
  expect(metrics.panelHeight).toBeGreaterThan(760);
  expect(metrics.frameHeight).toBeGreaterThan(680);
  expect(metrics.videoWidth).toBeLessThanOrEqual(metrics.panelWidth);
  expect(metrics.videoHeight).toBeLessThanOrEqual(metrics.frameHeight);
  expect(metrics.panelWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  expect(metrics.panelHeight).toBeLessThanOrEqual(metrics.viewportHeight);
});

test("video preview modal keeps viewport padding on small screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_t2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await page.evaluate(() => {
    mergeHistoryRuns([{
      batch_id: "mobile_preview_batch",
      run_id: "01_preview",
      workflow_id: "bernini_t2v",
      workflow_mode: "bernini_t2v",
      workflow_label: "WAN2.2 Bernini T2V",
      status: "done",
      video: "tasks/camera_lab_runs/mobile_preview_batch/01/output.mp4",
      prompt: "mobile preview sizing prompt",
      duration: 4,
    }], true);
    renderScopedHistory();
  });

  const card = page.locator("#resultsGrid .result-card").filter({ hasText: "mobile preview sizing prompt" });
  await card.locator(".preview-run").click();
  await expect(page.locator("#videoPreviewModal")).toHaveClass(/open/);
  const metrics = await page.locator(".video-preview-panel").evaluate((panel) => {
    const frame = panel.querySelector(".video-preview-frame");
    const video = panel.querySelector("video");
    const panelBox = panel.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    const videoBox = video.getBoundingClientRect();
    return {
      panelTop: panelBox.top,
      panelBottom: panelBox.bottom,
      panelLeft: panelBox.left,
      panelRight: panelBox.right,
      frameTop: frameBox.top,
      frameBottom: frameBox.bottom,
      videoTop: videoBox.top,
      videoBottom: videoBox.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });

  expect(metrics.panelTop).toBeGreaterThanOrEqual(15);
  expect(metrics.panelLeft).toBeGreaterThanOrEqual(15);
  expect(metrics.panelRight).toBeLessThanOrEqual(metrics.viewportWidth - 15);
  expect(metrics.panelBottom).toBeLessThanOrEqual(metrics.viewportHeight - 15);
  expect(metrics.frameBottom).toBeLessThanOrEqual(metrics.panelBottom);
  expect(metrics.videoTop).toBeGreaterThanOrEqual(metrics.frameTop);
  expect(metrics.videoBottom).toBeLessThanOrEqual(metrics.frameBottom);
});

test("video preview modal fits portrait videos to their aspect ratio", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_t2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await page.evaluate(() => {
    mergeHistoryRuns([{
      batch_id: "portrait_preview_batch",
      run_id: "01_preview",
      workflow_id: "bernini_t2v",
      workflow_mode: "bernini_t2v",
      workflow_label: "WAN2.2 Bernini T2V",
      status: "done",
      video: "tasks/camera_lab_runs/portrait_preview_batch/01/output.mp4",
      prompt: "portrait preview sizing prompt",
      width: 720,
      height: 1280,
      duration: 4,
    }], true);
    renderScopedHistory();
  });

  const card = page.locator("#resultsGrid .result-card").filter({ hasText: "portrait preview sizing prompt" });
  await card.locator(".preview-run").click();
  await expect(page.locator("#videoPreviewModal")).toHaveClass(/open/);
  const metrics = await page.locator(".video-preview-panel").evaluate((panel) => {
    const frame = panel.querySelector(".video-preview-frame");
    const panelBox = panel.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    return {
      panelWidth: panelBox.width,
      panelHeight: panelBox.height,
      frameWidth: frameBox.width,
      frameHeight: frameBox.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });

  const ratio = metrics.frameWidth / metrics.frameHeight;
  expect(ratio).toBeGreaterThan(0.52);
  expect(ratio).toBeLessThan(0.62);
  expect(metrics.panelWidth).toBeLessThan(620);
  expect(metrics.panelHeight).toBeLessThanOrEqual(metrics.viewportHeight - 32);
  expect(metrics.panelWidth).toBeLessThanOrEqual(metrics.viewportWidth - 32);
});

test("history refresh preserves existing result preview videos", async ({ page }) => {
  const historyPayload = {
    runs: [{
      batch_id: "stable_preview_batch",
      run_id: "01_stable",
      workflow_id: "bernini_t2v",
      workflow_mode: "bernini_t2v",
      workflow_label: "WAN2.2 Bernini T2V",
      status: "done",
      video: "tasks/camera_lab_runs/stable_preview_batch/01/output.mp4",
      prompt: "stable preview prompt",
      duration: 4,
    }],
  };
  await page.route("**/api/history?limit=200", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(historyPayload),
    });
  });

  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_t2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await expect(page.locator("#resultsGrid")).toContainText("stable preview prompt");

  const preserved = await page.evaluate(async () => {
    const first = document.querySelector("#resultsGrid video");
    first.dataset.probe = "keep";
    await loadHistory({ replace: false });
    const second = document.querySelector("#resultsGrid video");
    return first === second && second?.dataset.probe === "keep";
  });

  expect(preserved).toBe(true);
});

test("results are scoped by workspace and Bernini subtab", async ({ page }) => {
  await page.route("**/api/history?limit=200", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          {
            batch_id: "camera_batch",
            run_id: "01_camera",
            workflow_id: "ltx23_nag_i2v_extendcrop_general",
            workflow_mode: "i2v",
            workflow_label: "LTX I2V",
            status: "done",
            video: "tasks/camera_lab_runs/camera_batch/01_camera/output.mp4",
            prompt: "camera result prompt",
            duration: 4,
          },
          {
            batch_id: "bernini_t2v_batch",
            run_id: "01_bernini_t2v",
            workflow_id: "bernini_t2v",
            workflow_mode: "bernini_t2v",
            workflow_label: "WAN2.2 Bernini T2V",
            status: "done",
            video: "tasks/camera_lab_runs/bernini_t2v_batch/01/output.mp4",
            prompt: "bernini t2v result prompt",
            duration: 4,
          },
          {
            batch_id: "bernini_v2v_batch",
            run_id: "01_bernini_v2v",
            workflow_id: "bernini_v2v",
            workflow_mode: "bernini_v2v",
            workflow_label: "WAN2.2 Bernini V2V",
            status: "done",
            video: "tasks/camera_lab_runs/bernini_v2v_batch/01/output.mp4",
            prompt: "bernini v2v result prompt",
            duration: 4,
          },
          {
            batch_id: "inpaint_batch",
            run_id: "01_inpaint",
            workflow_id: "wan_vace_inpaint",
            workflow_mode: "wan_vace_inpaint",
            workflow_label: "WAN VACE Inpaint",
            status: "done",
            video: "tasks/camera_lab_runs/inpaint_batch/01/output.mp4",
            prompt: "inpaint result prompt",
            duration: 4,
          },
        ],
      }),
    });
  });

  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_v2v']")).toHaveCount(1);
  await expect(page.locator("#resultsGrid")).toContainText("camera result prompt");
  await expect(page.locator("#resultsGrid")).not.toContainText("bernini t2v result prompt");
  await expect(page.locator("#resultsGrid")).not.toContainText("inpaint result prompt");

  await page.locator("#editWorkspaceTab").click();
  await expect(page.locator("#resultsGrid")).toContainText("bernini t2v result prompt");
  await expect(page.locator("#resultsGrid")).not.toContainText("bernini v2v result prompt");
  await expect(page.locator("#resultsGrid")).not.toContainText("camera result prompt");

  await page.locator("[data-bernini-workflow='bernini_v2v']").click();
  await expect(page.locator("#resultsGrid")).toContainText("bernini v2v result prompt");
  await expect(page.locator("#resultsGrid")).not.toContainText("bernini t2v result prompt");

  await page.locator("#editWorkspaceTab").click();
  await page.locator("[data-edit-workflow='wan_vace_inpaint']").click();
  await expect(page.locator("#resultsGrid")).toContainText("inpaint result prompt");
  await expect(page.locator("#resultsGrid")).not.toContainText("bernini v2v result prompt");
  await expect(page.locator("#resultsGrid")).not.toContainText("camera result prompt");
});

test("result mode badge shows the workflow mode instead of generic generation type", async ({ page }) => {
  await page.route("**/api/history?limit=200", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          {
            batch_id: "bernini_rv2v_batch",
            run_id: "01_bernini_rv2v",
            workflow_id: "bernini_rv2v",
            workflow_mode: "bernini_rv2v",
            workflow_label: "WAN2.2 Bernini RV2V",
            status: "done",
            video: "tasks/camera_lab_runs/bernini_rv2v_batch/01/output.mp4",
            prompt: "bernini rv2v result prompt",
            duration: 4,
          },
          {
            batch_id: "inpaint_batch",
            run_id: "01_inpaint",
            workflow_id: "wan_vace_inpaint",
            workflow_mode: "wan_vace_inpaint",
            workflow_label: "WAN VACE Inpaint",
            status: "done",
            video: "tasks/camera_lab_runs/inpaint_batch/01/output.mp4",
            prompt: "inpaint result prompt",
            duration: 4,
          },
        ],
      }),
    });
  });

  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_rv2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await page.evaluate(() => setBerniniWorkflow("bernini_rv2v"));
  const berniniCard = page.locator("#resultsGrid .result-card").filter({ hasText: "bernini rv2v result prompt" });
  await expect(berniniCard.locator(".mode-tag")).toHaveText("RV2V");
  await expect(berniniCard.locator(".mode-tag")).toHaveAttribute("title", "WAN2.2 Bernini RV2V");

  await page.locator("#editWorkspaceTab").click();
  await page.locator("[data-edit-workflow='wan_vace_inpaint']").click();
  const inpaintCard = page.locator("#resultsGrid .result-card").filter({ hasText: "inpaint result prompt" });
  await expect(inpaintCard.locator(".mode-tag")).toHaveText("INPAINT");
});

test("inpaint workspace exposes drawing controls and payload inputs", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='wan_vace_inpaint']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await page.locator("[data-edit-workflow='wan_vace_inpaint']").click();

  await expect(page.locator("#inpaintTaskPanel")).toBeVisible();
  await expect(page.locator("#inpaintSourceVideoInput")).toBeVisible();
  await expect(page.locator("#inpaintReferenceImageInput")).toBeVisible();
  await expect(page.locator("#inpaintTaskPanel #inpaintMaskStage")).toHaveCount(0);
  await expect(page.locator("#inpaintCanvasPanel")).toBeVisible();
  await expect(page.locator("#inpaintMaskStage")).toBeVisible();
  await expect(page.locator("#inpaintMaskVideo")).toBeVisible();
  await expect(page.locator("#inpaintMaskCanvas")).toBeVisible();
  const promptSharesPanelWithCanvas = await page.locator("#promptText").evaluate((el) =>
    el.closest(".prompt-panel")?.querySelector("#inpaintMaskStage") !== null,
  );
  expect(promptSharesPanelWithCanvas).toBe(true);
  await expect(page.locator("#promptText")).toHaveValue(/painted area/);
  await expect(page.locator("#negativePrompt")).toHaveValue("bad video");
  const columns = await page.locator("#resultsGrid").evaluate((el) =>
    getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length,
  );
  expect(columns).toBe(2);

  await page.evaluate(() => {
    state.inpaintSourceVideoPath = "tasks/camera_lab_uploads/videos/source.mp4";
    state.inpaintReferenceImagePath = "tasks/camera_lab_uploads/images/ref.png";
    state.inpaintMaskImagePath = "tasks/camera_lab_uploads/images/mask.png";
    document.getElementById("promptText").value = "put the vase on the table";
  });

  const payload = await page.evaluate(() => collectPayload());

  expect(payload.workflow_id).toBe("wan_vace_inpaint");
  expect(payload.source_video_path).toContain("source.mp4");
  expect(payload.reference_image_path).toContain("ref.png");
  expect(payload.mask_image_path).toContain("mask.png");
  expect(payload.source_path).toBe("");
});

test("inpaint payload allows missing optional reference image", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='wan_vace_inpaint']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await page.locator("[data-edit-workflow='wan_vace_inpaint']").click();
  await page.evaluate(() => {
    state.inpaintSourceVideoPath = "tasks/camera_lab_uploads/videos/source.mp4";
    state.inpaintReferenceImagePath = "";
    state.inpaintMaskImagePath = "tasks/camera_lab_uploads/images/mask.png";
    document.getElementById("promptText").value = "remove the object and rebuild the background";
  });

  const payload = await page.evaluate(() => collectPayload());

  expect(payload.workflow_id).toBe("wan_vace_inpaint");
  expect(payload.reference_image_path).toBe("");
  expect(payload.source_video_path).toContain("source.mp4");
  expect(payload.mask_image_path).toContain("mask.png");
});

test("bernini mode subtabs stay horizontal on narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto("/");
  await page.locator("#editWorkspaceTab").click();

  await expect(page.locator("#berniniTaskTabs .motion-subtab")).toHaveCount(10);
  const tops = await page.locator("#berniniTaskTabs .motion-subtab").evaluateAll((buttons) =>
    buttons.map((button) => Math.round(button.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(1);
  const metrics = await page.locator("#berniniTaskTabs").evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeGreaterThanOrEqual(metrics.clientWidth);
});

test("director workspace starts without generated empty prompt segments", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await expect(page.locator("#directorTimelinePanel")).toBeVisible();
  await expect(page.locator(".director-lane")).toHaveCount(4);
  const laneOrder = await page.locator(".director-lane").evaluateAll((lanes) => lanes.map((lane) => lane.dataset.lane));
  expect(laneOrder).toEqual([
    "main",
    "video-audio",
    "dialogue",
    "ic-video",
  ]);
  await expect(page.locator(".director-lane[data-lane='main']")).toContainText("Main");
  await expect(page.locator(".director-lane[data-lane='ic-video']")).toContainText("IC video");
  await expect(page.locator(".director-lane[data-lane='video-audio']")).toContainText("Video audio");
  await expect(page.locator(".director-lane[data-lane='video-audio']")).toContainText("Follows main video guides");
  await expect(page.locator(".director-lane[data-lane='video-audio']")).not.toContainText("Detached video audio appears");
  await expect(page.locator(".director-lane[data-lane='dialogue']")).toContainText("Dialogue");
  await expect(page.locator("#addDirectorIcVideoBtn")).toBeVisible();
  await expect(page.locator("#directorTrack .director-block")).toHaveCount(0);
  await expect(page.locator("#directorSegmentInspector")).toContainText("Add a segment");
  await expect(page.locator("#directorTrack")).not.toContainText("empty prompt");
  await expect(page.locator("#directorGlobalPrompt")).toHaveValue(/continuous cinematic video/i);
  await page.locator("#directorGlobalPrompt").fill("");
  await page.evaluate(() => resetPrompt());
  await expect(page.locator("#directorGlobalPrompt")).toHaveValue(/continuous cinematic video/i);
});

test("director IC video lane uploads reference video into motion segments", async ({ page }) => {
  await page.route("**/api/upload-video", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        path: "tasks/camera_lab_uploads/videos/ic_reference.mp4",
        name: "ic_reference.mp4",
      }),
    });
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  const uploadRequest = page.waitForRequest("**/api/upload-video");
  await page.locator("#directorIcVideoInput").setInputFiles({
    name: "ic_reference.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("ic-video"),
  });
  await uploadRequest;

  await expect(page.locator("#directorIcVideoTrack .director-ic-video-block")).toContainText("ic_reference.mp4");
  const payload = await page.evaluate(() => collectPayload());
  expect(payload.motion_segments).toEqual([
    expect.objectContaining({
      type: "motion_video",
      video_path: expect.stringContaining("ic_reference.mp4"),
    }),
  ]);
  expect(payload.timeline_segments.some((segment) => segment.video_path?.includes("ic_reference.mp4"))).toBe(false);
});

test("director IC-LoRA dropdown populates from config and feeds the payload", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await page.evaluate(() => {
    state.config.director = {
      ic_loras: ["None", "ltxv/ltx2/ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors"],
    };
    fillDirectorIcLoras();
  });

  await expect(page.locator("#directorIcLora option")).toHaveCount(2);
  await expect(page.locator("#directorIcLora option").nth(1)).toHaveText(
    "ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors"
  );

  await page.locator("#addDirectorSegmentBtn").click();
  await page.locator("#directorIcLora").selectOption(
    "ltxv/ltx2/ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors"
  );

  const payload = await page.evaluate(() => collectPayload());
  expect(payload.ic_lora_name).toBe("ltxv/ltx2/ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors");
});

test("director segment remove controls delete from timeline and inspector", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.locator("#addDirectorSegmentBtn").click();

  await expect(page.locator("#removeDirectorSegmentBtn")).toBeVisible();
  await expect(page.locator("#removeDirectorSegmentIconBtn")).toHaveCount(0);
  await expect(page.locator("#directorTrack .director-block-remove")).toHaveCount(1);

  await page.locator("#directorTrack .director-block-remove").click();
  await expect(page.locator("#directorTrack .director-block")).toHaveCount(0);
  await expect(page.locator("#directorSegmentInspector")).toContainText("Add a segment");

  await page.locator("#addDirectorSegmentBtn").click();
  await expect(page.locator("#directorTrack .director-block-remove")).toHaveCount(1);
  await page.locator("#removeDirectorSegmentBtn").click();
  await expect(page.locator("#directorTrack .director-block")).toHaveCount(0);
});

test("director uses only timeline audio segments", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.audioPath = "uploads/full_track.wav";
    state.directorSegments = [{
      id: "seg_audio_1",
      start: 0,
      duration: 2,
      prompt: "A close-up line.",
      reference: "",
      imagePath: "",
      imageName: "",
      imagePreviewUrl: "",
      strength: 0.65,
    }];
    state.directorAudioSegments = [{
      id: "aud_1",
      start: 0,
      duration: 2,
      trimStart: 0,
      audioPath: "tts/library/current/line_one.wav",
      audioName: "line_one.wav",
      audioDuration: 2,
    }];
    state.directorSelectedId = "seg_audio_1";
    state.directorSelectionType = "image";
    renderDirectorEditor();
  });

  await expect(page.locator("#directorAudioModeHint")).toHaveCount(0);
  await expect(page.locator("#directorFullAudioModeBtn")).toHaveCount(0);
  await expect(page.locator(".director-lane[data-lane='dialogue'] #directorAudioTrack .director-audio-block.has-audio")).toHaveCount(1);
  await expect(page.locator("#audioUploadWrap")).toBeHidden();

  const payload = await page.evaluate(() => collectPayload());
  expect(payload.audio_path).toBe("");
  expect(payload.segments[0].audio_path).toBeUndefined();
  expect(payload.audio_segments[0].audio_path).toContain("line_one.wav");
});

test("director timeline audio modal rounds clip duration up and labels the timeline", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.castingLibrary = [{
      name: "line_one",
      file: "tts/library/current/line_one.wav",
      url: "/media?path=line_one.wav",
      voice: "laodao",
      duration: 2.13,
    }];
    state.directorSegments = [
      {
        id: "seg_audio_1",
        start: 0,
        duration: 1,
        prompt: "First line.",
        reference: "",
        imagePath: "",
        imageName: "",
        imagePreviewUrl: "",
        strength: 0.65,
      },
      {
        id: "seg_audio_2",
        start: 1,
        duration: 1,
        prompt: "Second shot.",
        reference: "",
        imagePath: "",
        imageName: "",
        imagePreviewUrl: "",
        strength: 0.65,
      },
    ];
    state.directorSelectedId = "seg_audio_1";
    state.directorSelectionType = "image";
    renderDirectorEditor();
  });

  await expect(page.locator("#directorSegmentInspector")).not.toContainText("Add audio here");
  await page.locator("#addDirectorAudioBtn").click();
  await expect(page.locator("#directorAudioModal")).toHaveClass(/open/);
  await page.locator("#directorAudioLibrarySelect").selectOption("tts/library/current/line_one.wav");
  await page.locator("#directorAudioModalStart").fill("0");
  await page.locator("#addDirectorAudioClipBtn").click();

  await expect(page.locator("#directorAudioDuration")).toHaveCount(0);
  await expect(page.locator("#directorSegmentInspector")).toContainText("Duration");
  await expect(page.locator("#directorSegmentInspector")).toContainText("2.5s");
  await expect(page.locator("#directorAudioTrack .director-audio-block.has-audio")).toContainText("Audio 2.13s -> Clip 2.5s");
  await expect(page.locator("#directorSegments .director-segment-chip").nth(1)).toContainText("S2 1.00s-2.00s");

  const payload = await page.evaluate(() => collectPayload());
  expect(payload.segments[0].duration).toBe(1);
  expect(payload.audio_segments[0].duration).toBe(2.5);
  expect(payload.audio_segments[0].audio_path).toContain("line_one.wav");
});

test("director video audio lane can add library audio clips", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.castingLibrary = [{
      name: "video_fx",
      file: "tts/library/current/video_fx.wav",
      url: "/media?path=video_fx.wav",
      voice: "fx",
      duration: 1.2,
    }];
    state.directorSegments = [{
      id: "seg_video_audio_add",
      start: 0,
      duration: 2,
      prompt: "Shot with extra video audio.",
      reference: "",
      imagePath: "",
      imageName: "",
      imagePreviewUrl: "",
      strength: 0.65,
    }];
    state.directorVideoAudioSegments = [];
    state.directorAudioSegments = [];
    state.directorSelectedId = "seg_video_audio_add";
    state.directorSelectionType = "image";
    renderDirectorEditor();
  });

  await page.locator("#addDirectorVideoAudioBtn").click();
  await expect(page.locator("#directorAudioModal")).toHaveClass(/open/);
  await page.locator("#directorAudioLibrarySelect").selectOption("tts/library/current/video_fx.wav");
  await page.locator("#directorAudioModalStart").fill("1");
  await page.locator("#addDirectorAudioClipBtn").click();

  const videoAudioBlock = page.locator("#directorVideoAudioTrack .director-video-audio-block");
  await expect(videoAudioBlock).toContainText("video_fx");
  await expect(page.locator("#directorAudioTrack .director-audio-block.has-audio")).toHaveCount(0);
  await videoAudioBlock.click();
  await expect(page.locator("#directorSegmentInspector")).toContainText("Selected video audio");
  await expect(page.locator("#directorVideoAudioStart")).toHaveValue("1");

  const payload = await page.evaluate(() => collectPayload());
  expect(payload.audio_segments).toEqual([
    expect.objectContaining({
      source: "video",
      audio_path: "tts/library/current/video_fx.wav",
      start: 1,
      duration: 1.5,
      trim_start: 0,
    }),
  ]);
});

test("director timeline audio blocks can be dragged but keep fixed duration", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [
      {
        id: "seg_drag_1",
        start: 0,
        duration: 4,
        prompt: "A speaker talks to camera.",
        reference: "",
        imagePath: "",
        imageName: "",
        imagePreviewUrl: "",
        strength: 0.65,
      },
    ];
    state.directorAudioSegments = [{
      id: "aud_drag_1",
      start: 0,
      duration: 1,
      trimStart: 0,
      audioPath: "tts/library/current/line_one.wav",
      audioName: "line_one.wav",
      audioDuration: 1,
    }];
    state.directorSelectedId = "aud_drag_1";
    state.directorSelectionType = "audio";
    renderDirectorEditor();
  });

  await page.locator("#directorAudioTrack .director-audio-block.has-audio").scrollIntoViewIfNeeded();
  const trackBox = await page.locator("#directorAudioTrack").boundingBox();
  const block = page.locator("#directorAudioTrack .director-audio-block.has-audio");
  const copy = block.locator(".director-audio-copy");
  let blockBox = await block.boundingBox();
  let copyBox = await copy.boundingBox();
  expect(trackBox).not.toBeNull();
  expect(blockBox).not.toBeNull();
  expect(copyBox).not.toBeNull();
  const oneSecond = trackBox.width / 6;
  const y = copyBox.y + copyBox.height / 2;

  await page.mouse.move(copyBox.x + copyBox.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(copyBox.x + copyBox.width / 2 + oneSecond * 2, y, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator("#directorAudioStart")).toHaveValue("2");
  await expect(page.locator("#directorAudioDuration")).toHaveCount(0);
  await expect(page.locator("#directorSegmentInspector")).toContainText("Clip 1s");
  await expect(block.locator(".resize-handle")).toHaveCount(0);

  blockBox = await block.boundingBox();
  await page.mouse.move(blockBox.x + blockBox.width - 2, blockBox.y + blockBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(blockBox.x + blockBox.width - 2 + oneSecond, blockBox.y + blockBox.height / 2, { steps: 8 });
  await page.mouse.up();

  const payload = await page.evaluate(() => collectPayload());
  expect(payload.audio_segments[0].start).toBe(3);
  expect(payload.audio_segments[0].duration).toBe(1);
});

test("director timeline audio blocks have preview buttons", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    window.Audio = class FakeAudio {
      constructor(url) {
        this.url = url;
      }
      addEventListener() {}
      play() {
        return new Promise(() => {});
      }
      pause() {}
      set src(_value) {}
    };
    state.castingLibrary = [{
      name: "line_one",
      file: "tts/library/current/line_one.wav",
      url: "/media?path=line_one.wav",
      voice: "laodao",
      duration: 1,
    }];
    state.directorSegments = [
      {
        id: "seg_preview_1",
        start: 0,
        duration: 2,
        prompt: "A speaker talks to camera.",
        reference: "",
        imagePath: "",
        imageName: "",
        imagePreviewUrl: "",
        strength: 0.65,
      },
    ];
    state.directorAudioSegments = [{
      id: "aud_preview_1",
      start: 0,
      duration: 1,
      trimStart: 0,
      audioPath: "tts/library/current/line_one.wav",
      audioName: "line_one.wav",
      audioDuration: 1,
    }];
    state.directorSelectedId = "aud_preview_1";
    state.directorSelectionType = "audio";
    renderDirectorEditor();
  });

  await page.locator("#directorAudioTrack .director-audio-block.has-audio").scrollIntoViewIfNeeded();
  const preview = page.locator("#directorAudioTrack .director-audio-preview");
  await expect(preview).toHaveAttribute("aria-label", "Preview audio 1");

  await preview.click();
  await expect(preview).toHaveAttribute("aria-label", "Stop preview");
  await expect(page.locator("#directorAudioTrack .director-audio-block.has-audio")).toHaveCount(1);

  await preview.click();
  await expect(preview).toHaveAttribute("aria-label", "Preview audio 1");

  const payload = await page.evaluate(() => collectPayload());
  expect(payload.audio_segments[0].start).toBe(0);
  expect(payload.audio_segments[0].duration).toBe(1);
});

test("use timeline restores segment timing from start frames, not guide frames", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  const payload = await page.evaluate(() => {
    useRunTimeline({
      batch_id: "dry",
      run_id: "01_director",
      workflow_id: "ltx_director_2",
      seed: "123",
      director_timeline: {
        global_prompt: "same subject",
        global_reference_strength: 0.35,
        segments: [
          {
            id: "seg_offset_guide",
            type: "image",
            prompt: "first image prompt",
            duration: 1,
            frames: 24,
            start_frame: 0,
            guide_frame: 24,
            image_path: "tasks/camera_lab_uploads/images/guide.png",
            strength: 0.8,
          },
          {
            id: "seg_text",
            type: "text",
            prompt: "second text prompt",
            duration: 1,
            frames: 24,
            start_frame: 48,
            guide_frame: 48,
            image_path: "",
            strength: 0,
          },
        ],
      },
    });
    return collectPayload();
  });

  expect(payload.timeline_segments[0].start).toBe(0);
  expect(payload.timeline_segments[0].guide_frame).toBe(24);
  expect(payload.timeline_segments[1].start).toBe(2);
});

test("use timeline restores audio timing from saved frame ranges", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  const payload = await page.evaluate(() => {
    useRunTimeline({
      batch_id: "dry",
      run_id: "01_director",
      workflow_id: "ltx_director_2",
      seed: "123",
      director_timeline: {
        segments: [
          {
            id: "seg_image",
            type: "image",
            prompt: "image prompt",
            duration: 4,
            frames: 96,
            start_frame: 0,
            guide_frame: 0,
            image_path: "",
            strength: 0.65,
          },
        ],
        audio_segments: [
          {
            id: "aud_line",
            audio_path: "tts/library/current/line.wav",
            start: 36,
            length: 60,
            trimStart: 12,
          },
        ],
      },
    });
    return collectPayload();
  });

  expect(payload.timeline_segments[0].start).toBe(0);
  expect(payload.audio_segments[0].start).toBe(1.5);
  expect(payload.audio_segments[0].duration).toBe(2.5);
  expect(payload.audio_segments[0].trim_start).toBe(12);
});

test("use timeline allows replacing a restored segment image guide", async ({ page }) => {
  await page.route("**/api/upload-image", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        path: "tasks/camera_lab_uploads/images/new_guide.png",
        name: "new_guide.png",
      }),
    });
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    useRunTimeline({
      batch_id: "dry",
      run_id: "01_director",
      workflow_id: "ltx_director_2",
      director_timeline: {
        segments: [
          {
            id: "seg_restored_image",
            type: "image",
            prompt: "image prompt",
            duration: 1,
            frames: 24,
            start_frame: 0,
            guide_frame: 0,
            image_path: "tasks/camera_lab_uploads/images/old_guide.png",
            strength: 0.75,
          },
        ],
      },
    });
  });

  await page.locator("#directorSegmentImageInput").setInputFiles({
    name: "new_guide.png",
    mimeType: "image/png",
    buffer: Buffer.from("new-image"),
  });

  await expect(page.locator("#directorSegmentImageStatus")).toContainText("new_guide.png");
  const payload = await page.evaluate(() => collectPayload());
  expect(payload.timeline_segments[0].image_path).toContain("new_guide.png");
});

test("use timeline allows replacing a restored segment with a video guide", async ({ page }) => {
  await page.route("**/api/upload-image", async (route) => {
    throw new Error(`video guide should not call upload-image: ${route.request().url()}`);
  });
  await page.route("**/api/upload-video", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        path: "tasks/camera_lab_uploads/videos/new_guide.mp4",
        name: "new_guide.mp4",
      }),
    });
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    useRunTimeline({
      batch_id: "dry",
      run_id: "01_director",
      workflow_id: "ltx_director_2",
      director_timeline: {
        segments: [
          {
            id: "seg_restored_video",
            type: "text",
            prompt: "video prompt",
            duration: 1,
            frames: 24,
            start_frame: 0,
            guide_frame: 0,
            strength: 0.75,
          },
        ],
      },
    });
  });

  const uploadRequest = page.waitForRequest("**/api/upload-video");
  await page.locator("#directorSegmentImageInput").setInputFiles({
    name: "new_guide.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("new-video"),
  });
  await uploadRequest;

  await expect(page.locator("#directorSegmentImageStatus")).toContainText("new_guide.mp4");
  await expect(page.locator(".director-block.selected .director-block-ref")).toContainText("timeline video");
  const videoAudioBlock = page.locator("#directorVideoAudioTrack .director-video-audio-block");
  await expect(videoAudioBlock).toContainText("new_guide.mp4");
  await videoAudioBlock.click();
  await expect(page.locator("#directorSegmentInspector")).toContainText("Selected video audio");
  await page.locator("#directorSegments .director-segment-chip").first().click();
  await expect(page.locator("#directorSegmentInspector")).toContainText("Selected segment");
  await videoAudioBlock.click();
  await expect(page.locator("#directorSegmentInspector")).toContainText("Selected video audio");
  await page.locator("#directorVideoAudioStart").fill("0.5");
  await page.locator("#directorVideoAudioTrimStart").fill("0.25");
  await page.locator("#directorSegments .director-segment-chip").first().click();
  await expect(page.locator("#directorSegmentInspector")).toContainText("Selected segment");
  await videoAudioBlock.click();
  const payload = await page.evaluate(() => collectPayload());
  expect(payload.timeline_segments[0].type).toBe("video");
  expect(payload.timeline_segments[0].video_path).toContain("new_guide.mp4");
  expect(payload.timeline_segments[0].image_path).toBe("");
  expect(payload.audio_segments).toEqual([
    expect.objectContaining({
      source: "video",
      audio_path: expect.stringContaining("new_guide.mp4"),
      start: 0.5,
      duration: 1,
      trim_start: 6,
    }),
  ]);
});

test("director queues media-only guides without global or segment prompts", async ({ page }) => {
  await page.route("**/api/run", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        batch_id: "media_only_batch",
        status: "queued",
        runs: [],
      }),
    });
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    document.getElementById("promptText").value = "";
    document.getElementById("directorGlobalPrompt").value = "";
    useRunTimeline({
      batch_id: "dry",
      run_id: "01_director",
      workflow_id: "ltx_director_2",
      director_timeline: {
        segments: [
          {
            id: "media_only",
            type: "video",
            prompt: "",
            duration: 1,
            frames: 24,
            start_frame: 0,
            guide_frame: 0,
            video_path: "tasks/camera_lab_uploads/videos/media_only.mp4",
            strength: 0.75,
          },
        ],
      },
    });
    document.getElementById("promptText").value = "";
    document.getElementById("directorGlobalPrompt").value = "";
  });

  const runRequest = page.waitForRequest("**/api/run");
  await page.locator("#runBtn").click();
  const payload = JSON.parse((await runRequest).postData() || "{}");

  expect(payload.global_prompt).toBe("");
  expect(payload.timeline_segments[0].prompt).toBe("");
  expect(payload.timeline_segments[0].video_path).toContain("media_only.mp4");
  await expect(page.locator("#runHint")).not.toContainText("director workflow requires");
});

test("casting line regenerate refreshes the audio library dropdown", async ({ page }) => {
  await page.route("**/api/casting/tts", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        clips: [
          {
            name: "run_before_it_sees_us",
            file: "tts/library/current/run_before_it_sees_us.wav",
            url: "/media?path=tts%2Flibrary%2Fcurrent%2Frun_before_it_sees_us.wav",
            voice: "voice_a",
            emotion: "excited",
          },
        ],
      }),
    });
  });
  await page.route("**/api/casting/library", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        clips: [
          {
            name: "run_before_it_sees_us",
            file: "tts/library/current/run_before_it_sees_us.wav",
            url: "/media?path=tts%2Flibrary%2Fcurrent%2Frun_before_it_sees_us.wav",
            voice: "voice_a",
            emotion: "excited",
          },
        ],
      }),
    });
  });
  await page.goto("/#casting");
  await page.evaluate(() => {
    state.config = {
      casting: {
        cosyvoice: { available: true, reason: "", version: "cv3" },
        llm: { available: true, reason: "", model: "test-llm" },
        voices: [{ id: "voice_a", label: "Voice A", gender: "" }],
        emotions: ["neutral", "excited"],
      },
    };
    state.castingLines = [{ text: "Run before it sees us", voice: "voice_a", emotion: "excited" }];
    renderCastingStatus();
    renderCastingTable();
  });

  await page.locator("#castingTableWrap button", { hasText: "Generate" }).click();

  await expect(page.locator("#audioLibrarySelect option", { hasText: "run_before_it_sees_us" })).toHaveCount(1);
});

test("casting line rows can be deleted after analysis", async ({ page }) => {
  await page.goto("/#casting");
  await page.evaluate(() => {
    state.config = {
      casting: {
        cosyvoice: { available: true, reason: "", version: "cv3" },
        llm: { available: true, reason: "", model: "test-llm" },
        voices: [{ id: "voice_a", label: "Voice A", gender: "" }],
        emotions: ["neutral", "excited"],
      },
    };
    state.castingLines = [
      { text: "First line", voice: "voice_a", emotion: "neutral" },
      { text: "Second line", voice: "voice_a", emotion: "excited" },
    ];
    renderCastingStatus();
    renderCastingTable();
  });

  await expect(page.locator("#castingTableWrap .casting-line-card")).toHaveCount(2);

  await page.locator("#castingTableWrap button[aria-label='Delete line 1']").click();

  await expect(page.locator("#castingTableWrap .casting-line-card")).toHaveCount(1);
  await expect(page.locator("#castingTableWrap textarea")).toHaveValue("Second line");
});

test("casting lines can be added manually when LLM is offline", async ({ page }) => {
  await page.goto("/#casting");
  await page.evaluate(() => {
    state.config = {
      casting: {
        cosyvoice: { available: true, reason: "", version: "cv3" },
        llm: {
          available: false,
          reason: "LLM not reachable at http://127.0.0.1:2345/v1",
          model: "test-llm",
        },
        voices: [{ id: "voice_a", label: "Voice A", gender: "" }],
        emotions: ["neutral", "excited"],
      },
    };
    state.castingLines = [];
    renderCastingStatus();
    renderCastingTable();
  });

  await expect(page.locator("#castingAnalyzeBtn")).toBeDisabled();
  await expect(page.locator("#castingAddLineBtn")).toBeEnabled();

  await page.locator("#castingAddLineBtn").click();

  await expect(page.locator("#castingTableWrap .casting-line-card")).toHaveCount(1);
  await expect(page.locator("#castingTableWrap textarea")).toHaveValue("");
  await expect(page.locator("#castingTableWrap select").first()).toContainText("Voice A");
  await expect(page.locator("#castingTableWrap select").nth(1)).toHaveValue("neutral");
});

test("casting generate buttons report missing voice before submitting", async ({ page }) => {
  let ttsPayload = null;
  await page.route("**/api/casting/tts", async (route) => {
    ttsPayload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ clips: [] }),
    });
  });

  await page.goto("/#casting");
  await page.evaluate(() => {
    state.config = {
      casting: {
        cosyvoice: { available: true, reason: "", version: "cv3" },
        llm: { available: true, reason: "", model: "test-llm" },
        voices: [{ id: "voice_a", label: "Voice A", gender: "" }],
        emotions: ["neutral", "excited"],
      },
    };
    state.castingLines = [{ text: "First line", voice: "", emotion: "neutral" }];
    renderCastingStatus();
    renderCastingTable();
  });

  await expect(page.locator("#castingGenerateBtn")).toBeEnabled();
  await expect(page.locator("#castingTableWrap button", { hasText: "Generate" })).toBeEnabled();

  let lineMessage = "";
  page.once("dialog", async (dialog) => {
    lineMessage = dialog.message();
    await dialog.accept();
  });
  await page.locator("#castingTableWrap button", { hasText: "Generate" }).click();
  expect(lineMessage).toContain("Select a voice");

  let allMessage = "";
  page.once("dialog", async (dialog) => {
    allMessage = dialog.message();
    await dialog.accept();
  });
  await page.locator("#castingGenerateBtn").click();
  expect(allMessage).toContain("Select a voice");
  expect(ttsPayload).toBeNull();

  await page.locator("#castingTableWrap select").first().selectOption("voice_a");

  await expect(page.locator("#castingGenerateBtn")).toBeEnabled();
  await expect(page.locator("#castingTableWrap button", { hasText: "Generate" })).toBeEnabled();
  await page.locator(".casting-speed-control input").evaluate((input) => {
    input.value = "0.85";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.locator("#castingGenerateBtn").click();

  expect(ttsPayload.archive_all).toBe(true);
  expect(ttsPayload.lines[0].voice).toBe("voice_a");
  expect(ttsPayload.lines[0].speed).toBe(0.85);
});

test("casting archive folder button calls the local open endpoint", async ({ page }) => {
  let opened = false;
  await page.route("**/api/casting/open-archive", async (route) => {
    opened = true;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, path: "tts/library/archive" }),
    });
  });

  await page.goto("/#casting");
  await page.locator("#castingOpenArchiveBtn").click();

  expect(opened).toBeTruthy();
});

test("casting library clips can be deleted to recycle bin after confirmation", async ({ page }) => {
  let deletePayload = null;
  await page.route("**/api/casting/delete", async (route) => {
    deletePayload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        recycled: [
          "tts/library/current/clip.wav",
          "tts/library/current/clip.json",
        ],
        clips: [],
      }),
    });
  });

  await page.goto("/#casting");
  await page.evaluate(() => {
    state.castingLibrary = [{
      name: "clip",
      file: "tts/library/current/clip.wav",
      url: "/media?path=tts%2Flibrary%2Fcurrent%2Fclip.wav",
      voice: "voice_a",
      emotion: "neutral",
      duration: 1,
    }];
    renderCastingLibrary();
  });

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Recycle Bin");
    await dialog.dismiss();
  });
  await page.locator("#castingLibrary button[aria-label='Delete clip']").click();
  expect(deletePayload).toBeNull();
  await expect(page.locator("#castingLibrary .casting-library-item")).toHaveCount(1);

  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.locator("#castingLibrary button[aria-label='Delete clip']").click();

  expect(deletePayload.file).toContain("current/clip.wav");
  await expect(page.locator("#castingLibrary")).toContainText("Library is empty");
  await expect(page.locator("#runHint")).toContainText("Moved 2 file(s) to Recycle Bin");
});

test("custom casting voice upload appears in the voice dropdown", async ({ page }) => {
  let uploadPayload = null;
  await page.route("**/api/casting/voice", async (route) => {
    uploadPayload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        voice: {
          id: "custom_mira",
          label: "Mira",
          gender: "",
        },
        voices: [
          { id: "voice_a", label: "Voice A", gender: "" },
          { id: "custom_mira", label: "Mira", gender: "" },
        ],
      }),
    });
  });

  await page.goto("/#casting");
  await page.evaluate(() => {
    state.config = {
      casting: {
        cosyvoice: { available: true, reason: "", version: "cv3" },
        llm: { available: true, reason: "", model: "test-llm" },
        voices: [{ id: "voice_a", label: "Voice A", gender: "" }],
        emotions: ["neutral", "excited"],
      },
    };
    state.castingLines = [{ text: "Hello from the new voice.", voice: "", emotion: "neutral" }];
    renderCastingStatus();
    renderCastingTable();
  });

  await page.locator("#castingAddVoiceBtn").click();
  await expect(page.locator("#castingVoiceModal")).toHaveClass(/open/);
  await page.locator("#customVoiceName").fill("Mira");
  await page.locator("#customVoiceText").fill("This is Mira's reference line.");
  await page.locator("#customVoiceFile").setInputFiles({
    name: "mira.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("RIFFfakewav"),
  });
  const voiceRequest = page.waitForRequest("**/api/casting/voice");
  await page.locator("#saveCustomVoiceBtn").click();
  uploadPayload = (await voiceRequest).postDataJSON();

  expect(uploadPayload.name).toBe("Mira");
  expect(uploadPayload.ref_text).toBe("This is Mira's reference line.");
  expect(uploadPayload.audio_name).toBe("mira.wav");
  expect(uploadPayload.audio_data).toContain("base64");
  await expect(page.locator("#castingTableWrap select option", { hasText: "Mira" })).toHaveCount(1);
});

test("casting tab shows missing TTS setup details", async ({ page }) => {
  await page.goto("/#casting");
  await page.evaluate(() => {
    state.config = {
      casting: {
        cosyvoice: {
          available: false,
          reason: "missing model dir: tts/models/Fun-CosyVoice3-0.5B; missing CosyVoice vendor: tts/cosyvoice",
          version: "cv3",
        },
        llm: { available: true, reason: "", model: "test-llm" },
        voices: [],
        emotions: ["neutral"],
      },
    };
    renderCastingStatus();
  });

  await expect(page.locator("#castingSetupWarning")).toBeVisible();
  await expect(page.locator("#castingSetupWarning")).toContainText("missing model dir");
  await expect(page.locator("#castingSetupWarning")).toContainText("tts/models/Fun-CosyVoice3-0.5B");
  await expect(page.locator("#castingSetupWarning")).toContainText("symlink");
});

test("casting tab disables analysis and warns when LLM is offline", async ({ page }) => {
  await page.goto("/#casting");
  await page.evaluate(() => {
    state.config = {
      casting: {
        cosyvoice: { available: true, reason: "", version: "cv3" },
        llm: {
          available: false,
          reason: "LLM not reachable at http://127.0.0.1:2345/v1",
          model: "openai/gpt-oss-20b",
        },
        voices: [{ id: "voice_a", label: "Voice A", gender: "" }],
        emotions: ["neutral"],
      },
    };
    renderCastingStatus();
  });

  await expect(page.locator("#castingAnalyzeBtn")).toBeDisabled();
  await expect(page.locator("#castingSetupWarning")).toBeVisible();
  await expect(page.locator("#castingSetupWarning")).toContainText("LLM offline");
  await expect(page.locator("#castingSetupWarning")).toContainText("not reachable");
});

test("casting preview switches clips without showing interrupted playback errors", async ({ page }) => {
  await page.goto("/#casting");
  await page.evaluate(() => {
    window.__previewAlerts = [];
    window.alert = (message) => window.__previewAlerts.push(String(message));
    window.Audio = class FakeAudio {
      constructor(url) {
        this.url = url;
        this.listeners = {};
        this.playPromise = new Promise((_resolve, reject) => {
          this.rejectPlay = reject;
        });
      }
      addEventListener(type, callback) {
        this.listeners[type] = callback;
      }
      play() {
        return this.playPromise;
      }
      pause() {
        if (this.rejectPlay) {
          this.rejectPlay(new DOMException("The play() request was interrupted by a call to pause().", "AbortError"));
          this.rejectPlay = null;
        }
      }
      set src(_value) {}
    };
    state.castingLibrary = [
      { name: "first", file: "tts/library/current/first.wav", url: "/media?path=first.wav", voice: "voice_a", emotion: "neutral", duration: 2 },
      { name: "second", file: "tts/library/current/second.wav", url: "/media?path=second.wav", voice: "voice_a", emotion: "neutral", duration: 2 },
    ];
    renderCastingLibrary();
  });

  const playButtons = page.locator("#castingLibrary .casting-play-button");
  await playButtons.nth(0).click();
  await playButtons.nth(1).click();
  await page.waitForTimeout(50);

  await expect(playButtons.nth(0)).toHaveAttribute("aria-label", "Preview first");
  await expect(playButtons.nth(1)).toHaveAttribute("aria-label", "Stop preview");
  const alerts = await page.evaluate(() => window.__previewAlerts);
  expect(alerts).toEqual([]);
});

test("casting current clips can be trimmed and saved", async ({ page }) => {
  let trimPayload = null;
  await page.route("**/api/casting/trim", async (route) => {
    trimPayload = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, file: trimPayload.file, url: "/media?path=clip.wav" }),
    });
  });
  await page.route("**/api/casting/library", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        clips: [
          {
            name: "clip",
            file: "tts/library/current/clip.wav",
            url: "/media?path=tts%2Flibrary%2Fcurrent%2Fclip.wav",
            voice: "voice_a",
            emotion: "neutral",
          },
        ],
      }),
    });
  });

  await page.goto("/#casting");
  await page.evaluate(() => {
    state.castingLibrary = [{
      name: "clip",
      file: "tts/library/current/clip.wav",
      url: "/media?path=tts%2Flibrary%2Fcurrent%2Fclip.wav",
      voice: "voice_a",
      emotion: "neutral",
      duration: 5,
    }];
    renderCastingLibrary();
  });

  await page.locator("#castingLibrary button[aria-label='Edit clip']").click();
  await expect(page.locator("[data-waveform-canvas]")).toBeVisible();
  await expect(page.locator("[data-trim-play]")).toBeVisible();
  await page.locator("[data-waveform-canvas]").scrollIntoViewIfNeeded();
  const box = await page.locator("[data-waveform-canvas]").boundingBox();
  expect(box).not.toBeNull();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, y, { steps: 8 });
  await page.mouse.up();
  await page.mouse.move(box.x + box.width - 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, y, { steps: 8 });
  await page.mouse.up();
  await page.locator("[data-trim-save]").click();

  expect(trimPayload.file).toContain("current/clip.wav");
  expect(trimPayload.start).toBeGreaterThan(0.8);
  expect(trimPayload.start).toBeLessThan(1.2);
  expect(trimPayload.end).toBeGreaterThan(3.3);
  expect(trimPayload.end).toBeLessThan(3.7);
});
