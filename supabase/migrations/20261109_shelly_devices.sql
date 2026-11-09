-- Shelly Pro 3 support: vendor/kind/external channel metadata on devices.
-- Safe to run on an existing Supabase project.

alter table devices add column if not exists vendor text not null default 'wlte';
alter table devices add column if not exists kind text not null default 'socket';
alter table devices add column if not exists external_id text;
alter table devices add column if not exists channel integer;

create index if not exists devices_external_id_idx on devices (external_id);
