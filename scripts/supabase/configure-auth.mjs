// Configure username/password accounts: immediate sign-in, no mail, rotated sessions.
// SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... SITE_URL=https://... node scripts/supabase/configure-auth.mjs
const env = (key) => {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
  return process.env[key];
};
const siteUrl = env('SITE_URL').replace(/\/$/, '');
if (!siteUrl.startsWith('https://')) throw new Error('SITE_URL must be https:// in production');
const body = {
  site_url: siteUrl,
  uri_allow_list: '',
  disable_signup: false,
  external_email_enabled: true,
  mailer_autoconfirm: true,
  mailer_secure_email_change_enabled: true,
  password_min_length: 10,
  jwt_exp: 3600,
  refresh_token_rotation_enabled: true,
  security_refresh_token_reuse_interval: 10,
  rate_limit_email_sent: 0,
  mailer_notifications_password_changed_enabled: false,
  smtp_host: '',
  smtp_user: '',
  smtp_pass: '',
  smtp_admin_email: '',
};
if (process.env.DRY_RUN) {
  console.log(JSON.stringify(body, null, 2));
  process.exit(0);
}
const ref = env('SUPABASE_PROJECT_REF');
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/config/auth`, {
  method: 'PATCH',
  headers: { authorization: `Bearer ${env('SUPABASE_ACCESS_TOKEN')}`, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
if (!res.ok) throw new Error(`Auth configuration failed (HTTP ${res.status})`);
const applied = await res.json();
if (!applied.mailer_autoconfirm || applied.rate_limit_email_sent !== 0)
  throw new Error('Auth settings were not applied');
console.log(`Username accounts configured for ${ref}; no email delivery or confirmation.`);
