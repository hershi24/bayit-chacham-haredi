-- Customer-chosen display / IVR order for devices. Safe to run more than once.
alter table devices add column if not exists sort_order integer not null default 0;
