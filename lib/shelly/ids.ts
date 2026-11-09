export type ShellyChannel = 0 | 1 | 2;

export function cleanShellyId(value: unknown): string {
  if (typeof value !== "string") throw new Error("מזהה Shelly חסר");
  const id = value.trim().toLowerCase();
  // App "מזהה התקן" is often just the MAC (12 hex). Full id is like shellypro3-8c4f008f0328.
  if (/^[a-f0-9]{8,16}$/.test(id)) return id;
  if (!/^[a-z0-9][a-z0-9_-]{3,48}$/.test(id)) {
    throw new Error("מזהה Shelly חייב להיות מזהה ההתקן מהאפליקציה (למשל 8c4f008f0328)");
  }
  return id;
}

/** Trailing MAC / serial hex from a Shelly id (`shellypro3-8c4f008f0328` → `8c4f008f0328`). */
export function shellyMac(id: string): string | null {
  const cleaned = id.trim().toLowerCase();
  if (/^[a-f0-9]{8,16}$/.test(cleaned)) return cleaned;
  const match = /-([a-f0-9]{8,16})$/.exec(cleaned);
  return match?.[1] ?? null;
}

export function shellyIdsMatch(a: string, b: string): boolean {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  const leftMac = shellyMac(left);
  const rightMac = shellyMac(right);
  return Boolean(leftMac && rightMac && leftMac === rightMac);
}

export function shellyChannelDeviceId(shellyId: string, channel: ShellyChannel): string {
  return `${shellyId}_ch${channel}`;
}

export function parseShellyChannelId(deviceId: string): { shellyId: string; channel: ShellyChannel } | null {
  const match = /^(.+)_ch([012])$/.exec(deviceId);
  if (!match) return null;
  const channel = Number(match[2]) as ShellyChannel;
  return { shellyId: match[1], channel };
}

export function isShellyChannelId(deviceId: string) {
  return parseShellyChannelId(deviceId) !== null;
}
