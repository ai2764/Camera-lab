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

test("model switcher applies main model and lora overrides", async ({ page }) => {
  await page.route("**/api/workflow-model-controls?**", async (route) => {
    await route.fulfill({
      json: {
        workflow_id: "active",
        controls: [
          {
            id: "317:unet_name",
            node_id: "317",
            class_type: "UnetLoaderGGUF",
            label: "Base model",
            field: "unet_name",
            category: "main_model",
            value: "LTX-2.3-distilled-Q4_K_S.gguf",
            options: ["LTX-2.3-distilled-Q4_K_S.gguf", "LTX-2.3-distilled-Q8_0.gguf"],
          },
          {
            id: "293:lora_name",
            node_id: "293",
            class_type: "LoraLoaderModelOnly",
            label: "Distilled LoRA",
            field: "lora_name",
            category: "lora",
            value: "lora-a.safetensors",
            options: ["lora-a.safetensors", "lora-b.safetensors"],
          },
        ],
      },
    });
  });
  await page.route("**/api/run", async (route) => {
    await route.fulfill({
      json: {
        batch: { batch_id: "model_switch_test", runs: [{ run_id: "01", status: "queued" }] },
      },
    });
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option")).not.toHaveCount(0);

  const runRequest = page.waitForRequest("**/api/run");
  await page.locator("#modelSwitcherBtn").click();
  await page.locator('select[data-model-control-id="317:unet_name"]').selectOption("LTX-2.3-distilled-Q8_0.gguf");
  await page.locator('select[data-model-control-id="293:lora_name"]').selectOption("lora-b.safetensors");
  await page.locator("#modelSwitcherApply").click();
  await page.evaluate(() => {
    state.sourcePath = "tasks/camera_lab_uploads/images/source.png";
    state.middlePath = "tasks/camera_lab_uploads/images/middle.png";
    state.endPath = "tasks/camera_lab_uploads/images/end.png";
  });
  await page.locator("#runBtn").click();

  const payload = JSON.parse((await runRequest).postData() || "{}");
  expect(payload.model_overrides).toEqual({
    "317:unet_name": "LTX-2.3-distilled-Q8_0.gguf",
    "293:lora_name": "lora-b.safetensors",
  });
});

test("model switcher reports non-json endpoint errors clearly", async ({ page }) => {
  await page.route("**/api/workflow-model-controls?**", async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "text/html",
      body: "<!DOCTYPE html><title>Not Found</title>",
    });
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option")).not.toHaveCount(0);

  await page.locator("#modelSwitcherBtn").click();

  await expect(page.locator("#modelSwitcherStatus")).toContainText("Model controls unavailable: 404 Not Found");
});

test("director workspace exposes the model switcher", async ({ page }) => {
  await page.route("**/api/workflow-model-controls?**", async (route) => {
    await route.fulfill({
      json: {
        workflow_id: "ltx_director_2",
        controls: [
          {
            id: "35:unet_name",
            node_id: "35",
            class_type: "UNETLoader",
            label: "Director base model",
            field: "unet_name",
            category: "main_model",
            value: "director-a.safetensors",
            options: ["director-a.safetensors", "director-b.safetensors"],
          },
        ],
      },
    });
  });
  await page.goto("/#director");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);

  await expect(page.locator("#directorModelSwitcherBtn")).toBeVisible();
  await page.locator("#directorModelSwitcherBtn").click();

  await expect(page.locator('select[data-model-control-id="35:unet_name"]')).toBeVisible();
});

test("model switcher buttons sit below seed controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option")).not.toHaveCount(0);

  const cameraSeedThenModels = await page.evaluate(() => {
    const seed = document.getElementById("seedInput");
    const models = document.getElementById("modelSwitcherBtn");
    return Boolean(seed && models && seed.compareDocumentPosition(models) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(cameraSeedThenModels).toBe(true);

  await page.locator("#directorWorkspaceTab").click();
  await expect(page.locator("#directorModelSwitcherBtn")).toBeVisible();
  const directorSeedThenModels = await page.evaluate(() => {
    const seed = document.getElementById("directorGlobalSeedInput");
    const models = document.getElementById("directorModelSwitcherBtn");
    return Boolean(seed && models && seed.compareDocumentPosition(models) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(directorSeedThenModels).toBe(true);
});

test("unready modules disable workspace tabs and direct hashes fall back to camera", async ({ page }) => {
  await page.route("**/api/config", async (route) => {
    const config = {
      workflows: [{ id: "i2v_mock", label: "Mock I2V", mode: "i2v", available: true }],
      camera_moves: [{ id: "push_in", name: "Push in", prompts: { base: "A calm camera push in." } }],
      camera_examples: {},
      default_negative: "",
      comfy: { ok: true, reason: "", url: "http://127.0.0.1:8188" },
      casting: { voices: [] },
      modules: {
        camera: { enabled: true, ready: true, missing: [] },
        director: { enabled: true, ready: false, missing: ["LTXDirector"] },
        edit: { enabled: false, ready: false, missing: [] },
        casting: { enabled: true, ready: true, missing: [] },
        motion: { enabled: true, ready: true, missing: [] },
      },
    };
    await route.fulfill({ json: config });
  });
  await page.goto("/#director");

  await expect(page.locator("#directorWorkspaceTab")).toBeVisible();
  await expect(page.locator("#directorWorkspaceTab")).toBeDisabled();
  await expect(page.locator("#directorWorkspaceTab")).toHaveClass(/module-unavailable/);
  await expect(page.locator("#directorWorkspaceTab")).toHaveAttribute("title", /LTXDirector/);
  await expect(page.locator("#editWorkspaceTab")).toBeVisible();
  await expect(page.locator("#editWorkspaceTab")).toBeDisabled();
  await expect(page.locator("#cameraWorkspaceTab")).toHaveClass(/active/);
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
  const inpaintUploadMetrics = await page.locator("#inpaintSourceVideoWrap").evaluate((wrap) => {
    const panel = wrap.closest(".inpaint-panel").getBoundingClientRect();
    const control = wrap.querySelector(".edit-media-control-row").getBoundingClientRect();
    const status = wrap.querySelector(".edit-media-status").getBoundingClientRect();
    const preview = wrap.querySelector(".video-upload-preview").getBoundingClientRect();
    return {
      controlInsidePanel: control.left >= panel.left && control.right <= panel.right + 1,
      statusInsidePanel: status.left >= panel.left && status.right <= panel.right + 1,
      previewInsidePanel: preview.left >= panel.left && preview.right <= panel.right + 1,
      previewAlignedWithControl: Math.abs(preview.left - control.left) < 1 && Math.abs(preview.right - control.right) < 1,
    };
  });
  expect(inpaintUploadMetrics).toEqual({
    controlInsidePanel: true,
    statusInsidePanel: true,
    previewInsidePanel: true,
    previewAlignedWithControl: true,
  });

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

test("motion result cards expand output videos with matching output types", async ({ page }) => {
  await page.route("**/api/history?limit=200", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        runs: [
          {
            batch_id: "motion_text_multi",
            run_id: "01_text",
            workflow_id: "text_to_motion",
            workflow_mode: "motion_text",
            workflow_label: "Motion Guide",
            status: "guide_done",
            guide_video: "tasks/camera_lab_runs/motion_text_multi/01/guide_a.mp4",
            guide_outputs: [
              {
                path: "tasks/camera_lab_runs/motion_text_multi/01/guide_a.mp4",
                bucket: "images",
                type: "output",
                media_type: "video",
              },
              {
                path: "tasks/camera_lab_runs/motion_text_multi/01/guide_temp.mp4",
                bucket: "images",
                type: "temp",
                media_type: "video",
              },
              {
                path: "tasks/camera_lab_runs/motion_text_multi/01/guide_b.webm",
                bucket: "gifs",
                type: "output",
                media_type: "video",
              },
            ],
            prompt: "text multi output",
            duration: 4,
          },
          {
            batch_id: "motion_scail_multi",
            run_id: "01_scail",
            workflow_id: "uploaded_motion_to_scail",
            workflow_mode: "motion_scail",
            workflow_label: "SCAIL2",
            status: "done",
            guide_video: "tasks/camera_lab_runs/motion_scail_multi/01/guide.mp4",
            video: "tasks/camera_lab_runs/motion_scail_multi/01/final_a.mp4",
            video_outputs: [
              {
                path: "tasks/camera_lab_runs/motion_scail_multi/01/final_a.mp4",
                bucket: "images",
                type: "output",
                media_type: "video",
              },
              {
                path: "tasks/camera_lab_runs/motion_scail_multi/01/final_temp.mp4",
                bucket: "images",
                type: "temp",
                media_type: "video",
              },
              {
                path: "tasks/camera_lab_runs/motion_scail_multi/01/final_b.webm",
                bucket: "gifs",
                type: "output",
                media_type: "video",
              },
            ],
            prompt: "scail multi output",
            duration: 4,
          },
        ],
      }),
    });
  });

  await page.goto("/#motion");
  await expect(page.locator("#motionResultsGrid video")).toHaveCount(2);
  await expect(page.locator("#motionResultsGrid .mode-tag")).toHaveText(["GUIDE", "GUIDE"]);
  const guidePaths = await page.locator("#motionResultsGrid video").evaluateAll((videos) =>
    videos.map((video) => new URL(video.currentSrc || video.src).searchParams.get("path")),
  );
  expect(guidePaths).toEqual(expect.arrayContaining([
    "tasks/camera_lab_runs/motion_text_multi/01/guide_a.mp4",
    "tasks/camera_lab_runs/motion_text_multi/01/guide_b.webm",
  ]));
  expect(guidePaths).not.toContain("tasks/camera_lab_runs/motion_text_multi/01/guide_temp.mp4");

  const firstGuideCard = page.locator("#motionResultsGrid .result-card").filter({ hasText: "text multi output" }).first();
  await expect(firstGuideCard.locator(".use-prompt-run")).toHaveText("Use Motion");
  await expect(firstGuideCard.locator(".use-skeleton-run")).toHaveCount(0);
  await page.evaluate(() => {
    state.motionRefPath = "tasks/camera_lab_uploads/images/ref.png";
  });
  await firstGuideCard.locator(".use-prompt-run").click();
  await expect(page.locator("#motionScailTab")).toHaveClass(/active/);
  await expect(page.locator("#motionGuide")).toHaveAttribute("src", /guide_a\.mp4/);
  await expect(page.locator("#motionGuideUploadStatus")).toHaveText("guide_a.mp4");
  await expect(page.locator("#motionRunBtn")).toBeEnabled();

  await page.locator("#motionScailTab").click();
  await expect(page.locator("#motionScailResultsGrid video")).toHaveCount(2);
  await expect(page.locator("#motionScailResultsGrid .mode-tag")).toHaveText(["SCAIL2", "SCAIL2"]);
  const finalPaths = await page.locator("#motionScailResultsGrid video").evaluateAll((videos) =>
    videos.map((video) => new URL(video.currentSrc || video.src).searchParams.get("path")),
  );
  expect(finalPaths).toEqual(expect.arrayContaining([
    "tasks/camera_lab_runs/motion_scail_multi/01/final_a.mp4",
    "tasks/camera_lab_runs/motion_scail_multi/01/final_b.webm",
  ]));
  expect(finalPaths).not.toContain("tasks/camera_lab_runs/motion_scail_multi/01/final_temp.mp4");
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
  const resultRun = {
    batch_id: "batch_result_video",
    run_id: "01_result",
    workflow_id: "bernini_t2v",
    workflow_mode: "bernini_t2v",
    workflow_label: "WAN2.2 Bernini T2V",
    status: "done",
    video: "tasks/camera_lab_runs/batch_result_video/01_result/output.mp4",
    prompt: "source prompt",
    duration: 4,
  };
  await page.route("**/api/history?limit=200", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ runs: [resultRun] }),
    });
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='bernini_ads2v']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();

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
  await expect(card.locator(".result-video-edit-menu")).toContainText("Retake");
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

test("result video edit menu sends a video into Director Retake", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#editWorkspaceTab").click();
  await page.evaluate(() => {
    mergeHistoryRuns([{
      batch_id: "batch_retake_result",
      run_id: "01_result",
      workflow_id: "bernini_t2v",
      workflow_mode: "bernini_t2v",
      workflow_label: "WAN2.2 Bernini T2V",
      status: "done",
      video: "tasks/camera_lab_runs/batch_retake_result/01_result/output.mp4",
      prompt: "director result prompt",
      duration: 5.5,
    }], true);
    renderScopedHistory();
  });

  const card = page.locator("#resultsGrid .result-card").filter({ hasText: "director result prompt" });
  const editMenuButton = card.locator(".result-video-edit-button");
  await expect(editMenuButton).toBeVisible();
  await editMenuButton.evaluate((button) => button.click());
  const retakeMenuItem = card.locator(".result-video-edit-menu button", { hasText: "Retake" });
  await expect(retakeMenuItem).toBeVisible();
  await retakeMenuItem.evaluate((button) => button.click());

  await expect(page.locator("#directorWorkspaceTab")).toHaveClass(/active/);
  await expect(page.locator("#directorModeRetakeBtn")).toHaveClass(/active/);
  await expect(page.locator("#directorRetakeTrack .director-retake-block")).toContainText("output.mp4");
  const payload = await page.evaluate(() => collectPayload());
  expect(payload.retake_mode).toBe(true);
  expect(payload.retake_video.video_path).toContain("output.mp4");
  expect(payload.retake_video.duration).toBe(5.5);
});

