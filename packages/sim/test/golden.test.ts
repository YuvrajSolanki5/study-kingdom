import { describe, expect, it } from 'vitest';
import goldenV1 from './golden-v1.json';
import goldenV2 from './golden-v2.json';
import { runBattle, runBattleChunk, validateCommands, type SimState } from '../src/index.ts';
import { replayCases } from './replays.ts';

for (const [version, golden] of [
  [1, goldenV1],
  [2, goldenV2],
] as const)
  describe(`pinned version ${version} replays`, () => {
    for (const c of replayCases(version))
      it(c.name, () => {
        expect(validateCommands(c.setup, c.commands)).toEqual({ ok: true });
        const expected = golden[c.name as keyof typeof golden];
        expect(runBattle(c.setup, c.commands)).toEqual(expected);
        let state: SimState | null = null;
        for (let i = 0; i < 2000; i++) {
          const chunk = runBattleChunk(c.setup, c.commands, state, 2500);
          state = JSON.parse(JSON.stringify(chunk.state)) as SimState;
          if (chunk.done) {
            expect(chunk.result).toEqual(expected);
            return;
          }
        }
        throw new Error('Checkpoint verification did not finish');
      });
  });
