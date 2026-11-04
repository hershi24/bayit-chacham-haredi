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
  private pendingGeneration = 0;
  private generation = 0;
  private lastError: string | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly fetchToken: () => Promise<IssuedToken>,
    private readonly now: () => number = Date.now,
  ) {}

  async get(force = false): Promise<CachedToken> {
    const run = this.chain.then(() => this.read(force));
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async read(force: boolean): Promise<CachedToken> {
    if (force) {
      this.generation += 1;
      this.current = null;
      this.pending = null;
    }
    if (!force && this.current && !tokenNeedsRefresh(this.current, this.now())) {
      return this.current;
    }
    const generation = this.generation;
    if (!this.pending || this.pendingGeneration !== generation) {
      this.pendingGeneration = generation;
      this.pending = this.issue(generation);
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

  private async issue(generation: number): Promise<CachedToken> {
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
      if (generation !== this.generation) {
        if (this.current) return this.current;
        throw new Error("האסימון שנדחה לא ישמש שוב");
      }
      this.current = token;
      this.lastError = null;
      return token;
    } catch (error) {
      if (generation === this.generation) {
        this.lastError = error instanceof Error ? error.message : "הנפקת האסימון נכשלה";
      }
      throw error;
    } finally {
      if (this.pendingGeneration === generation) this.pending = null;
    }
  }
}