test("result video edit menu can extract a frame from the playback timeline", async ({ page }) => {
  const resultRun = {
    batch_id: "frame_extract_batch",
    run_id: "01_frame_extract",
    workflow_id: "bernini_t2v",
    workflow_mode: "bernini_t2v",
    workflow_label: "WAN2.2 Bernini T2V",
    status: "done",
    video: "tasks/camera_lab_runs/frame_extract_batch/01/output.mp4",
    prompt: "frame extraction prompt",
    duration: 4,
  };
  await page.route("**/api/history?limit=200", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ runs: [resultRun] }),
    });
  });
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
  await expect(page.locator(".director-lane")).toHaveCount(5);
  const visibleLaneOrder = await page.locator(".director-lane").evaluateAll((lanes) => lanes
    .filter((lane) => getComputedStyle(lane).display !== "none")
    .map((lane) => lane.dataset.lane));
  expect(visibleLaneOrder).toEqual([
    "main",
    "video-audio",
    "dialogue",
    "ic-video",
  ]);
  await expect(page.locator(".director-lane[data-lane='retake']")).not.toBeVisible();
  await expect(page.locator(".director-lane[data-lane='main']")).toContainText("Main");
  await expect(page.locator(".director-lane[data-lane='ic-video']")).toContainText("IC video");
  await expect(page.locator(".director-lane[data-lane='video-audio']")).toContainText("Video audio");
  await expect(page.locator(".director-lane[data-lane='video-audio']")).toContainText("Follows main video guides");
  await expect(page.locator(".director-lane[data-lane='video-audio']")).not.toContainText("Detached video audio appears");
  await expect(page.locator(".director-lane[data-lane='dialogue']")).toContainText("Dialogue");
  await expect(page.locator("#addDirectorIcVideoBtn")).toBeVisible();
  await expect(page.locator(".director-timeline-shell")).not.toContainText("Image and text timeline");
  await expect(page.locator("#directorTrack .director-block")).toHaveCount(0);
  await expect(page.locator("#directorSegmentInspector")).toContainText("Add a segment");
  await expect(page.locator("#directorTrack")).not.toContainText("empty prompt");
  await expect(page.locator("#directorGlobalPrompt")).toHaveValue(/continuous cinematic video/i);
  await page.locator("#directorGlobalPrompt").fill("");
  await page.evaluate(() => resetPrompt());
  await expect(page.locator("#directorGlobalPrompt")).toHaveValue(/continuous cinematic video/i);
});

test("director payload spans the last segment end for disconnected segments", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await page.evaluate(() => {
    state.directorSegments = [
      {
        id: "seg_start",
        start: 0,
        duration: 1,
        prompt: "opening frame",
        reference: "",
        imagePath: "",
        imageName: "",
        imagePreviewUrl: "",
        strength: 0.65,
      },
      {
        id: "seg_end",
        start: 3,
        duration: 1,
        prompt: "ending frame",
        reference: "",
        imagePath: "",
        imageName: "",
        imagePreviewUrl: "",
        strength: 0.65,
      },
    ];
    renderDirectorEditor();
  });

  const payload = await page.evaluate(() => collectPayload());

  // Gap from 1s-3s is preserved (seg_end starts at 3s); generation spans the last
  // segment end (4s), not the x1.3-padded ruler value.
  expect(payload.duration).toBe(4);
  expect(payload.timeline_segments.map((segment) => [segment.start, segment.duration])).toEqual([
    [0, 1],
    [3, 1],
  ]);
});

test("director generation duration spans the longest track without display padding", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await page.evaluate(() => {
    state.directorSegments = [0, 1, 2].map((i) => ({
      id: `seg_${i}`,
      start: i * 4,
      duration: 4,
      prompt: `shot ${i}`,
      reference: "",
      imagePath: "",
      imageName: "",
      imagePreviewUrl: "",
      strength: 0.65,
    }));
    state.directorVideoAudioSegments = [
      {
        id: "va1",
        start: 0,
        duration: 13.33,
        trimStart: 0,
        audioPath: "tasks/camera_lab_uploads/audio/song.mp3",
        audioName: "song.mp3",
        audioDuration: 13.33,
        volume: 1,
      },
    ];
    state.directorAudioSegments = [];
    renderDirectorEditor();
  });

  const payload = await page.evaluate(() => collectPayload());

  // Segments span 12s, the video-audio clip spans 13.33s -> generation follows the
  // longest track (rounded up to 13.5s), NOT the padded ruler value (12 * 1.3 = 16).
  expect(payload.duration).toBe(13.5);
});

test("director timeline labels sit beside compact stacked tracks", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  const metrics = await page.evaluate(() => {
    const lanes = [...document.querySelectorAll(".director-lane")]
      .filter((lane) => getComputedStyle(lane).display !== "none");
    const label = document.querySelector(".director-lane[data-lane='main'] .director-track-label").getBoundingClientRect();
    const track = document.querySelector("#directorTrack").getBoundingClientRect();
    const storyboardParentLane = document.querySelector("#openStoryboardImportBtn").closest(".director-lane")?.dataset.lane || "";
    const addParentLane = document.querySelector("#addDirectorSegmentBtn").closest(".director-lane")?.dataset.lane || "";
    const gaps = lanes.slice(1).map((lane, index) => {
      const prev = lanes[index].getBoundingClientRect();
      const current = lane.getBoundingClientRect();
      return Math.round(current.top - prev.bottom);
    });
    return {
      labelRight: Math.round(label.right),
      trackLeft: Math.round(track.left),
      labelTop: Math.round(label.top),
      trackTop: Math.round(track.top),
      storyboardParentLane,
      addParentLane,
      gaps,
    };
  });
  expect(metrics.labelRight).toBeLessThanOrEqual(metrics.trackLeft);
  expect(Math.abs(metrics.labelTop - metrics.trackTop)).toBeLessThanOrEqual(2);
  expect(metrics.storyboardParentLane).toBe("main");
  expect(metrics.addParentLane).toBe("main");
  expect(Math.max(...metrics.gaps)).toBeLessThanOrEqual(2);
});

test("director timeline scrolls horizontally without vertical scrollbar", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  const metrics = await page.locator(".director-timeline-shell").evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      verticalScrollRange: el.scrollHeight - el.clientHeight,
    };
  });

  expect(metrics.overflowX).toBe("auto");
  expect(metrics.overflowY).toBe("hidden");
  expect(metrics.verticalScrollRange).toBeLessThanOrEqual(1);
});

test("director timeline expands horizontally for long clips", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await page.evaluate(() => {
    state.directorSegments = [];
    state.directorAudioSegments = [{
      id: "aud_long_scroll",
      start: 18,
      duration: 8,
      trimStart: 0,
      audioPath: "tasks/camera_lab_uploads/audio/long.wav",
      audioName: "long.wav",
      audioDuration: 8,
    }];
    state.directorSelectedId = "aud_long_scroll";
    state.directorSelectionType = "audio";
    renderDirectorEditor();
  });

  const metrics = await page.locator(".director-timeline-shell").evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth + 200);
});

test("director IC video lane uploads reference video into motion segments", async ({ page }) => {
  await page.route("**/api/upload-video", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        path: "tasks/camera_lab_uploads/videos/ic_reference.mp4",
        name: "ic_reference.mp4",
        poster_path: "tasks/camera_lab_uploads/videos/ic_reference_first_frame.jpg",
        duration: 3.75,
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
  const icPayload = await page.evaluate(() => collectPayload());
  expect(icPayload.motion_segments[0].duration).toBe(3.75);
  const layout = await page.evaluate(() => {
    const mainTrack = document.querySelector("#directorTrack").getBoundingClientRect();
    const icTrack = document.querySelector("#directorIcVideoTrack").getBoundingClientRect();
    const mainBlock = document.querySelector("#directorTrack .director-block")?.getBoundingClientRect();
    const icBlock = document.querySelector("#directorIcVideoTrack .director-ic-video-block").getBoundingClientRect();
    return {
      mainTrackHeight: Math.round(mainTrack.height),
      icTrackHeight: Math.round(icTrack.height),
      icBlockTopOffset: Math.round(icBlock.top - icTrack.top),
      icBlockBottomOffset: Math.round(icTrack.bottom - icBlock.bottom),
      mainBlockTopOffset: mainBlock ? Math.round(mainBlock.top - mainTrack.top) : 18,
      mainBlockBottomOffset: mainBlock ? Math.round(mainTrack.bottom - mainBlock.bottom) : 18,
    };
  });
  expect(layout.icTrackHeight).toBe(layout.mainTrackHeight);
  expect(layout.icBlockTopOffset).toBe(layout.mainBlockTopOffset);
  expect(layout.icBlockBottomOffset).toBe(layout.mainBlockBottomOffset);
  const payload = await page.evaluate(() => collectPayload());
  expect(payload.motion_segments).toEqual([
    expect.objectContaining({
      type: "motion_video",
      video_path: expect.stringContaining("ic_reference.mp4"),
    }),
  ]);
  expect(payload.timeline_segments.some((segment) => segment.video_path?.includes("ic_reference.mp4"))).toBe(false);
});

test("normal director result card keeps DIR tag when retake mode is false", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  const label = await page.evaluate(() => runModeLabel({
    workflow_id: "ltx_director_2",
    workflow_mode: "director_ref",
    director_timeline: { retake_mode: "false" },
  }));

  expect(label).toBe("DIR");
});

test("director retake tab uploads one base video and emits native retake payload", async ({ page }) => {
  await page.route("**/api/run", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        batch_id: "dry_retake",
        status: "queued",
        runs: [{ run_id: "01_director", status: "queued", workflow_id: "ltx_director_2" }],
      }),
    });
  });
  await page.route("**/api/upload-video", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        path: "tasks/camera_lab_uploads/videos/retake_base.mp4",
        name: "retake_base.mp4",
        poster_path: "tasks/camera_lab_uploads/videos/retake_base_first_frame.jpg",
      }),
    });
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await expect(page.locator("#directorModeGenerateBtn")).toHaveClass(/active/);
  await expect(page.locator("#directorRetakePanel")).toBeHidden();
  await expect(page.locator("#directorRetakePrompt")).toBeHidden();
  await page.locator("#directorModeRetakeBtn").click();
  await expect(page.locator("#directorModeRetakeBtn")).toHaveClass(/active/);
  await expect(page.locator("#directorRetakePanel")).toBeVisible();
  await expect(page.locator("#directorRetakePrompt")).toBeVisible();
  await expect(page.locator("#runBtn")).toHaveText("Queue Director Retake");
  await expect(page.locator("#directorRetakeTrack")).toBeVisible();
  await expect(page.locator("#directorTrack")).not.toBeVisible();
  await page.locator("#directorModeGenerateBtn").click();
  await expect(page.locator("#directorRetakePrompt")).toBeHidden();
  await page.locator("#directorModeRetakeBtn").click();

  await page.locator("#directorRetakeVideoInput").setInputFiles({
    name: "retake_base.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("retake-video"),
  });
  await expect(page.locator("#directorRetakeTrack .director-retake-block")).toContainText("retake_base.mp4");

  await page.evaluate(() => {
    state.directorRetakeVideo.duration = 6;
    renderDirectorEditor();
    DirectorPreview.seek(1.2);
  });
  await page.locator("#directorRetakeSetStartBtn").click();
  await page.evaluate(() => {
    DirectorPreview.seek(3.4);
  });
  await page.locator("#directorRetakeSetEndBtn").click();
  await page.locator("#directorRetakePrompt").fill("redo the hand gesture");

  const payload = await page.evaluate(() => collectPayload());
  const runRequest = page.waitForRequest("**/api/run");
  await page.locator("#runBtn").click();
  const queuedPayload = JSON.parse((await runRequest).postData());
  await expect(page.locator("#runBtn")).toHaveText("Queue Director Retake");
  await expect(page.locator("#runBtn")).toBeEnabled();

  expect(payload.retake_mode).toBe(true);
  expect(queuedPayload.retake_mode).toBe(true);
  expect(payload.timeline_segments).toEqual([]);
  expect(queuedPayload.timeline_segments).toEqual([]);
  expect(payload.motion_segments).toEqual([]);
  expect(payload.audio_segments).toEqual([]);
  expect(payload.retake_video).toEqual(expect.objectContaining({
    video_path: expect.stringContaining("retake_base.mp4"),
    file_name: "retake_base.mp4",
  }));
  expect(payload.retake_start).toBeCloseTo(29 / 24, 3);
  expect(queuedPayload.retake_start).toBeCloseTo(29 / 24, 3);
  expect(payload.retake_length).toBeCloseTo(53 / 24, 3);
  expect(queuedPayload.retake_length).toBeCloseTo(53 / 24, 3);
  expect(payload.retake_prompt).toBe("redo the hand gesture");
  expect(queuedPayload.retake_prompt).toBe("redo the hand gesture");
});

test("director preview keeps global prompt and size controls in the right rail", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await expect(page.getByRole("heading", { name: "Global Setup" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Timeline Segments" })).toHaveCount(0);
  await expect(page.locator("#directorGlobalReferenceStrength")).toHaveCount(0);
  await expect(page.locator("#directorReferenceWrap")).toHaveCount(0);
  await expect(page.locator("#directorNegativePrompt")).toHaveValue(/watermark/);

  const layout = await page.evaluate(() => {
    const preview = document.getElementById("directorPreview").getBoundingClientRect();
    const settings = document.querySelector(".director-preview-row .director-global-settings").getBoundingClientRect();
    return {
      sameRow: Math.abs(preview.top - settings.top) < 2,
      settingsRightOfPreview: settings.left > preview.right,
    };
  });
  expect(layout.sameRow).toBe(true);
  expect(layout.settingsRightOfPreview).toBe(true);

  await page.locator("#directorGlobalPrompt").fill("coherent scene tone");
  await page.locator("#directorGlobalSeedInput").fill("123456");
  await page.locator("#directorNegativePrompt").fill("no subtitles, no extra fingers");
  await page.locator("#directorSizePreset").selectOption("720x1280");
  const payload = await page.evaluate(() => collectPayload());
  expect(payload.global_prompt).toBe("coherent scene tone");
  expect(payload.seed).toBe("123456");
  expect(payload.negative_prompt).toBe("no subtitles, no extra fingers");
  expect(payload.width).toBe(720);
  expect(payload.height).toBe(1280);
  expect(payload.global_reference_strength).toBe(0);
});

test("director output heading is compact", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await expect(page.locator(".director-output-heading .director-section-kicker")).toHaveText("Output");
  await expect(page.locator(".director-output-heading")).not.toContainText("Queue / Video results / Segment jumps");
  await expect(page.locator(".director-output-heading")).not.toContainText("03");
});

test("director queue keeps global seed empty when run returns a random seed", async ({ page }) => {
  await page.route("**/api/run", async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.seed).toBe("");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        batch_id: "director_seed_batch",
        status: "queued",
        runs: [{
          batch_id: "director_seed_batch",
          run_id: "01_director",
          workflow_id: "ltx_director_2",
          workflow_mode: "director_ref",
          workflow_label: "LTX Director Reference V2",
          status: "queued",
          prompt: "random seed shot",
          seed: 987654321,
          duration: 2,
          director_timeline: {
            segments: [{ prompt: "random seed shot", duration: 2 }],
          },
        }],
      }),
    });
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    document.getElementById("seedInput").value = "111111111";
    state.directorSegments = [{ id: "seed_seg", start: 0, duration: 2, prompt: "random seed shot", reference: "", imagePath: "", imageName: "", imagePreviewUrl: "", strength: 0.65 }];
    renderDirectorEditor();
  });

  await expect(page.locator("#directorGlobalSeedInput")).toHaveValue("");
  await page.locator("#runBtn").click();
  await expect(page.locator("#directorGlobalSeedInput")).toHaveValue("");
});

