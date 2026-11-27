import { cookies } from 'next/headers';
import { randomUUID } from 'node:crypto';

const COOKIE = 'owner';

/** Anonymous device token — no registration. Persists "my projects" per browser. */
export async function getOwnerToken(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE)?.value;
  if (existing) return existing;

  const token = randomUUID();
  try {
    store.set(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/' });
  } catch {
    /* setting cookie may be disallowed in some contexts */
  }
  return token;
}