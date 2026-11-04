import { AirVent, Droplets, Fan, Heater, Lightbulb, Plug, Refrigerator, type LucideIcon } from "lucide-react";
import { isDeviceIcon, suggestIcon, type DeviceIconKey } from "@/lib/devices/icons";

const ICONS: Record<DeviceIconKey, LucideIcon> = {
  socket: Plug,
  ac: AirVent,
  fan: Fan,
  light: Lightbulb,
  heat: Heater,
  boiler: Droplets,
  fridge: Refrigerator,
};

export function glyphFor(icon: DeviceIconKey): LucideIcon {
  return ICONS[icon];
}

export function DeviceGlyph({
  name,
  icon,
  className,
}: {
  name: string;
  icon?: string | null;
  className?: string;
}) {
  const key = isDeviceIcon(icon) ? icon : suggestIcon(name);
  const Icon = ICONS[key];
  return <Icon className={className} aria-hidden="true" />;
}
