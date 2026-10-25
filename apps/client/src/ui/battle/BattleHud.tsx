import { TPS } from '@sk/sim';
import { useEffect, useRef, useState } from 'react';
import { battles } from '../../api/endpoints.ts';
import { ApiError, isNetworkError } from '../../api/http.ts';
import { battleBridge, useBattleHud, type Selection } from '../../state/battleHud.ts';
import { contentOf, useGame } from '../../state/store.ts';
import { friendly } from '../auth/AuthScreen.tsx';
import { Button, CostView, Icon, Modal, Stars } from '../common.tsx';
import { fmtClock } from '../format.ts';

export function BattleHud() {
  const battle = useGame((s) => s.battle)!;
  const hud = useBattleHud();
  const content = contentOf(useGame.getState().view);
  const army = battle.setup.attacker;
  const remainingSec = Math.max(0, (hud.durationTicks - hud.tick) / TPS);
  const sel = hud.selection;
  useProgressUpload();
  useSubmission();

  // Pick the first available troop automatically.
  useEffect(() => {
    if (battle.replay || sel) return;
    const first = army.troops[0];
    if (first) useBattleHud.getState().set({ selection: { k: 'troop', id: first.id } });
  }, [battle.replay, sel, army.troops]);

  const choose = (s: Selection) => hud.set({ selection: s });
  const isSel = (k: string, id?: string) => sel?.k === k && (!id || ('id' in sel && sel.id === id));

  return (
    <div className="battle-hud">
      <header className="battle-top">
        <div>
          <strong>{battle.title}</strong>
          <div className="muted small">
            {battle.replay
              ? 'Replay'
              : hud.skipping
                ? 'Simulating to the end…'
                : hud.started
                  ? 'Battle'
                  : 'Scout the base, then tap the green area to deploy, or auto-battle'}
          </div>
        </div>
        <div className="battle-score">
          <Stars n={hud.stars} size={22} />
          <span className="pct">{hud.percent}%</span>
        </div>
        <div className={`battle-clock ${remainingSec < 30 ? 'low' : ''}`}>{fmtClock(remainingSec)}</div>
      </header>
      {battle.replay ? (
        <ReplayControls />
      ) : (
        <footer className="tray">
          {army.troops.map((t) => {
            const left = hud.started ? (hud.remaining.troops[t.id] ?? 0) : t.count;
            return (
              <button
                key={t.id}
                className={`tray-card ${isSel('troop', t.id) ? 'on' : ''}`}
                disabled={left <= 0}
                onClick={() => choose({ k: 'troop', id: t.id })}
              >
                <Icon name={t.id} size={52} className="tray-art" />
                <span className="tray-name">{content.troops[t.id]?.name ?? t.id}</span>
                <span className="tray-count">×{left}</span>
                <span className="tag">Lv {t.level}</span>
              </button>
            );
          })}
          {army.heroes.map((h) => {
            const left = hud.started ? (hud.remaining.heroes[h.id] ?? 0) : 1;
            const ability = hud.heroAbility[h.id];
            return left > 0 ? (
              <button
                key={h.id}
                className={`tray-card hero ${isSel('hero', h.id) ? 'on' : ''}`}
                onClick={() => choose({ k: 'hero', id: h.id })}
              >
                <Icon name={h.id} size={52} className="tray-art" />
                <span className="tray-name">{content.heroes[h.id]?.name ?? h.id}</span>
                <span className="tag">{h.hpPercent}% ❤</span>
              </button>
            ) : ability === 'ready' ? (
              <button
                key={h.id}
                className="tray-card ability"
                onClick={() => battleBridge.activateAbility?.(h.id)}
              >
                <Icon name={h.id} size={52} className="tray-art" />
                <span className="tray-name">{content.heroes[h.id]?.abilityName ?? 'Ability'}</span>
                <span className="tag">Activate</span>
              </button>
            ) : null;
          })}
          {army.siege.map((s) => {
            const left = hud.started ? (hud.remaining.siege[s.id] ?? 0) : s.count;
            return (
              <button
                key={s.id}
                className={`tray-card ${isSel('siege', s.id) ? 'on' : ''}`}
                disabled={left <= 0}
                onClick={() => choose({ k: 'siege', id: s.id })}
              >
                <Icon name={s.id} size={52} className="tray-art" />
                <span className="tray-name">{content.siege[s.id]?.name ?? s.id}</span>
                <span className="tray-count">×{left}</span>
              </button>
            );
          })}
          {army.reinforcements.length && !army.siege.length ? (
            <button
              className={`tray-card ${isSel('reinforce') ? 'on' : ''}`}
              disabled={hud.started && !hud.remaining.reinforcements}
              onClick={() => choose({ k: 'reinforce' })}
            >
              <Icon name="clan" size={52} className="tray-art" />
              <span className="tray-name">Clan troops</span>
            </button>
          ) : null}
          {army.spells.map((s) => {
            const left = hud.started ? (hud.remaining.spells[s.id] ?? 0) : s.count;
            return (
              <button
                key={s.id}
                className={`tray-card spell ${isSel('spell', s.id) ? 'on' : ''}`}
                disabled={left <= 0}
                onClick={() => choose({ k: 'spell', id: s.id })}
              >
                <Icon name={s.id} size={52} className="tray-art" />
                <span className="tray-name">{content.spells[s.id]?.name ?? s.id}</span>
                <span className="tray-count">×{left}</span>
              </button>
            );
          })}
          <div className="tray-controls">
            {!hud.started ? (
              <Button
                tone="primary"
                title="Deploy the whole army automatically and see the result at once"
                onClick={() => battleBridge.autoBattle?.()}
              >
                ⚡ Auto-battle
              </Button>
            ) : (
              <>
                <div className="row speed" role="group" aria-label="Battle speed">
                  {[1, 2, 4].map((s) => (
                    <Button
                      key={s}
                      tone={hud.speed === s ? 'primary' : 'default'}
                      aria-pressed={hud.speed === s}
                      disabled={hud.ended || hud.skipping}
                      onClick={() => hud.set({ speed: s })}
                    >
                      {s}×
                    </Button>
                  ))}
                </div>
                <Button
                  title="Simulate the rest of the battle now; nothing more can be deployed"
                  disabled={hud.ended || hud.skipping}
                  onClick={() => battleBridge.skipToEnd?.()}
                >
                  ⏭ Skip to end
                </Button>
              </>
            )}
            <Button
              tone="danger"
              className="end-btn"
              onClick={() => battleBridge.surrender?.()}
              disabled={hud.ended || hud.skipping}
            >
              {hud.started ? 'End battle' : 'Retreat'}
            </Button>
          </div>
        </footer>
      )}
      {battle.phase === 'submitting' || battle.phase === 'done' ? <ResultModal /> : null}
    </div>
  );
}

