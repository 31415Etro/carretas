-- PATCH (instalacao em banco vazio): o script base/159 cria indices unicos
-- (system_company_id, name/plate) em service_types e vehicles, mas essas tabelas
-- nao estao na lista de tabelas com escopo de empresa do proprio 159 (no sistema
-- antigo a coluna ja existia). Em banco vazio o 159 falharia com
-- 'column "system_company_id" does not exist'. Este patch roda ANTES do 159.
alter table public.service_types add column if not exists system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid;
alter table public.vehicles      add column if not exists system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid;
