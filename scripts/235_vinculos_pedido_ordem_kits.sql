-- 235 — Vínculos Pedido -> Ordem -> Kits -> Matérias-primas: snapshot técnico versionado e reconciliação assistida.
--  1) Snapshot técnico de cada item de produto do pedido, congelado na CONFIRMAÇÃO (produto, quantidade, medidas, acabamento, acessórios,
--     versões de engenharia/estrutura/kits, kits com componentes e perdas, matérias-primas consolidadas, referência ao desenho).
--     É tirado da composição que a ORDEM DE PRODUÇÃO congelou (não do catálogo de hoje) e nunca é sobrescrito.
--  2) confirm_sales_order passa a congelar o snapshot logo depois de gerar a produção.
--  3) production_link_pendencies: o que está sem vínculo (ordens sem kits/materiais, itens vendidos sem estrutura, kits sem etapa).
--  4) production_order_relink: reconciliação assistida de ordem antiga sem composição (motivo obrigatório, versão = a da própria ordem, auditada).
-- Rode no SQL Editor do Supabase depois de 234. Não apaga nem altera dados existentes (só preenche colunas novas).

alter table public.sales_order_items add column if not exists technical_snapshot jsonb;
alter table public.sales_order_items add column if not exists snapshot_at timestamptz;
alter table public.production_orders add column if not exists technical_snapshot jsonb;

