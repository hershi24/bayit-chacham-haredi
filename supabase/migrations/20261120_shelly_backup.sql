create table if not exists shelly_backups (
  shelly_id text primary key,
  tenant_id text not null,
  status text not null,
  mode text,
  window_start text,
  window_end text,
  window_label text,
  plan_hash text,
  action_count integer not null default 0,
  plan_code text,
  schedule_ids text not null default '[]',
  synced_at text,
  verified_at text,
  error text,
  attempts integer not null default 0,
  alerted_at text,
  updated_at text not null
);

alter table shelly_backups enable row level security;

revoke all on table shelly_backups from anon, authenticated;
