"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CallerNumbers } from "@/components/caller-numbers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/client-api";
import { formatIsrael } from "@/lib/time";
import type { BridgeStatus, CallerNumber, DeviceView, TenantView, UserView } from "@/lib/types";

type IvrInfo = {
  token: string;
  defaultToken: boolean;
  paths: { menu: string; on: string; off: string; status: string };
};

export function AdminConsole() {
  const [tenants, setTenants] = useState<TenantView[]>([]);
  const [users, setUsers] = useState<UserView[]>([]);
  const [devices, setDevices] = useState<DeviceView[]>([]);
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const [ivr, setIvr] = useState<IvrInfo | null>(null);
  const [shellyUrl, setShellyUrl] = useState("");
  const [actorId, setActorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  async function load() {
    try {
      const [tenantPayload, userPayload, devicePayload, session, ivrPayload] = await Promise.all([
        api<{ tenants: TenantView[] }>("/api/admin/tenants"),
        api<{ users: UserView[] }>("/api/admin/users"),
        api<{ devices: DeviceView[]; shelly?: { outboundUrl: string; certificateHint: string } }>("/api/admin/devices"),
        api<{ user: { id: string }; status: BridgeStatus }>("/api/auth/me"),
        api<IvrInfo>("/api/admin/ivr"),
      ]);
      setTenants(tenantPayload.tenants);
      setUsers(userPayload.users);
      setDevices(devicePayload.devices);
      setShellyUrl(devicePayload.shelly?.outboundUrl ?? "");
      setActorId(session.user.id);
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
    <section className="min-w-0">
      <h2 className="text-2xl font-semibold tracking-tight">ניהול</h2>
      <p className="mb-4 text-sm text-muted-foreground">כל נתוני הלקוח, וחיבור לימות המשיח.</p>
      <Tabs defaultValue="tenants" className="min-w-0">
        <TabsList className="grid h-auto w-full grid-cols-2 sm:inline-flex sm:w-fit">
          <TabsTrigger value="tenants" className="px-3 py-2">
            לקוחות
          </TabsTrigger>
          <TabsTrigger value="link" className="px-3 py-2">
            חיבור וטלפון
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tenants" className="min-w-0 pt-4">
          <CustomerPanel
            actorId={actorId}
            tenants={tenants}
            users={users}
            devices={devices}
            onChange={load}
            onTenants={setTenants}
          />
        </TabsContent>
        <TabsContent value="link" className="min-w-0 pt-4">
          <LinkPanel status={status} ivr={ivr} devices={devices} shellyUrl={shellyUrl} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

function socketLabel(user: UserView | null) {
  if (!user) return "אין כניסה לאתר";
  if (!user.deviceIds) return "כניסה לכל השקעים";
  if (user.deviceIds.length === 1) return "כניסה לשקע אחד";
  return `כניסה ל-${user.deviceIds.length} שקעים`;
}

function CustomerPanel({
  actorId,
  tenants,
  users,
  devices,
  onChange,
  onTenants,
}: {
  actorId: string;
  tenants: TenantView[];
  users: UserView[];
  devices: DeviceView[];
  onChange: () => Promise<void>;
  onTenants: (tenants: TenantView[]) => void;
}) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("operator");
  const [editing, setEditing] = useState<{ tenantId: string | null; userId: string | null } | null>(null);
  const admins = users.filter((user) => user.role === "admin");
  const editUser = users.find((user) => user.id === editing?.userId) ?? null;
  const editTenant =
    tenants.find((tenant) => tenant.id === (editing?.tenantId ?? editUser?.tenantId)) ?? null;

  async function create(event: React.FormEvent) {
    event.preventDefault();
    try {
      if (role === "admin") {
        await api("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({ name, username, password, role: "admin", tenantId: null }),
        });
      } else {
        await api("/api/admin/tenants", {
          method: "POST",
          body: JSON.stringify({ name, username, password, phone }),
        });
      }
      setName("");
      setUsername("");
      setPassword("");
      setPhone("");
      toast.success(role === "admin" ? "המנהל נוסף" : "הלקוח נוסף");
      await onChange();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "שמירה נכשלה");
    }
  }

  async function removeTenant(tenant: TenantView) {
    if (tenant.deviceCount > 0) {
      toast.error("אי אפשר למחוק לקוח שעדיין יש לו שקעים");
      return;
    }
    if (!window.confirm(`למחוק את ${tenant.name}?`)) return;
    try {
      for (const user of users.filter((item) => item.tenantId === tenant.id)) {
        await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
      }
      await api(`/api/admin/tenants/${tenant.id}`, { method: "DELETE" });
      await onChange();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "המחיקה נכשלה");
    }
  }

  async function removeAdmin(user: UserView) {
    if (!window.confirm(`למחוק את ${user.name}?`)) return;
    try {
      await api(`/api/admin/users/${user.id}`, { method: "DELETE" });
      await onChange();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "המחיקה נכשלה");
    }
  }

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[22rem_1fr]">
      <Card className="order-2 min-w-0 lg:order-1">
        <CardHeader>
          <CardTitle>לקוח חדש</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={(event) => void create(event)}>
            <div className="grid gap-2">
              <Label htmlFor="customer-name">שם</Label>
              <Input id="customer-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="customer-username">שם משתמש</Label>
              <Input id="customer-username" dir="ltr" className="text-left" value={username} onChange={(event) => setUsername(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="customer-password">סיסמה</Label>
              <Input id="customer-password" dir="ltr" className="text-left" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>הרשאה</Label>
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
                <Label htmlFor="customer-phone">טלפון לחיוג</Label>
                <Input id="customer-phone" dir="ltr" className="text-left" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="035551001" />
              </div>
            ) : null}
            <Button type="submit" className="w-full">
              הוספה
            </Button>
          </form>
        </CardContent>
      </Card>
      <div className="order-1 grid min-w-0 gap-3 lg:order-2">
        <p className="text-sm font-medium lg:hidden">לקוחות קיימים ({tenants.length})</p>
        {tenants.map((tenant) => {
          const people = users.filter((user) => user.tenantId === tenant.id);
          const primary = people[0] ?? null;
          return (
            <div key={tenant.id} className="grid min-w-0 gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm">
              <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{tenant.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {primary ? (
                      <>
                        <span dir="ltr" className="font-mono">
                          {primary.username}
                        </span>
                        {" · "}
                        {socketLabel(primary)}
                      </>
                    ) : (
                      "אין כניסה לאתר"
                    )}
                  </p>
                  {tenant.phones.length ? (
                    <p dir="ltr" className="truncate text-left font-mono text-sm text-muted-foreground">
                      {tenant.phones
                        .map((item) => (item.label ? `${item.label} (${item.phone})` : item.phone))
                        .join(" · ")}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground">אין מספר לחיוג</p>
                  )}
                  <CustomerSocketsLine devices={devices.filter((device) => device.tenantId === tenant.id)} />
                </div>
                <span className="flex w-full gap-2 sm:w-auto sm:shrink-0">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-10 flex-1 sm:min-h-8 sm:flex-none"
                    onClick={() => setEditing({ tenantId: tenant.id, userId: primary?.id ?? null })}
                  >
                    עריכה
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="min-h-10 flex-1 sm:min-h-8 sm:flex-none"
                    onClick={() => void removeTenant(tenant)}
                  >
                    מחיקה
                  </Button>
                </span>
              </div>
              {people.slice(1).map((user) => (
                <div key={user.id} className="flex min-w-0 flex-col gap-2 border-t border-border/60 pt-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                  <span className="min-w-0 truncate">
                    <span dir="ltr" className="font-mono">
                      {user.username}
                    </span>
                    {" · "}
                    {socketLabel(user)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-10 w-full sm:min-h-8 sm:w-auto"
                    onClick={() => setEditing({ tenantId: tenant.id, userId: user.id })}
                  >
                    עריכה
                  </Button>
                </div>
              ))}
            </div>
          );
        })}
        <div className="grid gap-2">
          <p className="text-sm font-medium">מנהלים</p>
          {admins.map((user) => (
            <div key={user.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="font-medium">{user.name}</p>
                <p className="text-sm text-muted-foreground">
                  <span dir="ltr" className="font-mono">
                    {user.username}
                  </span>
                  {" · מנהל"}
                </p>
              </div>
              <span className="flex w-full gap-2 sm:w-auto">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="min-h-10 flex-1 sm:min-h-8 sm:flex-none"
                  onClick={() => setEditing({ tenantId: null, userId: user.id })}
                >
                  עריכה
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-10 flex-1 sm:min-h-8 sm:flex-none"
                  onClick={() => void removeAdmin(user)}
                >
                  מחיקה
                </Button>
              </span>
            </div>
          ))}
        </div>
      </div>
      <CustomerEditor
        actorId={actorId}
        user={editUser}
        tenant={editTenant}
        devices={devices}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={onChange}
        onPhones={(phones) => {
          if (!editTenant) return;
          onTenants(
            tenants.map((item) =>
              item.id === editTenant.id
                ? { ...item, phones, phone: phones[0]?.phone ?? null }
                : item,
            ),
          );
        }}
      />
    </div>
  );
}

function CustomerEditor({
  actorId,
  user,
  tenant,
  devices,
  open,
  onClose,
  onSaved,
  onPhones,
}: {
  actorId: string;
  user: UserView | null;
  tenant: TenantView | null;
  devices: DeviceView[];
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onPhones: (phones: CallerNumber[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {open ? (
          <CustomerEditorForm
            key={`${tenant?.id ?? "none"}:${user?.id ?? "none"}`}
            actorId={actorId}
            user={user}
            tenant={tenant}
            devices={devices}
            onClose={onClose}
            onSaved={onSaved}
            onPhones={onPhones}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CustomerEditorForm({
  actorId,
  user,
  tenant,
  devices,
  onClose,
  onSaved,
  onPhones,
}: {
  actorId: string;
  user: UserView | null;
  tenant: TenantView | null;
  devices: DeviceView[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  onPhones: (phones: CallerNumber[]) => void;
}) {
  const customer = user?.role !== "admin";
  const [name, setName] = useState(user?.name ?? tenant?.name ?? "");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [allDevices, setAllDevices] = useState(user ? user.deviceIds === null : true);
  const [chosen, setChosen] = useState<string[]>(user?.deviceIds ?? []);
  const [pending, setPending] = useState(false);
  const [socketId, setSocketId] = useState("");
  const [socketName, setSocketName] = useState("");
  const [socketBusy, setSocketBusy] = useState<string | null>(null);
  const [shellyId, setShellyId] = useState("");
  const [shellyKind, setShellyKind] = useState<"panel" | "socket">("panel");
  const [channelNames, setChannelNames] = useState(["לוח ערוץ 1", "לוח ערוץ 2", "לוח ערוץ 3"]);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const tenantDevices = devices.filter((device) => device.tenantId === tenant?.id);

  function toggleDevice(deviceId: string) {
    setChosen((current) => (current.includes(deviceId) ? current.filter((id) => id !== deviceId) : [...current, deviceId]));
  }

  async function addSocket() {
    if (!tenant) return;
    setSocketBusy("add");
    try {
      await api("/api/admin/devices", {
        method: "POST",
        body: JSON.stringify({ deviceId: socketId, name: socketName, tenantId: tenant.id }),
      });
      setSocketId("");
      setSocketName("");
      toast.success("השקע שויך");
      await onSaved();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "שמירה נכשלה");
    } finally {
      setSocketBusy(null);
    }
  }

  async function addShelly() {
    if (!tenant) return;
    setSocketBusy("shelly");
    try {
      await api("/api/admin/devices", {
        method: "POST",
        body: JSON.stringify({
          vendor: "shelly",
          type: "shelly-pro3",
          shellyId,
          tenantId: tenant.id,
          kind: shellyKind,
          channels: channelNames,
        }),
      });
      setShellyId("");
      toast.success("Shelly Pro 3 שויך כשלושה ערוצים");
      await onSaved();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "שמירה נכשלה");
    } finally {
      setSocketBusy(null);
    }
  }

  function startRename(device: DeviceView) {
    setRenameId(device.deviceId);
    setRenameValue(device.name);
  }

  async function saveRename(device: DeviceView) {
    const next = renameValue.trim();
    if (!next) {
      toast.error("יש להזין כינוי");
      return;
    }
    if (next === device.name) {
      setRenameId(null);
      return;
    }
    setSocketBusy(device.deviceId);
    try {
      await api(`/api/admin/devices/${device.deviceId}`, {
        method: "PATCH",
        body: JSON.stringify({ name: next, tenantId: device.tenantId }),
      });
      setRenameId(null);
      toast.success("הכינוי עודכן");
      await onSaved();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "עדכון הכינוי נכשל");
    } finally {
      setSocketBusy(null);
    }
  }

  async function freezeSocket(device: DeviceView) {
    setSocketBusy(device.deviceId);
    try {
      await api(`/api/admin/devices/${device.deviceId}/freeze`, {
        method: "POST",
        body: JSON.stringify({ frozen: !device.frozen }),
      });
      toast.success(device.frozen ? "השקע שוחרר" : "השקע הוקפא");
      await onSaved();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "ההקפאה נכשלה");
    } finally {
      setSocketBusy(null);
    }
  }

  async function removeSocket(device: DeviceView) {
    const shellyUnit = device.vendor === "shelly";
    const prompt = shellyUnit
      ? `להסיר את כל שלושת ערוצי Shelly של ${device.externalId ?? device.name}?`
      : `להסיר את ${device.name}?`;
    if (!window.confirm(prompt)) return;
    setSocketBusy(device.deviceId);
    try {
      await api(`/api/admin/devices/${device.deviceId}`, { method: "DELETE" });
      toast.success(shellyUnit ? "התקן Shelly הוסר (שלושה ערוצים)" : "השקע הוסר");
      await onSaved();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "ההסרה נכשלה");
    } finally {
      setSocketBusy(null);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      if (user) {
        await api(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            role: user.role,
            tenantId: user.tenantId,
            password,
            deviceIds: user.role === "admin" || allDevices ? null : chosen.filter((id) => tenantDevices.some((device) => device.deviceId === id)),
          }),
        });
      } else if (tenant && username.trim() !== "") {
        await api("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({ name, username, password, role: "operator", tenantId: tenant.id }),
        });
      }
      if (tenant && name !== tenant.name) {
        await api(`/api/admin/tenants/${tenant.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      }
      toast.success(password && user && user.id !== actorId ? "הסיסמה אופסה" : "הלקוח עודכן");
      await onSaved();
      onClose();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "השמירה נכשלה");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-3" onSubmit={(event) => void save(event)}>
      <DialogHeader>
        <DialogTitle>{customer ? "עריכת לקוח" : "עריכת מנהל"}</DialogTitle>
        {user ? (
          <DialogDescription>
            <span dir="ltr" className="font-mono">{user.username}</span>
          </DialogDescription>
        ) : (
          <DialogDescription>אפשר להוסיף כאן כניסה לאתר.</DialogDescription>
        )}
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="edit-name">שם</Label>
        <Input id="edit-name" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      {user ? null : (
        <div className="grid gap-2">
          <Label htmlFor="edit-username">שם משתמש</Label>
          <Input id="edit-username" dir="ltr" className="text-left" value={username} onChange={(event) => setUsername(event.target.value)} />
        </div>
      )}
      <div className="grid gap-2">
        <Label htmlFor="edit-password">{user ? "איפוס סיסמה" : "סיסמה"}</Label>
        <Input
          id="edit-password"
          dir="ltr"
          className="text-left"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={user ? "השאירו ריק כדי לא לשנות" : ""}
        />
        {user && user.id !== actorId ? (
          <p className="text-sm text-muted-foreground">סיסמה חדשה לכניסה לאתר. המשתמש ינותק ויתחבר איתה.</p>
        ) : null}
      </div>
      {customer && tenant ? (
        <>
          <div className="grid gap-2">
            <p className="text-sm font-medium">מספרים מותרים לחיוג</p>
            <CallerNumbers
              numbers={tenant.phones}
              onAdd={async (input) => {
                try {
                  const payload = await api<{ phones: CallerNumber[] }>(`/api/admin/tenants/${tenant.id}/phones`, {
                    method: "POST",
                    body: JSON.stringify(input),
                  });
                  onPhones(payload.phones);
                  toast.success("המספר נוסף");
                } catch (cause) {
                  toast.error(cause instanceof Error ? cause.message : "ההוספה נכשלה");
                  throw cause;
                }
              }}
              onUpdate={async (id, input) => {
                try {
                  const payload = await api<{ phones: CallerNumber[] }>(`/api/admin/tenants/${tenant.id}/phones/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify(input),
                  });
                  onPhones(payload.phones);
                  toast.success("הכינוי עודכן");
                } catch (cause) {
                  toast.error(cause instanceof Error ? cause.message : "עדכון הכינוי נכשל");
                  throw cause;
                }
              }}
              onRemove={async (id) => {
                if (!window.confirm("להסיר את המספר מהחיוג למערכת?")) return;
                try {
                  const payload = await api<{ phones: CallerNumber[] }>(`/api/admin/tenants/${tenant.id}/phones/${id}`, {
                    method: "DELETE",
                  });
                  onPhones(payload.phones);
                  toast.success("המספר הוסר");
                } catch (cause) {
                  toast.error(cause instanceof Error ? cause.message : "ההסרה נכשלה");
                }
              }}
            />
          </div>
          <div className="grid gap-2">
            <p className="text-sm font-medium">שקעים</p>
            {tenantDevices.length ? (
              <ul className="grid gap-2">
                {tenantDevices.map((device) => (
                  <li key={device.deviceId} className="grid gap-2 rounded-xl border border-border px-3 py-2">
                    {renameId === device.deviceId ? (
                      <div
                        className="grid gap-2"
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void saveRename(device);
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setRenameId(null);
                          }
                        }}
                      >
                        <Label htmlFor={`rename-${device.deviceId}`}>כינוי</Label>
                        <Input
                          id={`rename-${device.deviceId}`}
                          value={renameValue}
                          autoFocus
                          onChange={(event) => setRenameValue(event.target.value)}
                          placeholder={device.vendor === "shelly" ? "שם הערוץ" : "שם השקע"}
                        />
                        <span className="flex flex-wrap gap-1">
                          <Button type="button" size="sm" disabled={socketBusy !== null} onClick={() => void saveRename(device)}>
                            שמירת כינוי
                          </Button>
                          <Button type="button" size="sm" variant="ghost" disabled={socketBusy !== null} onClick={() => setRenameId(null)}>
                            ביטול
                          </Button>
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {device.name}
                            {device.frozen ? " (מוקפא)" : ""}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {device.vendor === "shelly"
                              ? `Shelly · ${device.kind === "panel" ? "לוח חשמל" : "שקע"} · ערוץ ${(device.channel ?? 0) + 1}`
                              : "WLTE · שקע"}
                          </span>
                          <span dir="ltr" className="block truncate text-left font-mono text-xs text-muted-foreground">
                            {device.deviceId}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-wrap justify-end gap-1">
                          <Button type="button" variant="outline" size="sm" disabled={socketBusy !== null} onClick={() => startRename(device)}>
                            כינוי
                          </Button>
                          <Button type="button" variant="outline" size="sm" disabled={socketBusy !== null} onClick={() => void freezeSocket(device)}>
                            {device.frozen ? "שחרור" : "הקפאה"}
                          </Button>
                          <Button type="button" variant="ghost" size="sm" disabled={socketBusy !== null} onClick={() => void removeSocket(device)}>
                            הסרה
                          </Button>
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">ללקוח הזה אין עדיין שקעים.</p>
            )}
            <div
              className="grid gap-2"
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void addSocket();
              }}
            >
              <Label htmlFor="socket-device-id">מזהה ב-WLTE</Label>
              <Input id="socket-device-id" dir="ltr" className="text-left font-mono" value={socketId} onChange={(event) => setSocketId(event.target.value)} placeholder="rct063285302" />
              <Label htmlFor="socket-device-name">שם בלוח</Label>
              <Input id="socket-device-name" value={socketName} onChange={(event) => setSocketName(event.target.value)} />
              <Button type="button" variant="outline" disabled={socketBusy !== null} onClick={() => void addSocket()}>
                הוספת שקע WLTE
              </Button>
            </div>
            <div className="mt-4 grid gap-2 rounded-xl border border-dashed border-border p-3">
              <p className="text-sm font-medium">Shelly Pro 3 · שלושה ערוצים</p>
              <Label htmlFor="shelly-id">מזהה Shelly</Label>
              <Input
                id="shelly-id"
                dir="ltr"
                className="text-left font-mono"
                value={shellyId}
                onChange={(event) => setShellyId(event.target.value)}
                placeholder="8c4f008f0328"
              />
              <p className="text-xs text-muted-foreground">
                מהאפליקציה: הגדרות → פרטי התקן → «מזהה התקן» (אפשר גם את המזהה המלא עם קידומת shellypro3-).
              </p>
              <Label htmlFor="shelly-kind">סוג התקנה</Label>
              <Select
                value={shellyKind}
                items={{ panel: "לוח חשמל (DIN)", socket: "שקע / ממסר" }}
                onValueChange={(value) => {
                  const kind = value === "socket" ? "socket" : "panel";
                  setShellyKind(kind);
                  setChannelNames(
                    kind === "panel"
                      ? ["לוח ערוץ 1", "לוח ערוץ 2", "לוח ערוץ 3"]
                      : ["שקע ערוץ 1", "שקע ערוץ 2", "שקע ערוץ 3"],
                  );
                }}
              >
                <SelectTrigger id="shelly-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="panel">לוח חשמל (DIN)</SelectItem>
                  <SelectItem value="socket">שקע / ממסר</SelectItem>
                </SelectContent>
              </Select>
              {[0, 1, 2].map((index) => (
                <div key={index} className="grid gap-1">
                  <Label htmlFor={`shelly-ch-${index}`}>שם ערוץ {index + 1}</Label>
                  <Input
                    id={`shelly-ch-${index}`}
                    value={channelNames[index]}
                    onChange={(event) =>
                      setChannelNames((current) => current.map((name, i) => (i === index ? event.target.value : name)))
                    }
                  />
                </div>
              ))}
              <Button type="button" variant="outline" disabled={socketBusy !== null} onClick={() => void addShelly()}>
                הוספת Shelly Pro 3
              </Button>
            </div>
          </div>
          {user ? (
            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">כניסה לאתר</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={allDevices} onChange={(event) => setAllDevices(event.target.checked)} />
                כל השקעים של הלקוח
              </label>
              {allDevices ? (
                tenantDevices.length ? (
                  <ul className="grid gap-1 text-sm text-muted-foreground">
                    {tenantDevices.map((device) => (
                      <li key={device.deviceId}>
                        {device.name}
                        {device.frozen ? " (מוקפא)" : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">ללקוח הזה אין עדיין שקעים.</p>
                )
              ) : tenantDevices.length ? (
                tenantDevices.map((device) => (
                  <label key={device.deviceId} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={chosen.includes(device.deviceId)} onChange={() => toggleDevice(device.deviceId)} />
                    {device.name}
                    {device.frozen ? " (מוקפא)" : ""}
                  </label>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">ללקוח הזה אין עדיין שקעים.</p>
              )}
            </fieldset>
          ) : null}
        </>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
        <Button type="submit" disabled={pending}>{pending ? "שומר…" : "שמירה"}</Button>
      </DialogFooter>
    </form>
  );
}

function CustomerSocketsLine({ devices }: { devices: DeviceView[] }) {
  if (!devices.length) return <p className="text-sm text-muted-foreground">אין שקעים</p>;
  return (
    <ul className="mt-1 grid gap-1 text-sm text-muted-foreground">
      {devices.map((device) => (
        <li key={device.deviceId} className="min-w-0">
          <span className="block truncate">{device.name}{device.frozen ? " (מוקפא)" : ""}</span>
          <span dir="ltr" className="block break-all font-mono text-xs">
            {device.deviceId}
          </span>
        </li>
      ))}
    </ul>
  );
}

function LinkPanel({
  status,
  ivr,
  devices,
  shellyUrl,
}: {
  status: BridgeStatus | null;
  ivr: IvrInfo | null;
  devices: DeviceView[];
  shellyUrl: string;
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

  const extension = ivr
    ? ["type=api", `api_link=${origin}${ivr.paths.menu}`, "api_url_post=yes"].join("\n")
    : "";
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
          <p>אחסון: {status?.storage === "supabase" ? "סופרבייס" : "קובץ מקומי"}</p>
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
          <CardTitle>חיבור Shelly Pro 3</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <p>ההתקן מתחבר אלינו ב־Outbound WebSocket. ב־Shelly → רשת → שקע אינטרנט יוצא:</p>
          <ol className="list-decimal space-y-1 pe-5 text-muted-foreground">
            <li>סמנו «לאפשר»</li>
            <li>הדביקו את כתובת השרת למטה</li>
            <li>בחרו תעודה <span dir="ltr">*</span> (מומלץ ל־wss ציבורי)</li>
            <li>שמרו ובצעו אתחול מחדש להתקן</li>
          </ol>
          {shellyUrl ? (
            <div className="grid gap-1">
              <div className="flex items-center justify-between gap-2">
                <span>כתובת Outbound WebSocket</span>
                <Button type="button" size="sm" variant="outline" onClick={() => void copy(shellyUrl)}>
                  העתקה
                </Button>
              </div>
              <code className="block overflow-x-auto rounded-lg bg-muted px-2 py-1 font-mono text-xs" dir="ltr">
                {shellyUrl}
              </code>
            </div>
          ) : (
            <p className="text-muted-foreground">הכתובת תופיע אחרי טעינת הניהול.</p>
          )}
          <p className="text-muted-foreground">כל Pro 3 מתווסף כלקוח כשלושה ערוצים נפרדים בלוח ובמערכת הקולית.</p>
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
          <p>בשלוחה שהשיחה נכנסת אליה מדביקים רק את שלוש השורות. ימות המשיח מזהה את עצמה, ושולחת לבד את מספר המתקשר. אין להוסיף טוקן ואין להוסיף מעבר לתיקייה אחרת.</p>
          {extension ? (
            <div className="grid gap-1">
              <div className="flex items-center justify-between gap-2">
                <span>שלוחה ראשית</span>
                <Button type="button" size="sm" variant="outline" onClick={() => void copy(extension)}>
                  העתקה
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-muted px-2 py-1 font-mono text-xs" dir="ltr">
                {extension}
              </pre>
            </div>
          ) : null}
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
