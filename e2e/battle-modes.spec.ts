import { expect, test, type Page } from '@playwright/test';
import { enableHooks, registerAccount, tileToPage, uniqueUsername } from './helpers.ts';

async function inBattle(page: Page) {
  await expect(page.locator('.battle-hud')).toBeVisible();
  await page.waitForFunction(
    () => (window as unknown as { __sk?: { scene: string } }).__sk?.scene === 'battle',
  );
}

/** Images in the village scene: the ground plus one per building and footprint pad. */
async function villageImages(page: Page) {
  return page.evaluate(() => {
    const sk = (
      window as unknown as {
        __sk?: { scene: string; owner: { children: { list: { type: string; active: boolean }[] } } };
      }
    ).__sk;
    if (sk?.scene !== 'village') return -1;
    return sk.owner.children.list.filter((o) => o.type === 'Image' && o.active).length;
  });
}

async function attackFirstBase(page: Page) {
  await expect.poll(() => villageImages(page)).toBeGreaterThan(5);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /Attack/ })
    .click();
  await page.locator('.campaign-base').first().getByRole('button', { name: 'Attack', exact: true }).click();
  await inBattle(page);
}

test('auto-battle deploys the army and the server verifies the result', async ({ page }) => {
  await enableHooks(page);
  await registerAccount(page, uniqueUsername('auto'), 'Auto Scholar');
  await expect.poll(() => villageImages(page)).toBeGreaterThan(5);
  const before = await villageImages(page);
  await attackFirstBase(page);
  await page.getByRole('button', { name: /Auto-battle/ }).click();
  await expect(page.getByRole('heading', { name: 'Victory!' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Rewards:/)).toBeVisible();
  // Regression: the village is redrawn after a battle, not just its ground.
  await page.getByRole('button', { name: 'Return home' }).click();
  await expect.poll(() => villageImages(page)).toBe(before);
});

test('live battles can speed up and skip to the end', async ({ page }) => {
  await enableHooks(page);
  await registerAccount(page, uniqueUsername('skip'), 'Skip Scholar');
  await attackFirstBase(page);
  for (let i = 0; i < 5; i++) {
    const p = await tileToPage(page, 0.5 + (i % 3) * 0.3, 18 + i * 0.5);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(80);
  }
  await expect(page.getByText('Battle', { exact: true })).toBeVisible();
  const fast = page.getByRole('group', { name: 'Battle speed' }).getByRole('button', { name: '4×' });
  await fast.click();
  await expect(fast).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /Skip to end/ }).click();
  await expect(page.getByRole('heading', { name: /Victory!|Defeat/ })).toBeVisible({ timeout: 60_000 });
});

test('friends can attack each other directly, friendly or ranked', async ({ page, browser }) => {
  await enableHooks(page);
  await registerAccount(page, uniqueUsername('alice'), 'Alice Scholar');
  const context = await browser.newContext({
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 800 },
  });
  const bob = await context.newPage();
  try {
    await registerAccount(bob, uniqueUsername('bob'), 'Bob Scholar');
    // Become friends through the API; the friends UI is covered in social.spec.ts.
    const bobProfile = await bob.evaluate(async () => (await (await fetch('/api/player')).json()).profile);
    const aliceProfile = await page.evaluate(async (code: string) => {
      const post = (url: string, body: unknown) =>
        fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      await post('/api/social/friends', { code });
      return (await (await fetch('/api/player')).json()).profile;
    }, bobProfile.friendCode as string);
    await bob.evaluate(
      (id: string) =>
        fetch(`/api/social/friends/${id}/accept`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        }),
      aliceProfile.userId as string,
    );

    const openAttack = async () => {
      await page
        .getByRole('navigation')
        .getByRole('button', { name: /Friends/ })
        .click();
      await page
        .locator('.list li')
        .filter({ hasText: 'Bob Scholar' })
        .getByRole('button', { name: 'Attack', exact: true })
        .click();
      await expect(page.getByRole('dialog', { name: 'Attack Bob Scholar' })).toBeVisible();
    };

    // Friendly: no challenge needed and the army comes back.
    await openAttack();
    await page.getByRole('button', { name: 'Friendly battle', exact: true }).click();
    await inBattle(page);
    await expect(page.getByText('Friendly battle · Bob Scholar')).toBeVisible();
    await page.getByRole('button', { name: /Auto-battle/ }).click();
    await expect(page.getByRole('heading', { name: /Victory!|Defeat/ })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Return home' }).click();

    // Ranked: a real raid on the same friend.
    await openAttack();
    await page.getByRole('button', { name: 'Ranked raid', exact: true }).click();
    await inBattle(page);
    await expect(page.getByText('Ranked raid · Bob Scholar')).toBeVisible();
    await page.getByRole('button', { name: /Auto-battle/ }).click();
    await expect(page.getByRole('heading', { name: /Victory!|Defeat/ })).toBeVisible({ timeout: 60_000 });
    const raids = await bob.evaluate(async () => (await (await fetch('/api/battles')).json()).battles);
    expect(
      raids.some((b: { kind: string; status: string }) => b.kind === 'ranked' && b.status === 'settled'),
    ).toBe(true);
  } finally {
    await context.close();
  }
});
