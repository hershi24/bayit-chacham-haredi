-- Last time a device was actually online. Safe to run more than once.
alter table device_state add column if not exists last_online_at text;
