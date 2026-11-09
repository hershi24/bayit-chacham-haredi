-- Optional nicknames for authorized dial-in numbers.
alter table caller_numbers add column if not exists label text;
