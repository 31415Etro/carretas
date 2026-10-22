-- DIAGNÓSTICO SOMENTE LEITURA das migrações 217 a 220. Cole no SQL Editor do Supabase e rode (não altera nada).
-- Cada bloco devolve uma tabela. "esperado" diz o que deve aparecer; qualquer linha com problema = 'FALTA' ou 'DIVERGE'.

-- 1) Índices e restrições criados
select 'indice' as tipo, i.name as item, case when exists (select 1 from pg_indexes where schemaname = 'public' and indexname = i.name) then 'OK' else 'FALTA' end as situacao,
       case i.name when 'materials_sku_uidx' then 'FALTA = ainda há SKU repetido (resolver sem apagar e rodar o 217 de novo)' else '' end as observacao
from (values ('materials_sku_uidx'), ('warehouses_single_default_company_uidx'), ('kit_versions_single_active_uidx'), ('product_bom_single_active_uidx'), ('production_orders_item_uidx'),
             ('raw_material_suppliers_primary_uidx'), ('production_consumptions_request_uidx'), ('production_receipts_request_uidx'), ('purchase_requests_open_order_uidx'), ('sales_orders_quote_uidx')) as i(name);

-- 2) Funções esperadas
select 'funcao' as tipo, f.name as item, case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f.name) then 'OK' else 'FALTA' end as situacao
from (values ('next_item_sku'), ('find_item_by_sku'), ('item_has_history'), ('change_item_sku'), ('materials_sku_guard'), ('materials_validate_by_type'), ('sellable_item_guard'), ('material_unit_cost'),
             ('company_default_warehouse'), ('stock_movements_company_guard'), ('transfer_stock_between_companies'), ('material_availability'), ('apply_stock_movement'),
             ('kit_versions_validate'), ('kit_components_validate'), ('kit_has_cycle'), ('kit_new_version'), ('kit_activate_version'), ('kit_version_cost'),
             ('product_bom_versions_validate'), ('product_kits_validate'), ('product_bom_new_version'), ('product_bom_activate_version'), ('explode_bom'), ('explode_kit_version'), ('product_bom_cost'), ('migrate_legacy_compositions'),
             ('next_sales_order_number'), ('next_production_code'), ('plan_materials'), ('create_production_from_sale'), ('confirm_sales_order'), ('reserve_production_materials'), ('generate_purchase_request'),
             ('record_production_consumption'), ('complete_production'), ('adjust_production_cost'), ('cancel_production_order'), ('product_capacity'), ('production_history_immutable'),
             ('raw_material_list'), ('raw_material_detail'), ('raw_material_set_suppliers')) as f(name);

-- 3) Gatilhos que devem existir
select 'gatilho' as tipo, t.tabela || '.' || t.nome as item, case when exists (select 1 from information_schema.triggers where trigger_schema = 'public' and event_object_table = t.tabela and trigger_name = t.nome) then 'OK' else 'FALTA' end as situacao
from (values ('materials', 'trg_materials_sku_guard'), ('materials', 'trg_materials_validate_by_type'), ('quote_items', 'trg_quote_items_sellable'), ('stock_movements', 'trg_stock_movements_company_guard'),
             ('warehouses', 'assign_system_company'), ('stock_reservations', 'assign_system_company'), ('kit_versions', 'trg_kit_versions_validate'), ('kit_components', 'trg_kit_components_validate'),
             ('product_bom_versions', 'trg_product_bom_versions_validate'), ('product_kits', 'trg_product_kits_validate'), ('production_orders', 'assign_system_company'),
             ('production_receipts', 'trg_production_receipts_immutable'), ('production_consumptions', 'trg_production_consumptions_immutable'), ('sales_order_items', 'trg_sales_order_items_sellable')) as t(tabela, nome);

-- 4) RLS ligada e políticas nas tabelas novas (tabelas operacionais devem ter tenant_company_isolation; as de catálogo, shared_authenticated_access)
select c.relname as tabela, c.relrowsecurity as rls_ligada,
       coalesce((select string_agg(p.polname, ', ' order by p.polname) from pg_policy p where p.polrelid = c.oid), '(nenhuma)') as politicas
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname in (
  'raw_material_suppliers', 'ncm_classifications', 'item_sku_counters', 'item_sku_history', 'stock_company_transfers', 'kit_versions', 'kit_components', 'product_bom_versions', 'product_kits',
  'sales_orders', 'sales_order_items', 'production_orders', 'production_order_kits', 'production_order_materials', 'production_consumptions', 'production_receipts',
  'production_cost_allocations', 'production_cost_adjustments', 'purchase_requests', 'purchase_request_items', 'warehouses', 'stock_reservations')
order by c.relname;

-- 5) Chaves estrangeiras das tabelas novas (devem ser todas validadas)
select conrelid::regclass as tabela, conname as restricao, convalidated as validada from pg_constraint
where contype = 'f' and conrelid::regclass::text in ('kit_versions', 'kit_components', 'product_bom_versions', 'product_kits', 'sales_orders', 'sales_order_items', 'production_orders', 'production_order_kits',
  'production_order_materials', 'production_consumptions', 'production_receipts', 'raw_material_suppliers') and not convalidated;

-- 6) Integridade de dados
select 'SKU repetido' as verificacao, lower(btrim(internal_code)) as detalhe, count(*) as quantidade from public.materials where internal_code is not null and btrim(internal_code) <> '' group by 2 having count(*) > 1
union all
select 'empresa sem depósito padrão', c.name, 0 from public.system_companies c where not exists (select 1 from public.warehouses w where w.system_company_id = c.id and w.is_default)
union all
select 'kit sem prefixo KIT-', internal_code, 1 from public.materials where item_type = 'Kit' and internal_code is not null and internal_code !~* '^KIT-'
union all
select 'versão de kit apontando para item que não é Kit', kv.id::text, 1 from public.kit_versions kv join public.materials m on m.id = kv.kit_id where m.item_type <> 'Kit'
union all
select 'componente de kit que não é matéria-prima (fora multinível)', kc.id::text, 1 from public.kit_components kc join public.kit_versions kv on kv.id = kc.kit_version_id join public.materials m on m.id = kc.component_id
  where m.item_type <> 'Materia-prima' and kv.composition_kind <> 'multinivel';

-- 7) Quantos itens de cada tipo e se a coluna de empresa dos depósitos está preenchida
select item_type, count(*) as itens from public.materials group by item_type order by item_type;
select code, name, is_default, system_company_id from public.warehouses order by system_company_id;
