"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/client-api";
import { formatIsrael } from "@/lib/time";
import type { BridgeStatus, DeviceView, TenantView, UserView } from "@/lib/types";

type IvrInfo = {
  token: string;
  defaultToken: boolean;
  paths: { on: string; off: string; status: string };
};

export function AdminConsole() {
  const [tenants, setTenants] = useState<TenantView[]>([]);
  const [users, setUsers] = useState<UserView[]>([]);
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [ivr, setIvr] = useState<IvrInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  async function load() {
    try {
      const [tenantPayload, userPayload, devicePayload, session, ivrPayload] = await Promise.all([
        api<{ tenants: TenantView[] }>("/api/admin/tenants"),
        api<{ users: UserView[] }>("/api/admin/users"),
        api<{ devices: DeviceView[] }>("/api/admin/devices"),
        api<{ status: BridgeStatus }>("/api/auth/me"),
        api<IvrInfo>("/api/admin/ivr"),
      ]);
      setTenants(tenantPayload.tenants);
      setUsers(userPayload.users);
      setDevices(devicePayload.devices);
      setStatus(session.status);
      setIvr(ivrPayload);
      setError(null);
      setReady(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "טעינת הניהול נכשלה");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  if (!ready && !error) {
    return <div className="h-64 animate-pulse rounded-2xl border border-border bg-card shadow-sm" />;
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="text-destructive">{error}</p>
        <Button className="mt-4" type="button" onClick={() => void load()}>
          נסו שוב
        </Button>
      </div>
    );
  }

  return (
    <section>
      <h2 className="text-2xl font-semibold tracking-tight">ניהול</h2>
      <p className="mb-4 text-sm text-muted-foreground">לקוחות, משתמשים, שיוך שקעים, וחיבור לימות המשיח.</p>
      <Tabs defaultValue="tenants">
        <TabsList>
          <TabsTrigger value="tenants">לקוחות</TabsTrigger>
          <TabsTrigger value="users">משתמשים</TabsTrigger>
          <TabsTrigger value="devices">שקעים</TabsTrigger>
          <TabsTrigger value="link">חיבור וטלפון</TabsTrigger>
        </TabsList>
        <TabsContent value="tenants" className="pt-4">
          <TenantPanel tenants={tenants} onChange={load} />
        </TabsContent>
        <TabsContent value="users" className="pt-4">
          <UserPanel tenants={tenants} users={users} onChange={load} />
        </TabsContent>
        <TabsContent value="devices" className="pt-4">
          <DevicePanel tenants={tenants} devices={devices} onChange={load} />
        </TabsContent>
        <TabsContent value="link" className="pt-4">
          <LinkPanel status={status} ivr={ivr} devices={devices} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

function TenantPanel({ tenants, onChange }: { tenants: TenantView[]; onChange: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api("/api/admin/tenants", { method: "POST", body: JSON.stringify({ name, phone }) });
      setName("");
      setPhone("");
      toast.success("הלקוח נוסף");
      await onChange();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "שמירה נכשלה");
    }
  }

  async function remove(tenant: TenantView) {
    if (!window.confirm(`למחוק את ${tenant.name}?`)) return;
    try {
      await api(`/api/admin/tenants/${tenant.id}`, { method: "DELETE" });
      await onChange();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "המחיקה נכשלה");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>לקוח חדש</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={(event) => void create(event)}>
            <div className="grid gap-2">
              <Label htmlFor="tenant-name">שם</Label>
              <Input id="tenant-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="tenant-phone">טלפון לזיהוי ב-IVR</Label>
              <Input id="tenant-phone" dir="ltr" className="text-left" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="035551001" />
            </div>
            <Button type="submit">הוספה</Button>
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-2">
        {tenants.map((tenant) => (
          <div key={tenant.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
            <div>
              <p className="font-medium">{tenant.name}</p>
              <p className="text-sm text-muted-foreground">
                {tenant.phone ?? "בלי טלפון"} · {tenant.deviceCount} שקעים · {tenant.userCount} משתמשים
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => void remove(tenant)}>
              מחיקה
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function UserPanel({
  tenants,
  users,
  onChange,
}: {
  tenants: TenantView[];
  users: UserView[];
  onChange: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("operator");
  const [tenantChoice, setTenantChoice] = useState("");
  const tenantId = tenantChoice || tenants[0]?.id || "";

  async function create(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({ name, username, password, role, tenantId: role === "admin" ? null : tenantId }),
      });
      setName("");
      setUsername("");
      setPassword("");
      toast.success("המשתמש נוסף");
      await onChange();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "שמירה נכשלה");
    }
  }

  async function remove(user: UserView) {
    if (!window.confirm(`למחוק את ${user.name}?`)) return;
    try {
      await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
      await onChange();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "המחיקה נכשלה");
    }
  }

  const items = Object.fromEntries(tenants.map((tenant) => [tenant.id, tenant.name]));

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>משתמש חדש</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={(event) => void create(event)}>
            <div className="grid gap-2">
              <Label htmlFor="user-name">שם לתצוגה</Label>
              <Input id="user-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user-username">שם משתמש</Label>
              <Input id="user-username" dir="ltr" className="text-left" value={username} onChange={(event) => setUsername(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="user-password">סיסמה</Label>
              <Input id="user-password" dir="ltr" className="text-left" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>תפקיד</Label>
              <Select value={role} onValueChange={(value) => setRole(value ?? "operator")} items={{ operator: "לקוח", admin: "מנהל" }}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operator">לקוח</SelectItem>
                  <SelectItem value="admin">מנהל</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {role === "operator" ? (
              <div className="grid gap-2">
                <Label>לקוח</Label>
                <Select value={tenantId} onValueChange={(value) => setTenantChoice(value ?? "")} items={items}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="בחירת לקוח" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map((tenant) => (
                      <SelectItem key={tenant.id} value={tenant.id}>
                        {tenant.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <Button type="submit">הוספה</Button>
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-2">
        {users.map((user) => (
          <div key={user.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
            <div>
              <p className="font-medium">{user.name}</p>
              <p className="text-sm text-muted-foreground">
                <span dir="ltr" className="font-mono">{user.username}</span>
                {" · "}
                {user.role === "admin" ? "מנהל" : user.tenantName}
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => void remove(user)}>
              מחיקה
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DevicePanel({
  tenants,
  devices,
  onChange,
}: {
  tenants: TenantView[];
  devices: DeviceView[];
  onChange: () => Promise<void>;
}) {
  const [deviceId, setDeviceId] = useState("");
  const [name, setName] = useState("");
  const [tenantChoice, setTenantChoice] = useState("");
  const tenantId = tenantChoice || tenants[0]?.id || "";
  const items = Object.fromEntries(tenants.map((tenant) => [tenant.id, tenant.name]));

  async function create(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api("/api/admin/devices", { method: "POST", body: JSON.stringify({ deviceId, name, tenantId }) });
      setDeviceId("");
      setName("");
      toast.success("השקע שויך");
      await onChange();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "שמירה נכשלה");
    }
  }

  async function remove(device: DeviceView) {
    if (!window.confirm(`להסיר את ${device.name}?`)) return;
    try {
      await api(`/api/admin/devices/${device.deviceId}`, { method: "DELETE" });
      await onChange();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "ההסרה נכשלה");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[22rem_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>שיוך שקע</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={(event) => void create(event)}>
            <div className="grid gap-2">
              <Label htmlFor="device-id">מזהה ב-WLTE</Label>
              <Input id="device-id" dir="ltr" className="text-left font-mono" value={deviceId} onChange={(event) => setDeviceId(event.target.value)} placeholder="rct063285302" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="device-name">שם בלוח</Label>
              <Input id="device-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>לקוח</Label>
              <Select value={tenantId} onValueChange={(value) => setTenantChoice(value ?? "")} items={items}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="בחירת לקוח" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((tenant) => (
                    <SelectItem key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit">שיוך</Button>
          </form>
        </CardContent>
      </Card>
      <div className="grid gap-2">
        {devices.map((device) => (
          <div key={device.deviceId} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
            <div>
              <p className="font-medium">{device.name}</p>
              <p className="font-mono text-xs text-muted-foreground" dir="ltr">{device.deviceId}</p>
              <p className="text-sm text-muted-foreground">{device.tenantName}</p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => void remove(device)}>
              הסרה
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function LinkPanel({
  status,
  ivr,
  devices,
}: {
  status: BridgeStatus | null;
  ivr: IvrInfo | null;
  devices: DeviceView[];
}) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const sample = devices[0]?.deviceId ?? "rct063285302";

  function url(path: string) {
    if (!ivr) return "";
    return `${origin}${path}?token=${encodeURIComponent(ivr.token)}&deviceId=${encodeURIComponent(sample)}`;
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    toast.success("הכתובת הועתקה");
  }

  const rows = ivr
    ? [
        ["הקשה 1 · הפעלה", url(ivr.paths.on)],
        ["הקשה 2 · כיבוי", url(ivr.paths.off)],
        ["הקשה 3 · מצב", url(ivr.paths.status)],
      ]
    : [];

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>חיבור WLTE</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>מצב: {status?.mode === "live" ? "חי מול openapi.svnwi.com" : "הדגמה מקומית, בלי מפתחות"}</p>
          <p>סגנון פקודה: {status?.relayStyle === "batch" ? "מערך relays" : "ממסר 1, תאימות למפרט"}</p>
          <p>אסימון: {status?.token.state === "valid" ? `בתוקף עד ${formatIsrael(status.token.expiresAt)}` : "לא בתוקף"}</p>
          <p>שידור: {status?.socket.state === "mock" ? "פנימי" : status?.socket.state === "open" ? "מחובר" : "מנותק"}</p>
          <p className="text-muted-foreground">האסימון מוחלף אוטומטית אחרי 50 דקות, וגם אחרי 401.</p>
          {status?.token.missingScopes.length ? (
            <p className="text-destructive">חסרות הרשאות: {status.token.missingScopes.join(", ")}</p>
          ) : (
            <p>ההרשאות הנדרשות קיימות באסימון הנוכחי.</p>
          )}
          {status?.lastError ? <p className="text-destructive">{status.lastError}</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>ימות המשיח</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          {ivr?.defaultToken ? (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-destructive">
              מוגדר טוקן ברירת מחדל של פיתוח. החליפו את IVR_TOKEN לפני חיבור לקו טלפון אמיתי.
            </p>
          ) : null}
          <p>בכל שלוחה: <span className="font-mono" dir="ltr">type=api</span> ו-<span className="font-mono" dir="ltr">api_url_post=yes</span>. השרת מחזיר <span className="font-mono" dir="ltr">id_list_message</span> להקראה.</p>
          <p>אפשר להשמיט את deviceId ולשלוח את מספר המתקשר כ-ApiPhone. המספר מזוהה מול הטלפון של הלקוח, אם יש לו שקע אחד.</p>
          {rows.map(([label, value]) => (
            <div key={label} className="grid gap-1">
              <div className="flex items-center justify-between gap-2">
                <span>{label}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => void copy(value)}>
                  העתקה
                </Button>
              </div>
              <code className="block overflow-x-auto rounded-lg bg-muted px-2 py-1 font-mono text-xs" dir="ltr">
                {value}
              </code>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
