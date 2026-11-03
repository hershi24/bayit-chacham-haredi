"use client";

import { useEffect, useState } from "react";
import { Plus, Search, SlidersHorizontal } from "lucide-react";
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
import type { BridgeStatus, DeviceView, TenantView, UserView } from "@/lib/types";

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
  const [actorId, setActorId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  async function load() {
    try {
      const [tenantPayload, userPayload, devicePayload, session, ivrPayload] = await Promise.all([
        api<{ tenants: TenantView[] }>("/api/admin/tenants"),
        api<{ users: UserView[] }>("/api/admin/users"),
        api<{ devices: DeviceView[] }>("/api/admin/devices"),
        api<{ user: { id: string }; status: BridgeStatus }>("/api/auth/me"),
        api<IvrInfo>("/api/admin/ivr"),
      ]);
      setTenants(tenantPayload.tenants);
      setUsers(userPayload.users);
      setDevices(devicePayload.devices);
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
    <section>
      <h2 className="text-2xl font-semibold tracking-tight">ניהול</h2>
      <p className="mb-4 text-sm text-muted-foreground">כל נתוני הלקוח, וחיבור לימות המשיח.</p>
      <Tabs defaultValue="tenants">
        <TabsList>
          <TabsTrigger value="tenants">לקוחות</TabsTrigger>
          <TabsTrigger value="link">חיבור וטלפון</TabsTrigger>
        </TabsList>
        <TabsContent value="tenants" className="pt-4">
          <CustomerPanel actorId={actorId} tenants={tenants} users={users} devices={devices} onChange={load} />
        </TabsContent>
        <TabsContent value="link" className="pt-4">
          <LinkPanel status={status} ivr={ivr} devices={devices} />
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

type KindFilter = "all" | "customers" | "admins";
type SocketFilter = "all" | "with" | "without" | "frozen";
type PresenceFilter = "all" | "with" | "without";
type SortKey = "name" | "sockets" | "phones";

type DirectoryRow =
  | { kind: "customer"; tenant: TenantView; people: UserView[]; sockets: DeviceView[] }
  | { kind: "admin"; user: UserView };

const KIND_ITEMS = { all: "הכל", customers: "לקוחות", admins: "מנהלים" };
const SOCKET_ITEMS = { all: "כל השקעים", with: "יש שקעים", without: "בלי שקעים", frozen: "יש שקע מוקפא" };
const PHONE_ITEMS = { all: "כל החיוג", with: "יש מספר", without: "בלי מספר" };
const LOGIN_ITEMS = { all: "כל הכניסות", with: "יש כניסה לאתר", without: "בלי כניסה לאתר" };
const SORT_ITEMS = { name: "לפי שם", sockets: "לפי מספר שקעים", phones: "לפי מספר טלפונים" };

function CustomerPanel({
  actorId,
  tenants,
  users,
  devices,
  onChange,
}: {
  actorId: string;
  tenants: TenantView[];
  users: UserView[];
  devices: DeviceView[];
  onChange: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [kind, setKind] = useState<KindFilter>("all");
  const [socketFilter, setSocketFilter] = useState<SocketFilter>("all");
  const [phoneFilter, setPhoneFilter] = useState<PresenceFilter>("all");
  const [loginFilter, setLoginFilter] = useState<PresenceFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<{ tenantId: string | null; userId: string | null } | null>(null);
  const admins = users.filter((user) => user.role === "admin");
  const editUser = users.find((user) => user.id === editing?.userId) ?? null;
  const editTenant =
    tenants.find((tenant) => tenant.id === (editing?.tenantId ?? editUser?.tenantId)) ?? null;
  const rows = directoryRows(tenants, users, devices, admins)
    .filter((row) => matchesDirectory(row, { query, kind, socketFilter, phoneFilter, loginFilter }))
    .toSorted((left, right) => compareRows(left, right, sortKey));
  const activeFilters = Number(kind !== "all") + Number(socketFilter !== "all") + Number(phoneFilter !== "all") + Number(loginFilter !== "all") + Number(sortKey !== "name");

  function clearFilters() {
    setKind("all");
    setSocketFilter("all");
    setPhoneFilter("all");
    setLoginFilter("all");
    setSortKey("name");
    setQuery("");
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
    <div className="grid gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="text-[22px] leading-7 font-semibold">לקוחות</h3>
          <p className="text-sm text-muted-foreground">
            {rows.length === tenants.length + admins.length
              ? `${hebrewCount(tenants.length, "לקוח אחד", "לקוחות")} · ${hebrewCount(admins.length, "מנהל אחד", "מנהלים")}`
              : `מציג ${rows.length} מתוך ${tenants.length + admins.length}`}
          </p>
        </div>
        <Button type="button" className="size-11 rounded-full" aria-label="לקוח חדש" onClick={() => setCreating(true)}>
          <Plus className="size-5" />
        </Button>
      </div>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="customer-search"
            className="h-11 pr-9"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="שם, משתמש, טלפון או שקע"
            aria-label="חיפוש לקוחות"
          />
        </div>
        <Button type="button" variant={advanced ? "secondary" : "outline"} className="h-11" aria-expanded={advanced} onClick={() => setAdvanced((open) => !open)}>
          <SlidersHorizontal />
          חיפוש
          {activeFilters ? <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">{activeFilters}</span> : null}
        </Button>
      </div>
      {advanced ? (
        <div className="grid gap-3 rounded-[22px] border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect label="סוג" value={kind} items={KIND_ITEMS} onChange={(value) => setKind(value as KindFilter)} />
          <FilterSelect label="שקעים" value={socketFilter} items={SOCKET_ITEMS} onChange={(value) => setSocketFilter(value as SocketFilter)} />
          <FilterSelect label="חיוג" value={phoneFilter} items={PHONE_ITEMS} onChange={(value) => setPhoneFilter(value as PresenceFilter)} />
          <FilterSelect label="כניסה לאתר" value={loginFilter} items={LOGIN_ITEMS} onChange={(value) => setLoginFilter(value as PresenceFilter)} />
          <FilterSelect label="מיון" value={sortKey} items={SORT_ITEMS} onChange={(value) => setSortKey(value as SortKey)} />
          {activeFilters || query ? (
            <div className="flex items-end">
              <Button type="button" variant="ghost" className="h-11" onClick={clearFilters}>
                ניקוי חיפוש
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {rows.length ? (
        <ul className="overflow-hidden rounded-[22px] border border-border bg-card">
          <li className="hidden grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto] gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground md:grid">
            <span>לקוח</span>
            <span>כניסה וחיוג</span>
            <span>שקעים</span>
            <span className="sr-only">פעולות</span>
          </li>
          {rows.map((row) =>
            row.kind === "customer" ? (
              <CustomerDirectoryRow
                key={row.tenant.id}
                tenant={row.tenant}
                people={row.people}
                sockets={row.sockets}
                onEdit={(userId) => setEditing({ tenantId: row.tenant.id, userId })}
                onRemove={() => void removeTenant(row.tenant)}
              />
            ) : (
              <li key={row.user.id} className="grid items-center gap-3 border-b border-border px-4 py-3 last:border-0 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto]">
                <div className="min-w-0">
                  <p className="truncate font-medium">{row.user.name}</p>
                  <p className="text-sm text-muted-foreground">מנהל</p>
                </div>
                <p dir="ltr" className="truncate text-left font-mono text-sm text-muted-foreground">{row.user.username}</p>
                <p className="text-sm text-muted-foreground">בלי שקעים</p>
                <RowActions onEdit={() => setEditing({ tenantId: null, userId: row.user.id })} onRemove={() => void removeAdmin(row.user)} />
              </li>
            ),
          )}
        </ul>
      ) : (
        <div className="rounded-[22px] border border-border bg-card px-4 py-10 text-center">
          <p className="font-medium">אין תוצאות לחיפוש הזה</p>
          <Button type="button" variant="outline" className="mt-3 h-11" onClick={clearFilters}>
            הצגת כל הרשימה
          </Button>
        </div>
      )}
      <CreateCustomerDialog open={creating} onClose={() => setCreating(false)} onCreated={onChange} />
      <CustomerEditor
        actorId={actorId}
        user={editUser}
        tenant={editTenant}
        devices={devices}
        open={editing !== null}
        onClose={() => setEditing(null)}
        onSaved={onChange}
      />
    </div>
  );
}

function hebrewCount(count: number, singular: string, plural: string) {
  return count === 1 ? singular : `${count} ${plural}`;
}

function directoryRows(tenants: TenantView[], users: UserView[], devices: DeviceView[], admins: UserView[]): DirectoryRow[] {
  return [
    ...tenants.map((tenant) => ({
      kind: "customer" as const,
      tenant,
      people: users.filter((user) => user.tenantId === tenant.id),
      sockets: devices.filter((device) => device.tenantId === tenant.id),
    })),
    ...admins.map((user) => ({ kind: "admin" as const, user })),
  ];
}

function matchesDirectory(
  row: DirectoryRow,
  filters: { query: string; kind: KindFilter; socketFilter: SocketFilter; phoneFilter: PresenceFilter; loginFilter: PresenceFilter },
) {
  if (filters.kind === "customers" && row.kind !== "customer") return false;
  if (filters.kind === "admins" && row.kind !== "admin") return false;
  const sockets = row.kind === "customer" ? row.sockets : [];
  const phones = row.kind === "customer" ? row.tenant.phones : [];
  const people = row.kind === "customer" ? row.people : [row.user];
  if (filters.socketFilter === "with" && sockets.length === 0) return false;
  if (filters.socketFilter === "without" && sockets.length > 0) return false;
  if (filters.socketFilter === "frozen" && !sockets.some((device) => device.frozen)) return false;
  if (filters.phoneFilter === "with" && phones.length === 0) return false;
  if (filters.phoneFilter === "without" && phones.length > 0) return false;
  if (filters.loginFilter === "with" && people.length === 0) return false;
  if (filters.loginFilter === "without" && people.length > 0) return false;
  const needle = filters.query.trim().toLowerCase();
  if (!needle) return true;
  const text = [
    row.kind === "customer" ? row.tenant.name : row.user.name,
    ...people.map((user) => `${user.username} ${user.name}`),
    ...phones.map((item) => item.phone),
    ...sockets.map((device) => `${device.name} ${device.deviceId}`),
  ].join(" ").toLowerCase();
  const digits = needle.replace(/\D/g, "");
  return text.includes(needle) || (digits.length >= 3 && text.replace(/\D/g, "").includes(digits));
}

function compareRows(left: DirectoryRow, right: DirectoryRow, sortKey: SortKey) {
  const name = (row: DirectoryRow) => (row.kind === "customer" ? row.tenant.name : row.user.name);
  const sockets = (row: DirectoryRow) => (row.kind === "customer" ? row.sockets.length : 0);
  const phones = (row: DirectoryRow) => (row.kind === "customer" ? row.tenant.phones.length : 0);
  if (sortKey === "sockets" && sockets(left) !== sockets(right)) return sockets(right) - sockets(left);
  if (sortKey === "phones" && phones(left) !== phones(right)) return phones(right) - phones(left);
  return name(left).localeCompare(name(right), "he");
}

function FilterSelect({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: string;
  items: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm">
      {label}
      <Select value={value} onValueChange={(next) => onChange(next ?? value)} items={items}>
        <SelectTrigger className="h-11 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(items).map(([itemValue, itemLabel]) => (
            <SelectItem key={itemValue} value={itemValue}>
              {itemLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function RowActions({ onEdit, onRemove }: { onEdit: () => void; onRemove: () => void }) {
  return (
    <span className="flex shrink-0 gap-1">
      <Button type="button" variant="outline" size="sm" onClick={onEdit}>
        עריכה
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
        מחיקה
      </Button>
    </span>
  );
}

function CustomerDirectoryRow({
  tenant,
  people,
  sockets,
  onEdit,
  onRemove,
}: {
  tenant: TenantView;
  people: UserView[];
  sockets: DeviceView[];
  onEdit: (userId: string | null) => void;
  onRemove: () => void;
}) {
  const primary = people[0] ?? null;
  const frozen = sockets.filter((device) => device.frozen).length;
  return (
    <li className="grid items-start gap-3 border-b border-border px-4 py-3 last:border-0 md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.25fr)_auto] md:items-center">
      <div className="min-w-0">
        <p className="truncate font-medium">{tenant.name}</p>
        <p className="text-sm text-muted-foreground">{primary ? socketLabel(primary) : "אין כניסה לאתר"}</p>
      </div>
      <div className="min-w-0 text-sm">
        {primary ? <p dir="ltr" className="truncate text-left font-mono text-muted-foreground">{primary.username}</p> : <p className="text-muted-foreground">אין כניסה</p>}
        {tenant.phones.length ? (
          <p dir="ltr" className="truncate text-left font-mono text-muted-foreground">{tenant.phones.map((item) => item.phone).join(" · ")}</p>
        ) : (
          <p className="text-muted-foreground">אין מספר לחיוג</p>
        )}
        {people.slice(1).map((user) => (
          <p key={user.id} className="mt-1 flex items-center justify-between gap-2">
            <span dir="ltr" className="truncate font-mono text-muted-foreground">{user.username}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => onEdit(user.id)}>
              עריכה
            </Button>
          </p>
        ))}
      </div>
      <div className="min-w-0">
        {sockets.length ? (
          <ul className="grid gap-0.5 text-sm">
            {sockets.map((device) => (
              <li key={device.deviceId} className="truncate">
                {device.name}
                {device.frozen ? <span className="text-muted-foreground"> · מוקפא</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">אין שקעים</p>
        )}
        {frozen ? <p className="mt-1 text-xs text-muted-foreground">{frozen === 1 ? "שקע אחד מוקפא" : `${frozen} שקעים מוקפאים`}</p> : null}
      </div>
      <RowActions onEdit={() => onEdit(primary?.id ?? null)} onRemove={onRemove} />
    </li>
  );
}

function CreateCustomerDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        {open ? <CreateCustomerForm key="new-customer" onClose={onClose} onCreated={onCreated} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateCustomerForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("operator");
  const [pending, setPending] = useState(false);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
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
      toast.success(role === "admin" ? "המנהל נוסף" : "הלקוח נוסף");
      await onCreated();
      onClose();
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "שמירה נכשלה");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-3" onSubmit={(event) => void create(event)}>
      <DialogHeader>
        <DialogTitle>{role === "admin" ? "מנהל חדש" : "לקוח חדש"}</DialogTitle>
        <DialogDescription>שם, כניסה לאתר, ואם זה לקוח גם מספר לחיוג.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="customer-name">שם</Label>
        <Input id="customer-name" className="h-11" value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="customer-username">שם משתמש</Label>
        <Input id="customer-username" className="h-11 text-left" dir="ltr" value={username} onChange={(event) => setUsername(event.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="customer-password">סיסמה</Label>
        <Input id="customer-password" className="h-11 text-left" dir="ltr" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label>הרשאה</Label>
        <Select value={role} onValueChange={(value) => setRole(value ?? "operator")} items={{ operator: "לקוח", admin: "מנהל" }}>
          <SelectTrigger className="h-11 w-full">
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
          <Input id="customer-phone" className="h-11 text-left" dir="ltr" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0520000000" />
        </div>
      ) : null}
      <DialogFooter>
        <Button type="button" variant="outline" className="h-11" onClick={onClose}>ביטול</Button>
        <Button type="submit" className="h-11" disabled={pending}>{pending ? "שומר…" : "הוספה"}</Button>
      </DialogFooter>
    </form>
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
}: {
  actorId: string;
  user: UserView | null;
  tenant: TenantView | null;
  devices: DeviceView[];
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
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
}: {
  actorId: string;
  user: UserView | null;
  tenant: TenantView | null;
  devices: DeviceView[];
  onClose: () => void;
  onSaved: () => Promise<void>;
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
    if (!window.confirm(`להסיר את ${device.name}?`)) return;
    setSocketBusy(device.deviceId);
    try {
      await api(`/api/admin/devices/${device.deviceId}`, { method: "DELETE" });
      toast.success("השקע הוסר");
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
              onAdd={async (value) => {
                try {
                  await api(`/api/admin/tenants/${tenant.id}/phones`, { method: "POST", body: JSON.stringify({ phone: value }) });
                  toast.success("המספר נוסף");
                  await onSaved();
                } catch (cause) {
                  toast.error(cause instanceof Error ? cause.message : "ההוספה נכשלה");
                  throw cause;
                }
              }}
              onRemove={async (id) => {
                if (!window.confirm("להסיר את המספר מהחיוג למערכת?")) return;
                try {
                  await api(`/api/admin/tenants/${tenant.id}/phones/${id}`, { method: "DELETE" });
                  toast.success("המספר הוסר");
                  await onSaved();
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
                  <li key={device.deviceId} className="flex items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {device.name}
                        {device.frozen ? " (מוקפא)" : ""}
                      </span>
                      <span dir="ltr" className="block truncate text-left font-mono text-xs text-muted-foreground">{device.deviceId}</span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <Button type="button" variant="outline" size="sm" disabled={socketBusy !== null} onClick={() => void freezeSocket(device)}>
                        {device.frozen ? "שחרור" : "הקפאה"}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" disabled={socketBusy !== null} onClick={() => void removeSocket(device)}>
                        הסרה
                      </Button>
                    </span>
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
                הוספת שקע
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
