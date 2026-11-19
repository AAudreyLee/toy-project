import { expect, test } from "@playwright/test";

test("첫 화면에서 연결 정보 입력란이 보인다", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("아이디어에서 첫 Spec까지");
  await expect(page.getByLabel("Azure OpenAI API 키")).toBeVisible();
  await expect(page.getByLabel("엔드포인트 주소")).toBeVisible();
  await expect(page.getByLabel("배포 이름")).toBeVisible();
});
