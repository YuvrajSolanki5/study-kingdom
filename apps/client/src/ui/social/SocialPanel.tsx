import { useEffect, useState } from 'react';
import type { LeagueStanding, SocialView } from '@sk/shared';
import { battles, social } from '../../api/endpoints.ts';
import { useGame } from '../../state/store.ts';
import { Button, Panel } from '../common.tsx';

export function SocialPanel() {
  const view = useGame((s) => s.view)!;
  const [data, setData] = useState<SocialView | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [invite, setInvite] = useState('');
  const [replayToken, setReplayToken] = useState('');
  const [scores, setScores] = useState<{ name: string; rows: LeagueStanding[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useGame((s) => s.toast);
  const load = () => social.view().then(setData);
  useEffect(() => {
    void load().catch((e) => toast(e.message, 'bad'));
    const t = setInterval(() => void load().catch(() => undefined), 30000);
    return () => clearInterval(t);
  }, [toast]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not complete action', 'bad');
    } finally {
      setBusy(false);
    }
  }
  async function attack(kind: 'friendly' | 'ranked', target?: string) {
    const r = await battles.start(kind, target);
    useGame.getState().setBattle({
      id: r.battle.id,
      kind,
      title: kind === 'ranked' ? 'Ranked raid' : 'Friendly challenge',
      setup: r.setup,
      phase: 'scouting',
      replay: false,
      commands: [],
      localResult: null,
      summary: null,
      error: null,
    });
  }
  return (
    <Panel title="Friends & study rooms" wide onClose={() => useGame.getState().setScreen('village')}>
      <p>
        Your friend code: <strong>{view.profile.friendCode}</strong>
      </p>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => social.friend(code));
        }}
      >
        <input
          aria-label="Friend code"
          placeholder="Friend code"
          value={code}
          maxLength={8}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
        />
        <Button busy={busy} type="submit">
          Add friend
        </Button>
      </form>
      {!data ? (
        <p>Loading…</p>
      ) : (
        <>
          <ul className="list">
            {data.friends.map((f) => (
              <li key={f.userId} className="stack">
                <div className="row between">
                  <strong>{f.displayName}</strong>
                  <span>
                    HQ {f.hqLevel} · 🏆 {f.trophies}
                  </span>
                </div>
                <div className="row wrap">
                  {f.accepted ? (
                    <>
                      <Button
                        busy={busy}
                        onClick={() =>
                          void run(async () => {
                            const v = await social.visit(f.userId);
                            useGame.getState().setVisit(v);
                          })
                        }
                      >
                        Visit
                      </Button>
                      <Button busy={busy} onClick={() => void run(() => social.challenge(f.userId))}>
                        Challenge
                      </Button>
                    </>
                  ) : f.incoming ? (
                    <Button
                      busy={busy}
                      onClick={() => void run(() => social.friendAction(f.userId, 'accept'))}
                    >
                      Accept request
                    </Button>
                  ) : (
                    <span className="muted">Request sent</span>
                  )}
                  <Button
                    busy={busy}
                    tone="ghost"
                    onClick={() => void run(() => social.friendAction(f.userId, 'remove'))}
                  >
                    {f.accepted ? 'Remove' : 'Decline / cancel'}
                  </Button>
                  <Button
                    busy={busy}
                    tone="ghost"
                    onClick={() => void run(() => social.friendAction(f.userId, 'block'))}
                  >
                    Block
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {!data.friends.length ? (
            <p className="muted">Share your code to study and compete with friends.</p>
          ) : null}
          {data.blocked.length ? (
            <details>
              <summary>Blocked players</summary>
              {data.blocked.map((p) => (
                <p key={p.userId}>
                  {p.displayName}{' '}
                  <Button onClick={() => void run(() => social.friendAction(p.userId, 'unblock'))}>
                    Unblock
                  </Button>
                </p>
              ))}
            </details>
          ) : null}
          <h3>Challenges</h3>
          <ul className="list">
            {data.challenges.map((c) => (
              <li key={c.id} className="row between">
                <span>
                  {c.senderName} → {c.recipientName}
                </span>
                {!c.battleId && c.recipient === view.profile.userId ? (
                  <Button busy={busy} onClick={() => void run(() => attack('friendly', c.id))}>
                    Accept challenge
                  </Button>
                ) : (
                  <span className="muted">{c.battleId ? 'Completed' : 'Waiting'}</span>
                )}
              </li>
            ))}
          </ul>
          <h3>Ranked raids</h3>
          <p className="small muted">
            Matched by HQ, army strength and trophies. Defenders keep their resources. Up to 20 raids daily;
            only the first 3 wins earn resources.
          </p>
          <Button busy={busy} onClick={() => void run(() => attack('ranked'))}>
            Find ranked opponent
          </Button>
          <h3>Weekly friend leagues</h3>
          <p className="small muted">
            UTC Monday–Sunday. Capped study credit and battle stars score points from the moment you join.
          </p>
          {data.leagues.map((l) => (
            <div className="row between" key={l.id}>
              <span>
                {l.name} · Invite: <code>{l.code}</code>
              </span>
              <Button
                onClick={() =>
                  void run(async () =>
                    setScores({ name: l.name, rows: (await social.standings(l.id)).standings }),
                  )
                }
              >
                Standings
              </Button>
            </div>
          ))}
          {scores ? (
            <>
              <h4>{scores.name}</h4>
              <ol>
                {scores.rows.map((s) => (
                  <li key={s.userId}>
                    {s.displayName}: <strong>{s.points} points</strong> · {s.studyMinutes} min · {s.stars}★
                  </li>
                ))}
              </ol>
            </>
          ) : null}
          <h3>Study room</h3>
          {data.room ? (
            <>
              <p>
                {data.room.name} · Invite: <code>{data.room.code}</code>
              </p>
              <ul>
                {data.room.members.map((m) => (
                  <li key={m.userId}>
                    {m.displayName} · {m.status}
                  </li>
                ))}
              </ul>
              <Button onClick={() => void run(social.leaveRoom)}>Leave room</Button>
            </>
          ) : (
            <p className="muted">Join a room to see friends focusing, taking a break or finishing.</p>
          )}
          <div className="stack">
            <label>
              New group name
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
            </label>
            <div className="row wrap">
              <Button
                busy={busy}
                disabled={name.trim().length < 2}
                onClick={() => void run(() => social.group('leagues', { name }))}
              >
                Create league
              </Button>
              <Button
                busy={busy}
                disabled={name.trim().length < 2}
                onClick={() => void run(() => social.group('rooms', { name }))}
              >
                Create room
              </Button>
            </div>
            <label>
              Group invite code
              <input value={invite} onChange={(e) => setInvite(e.target.value)} maxLength={16} />
            </label>
            <div className="row wrap">
              <Button
                busy={busy}
                disabled={invite.length !== 16}
                onClick={() => void run(() => social.group('leagues', { code: invite }))}
              >
                Join league
              </Button>
              <Button
                busy={busy}
                disabled={invite.length !== 16}
                onClick={() => void run(() => social.group('rooms', { code: invite }))}
              >
                Join room
              </Button>
            </div>
          </div>
        </>
      )}
      <h3>Shared replay</h3>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            const r = await social.replay(replayToken);
            useGame.getState().setBattle({
              id: r.battle.id,
              kind: r.battle.kind,
              title: 'Shared replay',
              setup: r.setup,
              commands: r.commands,
              replay: true,
              phase: 'fighting',
              localResult: null,
              summary: r.battle,
              error: null,
            });
          });
        }}
      >
        <input
          aria-label="Replay token"
          value={replayToken}
          onChange={(e) => setReplayToken(e.target.value)}
          placeholder="Paste replay token"
        />
        <Button busy={busy} type="submit">
          Watch replay
        </Button>
      </form>
    </Panel>
  );
}
