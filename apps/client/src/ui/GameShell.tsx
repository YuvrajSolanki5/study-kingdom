import { Onboarding } from './Onboarding.tsx';
import { social } from '../api/endpoints.ts';
import { ClanPanel } from './clan/ClanPanel.tsx';
import { SocialPanel } from './social/SocialPanel.tsx';
import { useEffect } from 'react';
import { PhaserHost } from '../game/PhaserHost.tsx';
import { useGame } from '../state/store.ts';
import { ArmyPanel } from './army/ArmyPanel.tsx';
import { AttackPanel } from './battle/AttackPanel.tsx';
import { BattleHud } from './battle/BattleHud.tsx';
import { Toasts } from './common.tsx';
import { UpdatePrompt } from './desktop/UpdatePrompt.tsx';
import { HistoryPanel } from './history/HistoryPanel.tsx';
import { Hud, Nav } from './Hud.tsx';
import { SettingsPanel } from './settings/SettingsPanel.tsx';
import { BreakBanner, FocusOverlay } from './study/FocusOverlay.tsx';
import { StudyPanel } from './study/StudyPanel.tsx';
import { BuildingPanel } from './village/BuildingPanel.tsx';
import { VillageTools } from './village/VillageTools.tsx';

export function GameShell() {
  const visit = useGame((s) => s.visit);
  const screen = useGame((s) => s.screen);
  const battle = useGame((s) => s.battle);
  const tick = useGame((s) => s.tick);
  const refresh = useGame((s) => s.refresh);

  useEffect(() => {
    const t = setInterval(tick, 1000);
    const onVisible = () => document.visibilityState === 'visible' && void refresh().catch(() => undefined);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [tick, refresh]);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      try {
        await social.presence();
        if (stopped || useGame.getState().view?.activeSession?.status === 'running') return;
        const { notifications } = await social.notifications();
        if (stopped) return;
        for (const n of notifications) useGame.getState().notify(n.message);
        if (notifications.length) await social.read(notifications[notifications.length - 1]!.id);
      } catch {
        /* Retry after reconnect. */
      }
    };
    void poll();
    const t = setInterval(() => void poll(), 45000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="shell">
      <PhaserHost />
      {battle ? (
        <BattleHud />
      ) : (
        <>
          <Hud />
          <BreakBanner />
          <Onboarding />
          <main className="stage">
            {visit ? (
              <div className="visit-banner">
                <strong>Visiting {visit.displayName}</strong>
                <button className="btn" onClick={() => useGame.getState().setVisit(null)}>
                  Return home
                </button>
              </div>
            ) : null}
            {screen === 'clan' ? <ClanPanel /> : null}
            {screen === 'social' ? <SocialPanel /> : null}
            {screen === 'village' && !visit ? (
              <>
                <VillageTools />
                <BuildingPanel />
              </>
            ) : null}
            {screen === 'study' ? <StudyPanel /> : null}
            {screen === 'army' ? <ArmyPanel /> : null}
            {screen === 'attack' ? <AttackPanel /> : null}
            {screen === 'history' ? <HistoryPanel /> : null}
            {screen === 'settings' ? <SettingsPanel /> : null}
          </main>
          <Nav />
          <FocusOverlay />
        </>
      )}
      <UpdatePrompt />
      <Toasts />
    </div>
  );
}
