-- Email for password reset and Google sign-in. Safe to run more than once.
alter table users add column if not exists email text;
alter table users add column if not exists google_sub text;
create unique index if not exists users_email_idx on users (email) where email is not null;
create unique index if not exists users_google_sub_idx on users (google_sub) where google_sub is not null;

create table if not exists password_resets (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  token_hash text not null,
  expires_at text not null,
  used_at text
);

alter table password_resets enable row level security;
revoke all on table password_resets from anon, authenticated;
