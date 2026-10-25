import { expect, type Page } from '@playwright/test';

export function uniqueUsername(tag: string) {
  return `e2e_${tag.slice(0, 5)}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export async function enableHooks(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('sk.e2e', '1'));
}

/** Registers a username account and enters the village immediately. */
export async function registerAccount(
  page: Page,
  username: string,
  name: string,
  password = 'e2e-password-123',
) {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Kingdom name').fill(name);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create my kingdom' }).click();
  await expect(page.getByRole('button', { name: /Study/ }).first()).toBeVisible();
}

export async function tileToPage(page: Page, x: number, y: number) {
  await page.waitForFunction(
    () => typeof (window as unknown as { __sk?: { tileToPage?: unknown } }).__sk?.tileToPage === 'function',
  );
  return page.evaluate(
    ([tx, ty]) =>
      (
        window as unknown as { __sk: { tileToPage(x: number, y: number): { x: number; y: number } } }
      ).__sk.tileToPage(tx!, ty!),
    [x, y],
  );
}

export async function hudGold(page: Page): Promise<number> {
  const text = await page.locator('.hud .res-gold').first().innerText();
  return Number(text.replace(/[^\d]/g, ''));
}
