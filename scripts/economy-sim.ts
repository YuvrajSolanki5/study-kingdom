import { simulateEconomy } from '../packages/rules/src/economy-sim.ts';
const reports = [25, 60, 120].map((m) => simulateEconomy(m));
if (process.argv.includes('--json')) console.log(JSON.stringify(reports, null, 2));
else console.table(reports.map((r) => ({ ...r, hqDays: JSON.stringify(r.hqDays) })));
if (reports.some((r) => r.reachedHq !== 10 || !r.firstSessionAffordableUpgrade)) process.exitCode = 1;
