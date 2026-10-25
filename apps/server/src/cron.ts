import { registerRivalry } from './services/rivalry.ts';
import { advanceWars, registerWars } from './services/wars.ts';
import type { Deps } from './context.ts';
import { finalizeExpired } from './services/battles.ts';
import { closeStaleSessions } from './services/study.ts';

/**
 * Scheduled maintenance. Every job is idempotent and bounded so a run fits the
 * free-plan CPU limit; anything left over is picked up by the next run.
 */
export async function runCron(deps: Deps, cron: string) {
  registerRivalry();
  registerWars();
  const sql = deps.createSql();
  try {
    if (cron === '0 3 * * *') {
      // Daily: prune old request receipts and error reports. Doubles as the
      // Supabase keep-alive so free projects are not paused for inactivity.
      await sql`delete from game.requests where created_at < now() - interval '3 days'`;
      await sql`delete from game.client_errors where created_at < now() - interval '30 days'`;
      await sql`delete from game.notifications where created_at < now() - interval '30 days'`;
      return;
    }
    await closeStaleSessions(sql, deps, 10);
    await finalizeExpired(sql, deps, { limit: 3 });
    await advanceWars(sql, deps);
  } finally {
    await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}
