const path = require("node:path");
const fs = require("node:fs/promises");
const { chromium } = require("@playwright/test");

const outDir = path.resolve("tasks/camera_lab_previews/camera_motion_10s");
const totalFrames = 120;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await page.goto("http://127.0.0.1:1234/#photography");
  await page.waitForSelector("body.photography-workspace-active", { timeout: 15000 });
  const canvas = page.locator("#photoViewport canvas");
  await canvas.waitFor({ state: "visible", timeout: 15000 });

  await page.locator("#photoFramesInput").fill(String(totalFrames));
  await page.locator("#photoFramesInput").dispatchEvent("input");

  const box = await canvas.boundingBox();
  if (!box) throw new Error("photography canvas is not visible");

  await page.locator("#photoFrameSlider").evaluate((slider) => {
    slider.value = "60";
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.46, { steps: 24 });
  await page.mouse.up();
  await page.locator("#photoAddKeyframeBtn").scrollIntoViewIfNeeded();
  await page.locator("#photoAddKeyframeBtn").click();

  for (let frame = 0; frame < totalFrames; frame += 1) {
    await page.locator("#photoFrameSlider").evaluate((slider, value) => {
      slider.value = String(value);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }, frame);
    await page.waitForTimeout(15);
    const filename = path.join(outDir, `frame_${String(frame + 1).padStart(4, "0")}.png`);
    const dataUrl = await canvas.evaluate((node) => node.toDataURL("image/png"));
    await fs.writeFile(filename, Buffer.from(dataUrl.split(",", 2)[1], "base64"));
  }

  await browser.close();
})();
