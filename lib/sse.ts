import { presentDevice } from "@/lib/store";
import type { BridgeStatus, DeviceView, Role } from "@/lib/types";

type Client = {
  id: string;
  role: Role;
  tenantId: string | null;
  send: (event: string, data: unknown) => void;
};

const globalHub = globalThis as unknown as { __pikudSse?: Set<Client> };

function clients() {
  if (!globalHub.__pikudSse) globalHub.__pikudSse = new Set();
  return globalHub.__pikudSse;
}

export function subscribe(client: Client) {
  clients().add(client);
  return () => clients().delete(client);
}

export function publishDevice(device: DeviceView) {
  for (const client of clients()) {
    if (client.role === "admin" || client.tenantId === device.tenantId) {
    client.send("device", presentDevice(device));
    }
  }
}

export function publishStatus(status: BridgeStatus) {
  for (const client of clients()) client.send("status", status);
}
