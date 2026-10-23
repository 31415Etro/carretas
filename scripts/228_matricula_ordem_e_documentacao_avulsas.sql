-- 228: (1) matrícula do colaborador gerada pelo sistema; (2) ordem de produção aberta direto na produção (sem pedido de venda);
--      (3) documentação veicular aberta sem pedido de venda (avulsa ou ligada a uma ordem de produção).
-- ADITIVA e idempotente. Requer 217 a 227. Não altera dados existentes: só afrouxa duas colunas (pedido e item do pedido passam a aceitar vazio) e recria funções.
-- Contratos já podem ser criados sem orçamento (botão "Novo contrato"), então nada muda em contratos.

-- ================================================================ 1. Matrícula automática (F0001, F0002...)
create or replace function public.shop_next_worker_code()
returns text
language plpgsql
as $$
declare
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtext('shop_worker_code:' || public.shop_cid()::text));
  select coalesce(max(substring(code from '^F([0-9]+)$')::integer), 0) + 1 into v_next from public.shop_workers where system_company_id = public.shop_cid() and code ~ '^F[0-9]+$';
  return 'F' || lpad(v_next::text, 4, '0');
end;
$$;

-- A matrícula é SEMPRE gerada na criação (o que vier no formulário é ignorado) e não muda depois.
create or replace function public.shop_worker_save(p jsonb, p_user text default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := nullif(p->>'worker_id', '')::uuid;
  v_pin text := nullif(p->>'pin', '');
  v_sectors text[];
begin
  if v_pin is not null and v_pin !~ '^[0-9]{4,8}$' then
    raise exception 'O PIN deve ter de 4 a 8 números.';
  end if;
  select coalesce(array_agg(x), '{}') into v_sectors from jsonb_array_elements_text(coalesce(p->'sectors', '[]'::jsonb)) x;
  if v_id is null then
    if coalesce(btrim(p->>'name'), '') = '' then
      raise exception 'Informe o nome do colaborador.';
    end if;
    begin
      insert into public.shop_workers (code, name, profile_id, sectors, shift, hourly_rate, is_inspector, is_supervisor, pin_hash, pin_set_at, created_by)
      values (public.shop_next_worker_code(), btrim(p->>'name'), nullif(p->>'profile_id', '')::uuid, v_sectors, nullif(btrim(p->>'shift'), ''), coalesce(nullif(p->>'hourly_rate', '')::numeric, 0),
              coalesce((p->>'is_inspector')::boolean, false), coalesce((p->>'is_supervisor')::boolean, false), case when v_pin is not null then crypt(v_pin, gen_salt('bf')) end, case when v_pin is not null then now() end, coalesce(p_user, public.request_actor()))
      returning id into v_id;
    exception when unique_violation then
      raise exception 'Este login do ERP já está ligado a outro colaborador.';
    end;
  else
    update public.shop_workers set name = coalesce(nullif(btrim(p->>'name'), ''), name), sectors = case when p ? 'sectors' then v_sectors else sectors end, shift = case when p ? 'shift' then nullif(btrim(p->>'shift'), '') else shift end,
      hourly_rate = coalesce(nullif(p->>'hourly_rate', '')::numeric, hourly_rate), is_inspector = coalesce((p->>'is_inspector')::boolean, is_inspector), is_supervisor = coalesce((p->>'is_supervisor')::boolean, is_supervisor),
      active = coalesce((p->>'active')::boolean, active), profile_id = case when p ? 'profile_id' then nullif(p->>'profile_id', '')::uuid else profile_id end,
      pin_hash = case when v_pin is not null then crypt(v_pin, gen_salt('bf')) else pin_hash end, pin_set_at = case when v_pin is not null then now() else pin_set_at end,
      failed_attempts = case when v_pin is not null then 0 else failed_attempts end, locked_until = case when v_pin is not null then null else locked_until end
    where id = v_id and system_company_id = public.shop_cid();
    if not found then
      raise exception 'Colaborador não encontrado.';
    end if;
    if p ? 'active' and not coalesce((p->>'active')::boolean, true) then
      update public.shop_sessions set ended_at = clock_timestamp() where worker_id = v_id and ended_at is null;
    end if;
  end if;
  return v_id;
end;
$$;

-- ================================================================ 2. Documentação veicular sem pedido de venda
alter table public.vehicle_documentation alter column sales_order_id drop not null;
alter table public.vehicle_documentation alter column sales_order_item_id drop not null;
alter table public.vehicle_documentation add column if not exists production_order_id uuid references public.production_orders(id) on delete restrict;
create index if not exists vehicle_documentation_production_idx on public.vehicle_documentation (production_order_id) where production_order_id is not null;
-- uma documentação por unidade de uma ordem avulsa (as do pedido continuam únicas por item do pedido)
create unique index if not exists vehicle_documentation_manual_unit_uidx on public.vehicle_documentation (production_order_id, unit_number) where production_order_id is not null and sales_order_item_id is null and status <> 'Cancelado';

create or replace function public.vehicle_doc_status_log()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.vehicle_doc_log(new.id, 'Criada', 'Documentação da unidade ' || new.unit_number || case when new.sales_order_id is null then ' criada sem pedido de venda.' else ' criada para o pedido.' end, null, new.created_by);
  elsif new.status is distinct from old.status then
    perform public.vehicle_doc_log(new.id, 'Situação', 'Situação alterada de ' || old.status || ' para ' || new.status || '.');
    if new.sales_order_id is not null then
      perform public.sales_order_refresh(new.sales_order_id);  -- a liberação da produção depende destas situações
    end if;
  end if;
  return null;
end;
$$;

-- p: { client_id, product_id, production_order_id?, vin?, notes? }. Com ordem de produção, usa a próxima unidade livre da ordem.
create or replace function public.vehicle_documentation_create_manual(p jsonb, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_client public.clients%rowtype;
  v_product public.materials%rowtype;
  v_po public.production_orders%rowtype;
  v_po_id uuid := nullif(p->>'production_order_id', '')::uuid;
  v_unit integer := 1;
  v_vin text := upper(btrim(coalesce(p->>'vin', '')));
  v_id uuid := gen_random_uuid();
  v_bom uuid;
begin
  select * into v_client from public.clients where id = nullif(p->>'client_id', '')::uuid;
  if not found then
    raise exception 'Escolha o cliente (proprietário) da documentação.';
  end if;
  if v_po_id is not null then
    select * into v_po from public.production_orders where id = v_po_id and system_company_id = public.request_system_company_id();
    if not found then
      raise exception 'Ordem de produção não encontrada.';
    end if;
    if v_po.status = 'Cancelada' then
      raise exception 'A ordem % está cancelada.', v_po.code;
    end if;
    select * into v_product from public.materials where id = v_po.product_id;
    select min(n) into v_unit from generate_series(1, greatest(ceil(v_po.quantity)::integer, 1)) n
      where not exists (select 1 from public.vehicle_documentation d where d.production_order_id = v_po.id and d.unit_number = n and d.sales_order_item_id is null and d.status <> 'Cancelado')
        and not exists (select 1 from public.vehicle_documentation d where v_po.sales_order_item_id is not null and d.sales_order_item_id = v_po.sales_order_item_id and d.unit_number = n and d.status <> 'Cancelado');
    if v_unit is null then
      raise exception 'Todas as unidades da ordem % já têm documentação.', v_po.code;
    end if;
  else
    select * into v_product from public.materials where id = nullif(p->>'product_id', '')::uuid and item_type = 'Produto';
    if not found then
      raise exception 'Escolha o produto (carreta).';
    end if;
  end if;
  if v_product.item_type is distinct from 'Produto' then
    raise exception 'A documentação veicular é para produto final.';
  end if;
  if v_vin <> '' and v_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' then
    raise exception 'Chassi (VIN) inválido: 17 caracteres, sem I, O e Q.';
  end if;
  select id into v_bom from public.product_bom_versions where product_id = v_product.id and status = 'Ativa';
  begin
    insert into public.vehicle_documentation (id, sales_order_id, sales_order_item_id, production_order_id, unit_number, client_id, product_id, bom_version_id, product_name, product_model, vin, notes, created_by, system_company_id)
    values (v_id, null, null, v_po_id, v_unit, v_client.id, v_product.id, v_bom, v_product.name, coalesce(v_product.product_model, ''), nullif(v_vin, ''), nullif(btrim(p->>'notes'), ''), coalesce(p_user, public.request_actor()), public.request_system_company_id());
  exception when unique_violation then
    raise exception 'Este chassi já está em outra documentação ativa.';
  end;
  return jsonb_build_object('documentation_id', v_id, 'unit_number', v_unit, 'production_order_id', v_po_id);
end;
$$;

-- Listas e detalhe passam a aceitar documentação sem pedido (o pedido vira "Avulsa" ou o código da ordem).
create or replace function public.vehicle_doc_list(p_search text default null, p_status text default null, p_order uuid default null, p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, sales_order_id uuid, order_number text, client_name text, product_name text, product_model text, unit_number integer, units_in_item integer, vin text, protocol text, portal text, channel text,
               status text, final_stage text, submitted_at timestamptz, last_checked_at timestamptz, approved_at timestamptz, responsible text, pendencies jsonb, last_error text, stale boolean, total_count bigint)
language sql
stable
as $$
  with base as (
    select d.id, d.sales_order_id, coalesce(so.order_number, po.code, 'Avulsa') as order_number, c.name as client_name, d.product_name, d.product_model, d.unit_number,
           coalesce(i.quantity::integer, ceil(po.quantity)::integer, 1) as units_in_item, d.vin, d.protocol, d.portal, d.channel, d.status,
           d.final_stage, d.submitted_at, d.last_checked_at, d.approved_at, d.responsible, d.pendencies, d.last_error, d.created_at,
           (d.status in ('Enviado', 'Aguardando processamento') and coalesce(d.last_checked_at, d.submitted_at, d.created_at) < now() - make_interval(days => public.sales_setting('stale_days')::integer)) as stale
    from public.vehicle_documentation d join public.clients c on c.id = d.client_id
    left join public.sales_orders so on so.id = d.sales_order_id left join public.sales_order_items i on i.id = d.sales_order_item_id left join public.production_orders po on po.id = d.production_order_id
    where d.system_company_id = public.request_system_company_id()
      and (p_order is null or d.sales_order_id = p_order)
      and (p_status is null or p_status = '' or (p_status = 'abertas' and d.status not in ('Aprovado para liberacao', 'Cancelado')) or (p_status = 'atencao' and d.status in ('Em exigencia', 'Rejeitado', 'Pendente de dados')) or d.status = p_status)
      and (p_search is null or btrim(p_search) = '' or coalesce(so.order_number, po.code, 'Avulsa') ilike '%' || btrim(p_search) || '%' or c.name ilike '%' || btrim(p_search) || '%' or d.vin ilike '%' || btrim(p_search) || '%'
           or d.protocol ilike '%' || btrim(p_search) || '%' or d.product_name ilike '%' || btrim(p_search) || '%')
  )
  select b.id, b.sales_order_id, b.order_number, b.client_name, b.product_name, b.product_model, b.unit_number, b.units_in_item, b.vin, b.protocol, b.portal, b.channel, b.status, b.final_stage, b.submitted_at,
         b.last_checked_at, b.approved_at, b.responsible, b.pendencies, b.last_error, b.stale, count(*) over ()
  from base b order by (b.status in ('Aprovado para liberacao', 'Cancelado')), b.created_at desc, b.unit_number limit greatest(least(coalesce(p_limit, 25), 200), 1) offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function public.vehicle_doc_detail(p_doc uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_doc jsonb;
begin
  select to_jsonb(d) || jsonb_build_object('order_number', coalesce(so.order_number, po.code, 'Avulsa'), 'client_name', c.name, 'client_document', c.document, 'quote_number', so.quote_number, 'opportunity_id', q.opportunity_id,
         'production_order_code', po.code, 'bom_version', bv.version, 'missing', to_jsonb(public.vehicle_doc_missing(d.id)), 'stale',
         (d.status in ('Enviado', 'Aguardando processamento') and coalesce(d.last_checked_at, d.submitted_at, d.created_at) < now() - make_interval(days => public.sales_setting('stale_days')::integer)))
  into v_doc
  from public.vehicle_documentation d join public.clients c on c.id = d.client_id left join public.sales_orders so on so.id = d.sales_order_id left join public.quotes q on q.id = so.quote_id
  left join public.production_orders po on po.id = d.production_order_id left join public.product_bom_versions bv on bv.id = d.bom_version_id
  where d.id = p_doc and d.system_company_id = public.request_system_company_id();
  if v_doc is null then
    raise exception 'Documentação não encontrada.';
  end if;
  return jsonb_build_object('documentation', v_doc,
    'attempts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'attempt_number', a.attempt_number, 'kind', a.kind, 'channel', a.channel, 'outcome', a.outcome, 'message', a.message, 'protocol', a.protocol,
        'actor', a.actor, 'created_at', a.created_at, 'finished_at', a.finished_at, 'request', a.request, 'response', a.response) order by a.attempt_number desc, a.created_at desc)
      from public.vehicle_documentation_attempts a where a.documentation_id = p_doc), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('event', e.event, 'description', e.description, 'actor', e.actor, 'created_at', e.created_at) order by e.created_at desc, e.id)
      from public.vehicle_documentation_events e where e.documentation_id = p_doc), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'kind', f.kind, 'name', f.name, 'file_path', f.file_path, 'created_by', f.created_by, 'created_at', f.created_at) order by f.created_at desc)
      from public.vehicle_documentation_files f where f.documentation_id = p_doc), '[]'::jsonb));
