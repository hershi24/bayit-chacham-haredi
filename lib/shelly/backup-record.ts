export type ShellyBackupRow = {
  shellyId: string;
  tenantId: string;
  status: "idle" | "pending" | "verified" | "failed";
  mode: "schedule" | "script" | null;
  windowStart: string | null;
  windowEnd: string | null;
  windowLabel: string | null;
  planHash: string | null;
  actionCount: number;
  /** Exact script and schedule calls last written to the device. */
  planCode: string | null;
  scheduleIds: number[];
  syncedAt: string | null;
  verifiedAt: string | null;
  error: string | null;
  attempts: number;
  alertedAt: string | null;
  /** The site checks about once a month that this Shelly is online and still holds the plan. */
  watch: boolean;
  checkedAt: string | null;
  nextCheckAt: string | null;
  updatedAt: string;
};

/** Fields the due loop needs. The full row stays for the write that installs a plan. */
export type ShellyBackupGate = {
  status: ShellyBackupRow["status"];
  windowStart: string | null;
  windowEnd: string | null;
  watch: boolean;
  nextCheckAt: string | null;
};

export function sameShellyBackup(left: ShellyBackupRow, right: ShellyBackupRow): boolean {
  return (
    left.shellyId === right.shellyId &&
    left.tenantId === right.tenantId &&
    left.status === right.status &&
    left.mode === right.mode &&
    left.windowStart === right.windowStart &&
    left.windowEnd === right.windowEnd &&
    left.windowLabel === right.windowLabel &&
    left.planHash === right.planHash &&
    left.actionCount === right.actionCount &&
    left.planCode === right.planCode &&
    left.scheduleIds.length === right.scheduleIds.length &&
    left.scheduleIds.every((id, index) => id === right.scheduleIds[index]) &&
    left.syncedAt === right.syncedAt &&
    left.verifiedAt === right.verifiedAt &&
    left.error === right.error &&
    left.attempts === right.attempts &&
    left.alertedAt === right.alertedAt &&
    left.watch === right.watch &&
    left.checkedAt === right.checkedAt &&
    left.nextCheckAt === right.nextCheckAt
  );
}
