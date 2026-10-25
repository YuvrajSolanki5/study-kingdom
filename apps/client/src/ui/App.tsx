import { useEffect } from 'react';
import { IS_DESKTOP } from '../platform/env.ts';
import { useGame } from '../state/store.ts';
import { AuthScreen } from './auth/AuthScreen.tsx';
import { Toasts } from './common.tsx';
import { GameShell } from './GameShell.tsx';
import '../study/controller.ts';

export function App() {
  const status = useGame((s) => s.auth);
  const view = useGame((s) => s.view);
  const boot = useGame((s) => s.boot);
  useEffect(() => {
    void boot();
  }, [boot]);

  if (status === 'loading' || (status === 'signed_in' && !view)) {
    return (
      <div className="splash" aria-busy>
        <img src={IS_DESKTOP ? 'favicon.svg' : '/favicon.svg'} alt="" width={72} height={72} />
        <p>Opening the gates…</p>
      </div>
    );
  }
  if (status === 'signed_out')
    return (
      <>
        <AuthScreen />
        <Toasts />
      </>
    );
  return <GameShell />;
}
