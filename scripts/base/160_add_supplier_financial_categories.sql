alter table public.suppliers
  add column if not exists category_ids uuid[] not null default '{}';

create index if not exists idx_suppliers_category_ids
  on public.suppliers using gin (category_ids);

comment on column public.suppliers.category_ids is
  'Categorias financeiras de saida vinculadas ao fornecedor.';
