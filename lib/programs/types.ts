import type { ClockAction } from "@/lib/programs/actions";
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
  /** When set, the program does not run on Israel yom tov. Chanukah and Purim still run. */
  skipHolidays?: boolean;
};

export type ProgramSlot = {
  onTime: string | null;
  offTime: string | null;
  /** Chosen actions, in the order they should run. Missing means the older on-then-off pair. */
  actions?: ClockAction[];
  weekdays?: number[];
  /** The date chosen for this clock. Its weekday is the day the clock runs. */
  date?: string | null;
  /** When set, this clock runs only on these devices. Empty or missing means the program's devices. */
  deviceIds?: string[];
};

export type DayClock = {
  id: string;
  tenantId: string;
  programId: string | null;
  day: string;
  onTime: string | null;
  offTime: string | null;
  actions?: ClockAction[];
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
