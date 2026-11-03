export type Role = "admin" | "operator";

export type Connectivity = "ONLINE" | "OFFLINE" | "UNKNOWN";

export type RelayAction = "ON" | "OFF";

export type SessionUser = {
  id: string;
  username: string;
  name: string;
  role: Role;
  tenantId: string | null;
  tenantName: string | null;
};

export type NextPlan = {
  at: string;
  action: RelayAction;
};

export type DeviceView = {
  deviceId: string;
  name: string;
  tenantId: string;
  tenantName: string;
  connectivity: Connectivity;
  relayOn: boolean | null;
  stateUpdatedAt: string | null;
  deviceType: string | null;
  sensorSummary: string | null;
  lastError: string | null;
  icon: string | null;
  frozen: boolean;
  next?: NextPlan | null;
};

export type AuditSource = "web" | "ivr" | "stream" | "system";

export type AuditView = {
  id: string;
  at: string;
  source: AuditSource;
  actor: string;
  deviceId: string | null;
  deviceName: string | null;
  action: string;
  idempotencyKey: string | null;
  result: string;
  detail: string | null;
};

export type CallerNumber = {
  id: string;
  phone: string;
};

export type TenantView = {
  id: string;
  name: string;
  phone: string | null;
  phones: CallerNumber[];
  deviceCount: number;
  userCount: number;
};

export type UserView = {
  id: string;
  username: string;
  name: string;
  role: Role;
  tenantId: string | null;
  tenantName: string | null;
  deviceIds: string[] | null;
};

export type BridgeStatus = {
  mode: "mock" | "live";
  storage: "sqlite" | "supabase";
  relayStyle: "indexed" | "batch";
  baseUrl: string;
  ivrTokenIsDefault: boolean;
  token: {
    state: "missing" | "valid" | "error";
    expiresAt: string | null;
    scopes: string[];
    missingScopes: string[];
  };
  socket: {
    state: "mock" | "connecting" | "open" | "closed";
    lastEventAt: string | null;
  };
  lastError: string | null;
};

export type CommandView = {
  status: string;
  action: RelayAction;
  commandId: string | null;
  idempotencyKey: string;
  requestId: string | null;
};
