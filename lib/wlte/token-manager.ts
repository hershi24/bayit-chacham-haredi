import { missingScopes, tokenNeedsRefresh } from "@/lib/wlte/policy";

export type IssuedToken = {
  accessToken: string;
  expiresIn: number;
  scopes: string[];
  clientId: string;
};

export type CachedToken = IssuedToken & {
  issuedAt: number;
  expiresAt: number;
};

export class TokenManager {
  private current: CachedToken | null = null;
  private pending: Promise<CachedToken> | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly fetchToken: () => Promise<IssuedToken>,
    private readonly now: () => number = Date.now,
  ) {}

  async get(force = false): Promise<CachedToken> {
    if (!force && this.current && !tokenNeedsRefresh(this.current, this.now())) {
      return this.current;
    }
    if (!this.pending) {
      this.pending = this.issue();
    }
    return this.pending;
  }

  status(): {
    state: "missing" | "valid" | "error";
    expiresAt: string | null;
    scopes: string[];
    missingScopes: string[];
    lastError: string | null;
  } {
    const token = this.current;
    const expired = !token || tokenNeedsRefresh(token, this.now());
    return {
      state: this.lastError && expired ? "error" : token && !expired ? "valid" : "missing",
      expiresAt: token ? new Date(token.expiresAt).toISOString() : null,
      scopes: token?.scopes ?? [],
      missingScopes: missingScopes(token?.scopes ?? []),
      lastError: this.lastError,
    };
  }

  private async issue(): Promise<CachedToken> {
    try {
      const issued = await this.fetchToken();
      const issuedAt = this.now();
      const expiresIn = Number.isFinite(issued.expiresIn) ? issued.expiresIn : 3600;
      const token: CachedToken = {
        ...issued,
        expiresIn,
        issuedAt,
        expiresAt: issuedAt + expiresIn * 1000,
      };
      this.current = token;
      this.lastError = null;
      return token;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "הנפקת האסימון נכשלה";
      throw error;
    } finally {
      this.pending = null;
    }
  }
}
