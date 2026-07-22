-- Run this file once in Supabase Dashboard > SQL Editor.
-- It is safe to run again: existing profiles are preserved.

begin;

-- A username is the login identity in this password-free app. Browser data
-- cleanup previously created a new user_id for the same person. Merge those
-- same-name IDs into the most recently active ID before adding uniqueness.
create temporary table profile_user_map on commit drop as
with per_user as (
  select
    lower(btrim(user_name)) as user_name_key,
    user_id,
    max(created_at) as last_seen
  from public.lunch_checkins
  where user_id is not null
    and btrim(user_id) <> ''
    and user_name is not null
    and btrim(user_name) <> ''
  group by lower(btrim(user_name)), user_id
)
select
  user_id,
  first_value(user_id) over (
    partition by user_name_key
    order by last_seen desc nulls last, user_id
  ) as canonical_user_id
from per_user;

-- Avoid a unique-key collision if two old IDs checked in on the same date.
delete from public.lunch_checkins as duplicate
using profile_user_map as mapping
where duplicate.user_id = mapping.user_id
  and mapping.user_id <> mapping.canonical_user_id
  and exists (
    select 1
    from public.lunch_checkins as canonical
    where canonical.user_id = mapping.canonical_user_id
      and canonical.check_date = duplicate.check_date
  );

update public.lunch_checkins as checkin
set user_id = mapping.canonical_user_id
from profile_user_map as mapping
where checkin.user_id = mapping.user_id
  and mapping.user_id <> mapping.canonical_user_id;

create table if not exists public.profiles (
  user_id text primary key,
  user_name text not null,
  user_name_key text generated always as (lower(btrim(user_name))) stored,
  avatar_url text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_user_name_not_blank
    check (char_length(btrim(user_name)) between 1 and 20)
);

alter table public.profiles
  add column if not exists user_name_key text
  generated always as (lower(btrim(user_name))) stored;

create unique index if not exists profiles_user_name_key_unique
  on public.profiles (user_name_key);

-- Recover existing users from their latest check-in without overwriting a
-- profile that has already been edited in the new table.
insert into public.profiles (user_id, user_name, avatar_url, created_at, updated_at)
select distinct on (user_id)
  user_id,
  user_name,
  coalesce(avatar_url, ''),
  coalesce(created_at, timezone('utc', now())),
  timezone('utc', now())
from public.lunch_checkins
where user_id is not null
  and btrim(user_id) <> ''
  and user_name is not null
  and btrim(user_name) <> ''
order by user_id, created_at desc nulls last
on conflict (user_id) do nothing;

create or replace function public.set_profile_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_profile_updated_at();

-- Keep denormalized name/avatar fields on every historical check-in in sync.
create or replace function public.sync_profile_to_lunch_checkins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lunch_checkins
  set
    user_name = new.user_name,
    avatar_url = new.avatar_url
  where user_id = new.user_id
    and (
      user_name is distinct from new.user_name
      or avatar_url is distinct from new.avatar_url
    );
  return new;
end;
$$;

drop trigger if exists sync_profile_to_lunch_checkins on public.profiles;
create trigger sync_profile_to_lunch_checkins
after insert or update of user_name, avatar_url on public.profiles
for each row
execute function public.sync_profile_to_lunch_checkins();

alter table public.profiles enable row level security;

drop policy if exists "Profiles are publicly readable" on public.profiles;
create policy "Profiles are publicly readable"
on public.profiles
for select
to anon, authenticated
using (true);

drop policy if exists "Profiles can be created by app users" on public.profiles;
create policy "Profiles can be created by app users"
on public.profiles
for insert
to anon, authenticated
with check (true);

drop policy if exists "Profiles can be updated by app users" on public.profiles;
create policy "Profiles can be updated by app users"
on public.profiles
for update
to anon, authenticated
using (true)
with check (true);

grant select, insert, update on table public.profiles to anon, authenticated;

-- Enable profile changes in the same Realtime channel used by the page.
do $$
begin
  alter publication supabase_realtime add table public.profiles;
exception
  when duplicate_object then null;
end;
$$;

commit;

-- Optional verification after running the migration:
-- select user_id, user_name, updated_at from public.profiles order by updated_at desc;
