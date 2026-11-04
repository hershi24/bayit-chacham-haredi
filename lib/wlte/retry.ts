import { isTokenRejection } from "@/lib/wlte/errors";

export type RetryDecision = "return" | "retry-same-key" | "refresh-then-retry";

export function retryDecision(input: {
  status?: number;
  code?: string;
  networkError: boolean;
  refreshed: boolean;
  retries: number;
}): RetryDecision {
  const tokenRejected = isTokenRejection(input.status, input.code);
  if (!input.networkError && input.status !== undefined && input.status < 400 && !tokenRejected) {
    return "return";
  }
  if (tokenRejected && !input.refreshed) return "refresh-then-retry";
  if (tokenRejected && input.refreshed) return "return";

  const retryable =
    input.networkError ||
    input.status === 429 ||
    input.status === 500 ||
    input.status === 503 ||
    (input.status === 409 && input.code === "DEVICE_BUSY");

  if (retryable && input.retries < 2) return "retry-same-key";
  return "return";
}

export type AttemptResult = {
  networkError?: boolean;
  status?: number;
  code?: string;
  retryAfterSeconds?: number;
  body?: unknown;
};

export async function runIdempotent(
  attempt: () => Promise<AttemptResult>,
  refresh: () => Promise<void>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<AttemptResult> {
  let refreshed = false;
  let retries = 0;

  for (let index = 0; index < 6; index += 1) {
    let result: AttemptResult;
    try {
      result = await attempt();
    } catch {
      result = { networkError: true };
    }

    const decision = retryDecision({
      status: result.status,
      code: result.code,
      networkError: Boolean(result.networkError),
      refreshed,
      retries,
    });

    if (decision === "return") return result;
    if (decision === "refresh-then-retry") {
      await refresh();
      refreshed = true;
      continue;
    }

    retries += 1;
    const wait =
      result.status === 429
        ? Math.min((result.retryAfterSeconds ?? 1) * 1000, 5000)
        : 400 * retries;
    await sleep(wait);
  }

  return { networkError: true, code: "RETRY_EXHAUSTED" };
}

export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}
