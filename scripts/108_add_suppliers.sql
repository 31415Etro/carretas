create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  document text,
  contact_name text,
  phone text,
  email text,
  category text,
  city text,
  state text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_suppliers_status on public.suppliers(status);
create index if not exists idx_suppliers_name on public.suppliers(name);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table public.suppliers enable row level security;

drop policy if exists "suppliers_service_role_all" on public.suppliers;
create policy "suppliers_service_role_all"
on public.suppliers
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop trigger if exists trg_suppliers_updated_at on public.suppliers;
create trigger trg_suppliers_updated_at
before update on public.suppliers
for each row
execute function public.set_updated_at();
