const { test, expect } = require("@playwright/test");

test("home screen loads public Camera Lab controls", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("h1")).toContainText("Camera Lab");
  await expect(page.locator("#workflowSelect")).toBeVisible();
  await expect(page.locator("#directorWorkspaceTab")).toBeVisible();
  await expect(page.locator("#photographyWorkspaceTab")).toBeHidden();
});
