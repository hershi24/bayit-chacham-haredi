export const DEVICE_ICONS = [
  { key: "socket", label: "שקע" },
  { key: "panel", label: "לוח חשמל" },
  { key: "ac", label: "מזגן" },
  { key: "fan", label: "מאוורר" },
  { key: "light", label: "תאורה" },
  { key: "heat", label: "חימום" },
  { key: "boiler", label: "דוד" },
  { key: "fridge", label: "מקרר" },
] as const;

export type DeviceIconKey = (typeof DEVICE_ICONS)[number]["key"];

const KEYS = new Set<string>(DEVICE_ICONS.map((item) => item.key));

export function isDeviceIcon(value: unknown): value is DeviceIconKey {
  return typeof value === "string" && KEYS.has(value);
}

export function suggestIcon(name: string): DeviceIconKey {
  if (name.includes("לוח")) return "panel";
  if (name.includes("מזגן")) return "ac";
  if (name.includes("תאורה") || name.includes("מנורה")) return "light";
  if (name.includes("מאוורר")) return "fan";
  if (name.includes("דוד")) return "boiler";
  if (name.includes("מקרר")) return "fridge";
  if (name.includes("חימום") || name.includes("תנור")) return "heat";
  return "socket";
}
