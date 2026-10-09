-- Vincula Tipos de Serviço aos Kits de Estoque.
-- Execute no Supabase SQL Editor antes de usar o campo "Kit vinculado" no cadastro de serviço.

alter table public.service_types
add column if not exists kit_id uuid references public.stock_kits(id) on delete set null;

create index if not exists idx_service_types_kit_id
on public.service_types(kit_id);
