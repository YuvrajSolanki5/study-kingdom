import { test, expect } from '@playwright/test';
import { enableHooks, registerAccount, uniqueUsername } from './helpers.ts';

test('username accounts enter immediately and can change passwords without email', async ({ page }) => {
  await enableHooks(page);
  const username = uniqueUsername('auth');
  await registerAccount(page, username, 'Account Test');
  await page.getByRole('button', { name: 'Profile and settings', exact: true }).click();
  await expect(page.getByText(`Signed in as ${username}`, { exact: false })).toBeVisible();
  await page.getByLabel('Current password', { exact: true }).fill('e2e-password-123');
  await page.getByLabel('New password', { exact: true }).fill('changed-password-456');
  await page.getByRole('button', { name: 'Change password', exact: true }).click();
  await expect(page.getByText('Password changed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toHaveCount(0);
  await page.getByLabel('Username', { exact: true }).fill(username.toUpperCase());
  await page.getByLabel('Password', { exact: true }).fill('changed-password-456');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: /Study/ }).first()).toBeVisible();
});
