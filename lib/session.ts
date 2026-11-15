import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/cookie";
import { HttpError } from "@/lib/http-error";
import { isWlteError } from "@/lib/wlte/errors";
import { verifyPassword } from "@/lib/password";
import { createSession, deleteSession, findUserForLogin, readSession } from "@/lib/store";
import type { SessionUser } from "@/lib/types";

export { SESSION_COOKIE };

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

const SESSION_CACHE_MS = 30_000;
const sessionCache = (globalThis as unknown as { __pikudSessionCache?: Map<string, { user: SessionUser; until: number }> })
  .__pikudSessionCache ??= new Map();

async function lookupSession(id: string): Promise<SessionUser | null> {
  const cached = sessionCache.get(id);
  if (cached && cached.until > Date.now()) return cached.user;
  let lastError: unknown;
  // A slow or failed store read is not a logout; retry before giving up.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const user = await readSession(id);
      if (user) sessionCache.set(id, { user, until: Date.now() + SESSION_CACHE_MS });
      else sessionCache.delete(id);
      return user;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function requireUser(): Promise<SessionUser> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) throw new HttpError(401, "נדרשת התחברות");
  const user = await lookupSession(id);
  if (!user) throw new HttpError(401, "נדרשת התחברות");
  return user;
}

export function isUnauthorized(error: unknown) {
  return error instanceof HttpError && error.status === 401;
}

/** For server pages: only a missing or expired session goes to /login; store errors surface as errors. */
export async function pageUser(): Promise<SessionUser> {
  try {
    return await requireUser();
  } catch (error) {
    if (isUnauthorized(error)) redirect("/login");
    throw error;
  }
}

export function requireAdmin(user: SessionUser) {
  if (user.role !== "admin") throw new HttpError(403, "הפעולה שמורה למנהל");
}

export async function establishSession(username: string, password: string): Promise<SessionUser> {
  const account = await findUserForLogin(username.trim());
  if (!account || !verifyPassword(password, account.passwordHash)) {
    throw new HttpError(401, "שם המשתמש או הסיסמה שגויים");
  }
  const session = await createSession(account.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, session.id, cookieOptions(session.maxAge));
  return {
    id: account.id,
    username: account.username,
    name: account.name,
    role: account.role,
    tenantId: account.tenantId,
    tenantName: account.tenantName,
  };
}

export async function clearSession() {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) {
    sessionCache.delete(id);
    await deleteSession(id);
  }
  jar.set(SESSION_COOKIE, "", cookieOptions(0));
}

export function withErrors(work: () => Promise<Response> | Response): Promise<Response> {
  return Promise.resolve()
    .then(work)
    .catch((error: unknown) => {
      if (error instanceof HttpError) {
        return Response.json({ message: error.message }, { status: error.status });
      }
      if (isWlteError(error)) {
        const status = error.status === 404 || error.status === 409 || error.status === 422 ? error.status : 502;
        return Response.json({ message: error.message, code: error.code }, { status });
      }
      console.error("[pikud]", error);
      return Response.json({ message: "שגיאה פנימית" }, { status: 500 });
    });
}
