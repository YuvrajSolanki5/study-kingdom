Email templates use Supabase Auth (GoTrue) Go template variables.
Links point to client pages that POST the token hash (`/auth/confirm`, `/auth/reset`),
so mail scanners that prefetch links cannot consume single-use tokens.
