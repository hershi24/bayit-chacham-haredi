export function normalizePhone(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("972")) digits = `0${digits.slice(3)}`;
  return digits;
}

type PhoneCarrier = { phone: string | null; phones?: readonly string[] | null };

export function storedPhones(device: PhoneCarrier): string[] {
  const listed = (device.phones ?? []).filter((item) => item.trim());
  if (listed.length) return [...listed];
  return device.phone ? [device.phone] : [];
}

export function deviceMatchesPhone(device: PhoneCarrier, incoming: string): boolean {
  return storedPhones(device).some((stored) => phonesMatch(stored, incoming));
}

export function devicesForPhone<T extends PhoneCarrier>(devices: T[], phone: string | undefined): T[] {
  const caller = phone?.trim();
  if (!caller) return [];
  return devices.filter((device) => deviceMatchesPhone(device, caller));
}

export function phonesMatch(stored: string | null | undefined, incoming: string): boolean {
  if (!stored) return false;
  const left = normalizePhone(stored);
  const right = normalizePhone(incoming);
  if (!left || !right) return false;
  return left === right;
}

export type DeviceLookup<T> = {
  ok: true;
  device: T;
} | {
  ok: false;
  reason: "not-found" | "ambiguous" | "missing";
};

export function resolveDevice<T extends { deviceId: string; phone: string | null; phones?: readonly string[] | null }>(
  devices: T[],
  query: { deviceId?: string; phone?: string },
): DeviceLookup<T> {
  const deviceId = query.deviceId?.trim();
  if (deviceId) {
    const device = devices.find((item) => item.deviceId === deviceId);
    return device ? { ok: true, device } : { ok: false, reason: "not-found" };
  }

  const phone = query.phone?.trim();
  if (!phone) return { ok: false, reason: "missing" };

  const matches = devices.filter((item) => deviceMatchesPhone(item, phone));
  if (matches.length === 1) return { ok: true, device: matches[0] };
  if (matches.length === 0) return { ok: false, reason: "not-found" };
  return { ok: false, reason: "ambiguous" };
}

export function canAccessDevice(
  user: { role: string; tenantId: string | null },
  deviceTenantId: string,
): boolean {
  if (user.role === "admin") return true;
  return user.tenantId !== null && user.tenantId === deviceTenantId;
}
