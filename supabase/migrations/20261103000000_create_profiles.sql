-- Player profiles: one row per signed-in user (auth.users).
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text not null unique
               check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null
               check (char_length(btrim(display_name)) between 1 and 50),
  bio          text check (char_length(bio) <= 280),
  location     text check (char_length(location) <= 60),
  avatar_url   text check (avatar_url is null or avatar_url ~ '^https://'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is 'Public player profile for each signed-in user.';

-- Keep updated_at current on every edit.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Row Level Security: signed-in players can see profiles; only the owner can write theirs.
alter table public.profiles enable row level security;

create policy "Signed-in users can view profiles"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can create their own profile"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Users can delete their own profile"
  on public.profiles for delete
  to authenticated
  using ((select auth.uid()) = id);

-- Signed-out visitors get no access at all.
revoke all on public.profiles from anon;
