declare const __APP_VERSION__: string;
declare const __PLATFORM__: 'web' | 'desktop';

export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev';

/** True inside the Tauri webview (desktop build, or `tauri dev` pointing at Vite). */
export const IS_DESKTOP: boolean =
  (typeof __PLATFORM__ === 'string' && __PLATFORM__ === 'desktop') ||
  (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window);

export const PLATFORM: 'web' | 'desktop' = IS_DESKTOP ? 'desktop' : 'web';

/**
 * Web uses the same origin (Workers serves both). The desktop app talks to the
 * deployed API; override with VITE_API_URL for local development.
 */
export const API_BASE: string = IS_DESKTOP
  ? ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787').replace(/\/$/, '')
  : '';
