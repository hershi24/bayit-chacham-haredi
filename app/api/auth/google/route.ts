import { randomBytes } from "node:crypto";
import { googleStartUrl, redirectWithCookies, requestOrigin } from "@/lib/auth/google";
import { cookieOptions } from "@/lib/session";

export const runtime = "nodejs";

export function GET(request: Request) {
  const origin = requestOrigin(request);
  const state = randomBytes(24).toString("hex");
  const target = googleStartUrl(origin, state);
  const cookie = `pikud_google_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${cookieOptions(600).secure ? "; Secure" : ""}`;
  if (!target) return redirectWithCookies(`${origin}/login?auth=google-unconfigured`, []);
  return redirectWithCookies(target, [cookie]);
}
