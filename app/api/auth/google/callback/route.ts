import { googleProfile, requestOrigin } from "@/lib/auth/google";
import { cookieOptions, SESSION_COOKIE } from "@/lib/session";
import { createSession, findUserIdByEmail, findUserIdByGoogleSub, linkGoogleAccount } from "@/lib/store";

export const runtime = "nodejs";

function stateFromCookie(request: Request) {
  const header = request.headers.get("cookie") ?? "";
  const match = header.match(/(?:^|;\s*)pikud_google_state=([^;]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function cookie(name: string, value: string, maxAge: number) {
  const secure = cookieOptions(maxAge).secure ? "; Secure" : "";
  return `${name}=${value}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export async function GET(request: Request) {
  const origin = requestOrigin(request);
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const fail = (reason: string) => {
    const response = Response.redirect(`${origin}/login?auth=${reason}`);
    response.headers.append("Set-Cookie", cookie("pikud_google_state", "", 0));
    return response;
  };
  if (!code || !state || state !== stateFromCookie(request)) return fail("google-failed");

  const profile = await googleProfile(origin, code);
  if (!profile) return fail("google-failed");

  try {
    const linked = await findUserIdByGoogleSub(profile.sub);
    const userId = linked ?? (await findUserIdByEmail(profile.email));
    if (!userId) return fail("google-unknown");
    if (!linked) await linkGoogleAccount(userId, profile.sub, profile.email);
    const session = await createSession(userId);
    const response = Response.redirect(`${origin}/`);
    response.headers.append("Set-Cookie", cookie(SESSION_COOKIE, session.id, session.maxAge));
    response.headers.append("Set-Cookie", cookie("pikud_google_state", "", 0));
    return response;
  } catch {
    return fail("google-failed");
  }
}