test("director generate queue ignores loaded retake base video", async ({ page }) => {
  let runRequests = 0;
  await page.route("**/api/run", async (route) => {
    runRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ batch_id: "generate_with_retake_loaded", status: "queued", runs: [] }),
    });
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorMode = "generate";
    state.directorRetakeVideo = {
      videoPath: "tasks/camera_lab_runs/retake/clip.mp4",
      videoName: "clip.mp4",
      videoPreviewUrl: "",
      videoPosterUrl: "",
      duration: 6,
    };
    renderDirectorEditor();
  });

  await expect(page.locator("#directorModeGenerateBtn")).toHaveClass(/active/);
  await expect(page.locator("#runBtn")).toHaveText("Queue Run");
  const runRequest = page.waitForRequest("**/api/run");
  await page.locator("#runBtn").click();
  const payload = JSON.parse((await runRequest).postData());

  expect(payload.retake_mode).toBeUndefined();
  expect(payload.retake_video).toBeUndefined();
  expect(runRequests).toBe(1);
});

test("director retake selection can be dragged and base video removed", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.locator("#directorModeRetakeBtn").click();
  await page.evaluate(() => {
    state.directorRetakeVideo = {
      videoPath: "tasks/camera_lab_runs/retake/clip.mp4",
      videoName: "clip.mp4",
      videoPreviewUrl: "",
      videoPosterUrl: "",
      duration: 6,
    };
    state.directorRetakeStart = 1;
    state.directorRetakeLength = 2;
    renderDirectorEditor();
  });

  const selection = page.locator("#directorRetakeTrack .director-retake-selection");
  await selection.scrollIntoViewIfNeeded();
  const box = await selection.boundingBox();
  const trackBox = await page.locator("#directorRetakeTrack").boundingBox();
  expect(box).not.toBeNull();
  expect(trackBox).not.toBeNull();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + trackBox.width / 6, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  const dragged = await page.evaluate(() => ({
    start: state.directorRetakeStart,
    length: state.directorRetakeLength,
    payload: collectPayload(),
  }));
  expect(dragged.start).toBeCloseTo(2, 1);
  expect(dragged.length).toBe(2);
  expect(dragged.payload.retake_start).toBeCloseTo(2, 1);
  expect(dragged.payload.retake_length).toBe(2);

  await page.locator("#directorRetakeTrack .director-retake-remove").click();
  await expect(page.locator("#directorRetakeTrack .director-retake-block")).toHaveCount(0);
  expect(await page.evaluate(() => state.directorRetakeVideo)).toBeNull();
});

test("director retake preview includes base video audio", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.locator("#directorModeRetakeBtn").click();
  await page.evaluate(() => {
    state.directorRetakeVideo = {
      videoPath: "tasks/camera_lab_runs/retake/clip_with_audio.mp4",
      videoName: "clip_with_audio.mp4",
      videoPreviewUrl: "",
      videoPosterUrl: "",
      duration: 6,
      width: 1920,
      height: 1080,
    };
    state.directorRetakeStart = 1;
    state.directorRetakeLength = 2;
    renderDirectorEditor();
  });

  const previewState = await page.evaluate(() => DirectorPreview._state());
  expect(previewState.timeline.audioClips).toEqual([
    expect.objectContaining({
      start: 0,
      duration: 6,
      trimStart: 0,
      src: expect.stringContaining("clip_with_audio.mp4"),
      volume: 1,
    }),
  ]);
  expect(await page.evaluate(() => DirectorPreview._audio())).toEqual([
    expect.objectContaining({ start: 0, volume: 1 }),
  ]);
});

test("director retake edit panel previews the selected clip range", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.locator("#directorModeRetakeBtn").click();
  await page.evaluate(() => {
    state.directorRetakeVideo = {
      videoPath: "tasks/camera_lab_runs/retake/clip.mp4",
      videoName: "clip.mp4",
      videoPreviewUrl: "",
      videoPosterUrl: "",
      duration: 6,
      width: 1920,
      height: 1080,
    };
    state.directorRetakeStart = 1.2;
    state.directorRetakeLength = 2.2;
    renderDirectorEditor();
  });

  await expect(page.locator("#directorRetakeSelectionPreview")).toHaveAttribute("src", /clip\.mp4/);
  await expect(page.locator("#directorRetakeSelectionLabel")).toHaveText(/clip\.mp4 \| 1\.21s - 3\.42s/);
});

test("director retake selection handles resize the selected range", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.locator("#directorModeRetakeBtn").click();
  await page.evaluate(() => {
    state.directorRetakeVideo = {
      videoPath: "tasks/camera_lab_runs/retake/clip.mp4",
      videoName: "clip.mp4",
      videoPreviewUrl: "",
      videoPosterUrl: "",
      duration: 6,
    };
    state.directorRetakeStart = 2;
    state.directorRetakeLength = 2;
    renderDirectorEditor();
  });

  const trackBox = await page.locator("#directorRetakeTrack").boundingBox();
  const leftHandle = page.locator("#directorRetakeTrack .director-retake-handle-left");
  const rightHandle = page.locator("#directorRetakeTrack .director-retake-handle-right");
  await expect(leftHandle).toBeVisible();
  await expect(rightHandle).toBeVisible();
  const leftBox = await leftHandle.boundingBox();
  const rightBox = await rightHandle.boundingBox();
  expect(trackBox).not.toBeNull();
  expect(leftBox).not.toBeNull();
  expect(rightBox).not.toBeNull();
  const oneSecond = trackBox.width / 6;

  await page.mouse.move(leftBox.x + leftBox.width / 2, leftBox.y + leftBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(leftBox.x + leftBox.width / 2 - oneSecond, leftBox.y + leftBox.height / 2, { steps: 8 });
  await page.mouse.up();

  let range = await page.evaluate(() => ({ start: state.directorRetakeStart, length: state.directorRetakeLength }));
  expect(range.start).toBeCloseTo(1, 1);
  expect(range.length).toBeCloseTo(3, 1);

  const rightBoxAfter = await rightHandle.boundingBox();
  expect(rightBoxAfter).not.toBeNull();
  await page.mouse.move(rightBoxAfter.x + rightBoxAfter.width / 2, rightBoxAfter.y + rightBoxAfter.height / 2);
  await page.mouse.down();
  await page.mouse.move(rightBoxAfter.x + rightBoxAfter.width / 2 + oneSecond, rightBoxAfter.y + rightBoxAfter.height / 2, { steps: 8 });
  await page.mouse.up();

  range = await page.evaluate(() => ({
    start: state.directorRetakeStart,
    length: state.directorRetakeLength,
    payload: collectPayload(),
  }));
  expect(range.start).toBeCloseTo(1, 1);
  expect(range.length).toBeCloseTo(4, 1);
  expect(range.payload.retake_start).toBeCloseTo(1, 1);
  expect(range.payload.retake_length).toBeCloseTo(4, 1);
});

test("director retake edit mode buttons trim the selection into Edit inputs", async ({ page }) => {
  await page.route("**/api/trim-video", async (route) => {
    const payload = route.request().postDataJSON();
    expect(payload.video_path).toContain("clip.mp4");
    expect(payload.start).toBeCloseTo(29 / 24, 3);
    expect(payload.end).toBeCloseTo(82 / 24, 2);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        path: "tasks/camera_lab_uploads/videos/retake_clip_1_2_3_4.mp4",
        name: "retake_clip_1_2_3_4.mp4",
        duration: 2.2,
      }),
    });
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.locator("#directorModeRetakeBtn").click();
  await page.evaluate(() => {
    state.directorRetakeVideo = {
      videoPath: "tasks/camera_lab_runs/retake/clip.mp4",
      videoName: "clip.mp4",
      videoPreviewUrl: "",
      videoPosterUrl: "",
      duration: 6,
      width: 1920,
      height: 1080,
    };
    state.directorRetakeStart = 1.2;
    state.directorRetakeLength = 2.2;
    state.directorRetakePrompt = "make the gesture more subtle";
    renderDirectorEditor();
  });

  await expect(page.locator("#directorRetakeEditModes")).toContainText("V2V");
  await expect(page.locator("#directorRetakeEditModes")).toContainText("Inpaint");
  await page.getByRole("button", { name: "V2V", exact: true }).click();

  await expect(page.locator("#editWorkspaceTab")).toHaveClass(/active/);
  await expect(page.locator("#workflowSelect")).toHaveValue("bernini_v2v");
  await expect(page.locator("#berniniSourceVideoStatus")).toContainText("retake_clip_1_2_3_4.mp4");
  await expect(page.locator("#promptText")).toHaveValue("make the gesture more subtle");
  await expect(page.locator("#runHint")).toContainText("Loaded retake selection into V2V");
  const pendingStitch = await page.evaluate(() => state.directorRetakePendingStitch);
  expect(pendingStitch).toMatchObject({
    baseVideoPath: expect.stringContaining("clip.mp4"),
    prompt: "make the gesture more subtle",
    targetId: "bernini_v2v",
    targetKind: "bernini",
  });
  expect(pendingStitch.start).toBeCloseTo(29 / 24, 3);
  expect(pendingStitch.end).toBeCloseTo(82 / 24, 2);
  let payload = await page.evaluate(() => collectPayload());
  expect(payload.duration).toBe(2.2);
  expect(payload.width).toBe(1920);
  expect(payload.height).toBe(1080);
  expect(payload.bernini_preserve_audio).toBe(true);
  expect(payload.source_video_path).toContain("retake_clip_1_2_3_4.mp4");

  await page.locator("#directorWorkspaceTab").click();
  await page.locator("#directorModeRetakeBtn").click();
  await page.getByRole("button", { name: "Inpaint", exact: true }).click();
  await expect(page.locator("#workflowSelect")).toHaveValue("wan_vace_inpaint");
  await expect(page.locator("#inpaintSourceVideoStatus")).toContainText("retake_clip_1_2_3_4.mp4");
  payload = await page.evaluate(() => collectPayload());
  expect(payload.duration).toBe(2.2);
  expect(payload.width).toBe(1920);
  expect(payload.height).toBe(1080);
  expect(payload.source_video_path).toContain("retake_clip_1_2_3_4.mp4");
});

test("director retake edit run carries lineage and shows pending stitched outputs", async ({ page }) => {
  const runPayloads = [];
  await page.route("**/api/trim-video", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        path: "tasks/camera_lab_uploads/videos/retake_clip_2_3_6_1.mp4",
        name: "retake_clip_2_3_6_1.mp4",
        duration: 3.8,
      }),
    });
  });
  await page.route("**/api/run", async (route) => {
    const payload = route.request().postDataJSON();
    runPayloads.push(payload);
    const index = runPayloads.length;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        batch_id: `bernini_retake_batch_${index}`,
        status: "queued",
        runs: [{
          batch_id: `bernini_retake_batch_${index}`,
          run_id: `01_v2v_${index}`,
          workflow_id: "bernini_v2v",
          workflow_mode: "bernini_v2v",
          workflow_label: "WAN2.2 Bernini V2V",
          status: "queued",
          prompt: "replace the hand motion",
          duration: 3.8,
          retake_context: payload.retake_context,
        }],
      }),
    });
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.locator("#directorModeRetakeBtn").click();
  await page.evaluate(() => {
    state.directorRetakeVideo = {
      videoPath: "tasks/camera_lab_runs/retake/base.mp4",
      videoName: "base.mp4",
      videoPreviewUrl: "",
      videoPosterUrl: "",
      duration: 8,
    };
    state.directorRetakeStart = 2.3;
    state.directorRetakeLength = 3.8;
    state.directorRetakePrompt = "replace the hand motion";
    renderDirectorEditor();
  });

  await page.getByRole("button", { name: "V2V", exact: true }).click();
  await page.locator("#runBtn").click();

  await expect(page.locator("#directorWorkspaceTab")).toHaveClass(/active/);
  await expect(page.locator("#directorModeRetakeBtn")).toHaveClass(/active/);
  const runPayload = runPayloads[0];
  expect(runPayload.retake_context).toMatchObject({
    base_video_path: "tasks/camera_lab_runs/retake/base.mp4",
    start: expect.closeTo(2.3, 1),
    end: expect.closeTo(6.1, 1),
    clipped_path: "tasks/camera_lab_uploads/videos/retake_clip_2_3_6_1.mp4",
    target_workflow: "bernini_v2v",
    prompt: "replace the hand motion",
    auto_stitch: true,
  });
  expect(runPayload.retake_context.retake_id).toMatch(/^retake-/);
  await expect(page.locator("#directorResultsGrid .result-card").filter({ hasText: runPayload.retake_context.retake_id })).toContainText("waiting for V2V result");
  expect(await page.evaluate((retakeId) => state.directorRetakeCompletedStitches[retakeId], runPayload.retake_context.retake_id)).toBeUndefined();
  expect(await page.evaluate(() => runModeLabel(state.historyRuns.find((run) => run.retake_context?.retake_id)))).toBe("retake-V2V");

  await page.evaluate(() => {
    setWorkspace("edit", { syncWorkflow: false });
    setBerniniWorkflow("bernini_v2v");
  });
  await page.locator("#runBtn").click();
  await expect(page.locator("#directorWorkspaceTab")).toHaveClass(/active/);
  expect(runPayloads).toHaveLength(2);
  const firstRetakeId = runPayloads[0].retake_context.retake_id;
  const secondRetakeId = runPayloads[1].retake_context.retake_id;
  expect(secondRetakeId).toMatch(/^retake-/);
  expect(secondRetakeId).not.toBe(firstRetakeId);
  await expect(page.locator("#directorResultsGrid .result-card").filter({ hasText: firstRetakeId })).toContainText("waiting for V2V result");
  await expect(page.locator("#directorResultsGrid .result-card").filter({ hasText: secondRetakeId })).toContainText("waiting for V2V result");
});

