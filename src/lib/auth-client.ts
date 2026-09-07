"use client";

/**
 * Client-side session helpers.
 *
 * The server never sets a cookie — auth is a bearer token the client holds
 * (in localStorage) and attaches to requests itself. This module is the one
 * place that reads/writes that token, so nothing else touches localStorage
 * directly.
 *
 * Important: holding a token in localStorage only means "we were logged in
 * at some point." It doesn't mean the token still works — it may have
 * expired, or the server's secret may have rotated. `checkAuth()` is the
 * function that actually asks the server (GET /api/auth/me) whether the
 * token is still good, and clears it locally if not. Always prefer
 * `checkAuth()` over just checking `getToken()` truthiness before gating
 * access to something.
 */

const TOKEN_KEY = "veyra_token";
const USER_KEY = "veyra_user";

/** The subset of a User record that's safe/useful to cache client-side. */
export interface SessionUser {
  id: number;
  name: string | null;
  email: string;
  username: string | null;
}

/** Persists a session after a successful signup or login. */
export function saveSession(token: string, user: SessionUser): void {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/** Raw token getter. Prefer `checkAuth()` when the answer needs to be
 *  trustworthy rather than just "is something stored". */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

/** Last-known user info, cached from the most recent login/signup/checkAuth.
 *  May be stale — re-verify with `checkAuth()` before relying on it for
 *  anything security-sensitive. */
export function getCachedUser(): SessionUser | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(USER_KEY);
  return raw ? (JSON.parse(raw) as SessionUser) : null;
}

/** Clears the local session (logout, or a token that failed verification). */
export function clearSession(): void {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}

/**
 * Verifies the stored token against the server and returns the current
 * user, or `null` if there's no token or it's no longer valid (in which
 * case the stale local session is cleared automatically).
 *
 * This is the "background check" used before letting someone into a gated
 * action (e.g. the landing page's Create/Join buttons) or rendering a
 * protected page (e.g. /dashboard on direct navigation).
 */
export async function checkAuth(): Promise<SessionUser | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      clearSession();
      return null;
    }
    const data = (await res.json()) as { user: SessionUser };
    return data.user;
  } catch {
    // Network failure — don't wipe the session over a blip; just report
    // "couldn't confirm" so the caller can decide (typically: block anyway).
    return null;
  }
}

/** Convenience header object for authenticated fetch calls. */
export function authHeaders(): HeadersInit {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