end;
$$;

-- O chassi de uma unidade vem da documentação do item do pedido OU da documentação ligada à ordem avulsa.
create or replace function public.shop_unit_vin(p_order uuid, p_unit integer)
returns text
language sql
stable
as $$
  select d.vin from public.production_orders po join public.vehicle_documentation d on d.unit_number = p_unit and d.status <> 'Cancelado'
    and ((po.sales_order_item_id is not null and d.sales_order_item_id = po.sales_order_item_id) or d.production_order_id = po.id)
  where po.id = p_order limit 1
$$;

-- ================================================================ 3. Ordem de produção aberta direto na produção
-- p: { product_id, quantity, planned_end?, priority?, client_id?, responsible?, notes?, create_documentation? }
-- Usa a estrutura de fabricação ATIVA do produto (kits e matérias-primas congelados na ordem), reserva os materiais e gera as tarefas da esteira.
-- Não há pedido de venda: nenhuma condição comercial é cobrada, e a fabricação é registrada como excepcional (sem estoque de acabado reservado a pedido).
create or replace function public.production_order_create_manual(p jsonb, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_product public.materials%rowtype;
  v_qty numeric := nullif(p->>'quantity', '')::numeric;
  v_bom uuid;
  v_cost record;
  v_po uuid := gen_random_uuid();
  v_company uuid := public.request_system_company_id();
  v_client uuid := nullif(p->>'client_id', '')::uuid;
  v_docs integer := 0;
  v_n integer;
  v_result jsonb;
begin
  select * into v_product from public.materials where id = nullif(p->>'product_id', '')::uuid and item_type = 'Produto';
  if not found then
    raise exception 'Escolha o produto a fabricar.';
  end if;
  if v_qty is null or v_qty <= 0 or v_qty <> trunc(v_qty) then
    raise exception 'A quantidade precisa ser um número inteiro maior que zero (cada carreta é uma unidade).';
  end if;
  select id into v_bom from public.product_bom_versions where product_id = v_product.id and status = 'Ativa';
  if v_bom is null then
    raise exception 'O produto % não tem estrutura de fabricação ativa: ative uma versão em Produtos finais antes de abrir a ordem.', v_product.name;
  end if;
  if v_client is not null and not exists (select 1 from public.clients where id = v_client) then
    raise exception 'Cliente não encontrado.';
  end if;
  select * into v_cost from public.product_bom_cost(v_bom);
  insert into public.production_orders (id, code, client_id, product_id, bom_version_id, quantity, priority, responsible, planned_end, notes,
                                        estimated_materials_cost, estimated_labor_cost, estimated_other_cost, created_by, system_company_id)
  values (v_po, public.next_production_code('OP'), v_client, v_product.id, v_bom, v_qty, coalesce(nullif(p->>'priority', '')::integer, 3), nullif(btrim(p->>'responsible'), ''), nullif(p->>'planned_end', '')::date,
          coalesce(nullif(btrim(p->>'notes'), ''), 'Ordem aberta direto na produção (sem pedido de venda).'),
          round(v_cost.materials_cost * v_qty, 2), round(v_cost.labor_cost * v_qty, 2), round((v_cost.overhead_cost + v_cost.other_cost) * v_qty, 2), coalesce(p_user, public.request_actor()), v_company);
  insert into public.production_order_kits (production_order_id, kit_id, kit_version_id, quantity, system_company_id)
  select v_po, e.kit_id, e.kit_version_id, max(e.kit_quantity), v_company from public.explode_bom(v_bom, v_qty) e group by e.kit_id, e.kit_version_id;
  insert into public.production_order_materials (production_order_id, material_id, kit_id, unit, required_quantity, estimated_unit_cost, system_company_id)
  select v_po, e.material_id, e.kit_id, max(e.unit), sum(e.required_quantity), public.material_unit_cost(e.material_id), v_company from public.explode_bom(v_bom, v_qty) e group by e.material_id, e.kit_id;
  perform public.reserve_production_materials(v_po, p_user);
  if coalesce((p->>'create_documentation')::boolean, false) and coalesce(v_product.requires_vehicle_documentation, false) then
    if v_client is null then
      raise exception 'Para criar a documentação veicular, informe o cliente (proprietário).';
    end if;
    for v_n in 1..v_qty::integer loop
      perform public.vehicle_documentation_create_manual(jsonb_build_object('client_id', v_client, 'production_order_id', v_po), p_user);
      v_docs := v_docs + 1;
    end loop;
  end if;
  perform public.shop_task_refresh(v_po);
  select to_jsonb(po) into v_result from public.production_orders po where po.id = v_po;
  return jsonb_build_object('production_order_id', v_po, 'code', v_result->>'code', 'status', v_result->>'status', 'documentation_created', v_docs);
end;
$$;
