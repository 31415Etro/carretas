alter table public.pmoc_equipment
  add column if not exists client_environment_id uuid references public.client_environments(id) on delete set null,
  add column if not exists client_equipment_id uuid references public.client_equipment(id) on delete set null;

create index if not exists idx_pmoc_equipment_client_environment_id on public.pmoc_equipment(client_environment_id);
create index if not exists idx_pmoc_equipment_client_equipment_id on public.pmoc_equipment(client_equipment_id);
