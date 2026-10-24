-- 233 — Produtos da oportunidade: vários produtos do catálogo, cada um com quantidade e preço (vindo do cadastro do produto).
-- O valor estimado da oportunidade passa a ser a soma dos itens; o orçamento (proposta) gerado já nasce com esses produtos.
-- Rode no SQL Editor do Supabase. Não apaga nem altera dados existentes.

create table if not exists public.opportunity_items (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  product_id uuid references public.materials(id) on delete set null,
  description text not null,
  unit text not null default 'UN',
  quantity numeric(14,4) not null default 1 check (quantity > 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);

create index if not exists opportunity_items_opportunity_idx on public.opportunity_items (opportunity_id, position);

drop trigger if exists assign_system_company on public.opportunity_items;
create trigger assign_system_company before insert on public.opportunity_items for each row execute function public.assign_request_system_company();
alter table public.opportunity_items enable row level security;
drop policy if exists tenant_authenticated_access on public.opportunity_items;
drop policy if exists tenant_company_isolation on public.opportunity_items;
create policy tenant_authenticated_access on public.opportunity_items as permissive for all to authenticated using (true) with check (true);
create policy tenant_company_isolation on public.opportunity_items as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id());

-- Oportunidades antigas com produto do catálogo ganham um item (quantidade 1, valor estimado como preço) para não perder a informação.
insert into public.opportunity_items (opportunity_id, product_id, description, unit, quantity, unit_price, position, system_company_id)
select o.id, o.material_id, coalesce(nullif(o.interest, ''), m.name), coalesce(m.unit, 'UN'), 1, o.estimated_value, 0, o.system_company_id
  from public.opportunities o
  join public.materials m on m.id = o.material_id
 where not exists (select 1 from public.opportunity_items i where i.opportunity_id = o.id);
