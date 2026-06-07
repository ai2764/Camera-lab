const path = require("node:path");
const fs = require("node:fs/promises");
const { chromium } = require("@playwright/test");

const outDir = path.resolve("tasks/camera_lab_previews/camera_motion_depth_10s");
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

    app.actor.position.set(0, 0.36, 0);
    app.actor.rotation.set(0, 0, 0);
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

  const frames = await page.evaluate(async (count) => {
    const photo = window.cameraLabPhotography;
    const { app, THREE } = photo;
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    const outputs = [];

    const previousAspect = app.camera.aspect;
    const previousWidth = app.renderer.domElement.width;
    const previousHeight = app.renderer.domElement.height;
    const previousBackground = app.scene.background;

    const materials = [];
    const visibility = [];
    app.scene.traverse((child) => {
      if (child.type === "GridHelper" || child.isLine) {
        visibility.push([child, child.visible]);
        child.visible = false;
      }
      if (!child.isMesh) return;
      materials.push([child, child.material]);
    });
    if (app.transform) {
      visibility.push([app.transform, app.transform.visible]);
      app.transform.visible = false;
    }

    app.camera.aspect = canvas.width / canvas.height;
    app.camera.updateProjectionMatrix();
    app.renderer.setSize(canvas.width, canvas.height, false);
    app.scene.background = new THREE.Color(0x000000);

    for (let frame = 0; frame < count; frame += 1) {
      photo.applyInterpolatedFrame(frame);
      app.camera.updateMatrixWorld(true);
      app.scene.updateMatrixWorld(true);

      for (const [mesh] of materials) {
        let parent = mesh.parent;
        let isActor = false;
        while (parent) {
          if (parent.name === "Actor") isActor = true;
          parent = parent.parent;
        }
        const world = mesh.getWorldPosition(new THREE.Vector3());
        const value = isActor ? 220 : world.y > 0.5 ? 70 : world.x > 0.8 ? 145 : 95;
        mesh.material = new THREE.MeshBasicMaterial({ color: new THREE.Color(value / 255, value / 255, value / 255) });
      }

      app.renderer.render(app.scene, app.camera);
      ctx.drawImage(app.renderer.domElement, 0, 0, canvas.width, canvas.height);
      outputs.push(canvas.toDataURL("image/png"));
    }

    for (const [mesh, material] of materials) mesh.material = material;
    for (const [object, visible] of visibility) object.visible = visible;
    app.scene.background = previousBackground;
    app.camera.aspect = previousAspect;
    app.camera.updateProjectionMatrix();
    app.renderer.setSize(previousWidth, previousHeight, false);
    return outputs;
  }, totalFrames);

  for (let frame = 0; frame < frames.length; frame += 1) {
    const filename = path.join(outDir, `frame_${String(frame + 1).padStart(4, "0")}.png`);
    await fs.writeFile(filename, Buffer.from(frames[frame].split(",", 2)[1], "base64"));
  }

  await browser.close();
})();