function ReplayControls() {
  const hud = useBattleHud();
  const setBattle = useGame((s) => s.setBattle);
  return (
    <footer className="tray replay">
      <Button onClick={() => hud.set({ paused: !hud.paused })}>{hud.paused ? '▶ Play' : '⏸ Pause'}</Button>
      {[1, 2, 4].map((s) => (
        <Button key={s} tone={hud.speed === s ? 'primary' : 'default'} onClick={() => hud.set({ speed: s })}>
          {s}×
        </Button>
      ))}
      <Button onClick={() => battleBridge.restartReplay?.()}>⟲ Restart</Button>
      <Button tone="ghost" onClick={() => setBattle(null)}>
        Exit replay
      </Button>
    </footer>
  );
}

/** Uploads recorded commands so a crash or closed tab still settles the battle fairly. */
function useProgressUpload() {
  const battle = useGame((s) => s.battle);
  const sent = useRef(0);
  const id = battle?.id;
  const replay = battle?.replay;
  useEffect(() => {
    if (!id || replay) return;
    sent.current = 0;
    const push = () => {
      const cmds = battleBridge.commands;
      if (cmds.length > sent.current && !useBattleHud.getState().ended) {
        const n = cmds.length;
        void battles
          .progress(id, cmds.slice())
          .then(() => (sent.current = Math.max(sent.current, n)))
          .catch(() => undefined);
      }
    };
    const t = setInterval(push, 8000);
    const onHide = () => document.visibilityState === 'hidden' && push();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [id, replay]);
}

/** Submits the finished battle and polls verification until the server settles it. */
function useSubmission() {
  const battle = useGame((s) => s.battle);
  const patch = useGame((s) => s.patchBattle);
  const refresh = useGame((s) => s.refresh);
  const running = useRef<string | null>(null);
  // Runs once per battle when it reaches the submitting phase.
  useEffect(() => {
    if (!battle || battle.replay || battle.phase !== 'submitting' || running.current === battle.id) return;
    running.current = battle.id;
    const id = battle.id;
    const commands = battleBridge.commands.slice();
    const hash = battle.localResult?.hash ?? '';
    void (async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        try {
          let res = await battles.submit(id, commands, hash);
          let polls = 0;
          while (res.battle.status === 'verifying' && polls++ < 120) {
            await new Promise((r) => setTimeout(r, 400));
            res = await battles.verify(id);
          }
          patch({ phase: 'done', summary: res.battle, error: null });
          await refresh();
          return;
        } catch (e) {
          if (e instanceof ApiError && e.code === 'battle_expired') {
            const b = await battles.get(id).catch(() => null);
            patch({
              phase: 'done',
              summary: b?.battle ?? null,
              error: 'The battle took too long and was settled from your saved progress.',
            });
            await refresh();
            return;
          }
          if (!isNetworkError(e) && !(e instanceof ApiError && e.status >= 500)) {
            patch({
              phase: 'done',
              error: e instanceof ApiError ? friendly(e) : 'Could not submit the battle',
            });
            return;
          }
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      patch({ error: 'Still offline. Your battle is saved and will be settled automatically.' });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on phase/id; reads the rest at that moment
  }, [battle?.phase, battle?.id]);
}

function ResultModal() {
  const battle = useGame((s) => s.battle)!;
  const setBattle = useGame((s) => s.setBattle);
  const setScreen = useGame((s) => s.setScreen);
  const [mismatch, setMismatch] = useState(false);
  const local = battle.localResult;
  const server = battle.summary?.result ?? null;
  useEffect(() => {
    if (local && server && local.hash !== server.hash) setMismatch(true);
  }, [local, server]);
  const result = server ?? local;
  const done = battle.phase === 'done';
  const close = () => {
    setBattle(null);
    setScreen(battle.replay ? 'attack' : 'village');
  };
  if (battle.replay) {
    return (
      <Modal label="Replay finished">
        <h2>Replay finished</h2>
        {result ? (
          <p>
            <Stars n={result.stars} /> {result.destructionPercent}% destroyed
          </p>
        ) : null}
        <div className="row end">
          <Button onClick={() => battleBridge.restartReplay?.()}>Watch again</Button>
          <Button tone="primary" onClick={close}>
            Close
          </Button>
        </div>
      </Modal>
    );
  }
  const rejected = battle.summary?.status === 'rejected';
  return (
    <Modal label="Battle result">
      <h2>
        {!done
          ? 'Checking the battle…'
          : rejected
            ? 'Battle rejected'
            : result && result.stars > 0
              ? 'Victory!'
              : 'Defeat'}
      </h2>
      {result ? (
        <p className="result-stars">
          <Stars n={result.stars} size={36} />
          <span className="pct">{result.destructionPercent}%</span>
        </p>
      ) : null}
      {!done ? <p className="muted">The server is re-running your battle to confirm the result.</p> : null}
      {rejected ? <p className="error">{battle.summary?.rejectReason}</p> : null}
      {battle.summary?.rewards && (battle.summary.rewards.gold || battle.summary.rewards.essence) ? (
        <p>
          Rewards: <CostView cost={battle.summary.rewards} />
        </p>
      ) : done && !rejected && battle.kind === 'campaign' ? (
        <p className="muted small">No new stars, so no new prizes this time.</p>
      ) : null}
      {battle.summary?.rewards?.trophies ? (
        <p>
          Trophies: {battle.summary.rewards.trophies > 0 ? '+' : ''}
          {battle.summary.rewards.trophies} 🏆
        </p>
      ) : null}
      {mismatch ? (
        <p className="muted small">
          The confirmed result differs from what your screen showed; the confirmed result counts.
        </p>
      ) : null}
      {battle.error ? <p className="warn">{battle.error}</p> : null}
      <div className="row end">
        <Button tone="primary" disabled={!done && !battle.error} onClick={close}>
          Return home
        </Button>
      </div>
    </Modal>
  );
}