test("director retake auto stitch merges an edit result into Director output", async ({ page }) => {
  const stitchPayloads = [];
  await page.route("**/api/stitch-retake-video", async (route) => {
    stitchPayloads.push(route.request().postDataJSON());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        run: {
          batch_id: "director_retake_stitch_test",
          run_id: "01_stitched",
          workflow_id: "ltx_director_2",
          workflow_mode: "director_ref",
          workflow_label: "LTX Director Reference V2",
          status: "done",
          video: "tasks/camera_lab_runs/director_retake_stitch_test/01_stitched/director_retake_stitched.mp4",
          duration: 6,
          variant_name: "retake-auto1+V2V",
          prompt: "replace the middle action",
          retake_stitch: {
            retake_id: "retake-auto1",
            edit_run_key: "bernini_done:01",
            base_video: "tasks/camera_lab_runs/retake/clip.mp4",
            edited_video: "tasks/camera_lab_runs/bernini_done/01/output.mp4",
            edit_mode: "V2V",
            start: 1,
            end: 3,
          },
        },
      }),
    });
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    const retakeContext = {
      retake_id: "retake-auto1",
      base_video_path: "tasks/camera_lab_runs/retake/clip.mp4",
      base_video_name: "clip.mp4",
      base_video_duration: 6,
      clipped_path: "tasks/camera_lab_uploads/videos/retake_clip.mp4",
      clipped_name: "retake_clip.mp4",
      start: 1,
      end: 3,
      prompt: "replace the middle action",
      target_workflow: "bernini_v2v",
      target_kind: "bernini",
      target_label: "V2V",
      auto_stitch: true,
      stitching: false,
    };
    state.directorRetakeStitches[retakeContext.retake_id] = retakeContext;
    mergeHistoryRuns([{
      batch_id: "bernini_done",
      run_id: "01",
      workflow_id: "bernini_v2v",
      workflow_mode: "bernini_v2v",
      workflow_label: "WAN2.2 Bernini V2V",
      status: "done",
      video: "tasks/camera_lab_runs/bernini_done/01/output.mp4",
      prompt: "replace the middle action",
      retake_context: retakeContext,
    }], true);
  });

  await page.waitForFunction(() => state.historyRuns.some((run) => run.retake_stitch && run.video.includes("director_retake_stitched")));
  expect(stitchPayloads[0]).toMatchObject({
    base_video_path: "tasks/camera_lab_runs/retake/clip.mp4",
    edited_video_path: "tasks/camera_lab_runs/bernini_done/01/output.mp4",
    start: 1,
    end: 3,
    prompt: "replace the middle action",
    retake_id: "retake-auto1",
    edit_mode: "V2V",
    edit_run_key: "bernini_done:01",
  });
  await page.evaluate(() => {
    const editRun = state.historyRuns.find((run) => run.batch_id === "bernini_done" && run.run_id === "01");
    mergeHistoryRuns([editRun], false);
  });
  await page.waitForTimeout(100);
  expect(stitchPayloads).toHaveLength(1);
  expect(await page.evaluate(() => state.directorRetakeStitches["retake-auto1"])).toBeUndefined();
  const stitchedCard = page.locator('#directorResultsGrid .result-card[data-run-key="director_retake_stitch_test:01_stitched"]');
  await expect(stitchedCard).toContainText("replace the middle action");
  await expect(stitchedCard).toContainText("retake-auto1+V2V");
  await expect(stitchedCard.locator(".mode-tag")).toHaveText("retake");
});

test("director retake auto stitch failure does not retry on later edit results", async ({ page }) => {
  let stitchRequests = 0;
  await page.route("**/api/stitch-retake-video", async (route) => {
    stitchRequests += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "ffprobe failed on stale stitched output" }),
    });
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.evaluate(() => {
    state.directorRetakePendingStitch = {
      retake_id: "retake-stale",
      base_video_path: "tasks/camera_lab_runs/missing/director_retake_stitched.mp4",
      start: 1,
      end: 3,
      prompt: "old retake",
      target_workflow: "bernini_i2v",
      target_label: "I2V",
      auto_stitch: true,
    };
    mergeHistoryRuns([{
      batch_id: "i2v_done_one",
      run_id: "01",
      workflow_id: "bernini_i2v",
      workflow_mode: "bernini_i2v",
      status: "done",
      video: "tasks/camera_lab_runs/i2v_done_one/01/out.mp4",
      prompt: "first i2v",
    }], true);
  });
  await expect(page.locator("#runHint")).toContainText("Retake stitch failed");

  await page.evaluate(() => {
    mergeHistoryRuns([{
      batch_id: "i2v_done_two",
      run_id: "01",
      workflow_id: "bernini_i2v",
      workflow_mode: "bernini_i2v",
      status: "done",
      video: "tasks/camera_lab_runs/i2v_done_two/01/out.mp4",
      prompt: "second i2v",
    }], true);
  });
  await page.waitForTimeout(100);
  expect(stitchRequests).toBe(1);
});

test("director retake result card shows the retake prompt instead of global prompt", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    mergeHistoryRuns([{
      batch_id: "batch_retake_prompt",
      run_id: "01_director",
      workflow_id: "ltx_director_2",
      workflow_mode: "director_ref",
      workflow_label: "LTX Director v2",
      status: "done",
      video: "tasks/camera_lab_runs/batch_retake_prompt/01_director/output.mp4",
      prompt: "replace the middle action",
      global_prompt: "keep the existing scene continuous",
      retake_prompt: "replace the middle action",
      director_timeline: {
        retake_mode: true,
        retake_prompt: "replace the middle action",
        global_prompt: "keep the existing scene continuous",
        segments: [],
      },
    }], true);
    renderScopedHistory();
  });

  const card = page.locator("#directorResultsGrid .result-card").filter({ hasText: "replace the middle action" });
  await expect(card.locator(".mode-tag")).toHaveText("retake");
  await expect(card.locator(".paths")).toHaveText("replace the middle action");
  await expect(card.locator(".paths")).not.toContainText("keep the existing scene continuous");
});

test("director IC video segments can be dragged on their timeline", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{
      id: "seg_for_ic_drag",
      start: 0,
      duration: 4,
      prompt: "Main guide.",
      reference: "",
      imagePath: "",
      imageName: "",
      imagePreviewUrl: "",
      strength: 0.65,
    }];
    state.directorIcVideoSegments = [{
      id: "ic_drag",
      start: 0,
      duration: 1,
      trimStart: 0,
      videoPath: "tasks/camera_lab_uploads/videos/ic_drag.mp4",
      videoName: "ic_drag.mp4",
      videoPreviewUrl: "",
      videoDuration: 1,
    }];
    state.directorSelectedId = "ic_drag";
    state.directorSelectionType = "ic_video";
    renderDirectorEditor();
  });

  await page.locator("#directorIcVideoTrack .director-ic-video-block").scrollIntoViewIfNeeded();
  const trackBox = await page.locator("#directorIcVideoTrack").boundingBox();
  const blockBox = await page.locator("#directorIcVideoTrack .director-ic-video-block").boundingBox();
  expect(trackBox).not.toBeNull();
  expect(blockBox).not.toBeNull();
  const oneSecond = trackBox.width / 6;
  const y = blockBox.y + blockBox.height / 2;

  await page.mouse.move(blockBox.x + blockBox.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(blockBox.x + blockBox.width / 2 + oneSecond * 2, y, { steps: 8 });
  await page.mouse.up();

  const payload = await page.evaluate(() => collectPayload());
  expect(payload.motion_segments[0]).toEqual(expect.objectContaining({
    id: "ic_drag",
    start: 2,
    duration: 1,
    video_path: expect.stringContaining("ic_drag.mp4"),
  }));
});

test("director audio segments display continuous waveform surfaces", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{
      id: "seg_waveform",
      start: 0,
      duration: 4,
      prompt: "Waveform test.",
      reference: "",
      imagePath: "",
      imageName: "",
      imagePreviewUrl: "",
      strength: 0.65,
    }];
    state.directorAudioSegments = [{
      id: "aud_waveform",
      start: 0,
      duration: 2,
      trimStart: 0,
      audioPath: "tts/library/current/line.wav",
      audioName: "line.wav",
      audioDuration: 2,
    }];
    state.directorVideoAudioSegments = [{
      id: "video_aud_waveform",
      start: 1,
      duration: 2,
      trimStart: 0,
      audioPath: "tasks/camera_lab_uploads/videos/guide.mp4",
      audioName: "guide.mp4",
      audioDuration: 2,
      source: "video",
    }];
    renderDirectorEditor();
  });

  await expect(page.locator("#directorAudioTrack .director-waveform-canvas")).toHaveAttribute("data-audio-src", /line\.wav/);
  await expect(page.locator("#directorVideoAudioTrack .director-waveform-canvas")).toHaveAttribute("data-audio-src", /guide\.mp4/);
  await expect(page.locator(".director-waveform-surface")).toHaveCount(0);
  await expect(page.locator(".director-waveform-bar")).toHaveCount(0);
});

test("director video segments use poster backgrounds without thumbnail strips", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{
      id: "seg_frames",
      start: 0,
      duration: 4,
      prompt: "Frame strip test.",
      reference: "",
      imagePath: "",
      imageName: "",
      imagePreviewUrl: "",
      videoPath: "tasks/camera_lab_uploads/videos/main.mp4",
      videoName: "main.mp4",
      videoPreviewUrl: "/media/tasks/camera_lab_uploads/videos/main.mp4",
      videoPosterUrl: "/media/tasks/camera_lab_uploads/videos/main_first_frame.png",
      strength: 0.65,
    }];
    state.directorIcVideoSegments = [{
      id: "ic_frames",
      start: 0,
      duration: 2,
      trimStart: 0,
      videoPath: "tasks/camera_lab_uploads/videos/ic.mp4",
      videoName: "ic.mp4",
      videoPreviewUrl: "/media/tasks/camera_lab_uploads/videos/ic.mp4",
      videoPosterUrl: "/media/tasks/camera_lab_uploads/videos/ic_first_frame.png",
      videoDuration: 2,
    }];
    renderDirectorEditor();
  });

  await expect(page.locator(".director-frame-strip")).toHaveCount(0);
  await expect(page.locator(".director-frame-strip-frame")).toHaveCount(0);
  await expect(page.locator("#directorTrack .director-block-image")).toHaveAttribute("src", /main_first_frame\.png/);
  await expect(page.locator("#directorIcVideoTrack .director-block-image")).toHaveAttribute("src", /ic_first_frame\.png/);
  await expect(page.locator("#directorTrack .director-block-image")).toHaveCSS("object-fit", "cover");
  await expect(page.locator(".director-frame-strip[data-video-src]")).toHaveCount(0);
  await expect(page.locator(".director-frame-strip[data-hydrated]")).toHaveCount(0);
  await expect(page.locator(".director-block-video")).toHaveCount(0);
});

test("director video segments keep a first-frame fallback when no poster was generated", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{
      id: "seg_no_poster",
      start: 0,
      duration: 3,
      prompt: "No poster fallback.",
      reference: "",
      imagePath: "",
      imageName: "",
      imagePreviewUrl: "",
      videoPath: "tasks/camera_lab_uploads/videos/no_poster.mp4",
      videoName: "no_poster.mp4",
      videoPreviewUrl: "/media/tasks/camera_lab_uploads/videos/no_poster.mp4",
      videoPosterUrl: "",
      strength: 0.65,
    }];
    renderDirectorEditor();
  });

  await expect(page.locator("#directorTrack .director-video-poster-canvas")).toHaveAttribute("data-video-src", /no_poster\.mp4/);
  await expect(page.locator("#directorTrack .director-video-poster-canvas")).toHaveAttribute("data-video-poster-status", /^(loading|ready|fallback)$/);
  await expect(page.locator("#directorTrack .director-video-poster-fallback")).toHaveCount(0);
  await expect(page.locator("#directorTrack .director-block-video")).toHaveCount(0);
  await expect(page.locator("#directorTrack img.director-block-image")).toHaveCount(0);
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
  await page.locator("#directorIcLoraStrength").fill("1.35");

  const payload = await page.evaluate(() => collectPayload());
  expect(payload.ic_lora_name).toBe("ltxv/ltx2/ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors");
  expect(payload.ic_lora_strength).toBe(1.35);
});

test("director Ingredients LoRA builds a typed global reference sheet", async ({ page }) => {
  const uploadedBodies = [];
  await page.route("**/api/upload-image", async (route) => {
    const body = route.request().postDataJSON();
    uploadedBodies.push(body);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        path: body.name.includes("ingredients") ? "tasks/camera_lab_uploads/images/ingredients_sheet.png" : `tasks/camera_lab_uploads/images/${body.name}`,
        name: body.name,
      }),
    });
  });
  await page.route("**/api/run", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        batch_id: "dry",
        status: "queued",
        runs: [{ run_id: "01_director", status: "queued", workflow_id: "ltx_director_2" }],
      }),
    });
  });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.config.director = {
      ic_loras: ["None", "ltxv/ltx2/ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors"],
    };
    fillDirectorIcLoras();
  });

  await page.locator("#directorIcLora").selectOption("ltxv/ltx2/ltx-2.3-22b-ic-lora-ingredients-0.9.safetensors");
  await page.evaluate(() => {
    state.referencePaths = [
      "tasks/camera_lab_uploads/images/person_a.png",
      "tasks/camera_lab_uploads/images/prop_camera.png",
    ];
    state.referenceNames = ["person_a.png", "prop_camera.png"];
    state.referencePreviewUrls = state.referencePaths.map((path) => mediaUrl(path));
    state.referenceMeta = [
      { type: "character", subject: "person_a" },
      { type: "prop", subject: "shared" },
    ];
  });

  const runRequest = page.waitForRequest("**/api/run");
  await page.locator("#runBtn").click();
  const payload = JSON.parse((await runRequest).postData());

  expect(uploadedBodies.some((body) => body.name === "director_ingredients_reference_sheet.png")).toBe(true);
  expect(payload.reference_images).toEqual([
    expect.stringContaining("person_a.png"),
    expect.stringContaining("prop_camera.png"),
  ]);
  expect(payload.timeline_segments[0]).toEqual(expect.objectContaining({
    id: "ingredients_reference_sheet",
    type: "image",
    image_path: expect.stringContaining("ingredients_sheet.png"),
    strength: 1,
  }));
  expect(payload.ic_lora_name).toContain("ingredients");
});

