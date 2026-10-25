import { expect, test } from '@playwright/test';
import { replayCases } from '../packages/sim/test/replays.ts';
import { runBattle } from '../packages/sim/src/index.ts';

test('browser simulation reproduces Node golden replays', async ({ page }) => {
  await page.goto('/');
  const modulePath = `/@fs/${process.cwd()}/packages/sim/src/index.ts`;
  for (const c of [...replayCases(1), ...replayCases(2)]) {
    const expected = runBattle(c.setup, c.commands);
    const actual = await page.evaluate(
      async ({ modulePath, setup, commands }) => {
        const sim = await import(/* @vite-ignore */ modulePath);
        return sim.runBattle(setup, commands);
      },
      { modulePath, setup: c.setup, commands: c.commands },
    );
    expect(actual, c.name).toEqual(expected);
  }
});
