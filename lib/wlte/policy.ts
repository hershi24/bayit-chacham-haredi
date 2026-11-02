export const REQUIRED_SCOPES = [
  "device:read",
  "device:control",
  "device:manage",
  "device:config",
] as const;

export const TOKEN_REFRESH_AFTER_MS = 50 * 60 * 1000;
export const TOKEN_EXPIRY_SAFETY_MS = 60 * 1000;

export type TokenClock = {
  issuedAt: number;
  expiresAt: number;
};

export function missingScopes(granted: readonly string[]): string[] {
  return REQUIRED_SCOPES.filter((scope) => !granted.includes(scope));
}

export function tokenNeedsRefresh(token: TokenClock | null, now: number): boolean {
  if (!token) return true;
  if (now - token.issuedAt >= TOKEN_REFRESH_AFTER_MS) return true;
  if (now >= token.expiresAt - TOKEN_EXPIRY_SAFETY_MS) return true;
  return false;
}