-- ================================================================ 1. Snapshot técnico de um item do pedido
create or replace function public.sales_item_technical_snapshot(p_item uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_i public.sales_order_items%rowtype;
  v_m public.materials%rowtype;
  v_po public.production_orders%rowtype;
  v_cfg public.product_configurations%rowtype;
  v_bom public.product_bom_versions%rowtype;
  v_kits jsonb;
  v_materials jsonb;
  v_has_po boolean;
begin
  select * into v_i from public.sales_order_items where id = p_item;
  if not found then
    raise exception 'Item do pedido não encontrado.';
  end if;
  select * into v_m from public.materials where id = v_i.material_id;
  select * into v_po from public.production_orders where sales_order_item_id = p_item and status <> 'Cancelada' order by created_at limit 1;
  v_has_po := found;
  if v_i.configuration_id is not null then
    select * into v_cfg from public.product_configurations where id = v_i.configuration_id;
  end if;
  select * into v_bom from public.product_bom_versions where id = coalesce(v_po.bom_version_id, v_i.bom_version_id);

  if v_has_po then
    -- composição congelada da ordem: kits (versão e quantidade) e matérias-primas por kit
    select coalesce(jsonb_agg(jsonb_build_object('kit_id', k.kit_id, 'sku', km.internal_code, 'name', km.name, 'kit_version_id', k.kit_version_id, 'version', kv.version, 'quantity', k.quantity,
             'components', coalesce((select jsonb_agg(jsonb_build_object('material_id', c.component_id, 'sku', cm.internal_code, 'name', cm.name, 'unit', c.unit, 'quantity', c.quantity, 'loss_percent', c.loss_percent) order by c.position)
                                     from public.kit_components c join public.materials cm on cm.id = c.component_id where c.kit_version_id = k.kit_version_id), '[]'::jsonb)) order by km.name), '[]'::jsonb)
      into v_kits
      from public.production_order_kits k join public.materials km on km.id = k.kit_id join public.kit_versions kv on kv.id = k.kit_version_id where k.production_order_id = v_po.id;
    select coalesce(jsonb_agg(jsonb_build_object('material_id', pom.material_id, 'sku', mm.internal_code, 'name', mm.name, 'kit_id', pom.kit_id, 'kit', km.name, 'unit', pom.unit, 'required_quantity', pom.required_quantity) order by mm.name, km.name), '[]'::jsonb)
      into v_materials
      from public.production_order_materials pom join public.materials mm on mm.id = pom.material_id join public.materials km on km.id = pom.kit_id where pom.production_order_id = v_po.id;
  elsif v_bom.id is not null then
    -- item atendido pelo estoque: a estrutura vigente no momento da confirmação
    select coalesce(jsonb_agg(jsonb_build_object('kit_id', e.kit_id, 'sku', km.internal_code, 'name', km.name, 'kit_version_id', e.kit_version_id, 'version', kv.version, 'quantity', e.kit_quantity)), '[]'::jsonb)
      into v_kits from (select distinct kit_id, kit_version_id, max(kit_quantity) kit_quantity from public.explode_bom(v_bom.id, greatest(v_i.quantity, 1)) group by kit_id, kit_version_id) e
      join public.materials km on km.id = e.kit_id join public.kit_versions kv on kv.id = e.kit_version_id;
    select coalesce(jsonb_agg(jsonb_build_object('material_id', e.material_id, 'sku', mm.internal_code, 'name', mm.name, 'kit_id', e.kit_id, 'unit', e.unit, 'required_quantity', e.required_quantity)), '[]'::jsonb)
      into v_materials from (select kit_id, material_id, max(unit) unit, sum(required_quantity) required_quantity from public.explode_bom(v_bom.id, greatest(v_i.quantity, 1)) group by kit_id, material_id) e join public.materials mm on mm.id = e.material_id;
  else
    v_kits := '[]'::jsonb; v_materials := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'schema', 1, 'taken_at', now(),
    'product', jsonb_build_object('id', v_i.material_id, 'sku', v_m.internal_code, 'name', v_m.name, 'model', v_m.product_model),
    'quantity', v_i.quantity, 'quantity_to_produce', v_i.quantity_to_produce, 'quantity_from_stock', v_i.quantity_from_stock,
    'production_order_id', case when v_has_po then v_po.id end, 'production_order_code', case when v_has_po then v_po.code end,
    'bom_version', v_bom.version, 'bom_version_id', v_bom.id,
    'engineering_revision', v_cfg.revision_label,
    'configuration', case when v_cfg.id is null then null else jsonb_build_object('id', v_cfg.id, 'status', v_cfg.status, 'summary', v_cfg.summary, 'params', v_cfg.params,
        'finish', (select jsonb_agg(o) from jsonb_array_elements(coalesce(v_cfg.options->'selected', '[]'::jsonb)) o where o->>'group' = 'acabamento'),
        'accessories', (select jsonb_agg(o) from jsonb_array_elements(coalesce(v_cfg.options->'selected', '[]'::jsonb)) o where o->>'group' = 'acessorio'),
        'options', v_cfg.options, 'frozen_at', v_cfg.frozen_at, 'frozen_by', v_cfg.frozen_by) end,
    'drawing', case when v_cfg.id is null then null else jsonb_build_object('configuration_id', v_cfg.id, 'kind', 'parametrico', 'spec', v_cfg.drawing_spec) end,
    'kits', v_kits, 'materials', v_materials,
    'consolidated', coalesce((select jsonb_agg(jsonb_build_object('material_id', x.material_id, 'sku', x.sku, 'name', x.name, 'unit', x.unit, 'required_quantity', x.q))
                              from (select m->>'material_id' material_id, max(m->>'sku') sku, max(m->>'name') name, max(m->>'unit') unit, sum((m->>'required_quantity')::numeric) q
                                    from jsonb_array_elements(v_materials) m group by m->>'material_id') x), '[]'::jsonb));
end;
$$;

-- Congela o snapshot dos itens de produto ainda sem snapshot (nunca sobrescreve) e o copia para a ordem de produção do item.
create or replace function public.sales_order_freeze_snapshots(p_order uuid)
returns integer
language plpgsql
as $$
declare
  v_item record;
  v_snapshot jsonb;
  v_count integer := 0;
begin
  for v_item in select i.id from public.sales_order_items i join public.sales_orders so on so.id = i.sales_order_id
                where i.sales_order_id = p_order and i.line_type = 'Produto' and i.material_id is not null and so.system_company_id = public.request_system_company_id() order by i.position loop
    if exists (select 1 from public.sales_order_items where id = v_item.id and technical_snapshot is null) then
      v_snapshot := public.sales_item_technical_snapshot(v_item.id);
      update public.sales_order_items set technical_snapshot = v_snapshot, snapshot_at = now() where id = v_item.id and technical_snapshot is null;
      v_count := v_count + 1;
    end if;
    update public.production_orders po set technical_snapshot = (select technical_snapshot from public.sales_order_items where id = v_item.id)
     where po.sales_order_item_id = v_item.id and po.technical_snapshot is null;
  end loop;
  return v_count;
