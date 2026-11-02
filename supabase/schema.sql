-- פיקד: לקוחות, משתמשים, שקעים, סשנים ויומן.
-- להריץ פעם אחת ב-Supabase: SQL Editor → Run.
-- השרת מתחבר עם המפתח service_role, שעוקף RLS.
-- מפתח anon לא קורא ולא כותב לטבלאות האלה.

create table if not exists tenants (
  id text primary key,
  name text not null,
  phone text,
  created_at text not null
);

create table if not exists users (
  id text primary key,
  tenant_id text references tenants (id),
  username text not null unique,
  name text not null,
  password_hash text not null,
  role text not null check (role in ('admin', 'operator')),
  created_at text not null
);

create table if not exists devices (
  device_id text primary key,
  tenant_id text not null references tenants (id),
  name text not null,
  created_at text not null
);

create table if not exists device_state (
  device_id text primary key references devices (device_id) on delete cascade,
  connectivity text not null,
  relay_on boolean,
  state_updated_at text,
  device_type text,
  api_name text,
  sensor_summary text,
  last_error text,
  updated_at text not null
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  expires_at text not null,
  created_at text not null
);

create table if not exists audit_log (
  id text primary key,
  at text not null,
  source text not null,
  actor text not null,
  device_id text,
  action text not null,
  idempotency_key text,
  result text not null,
  detail text
);

create index if not exists devices_tenant_idx on devices (tenant_id);
create index if not exists users_tenant_idx on users (tenant_id);
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists audit_log_at_idx on audit_log (at desc);

create table if not exists schedules (
  id text primary key,
  device_id text not null,
  kind text not null check (kind in ('timer_off', 'later_on')),
  run_at text not null,
  created_at text not null,
  done_at text,
  attempts integer not null default 0,
  detail text
);

create index if not exists schedules_due_idx on schedules (run_at);

alter table tenants enable row level security;
alter table users enable row level security;
alter table devices enable row level security;
alter table device_state enable row level security;
alter table sessions enable row level security;
alter table audit_log enable row level security;
alter table schedules enable row level security;

revoke all on table tenants, users, devices, device_state, sessions, audit_log, schedules from anon, authenticated;
