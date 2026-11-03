import { randomUUID } from "node:crypto";
import type { DayClock } from "@/lib/programs/types";

export function resolveDateClocks(programId: string, tenantId: string, clocks: DayClock[], existing: DayClock[]): DayClock[] {
  const owned = new Set(existing.filter((clock) => clock.programId === programId).map((clock) => clock.id));
  const taken = new Set(existing.map((clock) => clock.id));
  const used = new Set<string>();
  return clocks.map((clock) => {
    const requested = clock.id.trim();
    const reusable = Boolean(requested && !used.has(requested) && (owned.has(requested) || !taken.has(requested)));
    const id = reusable ? requested : `clk_${randomUUID()}`;
    used.add(id);
    taken.add(id);
    return { ...clock, id, tenantId, programId };
  });
}
