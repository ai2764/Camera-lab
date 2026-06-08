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

test("director segment inspector has a single remove control", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#workflowSelect option[value='ltx_director_reference_mvp']")).toHaveCount(1);
  await page.locator("#directorWorkspaceTab").click();
  await page.locator("#addDirectorSegmentBtn").click();

  await expect(page.locator("#removeDirectorSegmentBtn")).toBeVisible();
  await expect(page.locator("#removeDirectorSegmentIconBtn")).toHaveCount(0);
});
