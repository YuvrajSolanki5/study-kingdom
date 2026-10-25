import { useEffect, useState } from 'react';
import type { ClanView, FriendView } from '@sk/shared';
import { battles, clans, social } from '../../api/endpoints.ts';
import { contentOf, useGame } from '../../state/store.ts';
import { Button, Panel, Progress } from '../common.tsx';

export function ClanPanel() {
  const view = useGame((s) => s.view)!,
    toast = useGame((s) => s.toast);
  const [data, setData] = useState<ClanView | null>(null),
    [friends, setFriends] = useState<FriendView[]>([]);
  const [name, setName] = useState(''),
    [enemy, setEnemy] = useState(''),
    [roster, setRoster] = useState<string[]>([]);
  const [troop, setTroop] = useState('swordsman'),
    [count, setCount] = useState(1),
    [busy, setBusy] = useState(false);
  const load = async () => {
    setData(await clans.view());
  };
  useEffect(() => {
    void load().catch((e) => toast(e.message, 'bad'));
    void social
      .view()
      .then((r) => setFriends(r.friends.filter((f) => f.accepted)))
      .catch(() => undefined);
    const t = setInterval(() => void load().catch(() => undefined), 30000);
    return () => clearInterval(t);
  }, [toast]);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      await load();
      await useGame.getState().refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Action failed', 'bad');
    } finally {
      setBusy(false);
    }
  }
  const me = data?.members.find((m) => m.userId === view.profile.userId),
    canManage = me?.role === 'leader' || me?.role === 'officer';
  return (
    <Panel title="Clan" wide onClose={() => useGame.getState().setScreen('village')}>
      {!data ? (
        <p>Loading…</p>
      ) : !data.clan ? (
        <>
          <p>Study together, share reinforcements and fight direct 5v5 wars. Clans hold up to 20 members.</p>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => clans.create(name));
            }}
          >
            <input
              aria-label="Clan name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              minLength={2}
              maxLength={40}
              required
            />
            <Button busy={busy} type="submit">
              Create clan
            </Button>
          </form>
          <h3>Invitations</h3>
          {data.invites.length ? (
            data.invites.map((i) => (
              <div className="row between" key={i.id}>
                {i.name}
                <Button busy={busy} onClick={() => void run(() => clans.join(i.id))}>
                  Join clan
                </Button>
              </div>
            ))
          ) : (
            <p className="muted">Ask a friend’s clan leader for an invitation.</p>
          )}
        </>
      ) : (
        <>
          <h3>{data.clan.name}</h3>
          <p className="small">
            Clan ID for war challenges: <code>{data.clan.id}</code>
          </p>
          <ul className="list">
            {data.members.map((m) => (
              <li className="row between" key={m.userId}>
                <span>
                  {m.displayName} · {m.role}
                </span>
                {m.userId !== view.profile.userId && canManage ? (
                  <div className="row wrap">
                    {me?.role === 'leader' ? (
                      <>
                        <Button
                          busy={busy}
                          onClick={() =>
                            void run(() => clans.role(m.userId, m.role === 'officer' ? 'member' : 'officer'))
                          }
                        >
                          {m.role === 'officer' ? 'Make member' : 'Make officer'}
                        </Button>
                        <Button busy={busy} onClick={() => void run(() => clans.role(m.userId, 'leader'))}>
                          Transfer leadership
                        </Button>
                      </>
                    ) : null}
                    <Button tone="ghost" busy={busy} onClick={() => void run(() => clans.remove(m.userId))}>
                      Remove
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {canManage ? (
            <details>
              <summary>Invite friends</summary>
              {friends.map((f) => (
                <p key={f.userId}>
                  {f.displayName}{' '}
                  <Button busy={busy} onClick={() => void run(() => clans.invite(f.userId))}>
                    Invite to clan
                  </Button>
                </p>
              ))}
            </details>
          ) : null}
          <h3>Shared weekly study objective</h3>
          {data.objective ? (
            <>
              <p>
                {data.objective.minutes} / {data.objective.targetMinutes} minutes
              </p>
              <Progress
                value={Math.min(1, data.objective.minutes / Math.max(1, data.objective.targetMinutes))}
              />
              <p className="small muted">
                The weekly roster is fixed when this week’s objective begins. Each member contributes up to
                600 competitive minutes.
              </p>
              <Button
                busy={busy}
                disabled={data.objective.claimed || data.objective.minutes < data.objective.targetMinutes}
                onClick={() => void run(clans.objective)}
              >
                {data.objective.claimed ? 'Cosmetic collected' : 'Collect study crest'}
              </Button>
            </>
          ) : null}
          <h3>Reinforcements</h3>
          <p className="small muted">
            Donate ready troops from your army. Claim donations into your Clan Hall before a battle.
          </p>
          <Button busy={busy} onClick={() => void run(clans.request)}>
            Request reinforcements
          </Button>
          <div className="row">
            <label>
              Troop
              <select value={troop} onChange={(e) => setTroop(e.target.value)}>
                {Object.keys(view.state.army.troops)
                  .filter(
                    (id) => (view.state.army.troops[id as keyof typeof view.state.army.troops] ?? 0) > 0,
                  )
                  .map((id) => (
                    <option key={id} value={id}>
                      {contentOf(view).troops[id]?.name ?? id}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Count
              <input
                type="number"
                min={1}
                max={30}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
          </div>
          <ul className="list">
            {data.requests.map((r) => (
              <li className="row between" key={r.id}>
                <span>
                  {r.displayName}: {r.housing}/{r.capacity} housing
                </span>
                {r.userId === view.profile.userId ? (
                  <Button busy={busy} disabled={!r.housing} onClick={() => void run(() => clans.claim(r.id))}>
                    Claim troops
                  </Button>
                ) : (
                  <Button
                    busy={busy}
                    disabled={r.housing >= r.capacity}
                    onClick={() => void run(() => clans.donate(r.id, troop, count))}
                  >
                    Donate
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <h3>Clan wars</h3>
          {canManage ? (
            <>
              <p className="small muted">
                Choose five members for a direct challenge or to accept an invitation. Preparation lasts 12
                hours, followed by 24 hours of battle.
              </p>
              <div className="row wrap">
                {data.members.map((m) => (
                  <label key={m.userId}>
                    <input
                      type="checkbox"
                      checked={roster.includes(m.userId)}
                      disabled={!roster.includes(m.userId) && roster.length >= 5}
                      onChange={(e) =>
                        setRoster(
                          e.target.checked ? [...roster, m.userId] : roster.filter((id) => id !== m.userId),
                        )
                      }
                    />
                    {m.displayName}
                  </label>
                ))}
              </div>
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => clans.war(enemy, roster));
                }}
              >
                <input
                  aria-label="Opponent clan ID"
                  placeholder="Opponent clan ID"
                  value={enemy}
                  onChange={(e) => setEnemy(e.target.value)}
                />
                <Button busy={busy} disabled={roster.length !== 5 || !enemy} type="submit">
                  Challenge clan
                </Button>
              </form>
            </>
          ) : null}
          {data.wars.map((w) => (
            <article className="war-card stack" key={w.id}>
              <strong>
                {w.homeName} vs {w.awayName}
              </strong>
              <span>
                {w.status}
                {w.preparationUntil && w.status === 'preparation'
                  ? ` · Battle starts ${new Date(w.preparationUntil).toLocaleString()}`
                  : ''}
                {w.battleUntil && w.status === 'battle'
                  ? ` · Ends ${new Date(w.battleUntil).toLocaleString()}`
                  : ''}
              </span>
              {w.status === 'invited' && w.away === data.clan!.id && canManage ? (
                <div className="row">
                  <Button
                    busy={busy}
                    disabled={roster.length !== 5}
                    onClick={() => void run(() => clans.respond(w.id, roster))}
                  >
                    Accept war
                  </Button>
                  <Button busy={busy} onClick={() => void run(() => clans.respond(w.id, null))}>
                    Decline war
                  </Button>
                </div>
              ) : null}
              {w.result ? (
                <p>
                  {w.result.homeStars}★ ({w.result.homeDestruction / 5}%) : {w.result.awayStars}★ (
                  {w.result.awayDestruction / 5}%) ·{' '}
                  {w.result.winner === null
                    ? 'Draw'
                    : w.result.winner === data.clan!.id
                      ? 'Victory'
                      : 'Defeat'}
                </p>
              ) : null}
              {w.roster.length ? (
                <>
                  <p className="small">
                    Your attacks: {w.attacks.filter((a) => a.attacker === view.profile.userId).length}/2. Best
                    result per enemy base counts.
                  </p>
                  <ul>
                    {w.roster
                      .filter((r) => r.clanId !== data.clan!.id)
                      .map((r) => (
                        <li key={r.userId} className="row between">
                          <span>
                            {r.position}. {r.displayName} · Keep {r.hqLevel}
                          </span>
                          {w.status === 'battle' && w.roster.some((r) => r.userId === view.profile.userId) ? (
                            <Button
                              busy={busy}
                              disabled={
                                w.attacks.filter((a) => a.attacker === view.profile.userId).length >= 2
                              }
                              onClick={() =>
                                void run(async () => {
                                  const b = await battles.start('war', `${w.id}:${r.userId}`);
                                  useGame.getState().setBattle({
                                    id: b.battle.id,
                                    kind: 'war',
                                    title: `War: ${r.displayName}`,
                                    setup: b.setup,
                                    phase: 'scouting',
                                    replay: false,
                                    commands: [],
                                    localResult: null,
                                    summary: null,
                                    error: null,
                                  });
                                })
                              }
                            >
                              Attack war base
                            </Button>
                          ) : null}
                        </li>
                      ))}
                  </ul>
                </>
              ) : null}
            </article>
          ))}
          <Button tone="ghost" busy={busy} onClick={() => void run(clans.leave)}>
            Leave clan
          </Button>
        </>
      )}
      {data?.cosmetics.length ? (
        <details>
          <summary>Earned crests ({data.cosmetics.length})</summary>
          <ul>
            {data.cosmetics.map((c) => (
              <li key={c}>{c.startsWith('war:') ? 'War victory crest' : `Study crest · ${c.slice(6)}`}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}
