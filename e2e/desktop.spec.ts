import { expect, test, type Page } from '@playwright/test';
import { registerAccount, uniqueUsername } from './helpers.ts';

/**
 * Runs the client in its desktop configuration inside WebKit (the engine of
 * the macOS webview) with a stand-in for the Tauri IPC bridge. Covers the
 * desktop-only paths: bearer tokens, Keychain-backed session persistence,
 * app allowlist + grace period, and the update check. The real native
 * commands are covered by `cargo test` in apps/desktop/src-tauri.
 */
test.skip(({ browserName }) => browserName !== 'webkit', 'The Mac app uses WebKit');

async function mockTauri(page: Page) {
  await page.addInitScript(() => {
    const store = JSON.parse(sessionStorage.getItem('mock.keychain') ?? '{}') as Record<string, string>;
    const save = () => sessionStorage.setItem('mock.keychain', JSON.stringify(store));
    const w = window as unknown as Record<string, unknown>;
    w.__mockFrontApp = { bundleId: 'com.apple.Safari', name: 'Safari' };
    let id = 0;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => ++id,
      invoke: async (cmd: string, args: Record<string, string>) => {
        switch (cmd) {
          case 'secure_get':
            return store[args.key!] ?? null;
          case 'secure_set':
            store[args.key!] = args.value!;
            save();
            return null;
          case 'secure_delete':
            delete store[args.key!];
            save();
            return null;
          case 'front_app':
            return {
              ...(w.__mockFrontApp as object),
              locked: false,
              idleSeconds: 3,
              selfBundleId: 'app.studykingdom.desktop',
            };
          case 'running_apps':
            return [
              { bundleId: 'com.apple.Safari', name: 'Safari' },
              { bundleId: 'md.obsidian', name: 'Obsidian' },
            ];
          case 'prevent_sleep':
            return null;
          case 'plugin:updater|check':
            return null;
          default:
            throw new Error(`unmocked command ${cmd}`);
        }
      },
    };
  });
}

test('desktop: Keychain session persists across restarts; allowlist grace applies', async ({ page }) => {
  const username = uniqueUsername('desktop');
  await registerAccount(page, username, 'Mac Scholar');
  await page.context().clearCookies();
  await mockTauri(page);
  await page.goto('/');
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password').fill('e2e-password-123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await expect(page.locator('.hud')).toContainText('Mac Scholar');
  const keychain = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mock.keychain') ?? '{}'));
  expect(keychain.refresh_token).toBeTruthy();
  // No cookies are used by the desktop client.
  expect((await page.context().cookies()).filter((c) => c.name.includes('sk_'))).toHaveLength(0);

  // "Restart": a fresh page restores the session from the Keychain refresh token.
  await page.reload();
  await expect(page.locator('.hud')).toContainText('Mac Scholar');

  // Allow Obsidian, then study in computer mode while Safari is in front.
  await page.getByRole('button', { name: 'Profile and settings' }).click();
  await page.getByRole('button', { name: '+ Obsidian' }).click();
  await expect(page.getByText('Obsidian', { exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: /Study/ }).click();
  await page.getByRole('radio', { name: /Computer/ }).click();
  await page.getByRole('button', { name: 'Start studying' }).click();
  await expect(page.getByText(/Safari is not on your study list · pausing in/)).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__mockFrontApp = {
      bundleId: 'md.obsidian',
      name: 'Obsidian',
    };
  });
  await expect(page.getByText('Earning — stay with it')).toBeVisible();
  await page.getByRole('button', { name: 'Finish early' }).click();
  await page.getByRole('button', { name: 'Collect rewards' }).click();
  await expect(page.getByRole('heading', { name: 'Well studied!' })).toBeVisible();
  await page.getByRole('button', { name: 'Spend it in my kingdom' }).click();

  // Sign out clears the Keychain entry.
  await page.getByRole('button', { name: 'Profile and settings' }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true }).last()).toBeVisible();
  const after = await page.evaluate(() => JSON.parse(sessionStorage.getItem('mock.keychain') ?? '{}'));
  expect(after.refresh_token).toBeUndefined();
});
