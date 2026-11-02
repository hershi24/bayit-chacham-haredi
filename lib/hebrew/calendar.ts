type Hebcal = typeof import("@hebcal/core");
type CalEvent = {
  getDesc(): string;
  getDate(): { greg(): Date };
  basename(): string;
  render(locale: string): string;
  eventTime?: Date;
};

let hebcalPromise: Promise<Hebcal> | undefined;

function hebcal() {
  hebcalPromise ??= import("@hebcal/core");
  return hebcalPromise;
}

export type RelayAction = "ON" | "OFF";

export type ClockSettings = {
  locationId: string;
  startAction: RelayAction;
  startOffsetMin: number;
  endAction: RelayAction;
  endOffsetMin: number;
};

export type ProgramWindow = {
  title: string;
  parsha: string | null;
  days: number;
  includesShabbat: boolean;
  start: string;
  end: string;
  hebrew: string;
};

export type ProgramPreview = {
  key: string;
  name: string;
  blurb: string;
  windows: ProgramWindow[];
};

export type Place = {
  id: string;
  name: string;
};

type HolidayRule = {
  key: string;
  name: string;
  blurb: string;
  match: (description: string) => boolean;
};

const HOLIDAYS: HolidayRule[] = [
  {
    key: "rosh-hashana",
    name: "ראש השנה",
    blurb: "יומיים. שעון אחד מערב החג עד מוצאי היום השני",
    match: (description) => /^Rosh Hashana( II| \d{4})?$/.test(description),
  },
  {
    key: "yom-kippur",
    name: "יום כיפור",
    blurb: "יום אחד, מערב הצום עד צאתו",
    match: (description) => description === "Yom Kippur",
  },
  {
    key: "sukkot",
    name: "סוכות",
    blurb: "יום טוב ראשון בארץ",
    match: (description) => description === "Sukkot I",
  },
  {
    key: "shemini",
    name: "שמיני עצרת",
    blurb: "שמיני עצרת ושמחת תורה בארץ",
    match: (description) => description === "Shmini Atzeret",
  },
  {
    key: "pesach",
    name: "פסח",
    blurb: "יום ראשון ויום שביעי, שני שעונים נפרדים",
    match: (description) => description === "Pesach I" || description === "Pesach VII",
  },
  {
    key: "shavuot",
    name: "שבועות",
    blurb: "יום אחד בארץ. אם הוא חל בערב שבת, השעון נמשך עד מוצאי שבת",
    match: (description) => description === "Shavuot" || description === "Shavuot I",
  },
];

const PLACES: Array<Place & { lookup?: string; latitude?: number; longitude?: number; city?: string }> = [
  { id: "jerusalem", name: "ירושלים", lookup: "Jerusalem" },
  { id: "bnei-brak", name: "בני ברק", latitude: 32.083, longitude: 34.833, city: "Bnei Brak" },
  { id: "tel-aviv", name: "תל אביב", lookup: "Tel Aviv" },
  { id: "elad", name: "אלעד", latitude: 32.052, longitude: 34.951, city: "Elad" },
  { id: "beit-shemesh", name: "בית שמש", latitude: 31.747, longitude: 34.988, city: "Beit Shemesh" },
  { id: "beitar", name: "ביתר עילית", latitude: 31.698, longitude: 35.115, city: "Beitar Illit" },
  { id: "modiin-illit", name: "מודיעין עילית", latitude: 31.932, longitude: 35.043, city: "Modiin Illit" },
  { id: "petach-tikva", name: "פתח תקווה", lookup: "Petach Tikvah" },
  { id: "ashdod", name: "אשדוד", lookup: "Ashdod" },
  { id: "haifa", name: "חיפה", lookup: "Haifa" },
  { id: "tzfat", name: "צפת", latitude: 32.965, longitude: 35.498, city: "Tzfat" },
  { id: "beer-sheva", name: "באר שבע", lookup: "Beer Sheva" },
  { id: "tiberias", name: "טבריה", lookup: "Tiberias" },
  { id: "eilat", name: "אילת", lookup: "Eilat" },
];

export const DEFAULT_CLOCK: ClockSettings = {
  locationId: "jerusalem",
  startAction: "ON",
  startOffsetMin: 0,
  endAction: "OFF",
  endOffsetMin: 0,
};

export function places(): Place[] {
  return PLACES.map(({ id, name }) => ({ id, name }));
}

export function placeName(id: string): string {
  return PLACES.find((place) => place.id === id)?.name ?? "ירושלים";
}

