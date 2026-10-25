import { Username } from '@sk/shared';

// Supabase's password provider uses an email-shaped identifier internally.
// This reserved, non-deliverable address contains no personal email address.
const SUFFIX = '@accounts.studykingdom.invalid';

export function accountAddress(username: string): string {
  return `${Username.parse(username)}${SUFFIX}`;
}

export function usernameFromAddress(address: string | undefined): string | null {
  if (!address?.endsWith(SUFFIX)) return null;
  const username = address.slice(0, -SUFFIX.length);
  const parsed = Username.safeParse(username);
  return parsed.success && parsed.data === username ? username : null;
}
