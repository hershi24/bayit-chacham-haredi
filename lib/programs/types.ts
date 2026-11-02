import type { RelayAction } from "@/lib/types";

export type StoredProgram = {
  id: string;
  tenantId: string;
  programKey: string;
  name: string;
  enabled: boolean;
  deviceIds: string[];
  startDate: string | null;
  endDate: string | null;
};

export type ProgramRun = {
  id: string;
  programId: string;
  deviceId: string;
  action: RelayAction;
  runAt: string;
  label: string;
  attempts: number;
};

export type ProgramRunInput = {
  deviceId: string;
  action: RelayAction;
  runAt: string;
  label: string;
};