test("director video audio clip can be deleted from the timeline", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await page.evaluate(() => {
    state.directorVideoAudioSegments = [
      {
        id: "vid_aud_del",
        start: 0,
        duration: 1,
        trimStart: 0,
        audioPath: "tasks/camera_lab_uploads/videos/clip.mp4",
        audioName: "clip.mp4",
        audioDuration: 1,
        volume: 1,
      },
    ];
    renderDirectorEditor();
  });

  const block = page.locator("#directorVideoAudioTrack .director-video-audio-block");
  await expect(block).toHaveCount(1);
  await block.locator(".director-audio-clear").click();
  await expect(page.locator("#directorVideoAudioTrack .director-video-audio-block")).toHaveCount(0);

  const remaining = await page.evaluate(() => state.directorVideoAudioSegments.length);
  expect(remaining).toBe(0);
});

test("director audio volume control feeds gain into the payload", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await page.evaluate(() => {
    state.directorAudioSegments = [
      {
        id: "aud_vol",
        start: 0,
        duration: 1,
        trimStart: 0,
        audioPath: "fixtures/line.wav",
        audioName: "line.wav",
        audioDuration: 1,
        volume: 1,
      },
    ];
    state.directorSelectedId = "aud_vol";
    state.directorSelectionType = "audio";
    renderDirectorEditor();
  });

  await page.evaluate(() => {
    const el = document.getElementById("directorAudioVolume");
    el.value = "40";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await expect(page.locator("#directorAudioVolumeReadout")).toHaveText("40%");

  const payload = await page.evaluate(() => collectPayload());
  const seg = payload.audio_segments.find((item) => item.id === "aud_vol");
  expect(seg.volume).toBeCloseTo(0.4, 5);
});

test("director segment remove controls delete from timeline and inspector", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.locator("#addDirectorSegmentBtn").click();

  await expect(page.locator("#directorSegmentModal")).not.toHaveClass(/open/);
  await page.locator("#directorTrack .director-block").click();
  await expect(page.locator("#directorSegmentModal")).not.toHaveClass(/open/);
  await expect(page.locator("#directorTrack .director-block")).toHaveClass(/selected/);
  await page.evaluate(() => openDirectorSegmentModal("image", state.directorSelectedId));
  await expect(page.locator("#removeDirectorSegmentBtn")).toBeVisible();
  await expect(page.locator("#removeDirectorSegmentIconBtn")).toHaveCount(0);
  await expect(page.locator("#directorTrack .director-block-remove")).toHaveCount(1);

  await page.locator("#closeDirectorSegmentModalBtn").click();
  await expect(page.locator("#directorSegmentModal")).not.toHaveClass(/open/);
  await page.locator("#directorTrack .director-block-remove").click();
  await expect(page.locator("#directorTrack .director-block")).toHaveCount(0);
  await expect(page.locator("#directorSegmentInspector")).toContainText("Add a segment");

  await page.locator("#addDirectorSegmentBtn").click();
  await expect(page.locator("#directorTrack .director-block-remove")).toHaveCount(1);
  await page.evaluate(() => openDirectorSegmentModal("image", state.directorSegments[0].id));
  await page.locator("#removeDirectorSegmentBtn").click();
  await expect(page.locator("#directorTrack .director-block")).toHaveCount(0);
});

test("director selected timeline segments can be deleted with keyboard", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await page.evaluate(() => {
    state.directorSegments = [{
      id: "seg_keyboard_delete",
      start: 0,
      duration: 2,
      prompt: "delete me",
      reference: "",
      imagePath: "",
      imageName: "",
      imagePreviewUrl: "",
      strength: 0.65,
    }];
    state.directorAudioSegments = [{
      id: "aud_keyboard_delete",
      start: 2,
      duration: 2,
      trimStart: 0,
      audioPath: "tasks/camera_lab_uploads/audio/delete.wav",
      audioName: "delete.wav",
      audioDuration: 2,
    }];
    state.directorSelectedId = "seg_keyboard_delete";
    state.directorSelectionType = "image";
    renderDirectorEditor();
  });

  await page.locator("#directorTrack .director-block").click();
  await page.keyboard.press("Backspace");
  await expect(page.locator("#directorTrack .director-block")).toHaveCount(0);

  await page.locator("#directorAudioTrack .director-audio-block").click();
  await page.keyboard.press("Delete");
  await expect(page.locator("#directorAudioTrack .director-audio-block")).toHaveCount(0);
});

test("director frame model preserves audio clip lengths after repeated split and delete", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{ id: "seg_anchor", start: 0, duration: 8, prompt: "anchor", reference: "", imagePath: "", imageName: "", imagePreviewUrl: "", strength: 0.65 }];
    state.directorAudioSegments = [{ id: "aud_chain", start: 1, duration: 6, trimStart: 0.5, audioPath: "fixtures/line.wav", audioName: "line.wav", audioDuration: 10, volume: 1 }];
    state.directorVideoAudioSegments = [];
    state.directorIcVideoSegments = [];
    state.directorSelectedId = "aud_chain";
    state.directorSelectionType = "audio";
    renderDirectorEditor();
    DirectorPreview.seek(3);
  });

  await page.locator("#directorCutAtPlayheadBtn").click();
  await page.evaluate(() => {
    state.directorSelectedId = state.directorAudioSegments[1].id;
    state.directorSelectionType = "audio";
    renderDirectorEditor();
    DirectorPreview.seek(5);
  });
  await page.locator("#directorCutAtPlayheadBtn").click();

  expect(await page.evaluate(() => state.directorAudioSegments.map(({ start, duration, trimStart }) => ({ start, duration, trimStart })))).toEqual([
    { start: 1, duration: 2, trimStart: 0.5 },
    { start: 3, duration: 2, trimStart: 2.5 },
    { start: 5, duration: 2, trimStart: 4.5 },
  ]);

  await page.evaluate(() => {
    state.directorSelectedId = state.directorAudioSegments[1].id;
    state.directorSelectionType = "audio";
    renderDirectorEditor();
  });
  await page.keyboard.press("Delete");

  expect(await page.evaluate(() => state.directorAudioSegments.map(({ start, duration, trimStart }) => ({ start, duration, trimStart })))).toEqual([
    { start: 1, duration: 2, trimStart: 0.5 },
    { start: 5, duration: 2, trimStart: 4.5 },
  ]);
});

test("clicking a director segment selects it without opening the modal", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.locator("#addDirectorSegmentBtn").click();

  await expect(page.locator("#directorSegmentModal")).not.toHaveClass(/open/);
  await page.locator("#directorTrack .director-block").click();
  await expect(page.locator("#directorSegmentModal")).not.toHaveClass(/open/);
  await expect(page.locator("#directorTrack .director-block")).toHaveClass(/selected/);
  await expect(page.locator("#directorSegmentInspector")).toContainText("Selected segment");
  await expect(page.locator("#directorSeedInput")).toHaveCount(0);
});

test("director playhead scissors splits the selected video timeline item", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{
      id: "seg_cut",
      start: 0,
      duration: 4,
      trimStart: 0,
      prompt: "Cut this video segment.",
      reference: "",
      imagePath: "",
      imageName: "",
      imagePreviewUrl: "",
      videoPath: "tasks/camera_lab_uploads/videos/guide.mp4",
      videoName: "guide.mp4",
      videoPreviewUrl: "/media/tasks/camera_lab_uploads/videos/guide.mp4",
      strength: 0.65,
    }];
    state.directorSelectedId = "seg_cut";
    state.directorSelectionType = "image";
    renderDirectorEditor();
    DirectorPreview.seek(1.5);
  });

  await expect(page.locator("#directorCutAtPlayheadBtn")).toBeVisible();
  await expect(page.locator("#directorCutAtPlayheadBtn")).toBeEnabled();
  await page.locator("#directorCutAtPlayheadBtn").click();

  const segments = await page.evaluate(() => state.directorSegments.map((item) => ({
    start: item.start,
    duration: item.duration,
    prompt: item.prompt,
    videoPath: item.videoPath,
  })));
  expect(segments).toEqual([
    expect.objectContaining({ start: 0, duration: 1.5, videoPath: expect.stringContaining("guide.mp4") }),
    expect.objectContaining({ start: 1.5, duration: 2.5, videoPath: expect.stringContaining("guide.mp4") }),
  ]);
  await expect(page.locator("#directorTrack .director-block")).toHaveCount(2);
});

test("director playhead scissors is disabled for image timeline items", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{
      id: "seg_image_no_cut",
      start: 0,
      duration: 4,
      prompt: "Do not cut this image segment.",
      reference: "",
      imagePath: "tasks/camera_lab_uploads/images/guide.png",
      imageName: "guide.png",
      imagePreviewUrl: "",
      strength: 0.65,
    }];
    state.directorSelectedId = "seg_image_no_cut";
    state.directorSelectionType = "image";
    renderDirectorEditor();
    DirectorPreview.seek(1.5);
  });

  await expect(page.locator("#directorCutAtPlayheadBtn")).toBeDisabled();
  const cutButtonStyle = await page.locator("#directorCutAtPlayheadBtn").evaluate((button) => {
    const style = getComputedStyle(button);
    return {
      color: style.color,
      cursor: style.cursor,
    };
  });
  expect(cutButtonStyle.color).toContain("rgba");
  expect(cutButtonStyle.cursor).toBe("not-allowed");
  await page.evaluate(() => document.getElementById("directorCutAtPlayheadBtn").click());

  expect(await page.evaluate(() => state.directorSegments.length)).toBe(1);
  await expect(page.locator("#directorTrack .director-block")).toHaveCount(1);
});

test("director playhead scissors preserves trim offsets when splitting audio and IC video", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{ id: "seg_anchor", start: 0, duration: 6, prompt: "anchor", reference: "", imagePath: "", imageName: "", imagePreviewUrl: "", strength: 0.65 }];
    state.directorAudioSegments = [{ id: "aud_cut", start: 1, duration: 4, trimStart: 0.5, audioPath: "fixtures/line.wav", audioName: "line.wav", audioDuration: 6, volume: 0.8 }];
    state.directorVideoAudioSegments = [{ id: "video_aud_cut", start: 1, duration: 4, trimStart: 0.25, audioPath: "fixtures/video.wav", audioName: "video.wav", audioDuration: 6, source: "video" }];
    state.directorIcVideoSegments = [{ id: "ic_cut", start: 1, duration: 4, trimStart: 0.75, videoPath: "fixtures/ic.mp4", videoName: "ic.mp4", videoDuration: 6 }];
    renderDirectorEditor();
  });

  await page.evaluate(() => {
    state.directorSelectedId = "aud_cut";
    state.directorSelectionType = "audio";
    DirectorPreview.seek(2.5);
    renderDirectorEditor();
  });
  await page.locator("#directorCutAtPlayheadBtn").click();
  expect(await page.evaluate(() => state.directorAudioSegments.map(({ start, duration, trimStart }) => ({ start, duration, trimStart })))).toEqual([
    { start: 1, duration: 1.5, trimStart: 0.5 },
    { start: 2.5, duration: 2.5, trimStart: 2 },
  ]);
  expect(await page.evaluate(() => {
    const blocks = [...document.querySelectorAll("#directorAudioTrack .director-audio-block")];
    return blocks.map((block) => ({
      left: block.style.left,
      width: block.style.width,
    }));
  })).toEqual([
    { left: "12.5%", width: "18.75%" },
    { left: "31.25%", width: "31.25%" },
  ]);
  expect(await page.evaluate(() => {
    const canvases = [...document.querySelectorAll("#directorAudioTrack .director-waveform-canvas")];
    return canvases.map((canvas) => ({
      trimStart: canvas.dataset.trimStart,
      duration: canvas.dataset.duration,
      audioDuration: canvas.dataset.audioDuration,
    }));
  })).toEqual([
    { trimStart: "0.5", duration: "1.5", audioDuration: "6" },
    { trimStart: "2", duration: "2.5", audioDuration: "6" },
  ]);
  expect(await page.evaluate(() => collectPayload().audio_segments
    .filter((segment) => segment.id && segment.id.startsWith("aud_cut"))
    .map(({ start, duration, trim_start }) => ({ start, duration, trim_start })))).toEqual([
    { start: 1, duration: 1.5, trim_start: 12 },
    { start: 2.5, duration: 2.5, trim_start: 48 },
  ]);

  await page.evaluate(() => {
    state.directorSelectedId = "video_aud_cut";
    state.directorSelectionType = "video_audio";
    DirectorPreview.seek(3);
    renderDirectorEditor();
  });
  await page.locator("#directorCutAtPlayheadBtn").click();
  expect(await page.evaluate(() => state.directorVideoAudioSegments.map(({ start, duration, trimStart }) => ({ start, duration, trimStart })))).toEqual([
    { start: 1, duration: 2, trimStart: 0.25 },
    { start: 3, duration: 2, trimStart: 2.25 },
  ]);

  await page.evaluate(() => {
    state.directorSelectedId = "ic_cut";
    state.directorSelectionType = "ic_video";
    DirectorPreview.seek(4);
    renderDirectorEditor();
  });
  await page.locator("#directorCutAtPlayheadBtn").click();
  expect(await page.evaluate(() => state.directorIcVideoSegments.map(({ start, duration, trimStart }) => ({ start, duration, trimStart })))).toEqual([
    { start: 1, duration: 3, trimStart: 0.75 },
    { start: 4, duration: 1, trimStart: 3.75 },
  ]);
});

