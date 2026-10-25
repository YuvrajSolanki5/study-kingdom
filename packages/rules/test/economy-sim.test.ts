import { expect, it } from 'vitest';
import { simulateEconomy } from '../src/economy-sim.ts';
it('25, 60 and 120 minute schedules can reach every HQ tier without resource softlocks', () => {
  const reports = [25, 60, 120].map((m) => simulateEconomy(m));
  for (const r of reports) {
    expect(r.reachedHq).toBe(10);
    expect(r.firstSessionAffordableUpgrade).toBe(true);
    expect(Object.keys(r.hqDays)).toHaveLength(10);
  }
  expect(reports[0]!.days).toBeGreaterThan(reports[1]!.days);
  expect(reports[1]!.days).toBeGreaterThan(reports[2]!.days);
});
