import { useEffect, useState, type FormEvent } from 'react';
import { auth } from '../../api/endpoints.ts';
import { api, ApiError, storeDesktopTokens } from '../../api/http.ts';
import { useGame } from '../../state/store.ts';
import { Button } from '../common.tsx';
import { UNOFFICIAL_NOTICE } from '../format.ts';

export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signedIn = useGame((s) => s.signedIn);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    api<{ ok: boolean }>('/health', { noRetry: true })
      .then(() => setUnreachable(false))
      .catch(() => setUnreachable(true));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === 'login'
          ? await auth.login(username, password, remember)
          : await auth.register(username, password, name);
      if (result.tokens) await storeDesktopTokens(result.tokens);
      await signedIn(result.user.username);
    } catch (err) {
      setError(err instanceof ApiError ? friendly(err) : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div className="brand">
          <img src="favicon.svg" alt="" width={56} height={56} />
          <div>
            <h1>Study Kingdom</h1>
            <p className="muted">Study to build. Build to conquer.</p>
          </div>
        </div>
        {unreachable ? (
          <p className="notice warn" role="alert">
            Can't reach the Study Kingdom server. Check your internet connection.
          </p>
        ) : null}
        <form className="stack" onSubmit={submit} noValidate>
          <div className="tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={mode === 'login' ? 'on' : ''}
              onClick={() => {
                setMode('login');
                setError(null);
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              className={mode === 'register' ? 'on' : ''}
              onClick={() => {
                setMode('register');
                setError(null);
              }}
            >
              Create account
            </button>
          </div>
          {mode === 'register' ? (
            <label>
              Kingdom name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                maxLength={24}
                required
                autoComplete="nickname"
              />
            </label>
          ) : null}
          <label>
            Username
            <input
              aria-label="Username"
              aria-describedby={mode === 'register' ? 'username-help' : undefined}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              minLength={3}
              maxLength={24}
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
            />
            {mode === 'register' ? (
              <span className="hint" id="username-help">
                3–24 letters, numbers or underscores. Usernames ignore capitals.
              </span>
            ) : null}
          </label>
          <label>
            Password
            <input
              type="password"
              aria-label="Password"
              aria-describedby={mode === 'register' ? 'password-help' : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'register' ? 10 : 1}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            />
            {mode === 'register' ? (
              <span className="hint" id="password-help">
                At least 10 characters.
              </span>
            ) : null}
          </label>
          {mode === 'login' ? (
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              Keep me signed in
            </label>
          ) : null}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <Button tone="primary" type="submit" busy={busy}>
            {mode === 'login' ? 'Sign in' : 'Create my kingdom'}
          </Button>
          <p className="muted small">
            {mode === 'register'
              ? 'Your kingdom opens immediately. Save your username and password.'
              : 'Forgot your password? Ask the person who invited you to reset it.'}
          </p>
        </form>
      </div>
      <p className="auth-foot muted small">
        Study Kingdom counts the time you study; it can't verify what you learn. Be honest with yourself —
        that's where the real reward is.
      </p>
      <p className="auth-foot muted small">{UNOFFICIAL_NOTICE}</p>
    </div>
  );
}

export function friendly(e: ApiError): string {
  if (e.code === 'bad_request' && Array.isArray(e.details)) {
    const first = (e.details as { message: string }[])[0];
    return first?.message ?? e.message;
  }
  return e.message;
}
