export function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host;
  return `${proto}://${host}`;
}

export function googleAuthConfig(origin: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: `${origin}/api/auth/google/callback`,
  };
}

export function googleStartUrl(origin: string, state: string) {
  const config = googleAuthConfig(origin);
  if (!config) return null;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export async function googleProfile(origin: string, code: string): Promise<{ sub: string; email: string } | null> {
  const config = googleAuthConfig(origin);
  if (!config) return null;
  const token = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!token.ok) return null;
  const body = (await token.json()) as { access_token?: string };
  if (!body.access_token) return null;
  const profile = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${body.access_token}` },
  });
  if (!profile.ok) return null;
  const user = (await profile.json()) as { sub?: string; email?: string; email_verified?: boolean };
  if (!user.sub || !user.email || user.email_verified === false) return null;
  return { sub: user.sub, email: user.email.trim().toLowerCase() };
}