test("director playhead scissors preserves source time when splitting a main video segment", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{
      id: "seg_video_cut",
      start: 0,
      duration: 4,
      trimStart: 0.5,
      prompt: "video cut",
      reference: "",
      imagePath: "",
      imageName: "",
      imagePreviewUrl: "",
      videoPath: "tasks/camera_lab_uploads/videos/guide.mp4",
      videoName: "guide.mp4",
      videoPreviewUrl: "/media/tasks/camera_lab_uploads/videos/guide.mp4",
      videoPosterUrl: "/media/tasks/camera_lab_uploads/videos/guide_first_frame.jpg",
      strength: 0.65,
    }];
    state.directorSelectedId = "seg_video_cut";
    state.directorSelectionType = "image";
    renderDirectorEditor();
    DirectorPreview.seek(1.5);
  });

  await page.locator("#directorCutAtPlayheadBtn").click();

  const segments = await page.evaluate(() => state.directorSegments.map(({ start, duration, trimStart, videoPath }) => ({ start, duration, trimStart, videoPath })));
  expect(segments).toEqual([
    { start: 0, duration: 1.5, trimStart: 0.5, videoPath: "tasks/camera_lab_uploads/videos/guide.mp4" },
    { start: 1.5, duration: 2.5, trimStart: 2, videoPath: "tasks/camera_lab_uploads/videos/guide.mp4" },
  ]);

  const previewClips = await page.evaluate(() => DirectorPreview._state().timeline.clips.map(({ start, duration, trimStart }) => ({ start, duration, trimStart })));
  expect(previewClips).toEqual([
    { start: 0, duration: 1.5, trimStart: 0.5 },
    { start: 1.5, duration: 2.5, trimStart: 2 },
  ]);

  const payload = await page.evaluate(() => collectPayload());
  expect(payload.timeline_segments.map((segment) => segment.trim_start)).toEqual([12, 48]);
  await expect(page.locator("#directorTrack .director-block-image")).toHaveCount(2);
  await expect(page.locator("#directorTrack .director-block-image").nth(0)).toHaveAttribute("src", /guide_first_frame\.jpg/);
  await expect(page.locator("#directorTrack .director-block-image").nth(1)).toHaveAttribute("src", /guide_first_frame\.jpg/);
});

test("director timeline edit buttons open the segment modal", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{ id: "seg_edit", start: 0, duration: 2, prompt: "edit main", reference: "", imagePath: "", imageName: "", imagePreviewUrl: "", strength: 0.65 }];
    state.directorAudioSegments = [{ id: "aud_edit", start: 0, duration: 2, trimStart: 0, audioPath: "fixtures/line.wav", audioName: "line.wav", audioDuration: 2 }];
    state.directorVideoAudioSegments = [{ id: "video_aud_edit", start: 0, duration: 2, trimStart: 0, audioPath: "fixtures/video.wav", audioName: "video.wav", audioDuration: 2, source: "video" }];
    state.directorIcVideoSegments = [{ id: "ic_edit", start: 0, duration: 2, trimStart: 0, videoPath: "fixtures/ic.mp4", videoName: "ic.mp4", videoDuration: 2 }];
    renderDirectorEditor();
  });

  await expect(page.locator("#directorTrack .director-block-edit")).toHaveText("Edit");
  await page.locator("#directorTrack .director-block-edit").click();
  await expect(page.locator("#directorSegmentModal")).toHaveClass(/open/);
  await expect(page.locator("#directorSegmentInspector")).toContainText("Selected segment");
  await page.locator("#closeDirectorSegmentModalBtn").click();

  await page.locator("#directorAudioTrack .director-block-edit").click();
  await expect(page.locator("#directorSegmentModal")).toHaveClass(/open/);
  await expect(page.locator("#directorSegmentInspector")).toContainText("Selected audio");
  await page.locator("#closeDirectorSegmentModalBtn").click();

  await page.locator("#directorVideoAudioTrack .director-block-edit").click();
  await expect(page.locator("#directorSegmentModal")).toHaveClass(/open/);
  await expect(page.locator("#directorSegmentInspector")).toContainText("Selected video audio");
  await page.locator("#closeDirectorSegmentModalBtn").click();

  await page.locator("#directorIcVideoTrack .director-block-edit").click();
  await expect(page.locator("#directorSegmentModal")).toHaveClass(/open/);
  await expect(page.locator("#directorSegmentInspector")).toContainText("Selected IC video");
});

test("director audio delete buttons use x labels", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{ id: "seg_audio_x", start: 0, duration: 2, prompt: "audio x", reference: "", imagePath: "", imageName: "", imagePreviewUrl: "", strength: 0.65 }];
    state.directorAudioSegments = [{ id: "aud_x", start: 0, duration: 2, trimStart: 0, audioPath: "fixtures/line.wav", audioName: "line.wav", audioDuration: 2 }];
    state.directorVideoAudioSegments = [{ id: "video_aud_x", start: 0, duration: 2, trimStart: 0, audioPath: "fixtures/video.wav", audioName: "video.wav", audioDuration: 2, source: "video" }];
    renderDirectorEditor();
  });

  await expect(page.locator("#directorAudioTrack .director-audio-clear")).toHaveText("x");
  await expect(page.locator("#directorVideoAudioTrack .director-audio-clear")).toHaveText("x");
  await expect(page.locator("#directorAudioTrack .director-audio-clear svg")).toHaveCount(0);
  await expect(page.locator("#directorVideoAudioTrack .director-audio-clear svg")).toHaveCount(0);

  for (const trackId of ["directorAudioTrack", "directorVideoAudioTrack"]) {
    const editBox = await page.locator(`#${trackId} .director-block-edit`).boundingBox();
    const clearBox = await page.locator(`#${trackId} .director-audio-clear`).boundingBox();
    expect(editBox).not.toBeNull();
    expect(clearBox).not.toBeNull();
    expect(Math.abs(clearBox.y - editBox.y)).toBeLessThanOrEqual(2);
    expect(clearBox.x).toBeGreaterThan(editBox.x + editBox.width);
  }
});

test("director timeline does not render the lower segment duration list", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await expect(page.locator("#directorSegments")).toHaveCount(0);
  await expect(page.locator(".director-segment-chip")).toHaveCount(0);
});

test("director audio and voice timeline blocks match main segment height", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{ id: "seg_height", start: 0, duration: 2, prompt: "height", reference: "", imagePath: "", imageName: "", imagePreviewUrl: "", strength: 0.65 }];
    state.directorAudioSegments = [{ id: "aud_height", start: 0, duration: 2, trimStart: 0, audioPath: "fixtures/line.wav", audioName: "line.wav", audioDuration: 2 }];
    state.directorVideoAudioSegments = [{ id: "video_aud_height", start: 0, duration: 2, trimStart: 0, audioPath: "fixtures/video.wav", audioName: "video.wav", audioDuration: 2, source: "video" }];
    renderDirectorEditor();
  });

  const heights = await page.evaluate(() => ({
    mainTrack: Math.round(document.querySelector("#directorTrack").getBoundingClientRect().height),
    videoAudioTrack: Math.round(document.querySelector("#directorVideoAudioTrack").getBoundingClientRect().height),
    dialogueTrack: Math.round(document.querySelector("#directorAudioTrack").getBoundingClientRect().height),
    mainBlock: Math.round(document.querySelector("#directorTrack .director-block").getBoundingClientRect().height),
    videoAudioBlock: Math.round(document.querySelector("#directorVideoAudioTrack .director-video-audio-block").getBoundingClientRect().height),
    dialogueBlock: Math.round(document.querySelector("#directorAudioTrack .director-audio-block").getBoundingClientRect().height),
  }));
  expect(heights.videoAudioTrack).toBe(heights.mainTrack);
  expect(heights.dialogueTrack).toBe(heights.mainTrack);
  expect(heights.videoAudioBlock).toBe(heights.mainBlock);
  expect(heights.dialogueBlock).toBe(heights.mainBlock);
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

test("director timeline audio modal rounds clip duration up and keeps timeline compact", async ({ page }) => {
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
  await expect(page.locator("#directorAudioTrack .director-audio-block.has-audio")).not.toContainText("Audio 2.13s -> Clip 2.5s");

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
  await expect(videoAudioBlock).not.toContainText("video_fx");
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
  let blockBox = await block.boundingBox();
  expect(trackBox).not.toBeNull();
  expect(blockBox).not.toBeNull();
  const oneSecond = trackBox.width / 6;
  const y = blockBox.y + blockBox.height / 2;

  await page.mouse.move(blockBox.x + blockBox.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(blockBox.x + blockBox.width / 2 + oneSecond * 2, y, { steps: 8 });
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

test("director timeline segment drag snaps to frame-derived seconds", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [
      {
        id: "seg_drag_tenth",
        start: 0,
        duration: 1,
        prompt: "drag with tenth second precision",
        reference: "",
        imagePath: "",
        imageName: "",
        imagePreviewUrl: "",
        strength: 0.65,
      },
      {
        id: "seg_drag_anchor",
        start: 5,
        duration: 1,
        prompt: "anchor",
        reference: "",
        imagePath: "",
        imageName: "",
        imagePreviewUrl: "",
        strength: 0.65,
      },
    ];
    state.directorSelectedId = "seg_drag_tenth";
    state.directorSelectionType = "image";
    renderDirectorEditor();
  });

  await page.evaluate(() => {
    state.directorDrag = {
      id: "seg_drag_tenth",
      type: "image",
      edge: "",
      rect: { width: 600 },
      total: 6,
      startX: 0,
      originalStart: 0,
      originalDuration: 1,
      moved: false,
    };
    onDirectorDrag({ clientX: 130 });
    stopDirectorDrag();
  });

  const payload = await page.evaluate(() => collectPayload());
  const moved = payload.timeline_segments.find((segment) => segment.id === "seg_drag_tenth");
  expect(moved.start).toBeCloseTo(31 / 24, 3);
});

test("director timeline resize handles snap to frame-derived seconds and show thick edge guides", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{
      id: "seg_resize_tenth",
      start: 0,
      duration: 4,
      prompt: "resize with tenth second precision",
      reference: "",
      imagePath: "",
      imageName: "",
      imagePreviewUrl: "",
      strength: 0.65,
    }];
    state.directorSelectedId = "seg_resize_tenth";
    state.directorSelectionType = "image";
    renderDirectorEditor();
  });

  await page.evaluate(() => {
    state.directorDrag = {
      id: "seg_resize_tenth",
      type: "image",
      edge: "right",
      rect: { width: 600 },
      total: 6,
      startX: 0,
      originalStart: 0,
      originalDuration: 1,
      moved: false,
    };
    onDirectorDrag({ clientX: 130 });
    stopDirectorDrag();
  });
  expect(await page.evaluate(() => state.directorSegments[0].duration)).toBeCloseTo(55 / 24, 3);

  await page.evaluate(() => {
    const segment = state.directorSegments[0];
    segment.start = 0;
    segment.duration = 4;
    state.directorDrag = {
      id: "seg_resize_tenth",
      type: "image",
      edge: "left",
      rect: { width: 600 },
      total: 6,
      startX: 0,
      originalStart: 0,
      originalDuration: 4,
      moved: false,
    };
    onDirectorDrag({ clientX: 130 });
    stopDirectorDrag();
  });

  expect(await page.evaluate(() => ({
    start: state.directorSegments[0].start,
    duration: state.directorSegments[0].duration,
  }))).toEqual({
    start: expect.closeTo(31 / 24, 3),
    duration: expect.closeTo(65 / 24, 3),
  });

  const handleGuide = await page.locator("#directorTrack .resize-handle.left").evaluate((el) => {
    const style = getComputedStyle(el, "::before");
    return {
      width: parseFloat(style.width),
      opacity: Number(style.opacity),
    };
  });
  expect(handleGuide.width).toBeGreaterThanOrEqual(5);
  expect(handleGuide.opacity).toBeGreaterThan(0.5);
});

test("director frame model drag preserves audio trim and duration", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{ id: "seg_anchor", start: 0, duration: 10, prompt: "anchor", reference: "", imagePath: "", imageName: "", imagePreviewUrl: "", strength: 0.65 }];
    state.directorAudioSegments = [{ id: "aud_drag_model", start: 1, duration: 2, trimStart: 3, audioPath: "fixtures/line.wav", audioName: "line.wav", audioDuration: 12 }];
    state.directorSelectedId = "aud_drag_model";
    state.directorSelectionType = "audio";
    renderDirectorEditor();
  });

  await page.evaluate(() => {
    state.directorDrag = {
      id: "aud_drag_model",
      type: "audio",
      edge: "",
      rect: { width: 600 },
      total: 6,
      startX: 0,
      originalStart: 1,
      originalDuration: 2,
      moved: false,
    };
    onDirectorDrag({ clientX: 120 });
    stopDirectorDrag();
  });

  const seg = await page.evaluate(() => state.directorAudioSegments.find((item) => item.id === "aud_drag_model"));
  expect(seg.duration).toBe(2);
  expect(seg.trimStart).toBe(3);
  expect(seg.start).toBeGreaterThan(1);
});

test("director frame model resize left advances video trim", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{
      id: "seg_resize_model",
      start: 0,
      duration: 4,
      trimStart: 1,
      prompt: "video",
      reference: "",
      videoPath: "fixtures/guide.mp4",
      videoName: "guide.mp4",
      videoPreviewUrl: "/media/fixtures/guide.mp4",
      strength: 0.65,
    }];
    state.directorSelectedId = "seg_resize_model";
    state.directorSelectionType = "image";
    renderDirectorEditor();
  });

  await page.evaluate(() => {
    state.directorDrag = {
      id: "seg_resize_model",
      type: "image",
      edge: "left",
      rect: { width: 600 },
      total: 6,
      startX: 0,
      originalStart: 0,
      originalDuration: 4,
      moved: false,
    };
    onDirectorDrag({ clientX: 80 });
    stopDirectorDrag();
  });

  const seg = await page.evaluate(() => state.directorSegments[0]);
  expect(seg.start).toBeGreaterThan(0);
  expect(seg.duration).toBeLessThan(4);
  expect(seg.trimStart).toBeGreaterThan(1);
});

