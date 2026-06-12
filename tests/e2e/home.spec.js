const { test, expect } = require("@playwright/test");

test("home screen loads public Camera Lab controls", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("h1")).toContainText("Camera Lab");
  await expect(page.locator("#workflowSelect")).toBeVisible();
  await expect(page.locator("#directorWorkspaceTab")).toBeVisible();
  await expect(page.locator("#photographyWorkspaceTab")).toBeHidden();
});

test("director workspace starts without generated empty prompt segments", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_reference_mvp']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  await expect(page.locator("#directorTimelinePanel")).toBeVisible();
  await expect(page.locator("#directorTrack .director-block")).toHaveCount(0);
  await expect(page.locator("#directorSegmentInspector")).toContainText("Add a segment");
  await expect(page.locator("#directorTrack")).not.toContainText("empty prompt");
});

test("director segment remove controls delete from timeline and inspector", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_reference_mvp']")).toHaveCount(1);
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
  await expect(page.locator("#workflowSelect option[value='ltx_director_reference_mvp']")).toHaveCount(1);
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
  await expect(page.locator("#directorAudioTrack .director-audio-block.has-audio")).toHaveCount(1);
  await expect(page.locator("#audioUploadWrap")).toBeHidden();

  const payload = await page.evaluate(() => collectPayload());
  expect(payload.audio_path).toBe("");
  expect(payload.segments[0].audio_path).toBeUndefined();
  expect(payload.audio_segments[0].audio_path).toContain("line_one.wav");
});

test("director timeline audio modal rounds clip duration up and labels the timeline", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_reference_mvp']")).toHaveCount(1);
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

test("director timeline audio blocks can be dragged but keep fixed duration", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_reference_mvp']")).toHaveCount(1);
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
  await expect(page.locator("#workflowSelect option[value='ltx_director_reference_mvp']")).toHaveCount(1);
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
  await expect(page.locator("#workflowSelect option[value='ltx_director_reference_mvp']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  const payload = await page.evaluate(() => {
    useRunTimeline({
      batch_id: "dry",
      run_id: "01_director",
      workflow_id: "ltx_director_reference_mvp",
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
  await expect(page.locator("#workflowSelect option[value='ltx_director_reference_mvp']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();

  const payload = await page.evaluate(() => {
    useRunTimeline({
      batch_id: "dry",
      run_id: "01_director",
      workflow_id: "ltx_director_reference_mvp",
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
  await expect(page.locator("#workflowSelect option[value='ltx_director_reference_mvp']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.evaluate(() => {
    useRunTimeline({
      batch_id: "dry",
      run_id: "01_director",
      workflow_id: "ltx_director_reference_mvp",
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