export function clampClock(input: Partial<ClockSettings>): ClockSettings {
  const place = PLACES.some((item) => item.id === input.locationId) ? input.locationId! : DEFAULT_CLOCK.locationId;
  return {
    locationId: place,
    startAction: input.startAction === "OFF" ? "OFF" : "ON",
    endAction: input.endAction === "ON" ? "ON" : "OFF",
    startOffsetMin: clampOffset(input.startOffsetMin),
    endOffsetMin: clampOffset(input.endOffsetMin),
  };
}

export async function upcomingPrograms(settings: ClockSettings, now = new Date()): Promise<ProgramPreview[]> {
  const built = await collect(settings, now);
  const shabbat: ProgramPreview = {
    key: "shabbat",
    name: "שבת",
    blurb: "כל שבת לפי הפרשה, משעת הנרות עד ההבדלה",
    windows: built.shabbat.filter((window) => Date.parse(window.end) > now.getTime()).slice(0, 8),
  };
  const holidays = HOLIDAYS.map((rule) => ({
    key: rule.key,
    name: rule.name,
    blurb: rule.blurb,
    windows: (built.holidays.get(rule.key) ?? []).filter((window) => Date.parse(window.end) > now.getTime()).slice(0, 3),
  }));
  return [shabbat, ...holidays];
}

export async function upcomingAgenda(
  settings: ClockSettings,
  now = new Date(),
  days = 70,
): Promise<Array<ProgramWindow & { programKey: string; programName: string }>> {
  const built = await collect(settings, now);
  const limit = now.getTime() + days * 86_400_000;
  const rows = [
    ...built.shabbat.map((window) => ({ ...window, programKey: "shabbat", programName: "שבת" })),
    ...HOLIDAYS.flatMap((rule) =>
      (built.holidays.get(rule.key) ?? []).map((window) => ({ ...window, programKey: rule.key, programName: rule.name })),
    ),
  ];
  return rows
    .filter((window) => Date.parse(window.start) < limit && Date.parse(window.end) > now.getTime())
    .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
}

export async function customWindow(
  name: string,
  startDate: string,
  endDate: string,
  settings: ClockSettings,
  now = new Date(),
): Promise<ProgramWindow | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  const from = startDate <= endDate ? startDate : endDate;
  const to = startDate <= endDate ? endDate : startDate;
  if (daysBetween(from, to) > 14) return null;
  const clock = clampClock(settings);
  const { candles, havdalah, location, HDate, Zmanim } = await loadMaps(clock.locationId, addDays(from, -2), addDays(to, 3));
  const made = makeWindow({
    title: name.trim() || "תוכנית",
    parsha: null,
    dates: eachDate(from, to),
    candles,
    havdalah,
    location,
    settings: clock,
    HDate,
    Zmanim,
  });
  if (!made || Date.parse(made.end) <= now.getTime()) return made;
  return made;
}

