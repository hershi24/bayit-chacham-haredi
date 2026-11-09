export type ShellyChannel = 0 | 1 | 2;

export function cleanShellyId(value: unknown): string {
  if (typeof value !== "string") throw new Error("מזהה Shelly חסר");
  const id = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{3,48}$/.test(id)) {
    throw new Error("מזהה Shelly חייב להכיל 4 עד 49 תווים באנגלית, ספרות, מקף או קו תחתון");
  }
  return id;
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
