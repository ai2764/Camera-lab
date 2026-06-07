const path = require("node:path");
const fs = require("node:fs/promises");
const { chromium } = require("@playwright/test");

const outDir = path.resolve("tasks/camera_lab_previews/camera_motion_environment_canny_10s");
const totalFrames = 120;

async function cleanOutputDir() {
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
}

(async () => {
  await cleanOutputDir();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await page.goto("http://127.0.0.1:1234/#photography");
  await page.waitForFunction(() => window.cameraLabPhotography?.app?.renderer, null, { timeout: 15000 });

  await page.evaluate((frames) => {
    const photo = window.cameraLabPhotography;
    const { app } = photo;
    document.getElementById("photoFramesInput").value = String(frames);
    document.getElementById("photoFramesInput").dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("photoSizeSelect").value = "768x512";

    app.actor.visible = false;
    if (app.transform) app.transform.visible = false;
    app.keyframes = [];
    app.nextKeyframeId = 1;

    const target = [0, 0.85, 0];
    const shots = [
      { frame: 0, cameraPosition: [0, 1.15, 4.9], target, fov: 34, easing: "easeInOut" },
      { frame: Math.floor((frames - 1) / 2), cameraPosition: [1.35, 1.2, 4.65], target, fov: 34, easing: "easeInOut" },
      { frame: frames - 1, cameraPosition: [2.45, 1.25, 4.05], target, fov: 34, easing: "easeInOut" },
    ];

    for (const shot of shots) {
      photo.applyShotState({
        cameraPosition: shot.cameraPosition,
        cameraRotation: [0, 0, 0],
        target: shot.target,
        fov: shot.fov,
      });
      photo.setKeyframe(shot.frame, photo.copyShotState(), shot.easing);
    }
    photo.applyInterpolatedFrame(0);
  }, totalFrames);

  const sequence = await page.evaluate(async () => {
    return window.cameraLabPhotography.renderCannySequence();
  });

  for (let frame = 0; frame < sequence.frames.length; frame += 1) {
    const filename = path.join(outDir, `frame_${String(frame + 1).padStart(4, "0")}.png`);
    await fs.writeFile(filename, Buffer.from(sequence.frames[frame].split(",", 2)[1], "base64"));
  }

  await browser.close();
})();
