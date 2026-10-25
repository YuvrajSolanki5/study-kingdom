import { expect, test } from '@playwright/test';
import { registerAccount, uniqueUsername } from './helpers.ts';

test('two friends form a league, share a verified replay and join a clan', async ({ page, browser }) => {
  await registerAccount(page, uniqueUsername('alice'), 'Alice Scholar');
  const context = await browser.newContext({
    baseURL: 'http://localhost:5173',
    viewport: { width: 1280, height: 800 },
  });
  const bob = await context.newPage();
  try {
    await registerAccount(bob, uniqueUsername('bob'), 'Bob Scholar');
    const bobProfile = await bob.evaluate(async () => (await (await fetch('/api/player')).json()).profile);
    await page
      .getByRole('navigation')
      .getByRole('button', { name: /Friends/ })
      .click();
    await page.getByLabel('Friend code', { exact: true }).fill(bobProfile.friendCode);
    await page.getByRole('button', { name: 'Add friend', exact: true }).click();
    await expect(page.getByText('Request sent')).toBeVisible();
    await bob
      .getByRole('navigation')
      .getByRole('button', { name: /Friends/ })
      .click();
    await bob.getByRole('button', { name: 'Accept request', exact: true }).click();
    await expect(bob.getByRole('button', { name: 'Visit', exact: true })).toBeVisible();
    await page.reload();
    await page
      .getByRole('navigation')
      .getByRole('button', { name: /Friends/ })
      .click();
    await page.getByRole('button', { name: 'Visit', exact: true }).click();
    await expect(page.getByText('Visiting Bob Scholar')).toBeVisible();
    await page.getByRole('button', { name: 'Return home', exact: true }).click();
    await page
      .getByRole('navigation')
      .getByRole('button', { name: /Friends/ })
      .click();
    await page.getByLabel('New group name').fill('Scholar League');
    await page.getByRole('button', { name: 'Create league', exact: true }).click();
    await expect(page.getByText('Scholar League', { exact: false }).first()).toBeVisible();
    const league = await page.evaluate(async () => (await (await fetch('/api/social')).json()).leagues[0]);
    await bob.getByLabel('Group invite code').fill(league.code);
    await bob.getByRole('button', { name: 'Join league', exact: true }).click();
    await bob.getByRole('button', { name: 'Standings', exact: true }).click();
    await expect(bob.getByText(/Alice Scholar:.*0 points/)).toBeVisible();
    await expect(bob.getByText(/Bob Scholar:.*0 points/)).toBeVisible();
    await page.getByRole('button', { name: 'Challenge', exact: true }).click();
    await expect(page.getByText('Alice Scholar → Bob Scholar', { exact: true })).toBeVisible();
    // Complete through the same API used by the battle scene; browser replay is rendered below.
    const challenge = await bob.evaluate(
      async () => (await (await fetch('/api/social')).json()).challenges[0],
    );
    const battle = await bob.evaluate(
      async (id: string) =>
        await (
          await fetch('/api/battles', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ requestId: crypto.randomUUID(), kind: 'friendly', target: id }),
          })
        ).json(),
      challenge.id,
    );
    const result = await bob.evaluate(
      async (id: string) =>
        await (
          await fetch(`/api/battles/${id}/submit`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ commands: [{ t: 0, k: 'end' }] }),
          })
        ).json(),
      battle.battle.id,
    );
    expect(result.battle.status).toBe('settled');
    const shared = await bob.evaluate(
      async (id: string) =>
        await (
          await fetch(`/api/social/replays/${id}/share`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
        ).json(),
      battle.battle.id,
    );
    await page.getByLabel('Replay token').fill(shared.token);
    await page.getByRole('button', { name: 'Watch replay', exact: true }).click();
    await expect(page.locator('.battle-hud')).toBeVisible();
    await page
      .getByRole('dialog', { name: 'Replay finished' })
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await page.getByRole('navigation').getByRole('button', { name: /Clan/ }).click();
    await page.getByLabel('Clan name', { exact: true }).fill('Scholars Guild');
    await page.getByRole('button', { name: 'Create clan', exact: true }).click();
    await page.getByText('Invite friends', { exact: true }).click();
    await page.getByRole('button', { name: 'Invite to clan', exact: true }).click();
    await bob.getByRole('navigation').getByRole('button', { name: /Clan/ }).click();
    await bob.getByRole('button', { name: 'Join clan', exact: true }).click();
    await expect(bob.getByRole('heading', { name: 'Scholars Guild', exact: true })).toBeVisible();
    await expect(bob.getByText('Bob Scholar · member', { exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
