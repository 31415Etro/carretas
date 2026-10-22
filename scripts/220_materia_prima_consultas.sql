-- 220: consultas da tela de matéria-prima (lista e página de detalhes). SOMENTE LEITURA: só cria funções. Requer 217, 218 e 219.
-- Tudo que é operacional (saldo, compras, movimentos, produção) vem da EMPRESA em uso (request_system_company_id); o cadastro do item é compartilhado.

-- Lista de matérias-primas com custo vigente e posição de estoque da empresa.
create or replace function public.raw_material_list(p_search text default null, p_status text default null, p_only_below_min boolean default false)
returns table (
  id uuid, sku text, name text, category text, subcategory text, unit text, status text, ncm text, photo_url text,
  unit_cost numeric, last_purchase_cost numeric, minimum_stock numeric, reorder_point numeric, maximum_stock numeric,
  physical numeric, reserved numeric, available numeric, incoming numeric, below_minimum boolean, needs_reorder boolean,
  primary_supplier text, kits_count integer, allows_sale boolean
)
language sql
stable
as $$
  select m.id, m.internal_code, m.name, m.category, m.subcategory, m.unit, m.status, m.ncm, m.photo_url,
         public.material_unit_cost(m.id), m.last_purchase_cost, m.minimum_stock, m.reorder_point, m.maximum_stock,
         av.physical, av.reserved, av.available, av.incoming,
         (m.minimum_stock > 0 and av.physical < m.minimum_stock),
         (m.reorder_point > 0 and av.available + av.incoming <= m.reorder_point),
         (select s.name from public.raw_material_suppliers rs join public.suppliers s on s.id = rs.supplier_id where rs.material_id = m.id and rs.is_primary limit 1),
         (select count(distinct kv.kit_id)::integer from public.kit_components kc join public.kit_versions kv on kv.id = kc.kit_version_id where kc.component_id = m.id and kv.status <> 'Obsoleta'),
         m.allows_sale
  from public.materials m
  cross join lateral public.material_availability(m.id) av
  where m.item_type = 'Materia-prima'
    and (p_status is null or p_status = '' or m.status = p_status)
    and (p_search is null or btrim(p_search) = ''
         or m.name ilike '%' || btrim(p_search) || '%' or m.internal_code ilike '%' || btrim(p_search) || '%'
         or m.category ilike '%' || btrim(p_search) || '%' or m.supplier_code ilike '%' || btrim(p_search) || '%')
    and (not p_only_below_min or (m.minimum_stock > 0 and av.physical < m.minimum_stock))
  order by m.name
$$;