export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function plainHebrew(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0591-\u05C7]/g, "")
    .replace(/[־–]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function collect(settings: ClockSettings, now: Date) {
  const { HebrewCalendar, HDate, Zmanim } = await hebcal();
  const clock = clampClock(settings);
  const from = addDays(israelDate(now), -2);
  const to = addDays(from, 430);
  const location = await placeLocation(clock.locationId);
  const events = HebrewCalendar.calendar({
    start: dateOf(from),
    end: dateOf(to),
    sedrot: true,
    candlelighting: true,
    il: true,
    location,
  });
  const candles = new Map<string, Date>();
  const havdalah = new Map<string, Date>();
  const shabbat: ProgramWindow[] = [];
  const holidayDates = new Map<string, string[]>();
  for (const rule of HOLIDAYS) holidayDates.set(rule.key, []);

  for (const event of events) {
    rememberTime(event, "Candle lighting", candles);
    rememberTime(event, "Havdalah", havdalah);
    const description = event.getDesc();
    if (description.startsWith("Parashat ")) {
      const day = hebrewDay(event);
      const parsha = parshaName(event);
      const made = makeWindow({
        title: `שבת פרשת ${parsha}`,
        parsha,
        dates: [day],
        candles,
        havdalah,
        location,
        settings: clock,
        HDate,
        Zmanim,
      });
      if (made) shabbat.push(made);
    }
    for (const rule of HOLIDAYS) {
      if (rule.match(description)) holidayDates.get(rule.key)?.push(hebrewDay(event));
    }
  }

  const holidays = new Map<string, ProgramWindow[]>();
  for (const rule of HOLIDAYS) {
    const windows = cluster(unique(holidayDates.get(rule.key) ?? []))
      .map((dates) =>
        makeWindow({
          title: rule.name,
          parsha: null,
          dates,
          candles,
          havdalah,
          location,
          settings: clock,
          HDate,
          Zmanim,
        }),
      )
      .filter((window): window is ProgramWindow => Boolean(window));
    holidays.set(rule.key, windows);
  }
  return { shabbat, holidays };
}

function makeWindow(input: {
  title: string;
  parsha: string | null;
  dates: string[];
  candles: Map<string, Date>;
  havdalah: Map<string, Date>;
  location: InstanceType<Hebcal["Location"]>;
  settings: ClockSettings;
  HDate: Hebcal["HDate"];
  Zmanim: Hebcal["Zmanim"];
}): ProgramWindow | null {
  const dates = [...input.dates].sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return null;
  const eve = addDays(first, -1);
  const entry = input.candles.get(eve) ?? beforeSunset(input.Zmanim, input.location, eve);
  let exitDay = last;
  let exit = input.havdalah.get(last);
  if (!exit) {
    const next = addDays(last, 1);
    exit = input.havdalah.get(next);
    if (exit) exitDay = next;
  }
  exit ??= nightfall(input.Zmanim, input.location, last);
  const start = shift(entry, input.settings.startOffsetMin);
  const end = shift(exit, input.settings.endOffsetMin);
  if (end.getTime() <= start.getTime()) return null;
  return {
    title: input.title,
    parsha: input.parsha,
    days: dates.length,
    includesShabbat: exitDay !== last,
    start: start.toISOString(),
    end: end.toISOString(),
    hebrew: hebrewSpan(input.HDate, first, last),
  };
}

function rememberTime(event: CalEvent, basename: string, into: Map<string, Date>) {
  if (event.basename() !== basename) return;
  const timed = event;
  if (!(timed.eventTime instanceof Date)) return;
  const key = israelDate(timed.eventTime);
  const previous = into.get(key);
  if (!previous || timed.eventTime.getTime() < previous.getTime()) into.set(key, timed.eventTime);
}

function parshaName(event: CalEvent): string {
  const rendered = plainHebrew(event.render("he"));
  return rendered.replace(/^פרשת\s+/, "") || plainHebrew(event.getDesc().replace(/^Parashat\s+/, ""));
}

function hebrewDay(event: CalEvent): string {
  const date = event.getDate().greg();
  return isoFromLocal(date);
}

function hebrewSpan(HDate: Hebcal["HDate"], from: string, to: string): string {
  const start = hebrewLabel(HDate, from);
  if (from === to) return start;
  return `${start} עד ${hebrewLabel(HDate, to)}`;
}

function hebrewLabel(HDate: Hebcal["HDate"], iso: string): string {
  return new HDate(dateOf(iso)).renderGematriya(true);
}

async function loadMaps(locationId: string, from: string, to: string) {
  const { HebrewCalendar, HDate, Zmanim } = await hebcal();
  const location = await placeLocation(locationId);
  const events = HebrewCalendar.calendar({
    start: dateOf(from),
    end: dateOf(to),
    candlelighting: true,
    il: true,
    location,
  });
  const candles = new Map<string, Date>();
  const havdalah = new Map<string, Date>();
  for (const event of events) {
    rememberTime(event, "Candle lighting", candles);
    rememberTime(event, "Havdalah", havdalah);
  }
  return { candles, havdalah, location, HDate, Zmanim };
}

function beforeSunset(Zmanim: Hebcal["Zmanim"], location: InstanceType<Hebcal["Location"]>, iso: string): Date {
  const sunset = new Zmanim(location, dateOf(iso), false).sunset();
  return new Date(sunset.getTime() - 40 * 60_000);
}

function nightfall(Zmanim: Hebcal["Zmanim"], location: InstanceType<Hebcal["Location"]>, iso: string): Date {
  return new Zmanim(location, dateOf(iso), false).tzeit(8.5);
}

async function placeLocation(id: string) {
  const { Location } = await hebcal();
  const place = PLACES.find((item) => item.id === id) ?? PLACES[0];
  if (!place) throw new Error("missing place");
  if (place.lookup) {
    const found = Location.lookup(place.lookup);
    if (!found) throw new Error(place.lookup);
    return found;
  }
  return new Location(place.latitude ?? 31.769, place.longitude ?? 35.216, true, "Asia/Jerusalem", place.city ?? place.name, "IL");
}

function shift(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

function clampOffset(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-180, Math.min(180, Math.round(value ?? 0)));
}

function cluster(dates: string[]): string[][] {
  const groups: string[][] = [];
  for (const date of dates) {
    const last = groups[groups.length - 1];
    const previous = last?.[last.length - 1];
    if (!last || !previous || daysBetween(previous, date) > 1) groups.push([date]);
    else last.push(date);
  }
  return groups;
}

function unique(dates: string[]): string[] {
  return [...new Set(dates)].sort();
}

function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to && dates.length < 15) {
    dates.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateOf(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isoFromLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function israelDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
