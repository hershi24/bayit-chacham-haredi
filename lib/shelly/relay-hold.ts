/** Ignore a switch reading that disagrees with a command this recently. */
export const RELAY_HOLD_MS = 15_000;

export type RelayHold = { on: boolean; at: number };

/** A status sample from before the command must not paint the old relay back. */
export function staleRelayReport(hold: RelayHold | undefined, reportedOn: boolean, now: number): boolean {
  return Boolean(hold && now - hold.at < RELAY_HOLD_MS && reportedOn !== hold.on);
}
