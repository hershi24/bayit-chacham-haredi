export type OrderedDevice = { sortOrder: number; name: string; tenantName?: string };

/** Stable tenant → sortOrder → Hebrew name ordering for dashboards and the phone menu. */
export function compareDevices(left: OrderedDevice, right: OrderedDevice, byTenant = false) {
  if (byTenant) {
    const leftTenant = left.tenantName ?? "";
    const rightTenant = right.tenantName ?? "";
    if (leftTenant !== rightTenant) return leftTenant.localeCompare(rightTenant, "he");
  }
  if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder;
  return left.name.localeCompare(right.name, "he");
}
