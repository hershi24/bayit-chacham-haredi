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
  icon text,
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

create table if not exists clock_settings (
  tenant_id text primary key references tenants (id) on delete cascade,
  location_id text not null,
  start_action text not null check (start_action in ('ON', 'OFF')),
  start_offset_min integer not null,
  end_action text not null check (end_action in ('ON', 'OFF')),
  end_offset_min integer not null,
  updated_at text not null
);

create table if not exists programs (
  id text primary key,
  tenant_id text not null references tenants (id) on delete cascade,
  program_key text not null,
  name text not null,
  enabled boolean not null default false,
  device_ids text not null default '[]',
  start_date text,
  end_date text,
  created_at text not null,
  unique (tenant_id, program_key)
);

create table if not exists program_runs (
  id text primary key,
  program_id text not null,
  device_id text not null,
  action text not null check (action in ('ON', 'OFF')),
  run_at text not null,
  label text not null,
  created_at text not null,
  done_at text,
  attempts integer not null default 0,
  detail text
);

create index if not exists program_runs_due_idx on program_runs (run_at);
create index if not exists programs_tenant_idx on programs (tenant_id);

alter table tenants enable row level security;
alter table users enable row level security;
alter table devices enable row level security;
alter table device_state enable row level security;
alter table sessions enable row level security;
alter table audit_log enable row level security;
alter table schedules enable row level security;
alter table clock_settings enable row level security;
alter table programs enable row level security;
alter table program_runs enable row level security;

alter table programs add column if not exists days text not null default '[]';
alter table programs add column if not exists weekdays text not null default '[]';
alter table programs add column if not exists on_time text;
alter table programs add column if not exists off_time text;

alter table devices add column if not exists icon text;
alter table devices add column if not exists frozen integer not null default 0;

create table if not exists clocks (
  id text primary key,
  tenant_id text not null references tenants (id) on delete cascade,
  program_id text,
  day text not null,
  on_time text,
  off_time text,
  device_ids text not null default '[]',
  created_at text not null
);

create index if not exists clocks_tenant_day_idx on clocks (tenant_id, day);

alter table clocks enable row level security;

create table if not exists caller_numbers (
  id text primary key,
  tenant_id text not null references tenants (id) on delete cascade,
  phone text not null unique,
  created_at text not null
);

create index if not exists caller_numbers_tenant_idx on caller_numbers (tenant_id);

insert into caller_numbers (id, tenant_id, phone, created_at)
select 'ph_' || id, id, phone, created_at from tenants
where phone is not null and btrim(phone) <> ''
on conflict (phone) do nothing;

create table if not exists user_devices (
  user_id text not null references users (id) on delete cascade,
  device_id text not null references devices (device_id) on delete cascade,
  primary key (user_id, device_id)
);

alter table caller_numbers enable row level security;
alter table user_devices enable row level security;

revoke all on table tenants, users, devices, device_state, sessions, audit_log, schedules, clock_settings, programs, program_runs, clocks, caller_numbers, user_devices from anon, authenticated;