test("director frame model serializes payload for all timeline tracks", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{
      id: "seg_payload",
      start: 1,
      duration: 2,
      trimStart: 0.5,
      prompt: "video",
      reference: "",
      videoPath: "fixtures/guide.mp4",
      videoName: "guide.mp4",
      audioExtracted: true,
      strength: 0.7,
    }];
    state.directorVideoAudioSegments = [{ id: "va_payload", start: 1, duration: 2, trimStart: 0.5, audioPath: "fixtures/guide.mp4", audioName: "guide.mp4", audioDuration: 5, source: "video" }];
    state.directorAudioSegments = [{ id: "aud_payload", start: 3, duration: 1.5, trimStart: 1, audioPath: "fixtures/line.wav", audioName: "line.wav", audioDuration: 5, volume: 0.8 }];
    state.directorIcVideoSegments = [{ id: "ic_payload", start: 2, duration: 3, trimStart: 0.25, videoPath: "fixtures/motion.mp4", videoName: "motion.mp4", videoDuration: 8 }];
    renderDirectorEditor();
  });

  const payload = await page.evaluate(() => collectPayload());
  expect(payload.timeline_segments).toEqual([
    expect.objectContaining({ id: "seg_payload", start: 1, duration: 2, trim_start: 12, type: "video" }),
  ]);
  expect(payload.audio_segments).toEqual([
    expect.objectContaining({ id: "va_payload", source: "video", start: 1, duration: 2, trim_start: 12 }),
    expect.objectContaining({ id: "aud_payload", start: 3, duration: 1.5, trim_start: 24, volume: 0.8 }),
  ]);
  expect(payload.motion_segments).toEqual([
    expect.objectContaining({ id: "ic_payload", start: 2, duration: 3, trim_start: 6 }),
  ]);
});

test("director video audio drag does not move the preview playhead", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{
      id: "seg_video_audio_drag",
      start: 0,
      duration: 4,
      prompt: "A guide video with audio.",
      reference: "",
      imagePath: "",
      imageName: "",
      imagePreviewUrl: "",
      videoPath: "tasks/camera_lab_uploads/videos/guide.mp4",
      videoName: "guide.mp4",
      videoPreviewUrl: "",
      audioExtracted: true,
      strength: 0.65,
    }];
    state.directorVideoAudioSegments = [{
      id: "video_audio_drag",
      start: 0,
      duration: 1,
      trimStart: 0,
      audioPath: "tasks/camera_lab_uploads/videos/guide.mp4",
      audioName: "guide.mp4",
      audioDuration: 1,
      source: "video",
    }];
    state.directorAudioSegments = [];
    state.directorSelectedId = "video_audio_drag";
    state.directorSelectionType = "video_audio";
    renderDirectorEditor();
    DirectorPreview.seek(0);
  });

  await page.locator("#directorVideoAudioTrack .director-video-audio-block").scrollIntoViewIfNeeded();
  const trackBox = await page.locator("#directorVideoAudioTrack").boundingBox();
  const block = page.locator("#directorVideoAudioTrack .director-video-audio-block");
  const blockBox = await block.boundingBox();
  expect(trackBox).not.toBeNull();
  expect(blockBox).not.toBeNull();
  const oneSecond = trackBox.width / 6;
  const y = blockBox.y + blockBox.height / 2;

  await page.mouse.move(blockBox.x + blockBox.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(blockBox.x + blockBox.width / 2 + oneSecond * 2, y, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator("#directorVideoAudioStart")).toHaveValue("2");
  const currentTime = await page.evaluate(() => DirectorPreview._state().currentTime);
  expect(currentTime).toBe(0);
});

test("director timeline audio blocks keep waveform clear of left overlays", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
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
    state.directorVideoAudioSegments = [{
      id: "video_audio_preview_1",
      start: 0,
      duration: 1,
      trimStart: 0,
      audioPath: "tasks/camera_lab_uploads/videos/guide.mp4",
      audioName: "guide.mp4",
      audioDuration: 1,
      source: "video",
    }];
    state.directorSelectedId = "aud_preview_1";
    state.directorSelectionType = "audio";
    renderDirectorEditor();
  });

  await page.locator("#directorAudioTrack .director-audio-block.has-audio").scrollIntoViewIfNeeded();
  await expect(page.locator("#directorAudioTrack .director-audio-preview")).toHaveCount(0);
  await expect(page.locator("#directorAudioTrack .director-audio-copy")).toHaveCount(0);
  await expect(page.locator("#directorAudioTrack .director-audio-block.has-audio > span")).toHaveCount(0);
  await expect(page.locator("#directorVideoAudioTrack .director-audio-copy")).toHaveCount(0);
  await expect(page.locator("#directorVideoAudioTrack .director-video-audio-block > span")).toHaveCount(0);
  const fit = await page.evaluate(() => {
    return ["#directorAudioTrack .director-audio-block.has-audio", "#directorVideoAudioTrack .director-video-audio-block"].map((selector) => {
      const block = document.querySelector(selector).getBoundingClientRect();
      const waveform = document.querySelector(`${selector} .director-waveform`).getBoundingClientRect();
      return {
        leftInset: waveform.left - block.left,
        rightInset: block.right - waveform.right,
      };
    });
  });
  for (const item of fit) {
    expect(item.leftInset).toBeLessThanOrEqual(10);
    expect(item.rightInset).toBeLessThanOrEqual(10);
  }

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

test("use timeline restores media into main, video-audio, dialogue, and IC tracks", async ({ page }) => {
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
            id: "seg_reload_video",
            type: "video",
            prompt: "restored video guide",
            duration: 2,
            frames: 48,
            start_frame: 0,
            guide_frame: 0,
            video_path: "tasks/camera_lab_uploads/videos/reload_guide.mp4",
            image_path: "",
            strength: 0.75,
          },
        ],
        audio_segments: [
          {
            id: "video_audio_reload",
            audio_path: "tasks/camera_lab_uploads/videos/reload_guide.mp4",
            start: 0,
            length: 48,
            trimStart: 6,
            volume: 0.7,
          },
          {
            id: "aud_dialogue_reload",
            audio_path: "tts/library/current/reload_line.wav",
            start: 24,
            length: 24,
            trimStart: 0,
            volume: 0.8,
          },
        ],
        motion_segments: [
          {
            id: "ic_reload",
            video_path: "tasks/camera_lab_uploads/videos/reload_ic.mp4",
            start: 0,
            length: 24,
          },
        ],
      },
    });
    return collectPayload();
  });

  await expect(page.locator("#directorTrack .director-block")).toContainText("restored video guide");
  await expect(page.locator("#directorTrack .director-block-ref")).toContainText("timeline video");
  await expect(page.locator("#directorVideoAudioTrack .director-video-audio-block")).toContainText("reload_guide.mp4");
  await expect(page.locator("#directorAudioTrack .director-audio-block.has-audio")).toContainText("reload_line.wav");
  await expect(page.locator("#directorIcVideoTrack .director-ic-video-block")).toContainText("reload_ic.mp4");
  await expect(page.locator("#directorAudioTrack .director-audio-block.has-audio")).toHaveCount(1);

  expect(payload.timeline_segments[0]).toEqual(expect.objectContaining({
    type: "video",
    video_path: expect.stringContaining("reload_guide.mp4"),
  }));
  expect(payload.audio_segments).toEqual([
    expect.objectContaining({
      source: "video",
      audio_path: expect.stringContaining("reload_guide.mp4"),
      trim_start: 6,
      volume: 0.7,
    }),
    expect.objectContaining({
      audio_path: expect.stringContaining("reload_line.wav"),
      start: 1,
      volume: 0.8,
    }),
  ]);
  expect(payload.motion_segments[0].video_path).toContain("reload_ic.mp4");
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
        poster_path: "tasks/camera_lab_uploads/videos/new_guide_first_frame.jpg",
        duration: 4.25,
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
  await expect(page.locator(".director-block.selected .director-block-image")).toHaveAttribute("src", /new_guide_first_frame\.jpg/);
  const videoAudioBlock = page.locator("#directorVideoAudioTrack .director-video-audio-block");
  await expect(videoAudioBlock).toHaveCount(1);
  await videoAudioBlock.click();
  await expect(page.locator("#directorSegmentInspector")).toContainText("Selected video audio");
  await page.evaluate(() => closeDirectorSegmentModal());
  await page.locator("#directorTrack .director-block").first().click();
  await expect(page.locator("#directorSegmentInspector")).toContainText("Selected segment");
  await page.evaluate(() => closeDirectorSegmentModal());
  await page.locator("#directorVideoAudioTrack .director-block-edit").click();
  await expect(page.locator("#directorSegmentInspector")).toContainText("Selected video audio");
  await page.locator("#directorVideoAudioStart").fill("0.5");
  await page.locator("#directorVideoAudioTrimStart").fill("0.25");
  await page.evaluate(() => closeDirectorSegmentModal());
  await page.locator("#directorTrack .director-block").first().click();
  await expect(page.locator("#directorSegmentInspector")).toContainText("Selected segment");
  await page.evaluate(() => closeDirectorSegmentModal());
  await videoAudioBlock.click();
  const payload = await page.evaluate(() => collectPayload());
  expect(payload.timeline_segments[0].type).toBe("video");
  expect(payload.timeline_segments[0].video_path).toContain("new_guide.mp4");
  expect(payload.timeline_segments[0].image_path).toBe("");
  expect(payload.timeline_segments[0].duration).toBe(4.25);
  expect(payload.audio_segments).toEqual([
    expect.objectContaining({
      source: "video",
      audio_path: expect.stringContaining("new_guide.mp4"),
      start: 0.5,
      duration: 4.25,
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

test("director preview shows video, image, and text frames by seek position", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await page.evaluate(() => {
    DirectorPreview.mount({
      playerEl: document.getElementById("directorPreview"),
      videoEl: document.getElementById("directorPreviewVideo"),
      imageEl: document.getElementById("directorPreviewImage"),
      overlayEl: document.getElementById("directorPreviewOverlay"),
      playButtonEl: document.getElementById("directorPreviewPlay"),
      timeReadoutEl: document.getElementById("directorPreviewTime"),
    });
    DirectorPreview.setTimeline({
      duration: 6,
      width: 1280,
      height: 720,
      clips: [
        { start: 0, duration: 2, kind: "video", src: "/static/app.js", trimStart: 0 },
        { start: 2, duration: 2, kind: "image", src: "/favicon.ico" },
        { start: 4, duration: 2, kind: "text", src: "", prompt: "a quiet street" },
      ],
      audioClips: [],
    });
  });

  await page.evaluate(() => DirectorPreview.seek(0.5));
  await expect(page.locator("#directorPreviewVideo")).toBeVisible();
  await expect(page.locator("#directorPreviewImage")).toBeHidden();

  await page.evaluate(() => DirectorPreview.seek(2.5));
  await expect(page.locator("#directorPreviewImage")).toBeVisible();
  await expect(page.locator("#directorPreviewVideo")).toBeHidden();

  await page.evaluate(() => DirectorPreview.seek(5));
  await expect(page.locator("#directorPreviewOverlay")).toBeVisible();
  await expect(page.locator("#directorPreviewOverlay")).toHaveText("a quiet street");
});

test("director preview stage stays landscape for portrait frame sizes", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await page.evaluate(() => {
    DirectorPreview.mount({
      playerEl: document.getElementById("directorPreview"),
      videoEl: document.getElementById("directorPreviewVideo"),
      imageEl: document.getElementById("directorPreviewImage"),
      overlayEl: document.getElementById("directorPreviewOverlay"),
      playButtonEl: document.getElementById("directorPreviewPlay"),
      timeReadoutEl: document.getElementById("directorPreviewTime"),
    });
    DirectorPreview.setTimeline({
      duration: 2,
      width: 720,
      height: 1280,
      clips: [{ start: 0, duration: 2, kind: "text", src: "", prompt: "portrait frame" }],
      audioClips: [],
    });
  });

  const ratio = await page.locator(".director-preview-stage").evaluate((el) => {
    const box = el.getBoundingClientRect();
    return box.width / box.height;
  });
  expect(ratio).toBeCloseTo(16 / 9, 2);
});

test("director preview is a primary control without reserved blank space", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await page.evaluate(() => {
    DirectorPreview.mount({
      playerEl: document.getElementById("directorPreview"),
      videoEl: document.getElementById("directorPreviewVideo"),
      imageEl: document.getElementById("directorPreviewImage"),
      overlayEl: document.getElementById("directorPreviewOverlay"),
      playButtonEl: document.getElementById("directorPreviewPlay"),
      timeReadoutEl: document.getElementById("directorPreviewTime"),
    });
    DirectorPreview.setTimeline({
      duration: 2,
      width: 1280,
      height: 720,
      clips: [{ start: 0, duration: 2, kind: "text", src: "", prompt: "wide frame" }],
      audioClips: [],
    });
  });

  const metrics = await page.evaluate(() => {
    const preview = document.getElementById("directorPreview").getBoundingClientRect();
    const stage = document.querySelector(".director-preview-stage").getBoundingClientRect();
    const play = document.getElementById("directorPreviewPlay").getBoundingClientRect();
    const settings = document.querySelector(".director-preview-row .director-global-settings").getBoundingClientRect();
    const globalPrompt = document.getElementById("directorGlobalPrompt").getBoundingClientRect();
    const negativePrompt = document.getElementById("directorNegativePrompt").getBoundingClientRect();
    const seed = document.querySelector(".director-seed-field").getBoundingClientRect();
    const seedInput = document.getElementById("directorGlobalSeedInput").getBoundingClientRect();
    const preset = document.getElementById("directorSizePreset").getBoundingClientRect();
    const size = document.querySelector(".director-video-size").getBoundingClientRect();
    return {
      stageWidth: stage.width,
      reservedBlank: preview.height - stage.height,
      playRightOfStage: play.left > stage.right,
      playCenterOffset: Math.abs((play.top + play.height / 2) - (stage.top + stage.height / 2)),
      settingsWidth: settings.width,
      settingsHeight: settings.height,
      stageHeight: stage.height,
      promptsShareRow: Math.abs(globalPrompt.top - negativePrompt.top) < 8 && negativePrompt.left > globalPrompt.right,
      promptFieldsStartNearLabels: globalPrompt.top < settings.top + 60 && negativePrompt.top < settings.top + 60,
      lowerControlsAligned: Math.abs(seed.top - size.top) < 18,
      promptHeight: globalPrompt.height,
      controlHeight: Math.min(seedInput.height, preset.height),
    };
  });
  expect(metrics.stageWidth).toBeGreaterThan(760);
  expect(metrics.reservedBlank).toBeLessThan(20);
  expect(metrics.playRightOfStage).toBe(true);
  expect(metrics.playCenterOffset).toBeLessThan(12);
  expect(metrics.settingsWidth).toBeGreaterThan(430);
  expect(Math.abs(metrics.settingsHeight - metrics.stageHeight)).toBeLessThanOrEqual(2);
  expect(metrics.promptsShareRow).toBe(true);
  expect(metrics.promptFieldsStartNearLabels).toBe(true);
  expect(metrics.lowerControlsAligned).toBe(true);
  expect(metrics.promptHeight).toBeGreaterThanOrEqual(146);
  expect(metrics.controlHeight).toBeGreaterThanOrEqual(40);
});

test("director workspace avoids page-level horizontal overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("director preview play toggles state and advances the playhead", async ({ page }) => {
  await page.goto("/");
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    DirectorPreview.mount({
      playerEl: document.getElementById("directorPreview"),
      videoEl: document.getElementById("directorPreviewVideo"),
      imageEl: document.getElementById("directorPreviewImage"),
      overlayEl: document.getElementById("directorPreviewOverlay"),
      playButtonEl: document.getElementById("directorPreviewPlay"),
      timeReadoutEl: document.getElementById("directorPreviewTime"),
      playheadEl: document.getElementById("directorPlayhead"),
      timelineEl: document.querySelector(".director-timeline-shell"),
    });
    DirectorPreview.setTimeline({
      duration: 6, width: 1280, height: 720, audioClips: [],
      clips: [{ start: 0, duration: 6, kind: "text", src: "", prompt: "x" }],
    });
    DirectorPreview.seek(0);
  });

  const playheadPct = () => page.evaluate(() =>
    Number(document.getElementById("directorPlayhead").style.getPropertyValue("--director-playhead-pct"))
  );
  await page.evaluate(() => DirectorPreview.seek(3));
  expect(await playheadPct()).toBeCloseTo(0.5, 2);

  await page.evaluate(() => DirectorPreview.play());
  expect(await page.evaluate(() => DirectorPreview.isPlaying())).toBe(true);
  await page.evaluate(() => DirectorPreview.pause());
  expect(await page.evaluate(() => DirectorPreview.isPlaying())).toBe(false);
});

