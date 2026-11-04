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
  days: string[];
  weekdays: number[];
  onTime: string | null;
  offTime: string | null;
  slots: ProgramSlot[];
  skippedDates?: string[];
};

export type ProgramSlot = {
  onTime: string | null;
  offTime: string | null;
  weekdays?: number[];
};

export type DayClock = {
  id: string;
  tenantId: string;
  programId: string | null;
  day: string;
  onTime: string | null;
  offTime: string | null;
  deviceIds: string[];
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
