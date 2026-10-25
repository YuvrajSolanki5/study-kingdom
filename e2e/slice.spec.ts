import { expect, test } from '@playwright/test';
import { enableHooks, hudGold, registerAccount, tileToPage, uniqueUsername } from './helpers.ts';

/**
 * Phase 2 completion criterion: a new player can study, upgrade their village,
 * assemble an army and win a battle without developer intervention.
 */
test('new player: register → study → upgrade → train → win a battle', async ({ page }) => {
  await enableHooks(page);
  const username = uniqueUsername('slice');
  await registerAccount(page, username, 'E2E Scholar');
  await expect(page.locator('.hud')).toContainText('E2E Scholar');
  await page.waitForFunction(
    () => (window as unknown as { __sk?: { scene: string } }).__sk?.scene === 'village',
  );
  expect(await hudGold(page)).toBe(750);
  // Regression: the starter village draws its buildings on first load, not just the ground.
  const drawn = await page.evaluate(
    () =>
      (
        window as unknown as { __sk: { owner: { children: { list: { type: string }[] } } } }
      ).__sk.owner.children.list.filter((o) => o.type === 'Image').length,
  );
  expect(drawn).toBeGreaterThan(5);

  // Study: a short paper session finished early still earns proportional credit.
  await page.getByRole('button', { name: /Study/ }).first().click();
  await page.getByRole('radio', { name: /Paper/ }).click();
  await page.getByLabel('Custom minutes').fill('5');
  await page.getByLabel('Goal for this session').fill('E2E reading');
  await page.getByRole('button', { name: 'Start studying' }).click();
  await expect(page.getByRole('region', { name: 'Focus session' })).toBeVisible();
  // The kingdom is hidden during focus; wait past the 60 s minimum (two heartbeats).
  await page.waitForTimeout(70_000);
  await page.getByRole('button', { name: 'Finish early' }).click();
  await page.getByRole('button', { name: 'Collect rewards' }).click();
  await expect(page.getByRole('heading', { name: 'Well studied!' })).toBeVisible();
  await page.getByRole('button', { name: 'Spend it in my kingdom' }).click();
  // The HUD updates when the refreshed player view arrives.
  await expect.poll(() => hudGold(page)).toBeGreaterThan(750);
  const afterStudy = await hudGold(page);

  // Upgrade the treasury (tile 25,20, size 3): select it, then upgrade.
  const t = await tileToPage(page, 26.5, 21.5);
  await page.mouse.click(t.x, t.y);
  await expect(page.getByRole('dialog', { name: /Gilded Vault/ })).toBeVisible();
  await page.getByRole('button', { name: 'Upgrade', exact: true }).click();
  await expect(page.getByText(/Upgrading to level 2/)).toBeVisible();
  expect(await hudGold(page)).toBe(afterStudy - 750);

  // Army: queue more swordsmen.
  await page.getByRole('navigation').getByRole('button', { name: /Army/ }).click();
  await page.getByRole('button', { name: '+5' }).first().click();
  await expect(page.getByText(/Training · all done in/)).toBeVisible();

  // Attack the first campaign base with the 15 starter swordsmen.
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /Attack/ })
    .click();
  await page.locator('.campaign-base').first().getByRole('button', { name: 'Attack', exact: true }).click();
  await expect(page.locator('.battle-hud')).toBeVisible();
  await page.waitForFunction(
    () => (window as unknown as { __sk?: { scene: string } }).__sk?.scene === 'battle',
  );
  for (let i = 0; i < 15; i++) {
    const p = await tileToPage(page, 0.5 + (i % 3) * 0.3, 18 + i * 0.5);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(80);
  }
  await expect(page.getByRole('heading', { name: 'Victory!' })).toBeVisible({ timeout: 200_000 });
  await expect(page.getByText(/Rewards:/)).toBeVisible();
  await page.getByRole('button', { name: 'Return home' }).click();
  await expect.poll(() => hudGold(page)).toBe(afterStudy - 750 + 700);
});
