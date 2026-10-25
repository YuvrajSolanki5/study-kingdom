import { useGame } from '../state/store.ts';
import { Button } from './common.tsx';
/** A dismissible guide that leaves every game control accessible. */
export function Onboarding() {
  const view = useGame((s) => s.view),
    screen = useGame((s) => s.screen),
    visit = useGame((s) => s.visit),
    act = useGame((s) => s.act);
  if (
    !view ||
    view.state.tutorialStep >= 100 ||
    screen !== 'village' ||
    visit ||
    view.activeSession ||
    Object.values(view.state.campaign).some((n) => n > 0)
  )
    return null;
  const upgraded = view.state.buildings.some((b) => b.level > 1) || view.state.builders.some(Boolean);
  return (
    <aside className="onboarding" aria-label="Getting started">
      <strong>Welcome to your kingdom</strong>
      <p>Study earns Gold and Essence. Upgrade your village, train an army, then take on Bandit Camp.</p>
      <p className="small muted">
        Start with a 25 minute session. Computer study uses check-ins; paper study needs no keyboard activity.
      </p>
      <div className="row">
        <Button tone="primary" onClick={() => useGame.getState().setScreen(upgraded ? 'attack' : 'study')}>
          {upgraded ? 'Open campaign' : 'Start my first study'}
        </Button>
        <Button tone="ghost" onClick={() => void act({ type: 'tutorial', step: 100 })}>
          Got it
        </Button>
      </div>
    </aside>
  );
}
