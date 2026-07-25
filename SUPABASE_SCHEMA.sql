-- Supabase Auth + server-side free trial for Piance.
-- Run this file in Supabase SQL Editor after creating the project.

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  free_trial_used integer not null default 0 check (free_trial_used >= 0),
  free_trial_limit integer not null default 3 check (free_trial_limit >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.user_profiles;
create policy "Users can read their own profile"
on public.user_profiles
for select
to authenticated
using (auth.uid() = id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_profiles_updated_at on public.user_profiles;
create trigger set_user_profiles_updated_at
before update on public.user_profiles
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
  set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

create or replace function public.increment_trial(p_user_id uuid)
returns table (free_trial_used integer, free_trial_limit integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and auth.uid() <> p_user_id then
    raise exception 'not allowed';
  end if;

  update public.user_profiles
  set free_trial_used = user_profiles.free_trial_used + 1
  where id = p_user_id
    and user_profiles.free_trial_used < user_profiles.free_trial_limit
  returning user_profiles.free_trial_used, user_profiles.free_trial_limit
  into increment_trial.free_trial_used, increment_trial.free_trial_limit;

  if not found then
    select user_profiles.free_trial_used, user_profiles.free_trial_limit
    into increment_trial.free_trial_used, increment_trial.free_trial_limit
    from public.user_profiles
    where id = p_user_id;

    if not found then
      raise exception 'profile not found';
    end if;

    if increment_trial.free_trial_used >= increment_trial.free_trial_limit then
      raise exception 'free trial exhausted';
    end if;
  end if;

  return next;
end;
$$;

revoke all on function public.increment_trial(uuid) from public;
grant execute on function public.increment_trial(uuid) to authenticated, service_role;