-- Detalhes de uma matéria-prima: fornecedores, estoque por depósito, compras, movimentações, kits que a usam e ordens de produção que a consomem.
create or replace function public.raw_material_detail(p_material_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_company uuid := public.request_system_company_id();
  v_material jsonb;
begin
  select to_jsonb(m) into v_material from public.materials m where m.id = p_material_id and m.item_type = 'Materia-prima';
  if v_material is null then
    raise exception 'Matéria-prima não encontrada.';
  end if;
  return jsonb_build_object(
    'material', v_material || jsonb_build_object('unit_cost', public.material_unit_cost(p_material_id)),
    'availability', (select to_jsonb(av) from public.material_availability(p_material_id) av),
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('id', rs.id, 'supplier_id', rs.supplier_id, 'supplier_name', s.name, 'supplier_document', s.document,
        'supplier_code', rs.supplier_code, 'is_primary', rs.is_primary, 'last_cost', rs.last_cost, 'lead_time_days', rs.lead_time_days,
        'min_purchase_qty', rs.min_purchase_qty, 'notes', rs.notes) order by rs.is_primary desc, s.name)
      from public.raw_material_suppliers rs join public.suppliers s on s.id = rs.supplier_id where rs.material_id = p_material_id), '[]'::jsonb),
    'stock_by_warehouse', coalesce((select jsonb_agg(jsonb_build_object('warehouse_id', w.id, 'warehouse', w.name, 'code', w.code, 'quantity', b.quantity) order by w.name)
      from public.stock_balances b join public.warehouses w on w.id = b.warehouse_id where b.material_id = p_material_id and w.system_company_id = v_company), '[]'::jsonb),
    'purchases', coalesce((select jsonb_agg(x order by x->>'order_date' desc) from (
      select jsonb_build_object('purchase_order_id', o.id, 'order_number', o.order_number, 'order_date', o.order_date, 'status', o.status, 'supplier_name', o.supplier_name,
        'quantity', i.quantity, 'received_quantity', i.received_quantity, 'unit_cost', i.unit_cost, 'total', i.total) x
      from public.purchase_order_items i join public.purchase_orders o on o.id = i.purchase_order_id
      where i.material_id = p_material_id and o.system_company_id = v_company order by o.order_date desc limit 50) q), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(x order by x->>'occurred_at' desc) from (
      select jsonb_build_object('id', sm.id, 'movement_type', sm.movement_type, 'quantity', sm.quantity, 'unit_cost', sm.unit_cost, 'total_cost', sm.total_cost,
        'occurred_at', sm.occurred_at, 'document_reference', sm.document_reference, 'responsible', sm.responsible, 'reason', sm.reason,
        'from_warehouse', wf.name, 'to_warehouse', wt.name, 'balance_after', sm.balance_after) x
      from public.stock_movements sm
      left join public.warehouses wf on wf.id = sm.from_warehouse_id
      left join public.warehouses wt on wt.id = sm.to_warehouse_id
      where sm.material_id = p_material_id and coalesce(wf.system_company_id, wt.system_company_id) = v_company
      order by sm.occurred_at desc limit 100) q), '[]'::jsonb),
    'kits', coalesce((select jsonb_agg(jsonb_build_object('kit_id', k.id, 'kit_sku', k.internal_code, 'kit_name', k.name, 'version_id', kv.id, 'version', kv.version,
        'version_status', kv.status, 'quantity', kc.quantity, 'unit', kc.unit, 'loss_percent', kc.loss_percent,
        'products', (select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'product_sku', p.internal_code, 'product_name', p.name) order by p.name), '[]'::jsonb)
                     from public.product_kits pk join public.product_bom_versions bv on bv.id = pk.bom_version_id and bv.status = 'Ativa'
                     join public.materials p on p.id = bv.product_id where pk.kit_id = k.id)) order by k.name, kv.version desc)
      from public.kit_components kc join public.kit_versions kv on kv.id = kc.kit_version_id join public.materials k on k.id = kv.kit_id
      where kc.component_id = p_material_id and kv.status <> 'Obsoleta'), '[]'::jsonb),
    'production', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object('production_order_id', po.id, 'code', po.code, 'status', po.status, 'product_name', pm.name, 'required', sum(pom.required_quantity),
        'reserved', sum(pom.reserved_quantity), 'consumed', sum(pom.consumed_quantity), 'created_at', po.created_at) x
      from public.production_order_materials pom join public.production_orders po on po.id = pom.production_order_id join public.materials pm on pm.id = po.product_id
      where pom.material_id = p_material_id and po.system_company_id = v_company group by po.id, pm.name order by po.created_at desc limit 50) q), '[]'::jsonb),
    'ncm', jsonb_build_object('code', v_material->>'ncm', 'description', v_material->>'ncm_description', 'source', v_material->>'ncm_source',
        'confirmed_by', v_material->>'ncm_confirmed_by', 'confirmed_at', v_material->>'ncm_confirmed_at', 'valid_from', v_material->>'ncm_valid_from'),
    'sku_history', coalesce((select jsonb_agg(jsonb_build_object('old_sku', h.old_sku, 'new_sku', h.new_sku, 'reason', h.reason, 'changed_by', h.changed_by, 'changed_at', h.changed_at) order by h.changed_at desc)
      from public.item_sku_history h where h.material_id = p_material_id), '[]'::jsonb)
  );
end;
$$;

-- Salva a lista de fornecedores da matéria-prima de uma vez (substitui; um único principal). Atômico.
create or replace function public.raw_material_set_suppliers(p_material_id uuid, p_suppliers jsonb)
returns void
language plpgsql
as $$
declare
  v_item jsonb;
  v_primary integer := 0;
begin
  if not exists (select 1 from public.materials where id = p_material_id and item_type = 'Materia-prima') then
    raise exception 'Matéria-prima não encontrada.';
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_suppliers, '[]'::jsonb)) loop
    if coalesce((v_item->>'is_primary')::boolean, false) then
      v_primary := v_primary + 1;
    end if;
  end loop;
  if v_primary > 1 then
    raise exception 'Informe apenas um fornecedor principal.';
  end if;
  delete from public.raw_material_suppliers where material_id = p_material_id;
  for v_item in select * from jsonb_array_elements(coalesce(p_suppliers, '[]'::jsonb)) loop
    insert into public.raw_material_suppliers (material_id, supplier_id, supplier_code, is_primary, last_cost, lead_time_days, min_purchase_qty, notes)
    values (p_material_id, (v_item->>'supplier_id')::uuid, nullif(v_item->>'supplier_code', ''), coalesce((v_item->>'is_primary')::boolean, false),
            nullif(v_item->>'last_cost', '')::numeric, nullif(v_item->>'lead_time_days', '')::integer, nullif(v_item->>'min_purchase_qty', '')::numeric, nullif(v_item->>'notes', ''));
  end loop;
  -- o fornecedor principal também fica no cadastro do item (compatibilidade com as telas atuais)
  update public.materials m set supplier_id = (select supplier_id from public.raw_material_suppliers where material_id = p_material_id and is_primary),
                                supplier_code = (select supplier_code from public.raw_material_suppliers where material_id = p_material_id and is_primary)
  where m.id = p_material_id and exists (select 1 from public.raw_material_suppliers where material_id = p_material_id and is_primary);
end;
$$;
