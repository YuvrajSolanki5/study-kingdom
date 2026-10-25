import type { BattleResult, BattleSetup, Command, SimState } from '@sk/sim';

export type VerifyOutcome =
  | { status: 'done'; result: BattleResult; via: string }
  | { status: 'pending'; checkpoint: SimState; work: number; via: string };

/** Re-simulates a submitted battle on trusted infrastructure. */
export interface BattleVerifier {
  readonly name: string;
  verify(setup: BattleSetup, commands: Command[], checkpoint: SimState | null): Promise<VerifyOutcome>;
}
