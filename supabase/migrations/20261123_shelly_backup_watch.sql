alter table shelly_backups add column if not exists watch boolean not null default false;
alter table shelly_backups add column if not exists checked_at text;
alter table shelly_backups add column if not exists next_check_at text;
