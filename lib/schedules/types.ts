export type ScheduleKind = "timer_off" | "later_on";

export type PendingSchedule = {
  id: string;
  deviceId: string;
  kind: ScheduleKind;
  runAt: string;
  attempts: number;
};
