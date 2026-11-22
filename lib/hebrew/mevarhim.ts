const ENDPOINT = "https://mevarhim.co.il/wp-json/mevarhim/v1";
const TTL_MS = 12 * 60 * 60 * 1000;

export const MEVARHIM_CREDIT = "זמנים מאתר מברכים";
export const MEVARHIM_URL = "https://mevarhim.co.il/";

const SLUGS: Record<string, string> = {
  jerusalem: "jerusalem",
  "bnei-brak": "bnei-brak",
  "tel-aviv": "tel-aviv",
  elad: "elad",
  "beit-shemesh": "beit-shemesh",
  beitar: "beitar-illit",
  "modiin-illit": "modiin-illit",
  "petach-tikva": "petah-tikva",
  ashdod: "ashdod",
  haifa: "haifa",
  tzfat: "tzfat",
  "beer-sheva": "beer-sheva",
  tiberias: "tiberias",
  eilat: "eilat",
};

type Getter = (path: string) => Promise<unknown>;
type Timed = { time?: string; iso?: string };
type CacheEntry = { at: number; body: unknown };

const cache = new Map<string, CacheEntry>();
let getter: Getter = liveGet;

export function mevarhimCity(locationId: string): string {
  return SLUGS[locationId] ?? "jerusalem";
}

export function setMevarhimGetter(next: Getter | null) {
  getter = next ?? liveGet;
  cache.clear();
}

export async function applyMevarhimTimes(input: {
  locationId: string;
  from: string;
  to: string;
  candles: Map<string, Date>;
  havdalah: Map<string, Date>;
  yomTovDays: readonly string[];
  everyDay: boolean;
}): Promise<{ sunset: Map<string, string>; tzeit: Map<string, string>; rabbeinuTam: Map<string, string> } | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to) || input.from > input.to) return null;
  const city = mevarhimCity(input.locationId);
  const sunset = new Map<string, string>();
  const tzeit = new Map<string, string>();
  const sunsetAt = new Map<string, Date>();
  const tzeitAt = new Map<string, Date>();
  const rabbeinuTam = new Map<string, string>();
  const candleDays = new Set<string>();
  const endDays = new Set<string>();
  let offset = defaultOffset(city);
  let found = false;

  const zmanimDays = input.everyDay ? eachDate(input.from, input.to, 48) : focusDays(input);
  const zmanim = await pool(zmanimDays, 4, async (date) => {
    const body = await readJson(`zmanim?city=${city}&date=${date}`);
    return { date, body: body as { data?: { sunset?: Timed; tzeit_hakochavim?: Timed } } | null };
  });
  for (const row of zmanim) {
    if (!row?.body?.data) continue;
    const sun = instant(row.body.data.sunset);
    const stars = instant(row.body.data.tzeit_hakochavim);
    if (sun) {
      sunset.set(row.date, sun.label);
      sunsetAt.set(row.date, sun.at);
      found = true;
    }
    if (stars) {
      tzeit.set(row.date, stars.label);
      tzeitAt.set(row.date, stars.at);
      found = true;
    }
  }

  const shabbat = await pool(probes(input.from, input.to), 4, async (date) => {
    const body = await readJson(`shabbat?city=${city}&date=${date}`);
    return body as { data?: { candle_lighting?: Timed; shabbat_end?: Timed; rabbeinu_tam?: Timed; candle_offset?: number } } | null;
  });
  for (const body of shabbat) {
    if (!body?.data) continue;
    if (typeof body.data.candle_offset === "number" && body.data.candle_offset > 0) offset = Math.round(body.data.candle_offset);
    const candles = instant(body.data.candle_lighting);
    const end = instant(body.data.shabbat_end);
    const tam = instant(body.data.rabbeinu_tam);
    if (tam) rabbeinuTam.set(tam.day, tam.label);
    if (candles) {
      input.candles.set(candles.day, candles.at);
      candleDays.add(candles.day);
      found = true;
    }
    if (end) {
      input.havdalah.set(end.day, end.at);
      endDays.add(end.day);
      found = true;
    }
  }

  for (const day of input.yomTovDays) {
    const eve = addDays(day, -1);
    if (!candleDays.has(eve)) {
      const sun = sunsetAt.get(eve);
      if (sun) input.candles.set(eve, new Date(sun.getTime() - offset * 60_000));
    }
    if (weekday(day) !== 5 && !endDays.has(day)) {
      const stars = tzeitAt.get(day);
      if (stars) input.havdalah.set(day, stars);
    }
  }

  return found ? { sunset, tzeit, rabbeinuTam } : null;
}

async function liveGet(path: string): Promise<unknown> {
  const response = await fetch(`${ENDPOINT}/${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`mevarhim ${response.status}`);
  return response.json();
}

async function readJson(path: string): Promise<unknown | null> {
  const cached = cache.get(path);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.body;
  try {
    const body = await getter(path);
    cache.set(path, { at: Date.now(), body });
    return body;
  } catch {
    return null;
  }
}

function instant(value: Timed | undefined): { day: string; label: string; at: Date } | null {
  if (!value?.iso || !value.time || !/^\d{2}:\d{2}$/.test(value.time)) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T.*([+-]\d{2}:\d{2}|Z)$/.exec(value.iso);
  if (!match) return null;
  const zone = match[2] === "Z" ? "Z" : match[2];
  const at = new Date(`${match[1]}T${value.time}:00${zone}`);
  if (Number.isNaN(at.getTime())) return null;
  return { day: match[1], label: value.time, at };
}

function defaultOffset(city: string): number {
  if (city === "jerusalem") return 40;
  if (city === "haifa") return 30;
  return 20;
}

function focusDays(input: { from: string; to: string; yomTovDays: readonly string[] }): string[] {
  const days = new Set<string>();
  for (const day of input.yomTovDays) {
    if (day >= input.from && day <= input.to) days.add(day);
    const eve = addDays(day, -1);
    if (eve >= input.from && eve <= input.to) days.add(eve);
  }
  return [...days];
}

function probes(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to && days.length < 16) {
    days.push(cursor);
    cursor = addDays(cursor, 7);
  }
  if (days[days.length - 1] !== to) days.push(to);
  return days;
}

function eachDate(from: string, to: string, cap: number): string[] {
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to && days.length < cap) {
    days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

async function pool<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function weekday(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day).getDay();
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