end;
$$;

-- ================================================================ 2. Confirmação do pedido congela o snapshot (mesmo corpo da versão do script 224 + 1 chamada)
create or replace function public.confirm_sales_order(p_sales_order_id uuid, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_order public.sales_orders%rowtype;
  v_result jsonb;
  v_docs integer;
  v_receivables jsonb;
  v_frozen integer;
begin
  select * into v_order from public.sales_orders where id = p_sales_order_id for update;
  if not found then
    raise exception 'Pedido de venda não encontrado.';
  end if;
  if v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Este pedido pertence a outra empresa.';
  end if;
  if v_order.status = 'Cancelado' then
    raise exception 'Pedido cancelado não pode ser confirmado.';
  end if;
  if not exists (select 1 from public.sales_order_items where sales_order_id = p_sales_order_id) then
    raise exception 'O pedido não tem itens.';
  end if;
  if v_order.status in ('Rascunho', 'Aguardando confirmacao') then
    update public.sales_orders set status = 'Confirmado', confirmed_by = coalesce(p_user, public.request_actor()) where id = p_sales_order_id;
  end if;
  v_receivables := public.sales_order_generate_receivables(p_sales_order_id, p_user);
  v_docs := public.vehicle_documentation_generate(p_sales_order_id, p_user);
  v_result := public.create_production_from_sale(p_sales_order_id, p_user);
  v_frozen := public.sales_order_freeze_snapshots(p_sales_order_id);
  return v_result || jsonb_build_object('documentation_created', v_docs, 'receivables', v_receivables, 'release', public.production_eligibility(p_sales_order_id), 'snapshots_frozen', v_frozen);
end;
$$;

-- ================================================================ 3. Pendências de vínculo
create or replace function public.production_link_pendencies()
returns jsonb
language plpgsql
stable
as $$
declare
  v_company uuid := public.request_system_company_id();
begin
  return jsonb_build_object(
    -- ordens abertas sem kits ou sem matérias-primas congelados
    'orders_without_composition', coalesce((
      select jsonb_agg(jsonb_build_object('id', po.id, 'code', po.code, 'product', m.name, 'sales_order', so.order_number, 'status', po.status, 'bom_version', bv.version,
             'missing', case when not exists (select 1 from public.production_order_kits k where k.production_order_id = po.id) then 'kits' else 'materiais' end,
             'bom_has_kits', exists (select 1 from public.product_kits pk where pk.bom_version_id = po.bom_version_id)) order by po.created_at)
      from public.production_orders po join public.materials m on m.id = po.product_id left join public.product_bom_versions bv on bv.id = po.bom_version_id left join public.sales_orders so on so.id = po.sales_order_id
      where po.system_company_id = v_company and po.status not in ('Concluida', 'Cancelada')
        and (not exists (select 1 from public.production_order_kits k where k.production_order_id = po.id) or not exists (select 1 from public.production_order_materials pm where pm.production_order_id = po.id))), '[]'::jsonb),
    -- itens vendidos (pedido não cancelado) cujo produto não tem estrutura ativa com kits
    'items_without_structure', coalesce((
      select jsonb_agg(jsonb_build_object('sales_order', so.order_number, 'sales_order_id', so.id, 'item_id', i.id, 'product', m.name, 'sku', m.internal_code,
             'problem', case when bv.id is null then 'sem estrutura de fabricação ativa' else 'a estrutura ativa não tem kits' end) order by so.order_number, i.position)
      from public.sales_order_items i join public.sales_orders so on so.id = i.sales_order_id join public.materials m on m.id = i.material_id
      left join public.product_bom_versions bv on bv.product_id = m.id and bv.status = 'Ativa'
      where so.system_company_id = v_company and so.status not in ('Cancelado', 'Entregue', 'Atendido') and i.line_type = 'Produto' and m.item_type = 'Produto'
        and (bv.id is null or not exists (select 1 from public.product_kits pk where pk.bom_version_id = bv.id))), '[]'::jsonb),
    -- kits de ordens abertas que nenhuma etapa da esteira usa (o colaborador não os veria em nenhuma tarefa)
    'kits_without_step', coalesce((
      select jsonb_agg(distinct jsonb_build_object('kit_id', k.kit_id, 'kit', km.name, 'sku', km.internal_code))
      from public.production_order_kits k join public.production_orders po on po.id = k.production_order_id join public.materials km on km.id = k.kit_id
      where po.system_company_id = v_company and po.status not in ('Concluida', 'Cancelada')
        and not exists (select 1 from public.shop_step_kits sk where sk.kit_id = k.kit_id and sk.system_company_id = v_company)
        and not exists (select 1 from public.shop_steps s where s.system_company_id = v_company and s.active and s.kit_match is not null and s.kit_match <> '*' and coalesce(km.category, '') ilike '%' || s.kit_match || '%')), '[]'::jsonb)
  );
end;
$$;

-- ================================================================ 4. Reconciliação assistida de uma ordem sem composição
create or replace function public.production_order_relink(p_order uuid, p_reason text, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_po public.production_orders%rowtype;
  v_company uuid := public.request_system_company_id();
  v_kits integer;
  v_materials integer;
begin
  if coalesce(btrim(p_reason), '') = '' or length(btrim(p_reason)) < 10 then
    raise exception 'Informe o motivo da reconciliação (mínimo 10 caracteres).';
  end if;
  select * into v_po from public.production_orders where id = p_order and system_company_id = v_company for update;
  if not found then
    raise exception 'Ordem de produção não encontrada.';
  end if;
  if v_po.status in ('Concluida', 'Cancelada') then
    raise exception 'A ordem está % e não pode ser reconciliada.', lower(v_po.status);
  end if;
  if exists (select 1 from public.production_order_kits where production_order_id = p_order) and exists (select 1 from public.production_order_materials where production_order_id = p_order) then
    raise exception 'A ordem já tem kits e matérias-primas congelados: não há o que reconciliar.';
  end if;
  if v_po.bom_version_id is null or not exists (select 1 from public.product_kits where bom_version_id = v_po.bom_version_id) then
    raise exception 'A estrutura vinculada à ordem não tem kits: vincule os kits ao produto em Estoque > Produtos finais e tente de novo.';
  end if;
  -- usa SEMPRE a versão de estrutura que a própria ordem já registra (nunca uma versão escolhida agora)
  insert into public.production_order_kits (production_order_id, kit_id, kit_version_id, quantity, system_company_id)
  select p_order, e.kit_id, e.kit_version_id, max(e.kit_quantity), v_company from public.explode_bom(v_po.bom_version_id, v_po.quantity) e group by e.kit_id, e.kit_version_id
  on conflict (production_order_id, kit_id) do nothing;
  insert into public.production_order_materials (production_order_id, material_id, kit_id, unit, required_quantity, estimated_unit_cost, system_company_id)
  select p_order, e.material_id, e.kit_id, max(e.unit), sum(e.required_quantity), public.material_unit_cost(e.material_id), v_company from public.explode_bom(v_po.bom_version_id, v_po.quantity) e group by e.material_id, e.kit_id
  on conflict (production_order_id, material_id, kit_id) do nothing;
  select count(*) into v_kits from public.production_order_kits where production_order_id = p_order;
  select count(*) into v_materials from public.production_order_materials where production_order_id = p_order;
  insert into public.production_events (production_order_id, event, description, actor, system_company_id)
  values (p_order, 'Reconciliação de composição', 'Kits e matérias-primas vinculados pela estrutura v' || (select version from public.product_bom_versions where id = v_po.bom_version_id) || ' (a registrada na ordem). Motivo: ' || btrim(p_reason), coalesce(p_user, public.request_actor()), v_company);
  update public.production_orders set technical_snapshot = null where id = p_order;
  if v_po.sales_order_item_id is not null then
    update public.sales_order_items set technical_snapshot = null, snapshot_at = null where id = v_po.sales_order_item_id and technical_snapshot is not null and (technical_snapshot->'kits') = '[]'::jsonb;
    perform public.sales_order_freeze_snapshots(v_po.sales_order_id);
  end if;
  return jsonb_build_object('production_order_id', p_order, 'kits', v_kits, 'materials', v_materials);
end;
$$;
