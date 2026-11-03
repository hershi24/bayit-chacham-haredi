import type { NextPlan, RelayAction } from "@/lib/types";

export type PlanItem = {
  deviceId: string;
  at: string;
  action: RelayAction;
};

export function earliestPlan(items: PlanItem[]): Map<string, NextPlan> {
  const plans = new Map<string, NextPlan>();
  for (const item of items) {
    const current = plans.get(item.deviceId);
    if (!current || item.at < current.at) plans.set(item.deviceId, { at: item.at, action: item.action });
  }
  return plans;
}