test("director timeline toolbar sits below preview and above the playhead line", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await expect(page.locator("#directorTimelinePanel")).toBeVisible();
  await page.evaluate(() => {
    DirectorPreview.mount({
      playerEl: document.getElementById("directorPreview"),
      videoEl: document.getElementById("directorPreviewVideo"),
      imageEl: document.getElementById("directorPreviewImage"),
      overlayEl: document.getElementById("directorPreviewOverlay"),
      playButtonEl: document.getElementById("directorPreviewPlay"),
      timeReadoutEl: document.getElementById("directorPreviewTime"),
      playheadEl: document.getElementById("directorPlayhead"),
      playheadFrameEl: document.getElementById("directorPlayheadFrame"),
      timelineEl: document.querySelector(".director-timeline-shell"),
    });
    DirectorPreview.setTimeline({
      duration: 6, width: 1280, height: 720, audioClips: [],
      clips: [{ start: 0, duration: 6, kind: "text", src: "", prompt: "x" }],
    });
    DirectorPreview.seek(1);
  });
  const marker = await page.locator("#directorPlayhead").evaluate((el) => {
    const before = getComputedStyle(el, "::before");
    return {
      lineWidth: before.width,
      pointerEvents: getComputedStyle(el).pointerEvents,
    };
  });
  expect(parseFloat(marker.lineWidth)).toBeGreaterThanOrEqual(2);
  expect(marker.pointerEvents).toBe("auto");
  await expect(page.locator("#directorPlayheadFrame")).toHaveText(/F\d+/);
  await expect(page.locator("#directorCutAtPlayheadBtn")).toHaveCount(1);
  await expect(page.locator("#directorCutAtPlayheadBtn svg")).toHaveCount(1);
  expect(await page.locator("#directorPlayhead #directorCutAtPlayheadBtn").count()).toBe(0);
  const order = await page.evaluate(() => {
    const preview = document.getElementById("directorPreview").getBoundingClientRect();
    const toolbar = document.querySelector(".director-timeline-toolbar").getBoundingClientRect();
    const timeline = document.querySelector(".director-timeline-shell").getBoundingClientRect();
    const tabs = document.querySelector(".director-timeline-toolbar .director-mode-tabs").getBoundingClientRect();
    const scissors = document.getElementById("directorCutAtPlayheadBtn").getBoundingClientRect();
    return {
      previewBottom: preview.bottom,
      toolbarTop: toolbar.top,
      toolbarBottom: toolbar.bottom,
      timelineTop: timeline.top,
      tabsTop: tabs.top,
      tabsRight: tabs.right,
      tabsHeight: tabs.height,
      scissorsTop: scissors.top,
      scissorsLeft: scissors.left,
      scissorsHeight: scissors.height,
    };
  });
  expect(order.toolbarTop).toBeGreaterThanOrEqual(order.previewBottom - 1);
  expect(order.toolbarBottom).toBeLessThanOrEqual(order.timelineTop + 1);
  expect(Math.abs(order.tabsTop - order.scissorsTop)).toBeLessThanOrEqual(6);
  expect(order.scissorsLeft).toBeGreaterThanOrEqual(order.tabsRight);
  expect(Math.abs(order.scissorsHeight - order.tabsHeight)).toBeLessThanOrEqual(1);
});

test("director ic video model controls stack model above strength", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await expect(page.locator("#directorTimelinePanel")).toBeVisible();
  await expect(page.locator("#directorIcLora")).toBeVisible();
  await expect(page.locator("#directorIcLoraStrength")).toBeVisible();
  const layout = await page.evaluate(() => {
    const controls = document.querySelector(".director-ic-lora-controls").getBoundingClientRect();
    const select = document.getElementById("directorIcLora").getBoundingClientRect();
    const strength = document.querySelector(".director-ic-lora-strength-label").getBoundingClientRect();
    return {
      controlsWidth: controls.width,
      selectTop: select.top,
      selectLeft: select.left,
      selectWidth: select.width,
      strengthTop: strength.top,
      strengthLeft: strength.left,
      strengthWidth: strength.width,
    };
  });
  expect(layout.strengthTop).toBeGreaterThan(layout.selectTop);
  expect(Math.abs(layout.selectLeft - layout.strengthLeft)).toBeLessThanOrEqual(2);
  expect(layout.selectWidth).toBeGreaterThan(layout.controlsWidth * 0.85);
  expect(layout.strengthWidth).toBeGreaterThan(layout.controlsWidth * 0.85);
});

test("director preview playhead can be dragged across the timeline", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await expect(page.locator(".director-timeline-shell")).toBeVisible();
  await page.evaluate(() => {
    DirectorPreview.mount({
      playerEl: document.getElementById("directorPreview"),
      videoEl: document.getElementById("directorPreviewVideo"),
      imageEl: document.getElementById("directorPreviewImage"),
      overlayEl: document.getElementById("directorPreviewOverlay"),
      playButtonEl: document.getElementById("directorPreviewPlay"),
      timeReadoutEl: document.getElementById("directorPreviewTime"),
      playheadEl: document.getElementById("directorPlayhead"),
      timelineEl: document.querySelector(".director-timeline-shell"),
    });
    DirectorPreview.setTimeline({
      duration: 6, width: 1280, height: 720, audioClips: [],
      clips: [{ start: 0, duration: 6, kind: "text", src: "", prompt: "drag target" }],
    });
    DirectorPreview.seek(0);
  });

  await page.evaluate(() => {
    const shell = document.querySelector(".director-timeline-shell");
    const track = document.getElementById("directorTrack");
    const rect = track.getBoundingClientRect();
    const eventInit = (ratio) => ({
      clientX: rect.left + rect.width * ratio,
      pointerId: 1,
      bubbles: true,
    });
    shell.dispatchEvent(new PointerEvent("pointerdown", eventInit(0.25)));
    shell.dispatchEvent(new PointerEvent("pointermove", eventInit(0.75)));
    shell.dispatchEvent(new PointerEvent("pointerup", eventInit(0.75)));
  });

  const playheadPct = await page.evaluate(() =>
    Number(document.getElementById("directorPlayhead").style.getPropertyValue("--director-playhead-pct"))
  );
  expect(playheadPct).toBeCloseTo(0.75, 2);
  const playheadCursor = await page.evaluate(() => getComputedStyle(document.getElementById("directorPlayhead")).cursor);
  const playheadWidth = await page.locator("#directorPlayhead").evaluate((el) => el.getBoundingClientRect().width);
  expect(playheadCursor).toBe("ew-resize");
  expect(playheadWidth).toBeGreaterThanOrEqual(12);
  const visualDelta = await page.evaluate(() => {
    const track = document.getElementById("directorTrack").getBoundingClientRect();
    const playhead = document.getElementById("directorPlayhead").getBoundingClientRect();
    const expectedX = track.left + track.width * 0.75;
    const actualX = playhead.left + playhead.width / 2;
    return Math.abs(actualX - expectedX);
  });
  expect(visualDelta).toBeLessThan(2);
  const currentTime = await page.evaluate(() => DirectorPreview._state().currentTime);
  expect(currentTime).toBeGreaterThan(4.45);
  expect(currentTime).toBeLessThan(4.55);
});

test("director preview playhead uses display duration for short timelines", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await expect(page.locator(".director-timeline-shell")).toBeVisible();
  await page.evaluate(() => {
    state.directorSegments = [{ id: "short_preview", start: 0, duration: 2, prompt: "short preview", reference: "", imagePath: "", imageName: "", imagePreviewUrl: "", strength: 0.65 }];
    state.directorAudioSegments = [];
    state.directorVideoAudioSegments = [];
    state.directorIcVideoSegments = [];
    renderDirectorEditor();
    DirectorPreview.seek(1);
  });

  const stateAtOne = await page.evaluate(() => DirectorPreview._state());
  expect(stateAtOne.timeline.duration).toBe(2);
  expect(stateAtOne.timeline.displayDuration).toBe(6);
  const visualDelta = await page.evaluate(() => {
    const track = document.getElementById("directorTrack").getBoundingClientRect();
    const playhead = document.getElementById("directorPlayhead").getBoundingClientRect();
    const expectedX = track.left + track.width * (1 / 6);
    const actualX = playhead.left + playhead.width / 2;
    return Math.abs(actualX - expectedX);
  });
  expect(visualDelta).toBeLessThan(2);

  await page.evaluate(() => {
    const shell = document.querySelector(".director-timeline-shell");
    const track = document.getElementById("directorTrack");
    const rect = track.getBoundingClientRect();
    const eventInit = {
      clientX: rect.left + rect.width * (1 / 3),
      pointerId: 7,
      bubbles: true,
    };
    shell.dispatchEvent(new PointerEvent("pointerdown", eventInit));
    shell.dispatchEvent(new PointerEvent("pointerup", eventInit));
  });
  expect(await page.evaluate(() => DirectorPreview._state().currentTime)).toBeCloseTo(2, 3);
});

test("dragging the director playhead does not select timeline text", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [{
      id: "seg_no_select",
      start: 0,
      duration: 6,
      prompt: "Text should not highlight while the red playhead is dragged.",
      reference: "",
      imagePath: "",
      imageName: "",
      imagePreviewUrl: "",
      strength: 0.65,
    }];
    renderDirectorEditor();
  });

  const shellSelect = await page.locator(".director-timeline-shell").evaluate((el) => getComputedStyle(el).userSelect);
  expect(shellSelect).toBe("none");

  const selectedText = await page.evaluate(() => {
    const shell = document.querySelector(".director-timeline-shell");
    const rect = shell.getBoundingClientRect();
    const eventInit = (ratio) => ({
      clientX: rect.left + rect.width * ratio,
      pointerId: 3,
      bubbles: true,
    });
    shell.dispatchEvent(new PointerEvent("pointerdown", eventInit(0.1)));
    shell.dispatchEvent(new PointerEvent("pointermove", eventInit(0.85)));
    shell.dispatchEvent(new PointerEvent("pointerup", eventInit(0.85)));
    return window.getSelection().toString();
  });
  expect(selectedText).toBe("");
});

test("director preview drives audio clips at their volume by playhead position", async ({ page }) => {
  await page.goto("/");
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    DirectorPreview.mount({
      playerEl: document.getElementById("directorPreview"),
      videoEl: document.getElementById("directorPreviewVideo"),
      imageEl: document.getElementById("directorPreviewImage"),
      overlayEl: document.getElementById("directorPreviewOverlay"),
      playButtonEl: document.getElementById("directorPreviewPlay"),
      timeReadoutEl: document.getElementById("directorPreviewTime"),
      playheadEl: document.getElementById("directorPlayhead"),
      timelineEl: document.querySelector(".director-timeline-shell"),
    });
    DirectorPreview.setTimeline({
      duration: 6, width: 1280, height: 720,
      clips: [{ start: 0, duration: 6, kind: "text", src: "", prompt: "x" }],
      audioClips: [
        { start: 0, duration: 2, trimStart: 0, src: "/favicon.ico", volume: 0.4 },
        { start: 3, duration: 2, trimStart: 0, src: "/favicon.ico", volume: 1.5 },
      ],
    });
  });

  // At t=1 the first audio clip is active at gain 0.4; the second is not.
  await page.evaluate(() => DirectorPreview.seek(1));
  const a1 = await page.evaluate(() => DirectorPreview._audio());
  expect(a1.find((a) => a.start === 0).active).toBe(true);
  expect(a1.find((a) => a.start === 0).volume).toBeCloseTo(0.4, 5);
  expect(a1.find((a) => a.start === 3).active).toBe(false);

  // At t=3.5 the second clip is active and its >1 volume is capped to 1.0.
  await page.evaluate(() => DirectorPreview.seek(3.5));
  const a2 = await page.evaluate(() => DirectorPreview._audio());
  expect(a2.find((a) => a.start === 3).active).toBe(true);
  expect(a2.find((a) => a.start === 3).volume).toBeCloseTo(1.0, 5);
});

test("director editor feeds the preview from timeline state", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_2']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    state.directorSegments = [
      { id: "p1", start: 0, duration: 2, prompt: "opening shot", strength: 0.7 },
    ];
    state.directorAudioSegments = [];
    state.directorVideoAudioSegments = [];
    renderDirectorEditor();
  });

  await page.evaluate(() => DirectorPreview.seek(1));
  await expect(page.locator("#directorPreviewOverlay")).toBeVisible();
  await expect(page.locator("#directorPreviewOverlay")).toHaveText("opening shot");
  const st = await page.evaluate(() => DirectorPreview._state());
  expect(st.timeline.duration).toBe(2);
});
