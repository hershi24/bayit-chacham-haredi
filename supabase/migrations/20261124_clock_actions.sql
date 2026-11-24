alter table clocks add column if not exists actions text not null default '[]';
