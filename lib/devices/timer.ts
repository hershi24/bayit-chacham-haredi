import { clockFace, nextJerusalemClock, offClock } from "@/lib/time";

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

function mark(value: string) {
  return `\u2066${value}\u2069`;
}

export function timerInstants(
  input: { minutes: number; start: "now" | string },
  now = new Date(),
): { onAt: string | null; offAt: string } {
  if (!Number.isInteger(input.minutes) || input.minutes < 1 || input.minutes > 720) {
    throw new Error("משך הטיימר חייב להיות בין דקה ל-12 שעות");
  }
  if (input.start === "now") {
    return { onAt: null, offAt: new Date(now.getTime() + input.minutes * 60_000).toISOString() };
  }
  const clock = CLOCK.exec(input.start);
  if (!clock) throw new Error("השעה אינה תקינה");
  const on = nextJerusalemClock(Number(clock[1]), Number(clock[2]), now);
  return {
    onAt: on.at.toISOString(),
    offAt: new Date(on.at.getTime() + input.minutes * 60_000).toISOString(),
  };
}

export function timerMessage(input: {
  mode: "now" | "later";
  minutes: number;
  onAt: string | null;
  offAt: string;
}): string {
  if (input.mode === "now") {
    const unit = input.minutes === 1 ? "דקה" : "דקות";
    return `השקע יופעל עכשיו ויכבה בעוד ${input.minutes} ${unit}`;
  }
  if (!input.onAt) throw new Error("השעה אינה תקינה");
  return `השקע יופעל בשעה ${mark(clockFace(input.onAt))} ויכבה בשעה ${mark(offClock(input.onAt, input.offAt))}`;
}
