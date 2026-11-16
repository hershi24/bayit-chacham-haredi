import { randomBytes } from "node:crypto";
import { googleStartUrl, requestOrigin } from "@/lib/auth/google";
import { cookieOptions } from "@/lib/session";

export const runtime = "nodejs";

export function GET(request: Request) {
  const origin = requestOrigin(request);
  const state = randomBytes(24).toString("hex");
  const target = googleStartUrl(origin, state);
  if (!target) {
    return Response.redirect(`${origin}/login?auth=google-unconfigured`);
  }
  const response = Response.redirect(target);
  response.headers.append(
    "Set-Cookie",
    `pikud_google_state=${state}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${cookieOptions(600).secure ? "; Secure" : ""}`,
  );
  return response;
}
