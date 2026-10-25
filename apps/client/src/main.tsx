import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api/http.ts';
import { APP_VERSION, PLATFORM } from './platform/env.ts';
import './styles.css';
import { App } from './ui/App.tsx';

// Lightweight error monitoring within the free tier: reports go to our own API.
let reported = 0;
function report(message: string, stack?: string) {
  if (reported++ > 10) return;
  void api('/errors', {
    body: {
      message: message.slice(0, 2000),
      stack: stack?.slice(0, 8000),
      url: location.pathname,
      appVersion: APP_VERSION,
      platform: PLATFORM,
    },
    noRetry: true,
  }).catch(() => undefined);
}
window.addEventListener('error', (e) =>
  report(e.message, e.error instanceof Error ? e.error.stack : undefined),
);
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason as unknown;
  if (r && typeof r === 'object' && 'status' in r) return; // API errors are handled in the UI
  report(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined);
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
