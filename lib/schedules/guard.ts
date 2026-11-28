/** One round at a time. A tick that arrives while the previous round is still running waits for the next interval. */
export function createRoundGuard() {
  let running = false;
  return async function run(job: () => Promise<void>): Promise<"ran" | "skipped"> {
    if (running) return "skipped";
    running = true;
    try {
      await job();
      return "ran";
    } finally {
      running = false;
    }
  };
}

/**
 * One round at a time, and a request that arrives in the middle runs once after the current round.
 * The later request replaces an earlier queued one, so two full scans never run together.
 */
export function createCoalescingGuard() {
  let running = false;
  let pending: (() => Promise<void>) | null = null;
  return async function run(job: () => Promise<void>): Promise<"ran" | "joined"> {
    if (running) {
      pending = job;
      return "joined";
    }
    running = true;
    try {
      let next: (() => Promise<void>) | null = job;
      while (next) {
        const current = next;
        pending = null;
        await current();
        next = pending;
      }
      return "ran";
    } finally {
      running = false;
    }
  };
}
