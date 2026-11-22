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
  updatedAt: string;
};
