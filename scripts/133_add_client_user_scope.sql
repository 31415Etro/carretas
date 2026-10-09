-- Vincula usuarios do portal a um cliente e habilita o perfil Cliente.
-- Script idempotente: pode ser executado novamente sem duplicar estruturas.

alter table public.profiles
  add column if not exists client_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_client_id_fkey'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_client_id_fkey
      foreign key (client_id) references public.clients(id) on delete set null;
  end if;
end $$;

create index if not exists idx_profiles_client_id on public.profiles(client_id);

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role = any (array[
    'admin', 'sdr', 'closer', 'representative', 'manager', 'sd', 'user', 'client'
  ]));

alter table public.profiles drop constraint if exists profiles_client_role_requires_client;
alter table public.profiles
  add constraint profiles_client_role_requires_client
  check (role <> 'client' or client_id is not null);

comment on column public.profiles.client_id is
  'Cliente cujos dados podem ser visualizados pelo usuario com role client.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, email, full_name, role, page_permissions, client_id, active
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'user'),
    coalesce(
      array(select jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'page_permissions', '[]'::jsonb))),
      '{}'::text[]
    ),
    nullif(new.raw_user_meta_data->>'client_id', '')::uuid,
    true
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    role = excluded.role,
    page_permissions = excluded.page_permissions,
    client_id = excluded.client_id,
    updated_at = now();

  return new;
end;
$$;
