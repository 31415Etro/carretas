create extension if not exists pgcrypto;

create table if not exists public.comercial_cno_records (
  id uuid primary key default gen_random_uuid(),
  cno text not null unique,
  responsible_name text,
  company_name text,
  zip_code text,
  address text,
  district text,
  city text,
  state text,
  total_area numeric,
  total_area_text text,
  work_status text,
  location_code text,
  phone text,
  email text,
  latitude numeric,
  longitude numeric,
  geocode_status text not null default 'Sem coordenadas',
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.comercial_cno_records
  add column if not exists saved_at timestamptz,
  add column if not exists commercial_status text not null default 'Novo',
  add column if not exists sent_at timestamptz;

create index if not exists comercial_cno_records_state_idx on public.comercial_cno_records (state);
create index if not exists comercial_cno_records_city_idx on public.comercial_cno_records (city);
create index if not exists comercial_cno_records_district_idx on public.comercial_cno_records (district);
create index if not exists comercial_cno_records_geocode_status_idx on public.comercial_cno_records (geocode_status);
create index if not exists comercial_cno_records_saved_at_idx on public.comercial_cno_records (saved_at);
create index if not exists comercial_cno_records_commercial_status_idx on public.comercial_cno_records (commercial_status);
create index if not exists comercial_cno_records_location_idx on public.comercial_cno_records (latitude, longitude);
create index if not exists comercial_cno_records_search_idx on public.comercial_cno_records
  using gin (
    to_tsvector(
      'portuguese',
      coalesce(cno, '') || ' ' ||
      coalesce(responsible_name, '') || ' ' ||
      coalesce(company_name, '') || ' ' ||
      coalesce(address, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(state, '') || ' ' ||
      coalesce(district, '')
    )
  );

create or replace function public.set_comercial_cno_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_comercial_cno_updated_at on public.comercial_cno_records;
create trigger trg_comercial_cno_updated_at
before update on public.comercial_cno_records
for each row execute function public.set_comercial_cno_updated_at();

alter table public.comercial_cno_records enable row level security;

drop policy if exists "Authenticated users can read comercial cno records" on public.comercial_cno_records;
create policy "Authenticated users can read comercial cno records"
on public.comercial_cno_records for select
to authenticated
using (true);

drop policy if exists "Authenticated users can write comercial cno records" on public.comercial_cno_records;
create policy "Authenticated users can write comercial cno records"
on public.comercial_cno_records for all
to authenticated
using (true)
with check (true);
