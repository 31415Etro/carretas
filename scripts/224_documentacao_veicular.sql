-- 224: Documentação veicular (pré-cadastro) por unidade vendida e liberação calculada da produção.
-- ADITIVA e idempotente. Requer 217 a 223. Não apaga nem altera dados existentes; não chama nenhum serviço externo (a integração fica no código, atrás de um adaptador).
-- Fluxo: pedido confirmado -> (financeiro: títulos previstos, se a empresa ligar) + (documentação: uma por unidade) + (produção: demanda e materiais planejados)
-- O INÍCIO FÍSICO (iniciar, consumir material, concluir unidades) só é permitido quando production_eligibility() calcula que o pedido está liberado.
-- Pré-cadastro aprovado NÃO é CRLV, ATPV-e nem emplacamento: esses ficam no "estágio final" (final_stage), separado.

-- ================================================================ 1. Configuração da empresa e marcação do produto
alter table public.sales_settings
  add column if not exists require_documentation_before_production boolean not null default true,
  add column if not exists require_operational_authorization boolean not null default true,
  add column if not exists allow_payment_exception boolean not null default false,           -- regra formal: permite dispensar SÓ a exigência comercial/financeira, com justificativa e auditoria
  add column if not exists generate_receivables_on_confirmation boolean not null default false,
  add column if not exists documentation_channel text not null default 'manual' check (documentation_channel in ('manual', 'serpro_lote', 'simulador')),
  add column if not exists documentation_stale_days integer not null default 7 check (documentation_stale_days between 1 and 90);

alter table public.materials add column if not exists requires_vehicle_documentation boolean not null default true;
alter table public.sales_orders add column if not exists receivables_generated_at timestamptz;

create or replace function public.sales_setting(p_key text)
returns text
language sql
stable
as $$
  select case p_key
    when 'documentation' then coalesce((select require_documentation_before_production from public.sales_settings where system_company_id = public.request_system_company_id()), true)::text
    when 'authorization' then coalesce((select require_operational_authorization from public.sales_settings where system_company_id = public.request_system_company_id()), true)::text
    when 'payment_exception' then coalesce((select allow_payment_exception from public.sales_settings where system_company_id = public.request_system_company_id()), false)::text
    when 'receivables' then coalesce((select generate_receivables_on_confirmation from public.sales_settings where system_company_id = public.request_system_company_id()), false)::text
    when 'channel' then coalesce((select documentation_channel from public.sales_settings where system_company_id = public.request_system_company_id()), 'manual')
    when 'stale_days' then coalesce((select documentation_stale_days from public.sales_settings where system_company_id = public.request_system_company_id()), 7)::text
  end
$$;

create or replace function public.sales_settings_get()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'require_payment_before_production', public.sales_requires_payment(),
    'require_documentation_before_production', public.sales_setting('documentation')::boolean,
    'require_operational_authorization', public.sales_setting('authorization')::boolean,
    'allow_payment_exception', public.sales_setting('payment_exception')::boolean,
    'generate_receivables_on_confirmation', public.sales_setting('receivables')::boolean,
    'documentation_channel', public.sales_setting('channel'),
    'documentation_stale_days', public.sales_setting('stale_days')::integer)
$$;

create or replace function public.sales_settings_update(p jsonb, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_company uuid := public.request_system_company_id();
  v_current jsonb := public.sales_settings_get();
  v_channel text := coalesce(nullif(p->>'documentation_channel', ''), v_current->>'documentation_channel');
begin
  if v_channel not in ('manual', 'serpro_lote', 'simulador') then
    raise exception 'Canal de documentação inválido: %.', v_channel;
  end if;
  insert into public.sales_settings (system_company_id) values (v_company) on conflict (system_company_id) do nothing;
  update public.sales_settings set
    require_payment_before_production = coalesce((p->>'require_payment_before_production')::boolean, (v_current->>'require_payment_before_production')::boolean),
    require_documentation_before_production = coalesce((p->>'require_documentation_before_production')::boolean, (v_current->>'require_documentation_before_production')::boolean),
    require_operational_authorization = coalesce((p->>'require_operational_authorization')::boolean, (v_current->>'require_operational_authorization')::boolean),
    allow_payment_exception = coalesce((p->>'allow_payment_exception')::boolean, (v_current->>'allow_payment_exception')::boolean),
    generate_receivables_on_confirmation = coalesce((p->>'generate_receivables_on_confirmation')::boolean, (v_current->>'generate_receivables_on_confirmation')::boolean),
    documentation_channel = v_channel,
    documentation_stale_days = coalesce(nullif(p->>'documentation_stale_days', '')::integer, (v_current->>'documentation_stale_days')::integer),
    updated_by = coalesce(p_user, public.request_actor()), updated_at = now()
  where system_company_id = v_company;
  perform public.audit_setting_change(v_current, public.sales_settings_get(), p_user);
  return public.sales_settings_get();
end;
$$;

-- registro simples da mudança de regra (a tabela de eventos de pedido não serve: não há pedido)
create table if not exists public.sales_settings_log (
  id uuid primary key default gen_random_uuid(),
  before jsonb,
  after jsonb,
  changed_by text,
  changed_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create or replace function public.audit_setting_change(p_before jsonb, p_after jsonb, p_user text)
returns void
language sql
as $$
  insert into public.sales_settings_log (before, after, changed_by) select p_before, p_after, coalesce(p_user, public.request_actor()) where p_before is distinct from p_after
$$;

-- ================================================================ 2. Documentação por unidade
create table if not exists public.vehicle_documentation (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  sales_order_item_id uuid not null references public.sales_order_items(id) on delete restrict,
  unit_number integer not null check (unit_number >= 1),
  client_id uuid not null references public.clients(id) on delete restrict,
  product_id uuid not null references public.materials(id) on delete restrict,
  bom_version_id uuid references public.product_bom_versions(id) on delete restrict,
  product_name text not null,
  product_model text,
  vin text,
  cat_number text,
  brand_model_version_code text,
  portal text not null default 'SERPRO/RENAVAM - Pré-cadastro de veículos',
  channel text not null default 'manual',
  protocol text,
  status text not null default 'Pendente de dados' check (status in (
    'Pendente de dados', 'Pronto para envio', 'Envio em andamento', 'Enviado', 'Aguardando processamento', 'Em exigencia', 'Rejeitado', 'Aprovado para liberacao', 'Cancelado')),
  final_stage text not null default 'Nao iniciada' check (final_stage in ('Nao iniciada', 'Aguardando fabricacao', 'Em andamento', 'Concluida')),
  final_stage_note text,
  pendencies jsonb not null default '[]'::jsonb,
  last_error text,
  external_response jsonb,
  responsible text,
  notes text,
  submitted_at timestamptz,
  last_checked_at timestamptz,
  next_check_at timestamptz,
  approved_at timestamptz,
  cancelled_reason text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  unique (sales_order_item_id, unit_number)
);
create index if not exists vehicle_documentation_order_idx on public.vehicle_documentation (sales_order_id);
create index if not exists vehicle_documentation_status_idx on public.vehicle_documentation (system_company_id, status);
-- Chassi: um veículo físico existe uma vez só (em qualquer empresa); protocolo: único por portal. Documentação cancelada libera os dois.
create unique index if not exists vehicle_documentation_vin_uidx on public.vehicle_documentation (upper(vin)) where vin is not null and status <> 'Cancelado';
create unique index if not exists vehicle_documentation_protocol_uidx on public.vehicle_documentation (portal, protocol) where protocol is not null and status <> 'Cancelado';

create table if not exists public.vehicle_documentation_attempts (
  id uuid primary key default gen_random_uuid(),
  documentation_id uuid not null references public.vehicle_documentation(id) on delete restrict,
  attempt_number integer not null,
  kind text not null check (kind in ('envio', 'reenvio', 'consulta', 'retorno_manual')),
  channel text not null,
  idempotency_key text,
  request jsonb,
  response jsonb,
  outcome text check (outcome in ('sucesso', 'erro', 'indisponivel', 'rejeitado', 'exigencia', 'aprovado', 'processando', 'ignorado')),
  message text,
  protocol text,
  actor text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create unique index if not exists vehicle_documentation_attempts_key_uidx on public.vehicle_documentation_attempts (documentation_id, idempotency_key) where idempotency_key is not null;
create index if not exists vehicle_documentation_attempts_doc_idx on public.vehicle_documentation_attempts (documentation_id, attempt_number);

create table if not exists public.vehicle_documentation_events (
  id uuid primary key default gen_random_uuid(),
  documentation_id uuid not null references public.vehicle_documentation(id) on delete restrict,
  event text not null,
  description text not null,
  detail jsonb,
  actor text,
  created_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create index if not exists vehicle_documentation_events_doc_idx on public.vehicle_documentation_events (documentation_id, created_at desc);

create table if not exists public.vehicle_documentation_files (
  id uuid primary key default gen_random_uuid(),
  documentation_id uuid not null references public.vehicle_documentation(id) on delete restrict,
  kind text not null default 'Comprovante' check (kind in ('Comprovante', 'Retorno do portal', 'Documento', 'Outro')),
  name text not null,
  file_path text not null,
  created_by text,
  created_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);

-- Histórico imutável: tentativas e eventos não são alterados nem apagados.
do $$
declare
  t text;
begin
  foreach t in array array['vehicle_documentation_attempts', 'vehicle_documentation_events'] loop
    execute format('drop trigger if exists trg_%I_immutable_del on public.%I', t, t);
    execute format('create trigger trg_%I_immutable_del before delete on public.%I for each row execute function public.production_history_immutable()', t, t);
  end loop;
end;
$$;

create or replace function public.vehicle_doc_log(p_doc uuid, p_event text, p_description text, p_detail jsonb default null, p_actor text default null)
returns void
language sql
as $$
  insert into public.vehicle_documentation_events (documentation_id, event, description, detail, actor) values (p_doc, p_event, p_description, p_detail, coalesce(p_actor, public.request_actor()))
$$;

-- ================================================================ 3. Autorização operacional e exceção formal
create table if not exists public.production_authorizations (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  authorized_by text not null,
  note text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text,
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create unique index if not exists production_authorizations_active_uidx on public.production_authorizations (sales_order_id) where revoked_at is null;

-- Só a exigência COMERCIAL/FINANCEIRA pode ser dispensada, e só com a regra formal ligada na empresa, justificativa e auditoria. Documentação (requisito legal) nunca.
create table if not exists public.production_release_exceptions (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  component text not null check (component in ('pagamento')),
  reason text not null check (length(btrim(reason)) >= 10),
  approved_by text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by text,
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create unique index if not exists production_release_exceptions_active_uidx on public.production_release_exceptions (sales_order_id, component) where revoked_at is null;

-- ================================================================ 4. Elegibilidade CALCULADA da produção (nenhum campo livre de "liberado")
create or replace function public.production_eligibility(p_sales_order_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_order public.sales_orders%rowtype;
  v_blockers jsonb := '[]'::jsonb;
  v_needs_docs integer;
  v_total integer;
  v_approved integer;
  v_cancelled integer;
  v_waived boolean;
  v_auth boolean;
  v_docs_required boolean := public.sales_setting('documentation')::boolean;
  v_pay_required boolean := public.sales_requires_payment();
  v_auth_required boolean := public.sales_setting('authorization')::boolean;
begin
  select * into v_order from public.sales_orders where id = p_sales_order_id;
  if not found or v_order.system_company_id is distinct from public.request_system_company_id() then
    return jsonb_build_object('eligible', false, 'blockers', jsonb_build_array(jsonb_build_object('code', 'pedido', 'message', 'Pedido de venda não encontrado.', 'waivable', false)));
  end if;
  if v_order.status in ('Rascunho', 'Aguardando confirmacao') then
    v_blockers := v_blockers || jsonb_build_object('code', 'pedido', 'message', 'O pedido ainda não foi confirmado.', 'waivable', false);
  elsif v_order.status = 'Cancelado' then
    v_blockers := v_blockers || jsonb_build_object('code', 'pedido', 'message', 'O pedido está cancelado.', 'waivable', false);
  end if;

  select count(*) into v_needs_docs from public.sales_order_items i join public.materials m on m.id = i.material_id
  where i.sales_order_id = p_sales_order_id and i.line_type = 'Produto' and m.item_type = 'Produto' and m.requires_vehicle_documentation;
  select count(*), count(*) filter (where status = 'Aprovado para liberacao'), count(*) filter (where status = 'Cancelado')
  into v_total, v_approved, v_cancelled from public.vehicle_documentation where sales_order_id = p_sales_order_id;
  if v_docs_required and v_needs_docs > 0 then
    if v_total = 0 then
      v_blockers := v_blockers || jsonb_build_object('code', 'documentacao', 'message', 'A documentação veicular das unidades ainda não foi iniciada.', 'waivable', false);
    elsif v_approved < v_total then
      v_blockers := v_blockers || jsonb_build_object('code', 'documentacao', 'message',
        'Documentação veicular: ' || v_approved || ' de ' || v_total || ' unidade(s) liberada(s)' || case when v_cancelled > 0 then ' (' || v_cancelled || ' cancelada(s))' else '' end || '.', 'waivable', false);
    end if;
  end if;

  if v_pay_required and v_order.payment_confirmed_at is null then
    select exists (select 1 from public.production_release_exceptions where sales_order_id = p_sales_order_id and component = 'pagamento' and revoked_at is null) into v_waived;
    if not v_waived then
      v_blockers := v_blockers || jsonb_build_object('code', 'pagamento', 'message', 'Aguardando a confirmação do sinal/pagamento.', 'waivable', public.sales_setting('payment_exception')::boolean);
    end if;
  end if;
  if v_auth_required then
    select exists (select 1 from public.production_authorizations where sales_order_id = p_sales_order_id and revoked_at is null) into v_auth;
    if not v_auth then
      v_blockers := v_blockers || jsonb_build_object('code', 'autorizacao', 'message', 'Falta a autorização operacional da produção.', 'waivable', false);
    end if;
  end if;
  return jsonb_build_object('eligible', jsonb_array_length(v_blockers) = 0, 'blockers', v_blockers,
    'documentation', jsonb_build_object('required', v_docs_required and v_needs_docs > 0, 'units', v_total, 'approved', v_approved, 'cancelled', v_cancelled, 'items_requiring', v_needs_docs));
end;
$$;

create or replace function public.production_assert_release(p_production_order uuid)
returns void
language plpgsql
as $$
declare
  v_order uuid;
  v_result jsonb;
begin
  select sales_order_id into v_order from public.production_orders where id = p_production_order;
  if v_order is null then
    return;  -- ordem sem pedido de venda (fluxo interno): sem condições comerciais a verificar
  end if;
  v_result := public.production_eligibility(v_order);
  if not (v_result->>'eligible')::boolean then
    raise exception 'Produção bloqueada: %', (select string_agg(b->>'message', ' ') from jsonb_array_elements(v_result->'blockers') b);
  end if;
end;
$$;

-- O início físico (situação "Em produção", consumo de material e entrada de acabado) só passa quando o pedido está liberado.
create or replace function public.production_orders_release_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'Em producao' and old.status is distinct from 'Em producao' then
    perform public.production_assert_release(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists trg_production_orders_release_guard on public.production_orders;
create trigger trg_production_orders_release_guard before update of status on public.production_orders for each row execute function public.production_orders_release_guard();

create or replace function public.production_children_release_guard()
returns trigger
language plpgsql
as $$
begin
  perform public.production_assert_release(new.production_order_id);
  return new;
end;
$$;
drop trigger if exists trg_production_consumptions_release_guard on public.production_consumptions;
create trigger trg_production_consumptions_release_guard before insert on public.production_consumptions for each row execute function public.production_children_release_guard();
drop trigger if exists trg_production_receipts_release_guard on public.production_receipts;
create trigger trg_production_receipts_release_guard before insert on public.production_receipts for each row execute function public.production_children_release_guard();

-- Situação do pedido: com ordem aberta mas bloqueada, fica "Aguardando produção"; liberada, "Em produção".
create or replace function public.sales_order_refresh(p_order uuid)
returns text
language plpgsql
as $$
declare
  v_status text;
  v_items integer;
  v_all_delivered boolean;
  v_all_ready boolean;
  v_any boolean;
  v_open boolean;
  v_new text;
begin
  select status into v_status from public.sales_orders where id = p_order for update;
  if not found or v_status in ('Rascunho', 'Aguardando confirmacao', 'Cancelado') then
    return v_status;
  end if;
  with it as (
    select i.quantity, i.quantity_delivered as d,
           coalesce((select sum(r.quantity) from public.stock_reservations r where r.sales_order_item_id = i.id and r.status = 'Ativa'), 0) as res
    from public.sales_order_items i join public.materials m on m.id = i.material_id
    where i.sales_order_id = p_order and i.line_type = 'Produto' and m.item_type = 'Produto'
  )
  select count(*), bool_and(d >= quantity), bool_and(d + res >= quantity), bool_or(res > 0) into v_items, v_all_delivered, v_all_ready, v_any from it;
  if v_items = 0 then
    return v_status;
  end if;
  select exists (select 1 from public.production_orders where sales_order_id = p_order and status not in ('Concluida', 'Cancelada')) into v_open;
  v_new := case
    when v_all_delivered then 'Entregue' when v_all_ready then 'Pronto para entrega' when v_any then 'Parcialmente disponivel'
    when v_open and (public.production_eligibility(p_order)->>'eligible')::boolean then 'Em producao'
    when v_open then 'Aguardando producao'
    else v_status end;
  if v_new <> v_status then
    update public.sales_orders set status = v_new, delivered_at = case when v_new = 'Entregue' then now() else delivered_at end, updated_at = now() where id = p_order;
  end if;
  return v_new;
end;
$$;

-- A demanda e o planejamento de materiais NÃO esperam sinal nem documentação: só o início físico espera (production_eligibility).
create or replace function public.create_production_from_sale(p_sales_order_id uuid, p_created_by text default null)
returns jsonb
language plpgsql
as $$
declare
  v_order public.sales_orders%rowtype;
  v_item record;
  v_bom uuid;
  v_available numeric;
  v_from_stock numeric;
  v_to_produce numeric;
  v_po uuid;
  v_created jsonb := '[]'::jsonb;
  v_reused jsonb := '[]'::jsonb;
  v_cost record;
  v_snapshot jsonb;
begin
  select * into v_order from public.sales_orders where id = p_sales_order_id for update;
  if not found then
    raise exception 'Pedido de venda não encontrado.';
  end if;
  if v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Este pedido pertence a outra empresa.';
  end if;
  if v_order.status not in ('Confirmado', 'Aguardando producao', 'Em producao', 'Parcialmente disponivel', 'Pronto para entrega') then
    raise exception 'O pedido % precisa estar confirmado para gerar produção (situação atual: %).', v_order.order_number, v_order.status;
  end if;

  for v_item in
    select i.*, m.name as product_name, m.item_type from public.sales_order_items i
    left join public.materials m on m.id = i.material_id
    where i.sales_order_id = p_sales_order_id and i.line_type = 'Produto' order by i.position
  loop
    if v_item.item_type is distinct from 'Produto' then
      continue;
    end if;
    select id into v_po from public.production_orders where sales_order_item_id = v_item.id and status <> 'Cancelada' limit 1;
    if v_po is not null then
      v_reused := v_reused || to_jsonb(v_po);
      continue;
    end if;
    if v_item.planned_at is not null and v_item.quantity_to_produce = 0 then
      continue;
    end if;
    if v_item.planned_at is not null then
      update public.sales_order_items set quantity_from_stock = 0, quantity_to_produce = 0 where id = v_item.id;
      delete from public.stock_reservations where sales_order_item_id = v_item.id and status = 'Ativa';
    end if;

    select id into v_bom from public.product_bom_versions where product_id = v_item.material_id and status = 'Ativa';
    v_from_stock := 0;
    if not v_item.make_to_order then
      select available into v_available from public.material_availability(v_item.material_id);
      v_from_stock := least(coalesce(v_available, 0), v_item.quantity);
    end if;
    v_to_produce := v_item.quantity - v_from_stock;
    if v_to_produce > 0 and v_bom is null then
      raise exception 'O produto % não tem estrutura de fabricação ativa: ative uma versão em Produtos antes de confirmar a venda.', v_item.product_name;
    end if;
    if v_from_stock > 0 then
      insert into public.stock_reservations (material_id, quantity, status, sales_order_item_id, responsible, notes)
      values (v_item.material_id, v_from_stock, 'Ativa', v_item.id, p_created_by, 'Acabado reservado para o pedido ' || v_order.order_number);
    end if;
    update public.sales_order_items set quantity_from_stock = v_from_stock, quantity_to_produce = v_to_produce, planned_at = now() where id = v_item.id;

    if v_to_produce > 0 then
      select * into v_cost from public.product_bom_cost(v_bom);
      v_po := gen_random_uuid();
      insert into public.production_orders (id, code, sales_order_id, sales_order_item_id, client_id, product_id, bom_version_id, quantity, planned_end,
                                            estimated_materials_cost, estimated_labor_cost, estimated_other_cost, created_by, system_company_id)
      values (v_po, public.next_production_code('OP'), v_order.id, v_item.id, v_order.client_id, v_item.material_id, v_bom, v_to_produce, v_order.delivery_date,
              round(v_cost.materials_cost * v_to_produce, 2), round(v_cost.labor_cost * v_to_produce, 2), round((v_cost.overhead_cost + v_cost.other_cost) * v_to_produce, 2),
              p_created_by, v_order.system_company_id);
      insert into public.production_order_kits (production_order_id, kit_id, kit_version_id, quantity, system_company_id)
      select v_po, e.kit_id, e.kit_version_id, max(e.kit_quantity), v_order.system_company_id from public.explode_bom(v_bom, v_to_produce) e group by e.kit_id, e.kit_version_id;
      insert into public.production_order_materials (production_order_id, material_id, kit_id, unit, required_quantity, estimated_unit_cost, system_company_id)
      select v_po, e.material_id, e.kit_id, max(e.unit), sum(e.required_quantity), public.material_unit_cost(e.material_id), v_order.system_company_id
      from public.explode_bom(v_bom, v_to_produce) e group by e.material_id, e.kit_id;
      perform public.reserve_production_materials(v_po, p_created_by);
      v_created := v_created || to_jsonb(v_po);
    end if;
    v_snapshot := null;
    if v_bom is not null then
      select to_jsonb(c) into v_snapshot from public.product_bom_cost(v_bom) c;
    end if;
    update public.sales_order_items set bom_version_id = v_bom, cost_snapshot = v_snapshot where id = v_item.id;
  end loop;

  update public.sales_orders set production_released_at = coalesce(production_released_at, now()), updated_at = now() where id = p_sales_order_id;
  perform public.sales_order_refresh(p_sales_order_id);
  return jsonb_build_object('sales_order_id', p_sales_order_id, 'blocked', false, 'production_orders_created', v_created, 'already_existing', v_reused,
                            'release', public.production_eligibility(p_sales_order_id));
end;
$$;

-- ================================================================ 5. Validação e geração da documentação
create or replace function public.vehicle_doc_missing(p_doc uuid)
returns text[]
language plpgsql
stable
as $$
declare
  v_doc public.vehicle_documentation%rowtype;
  v_client public.clients%rowtype;
  v_missing text[] := '{}';
begin
  select * into v_doc from public.vehicle_documentation where id = p_doc;
  if not found then
    return array['Documentação não encontrada'];
  end if;
  if coalesce(btrim(v_doc.vin), '') = '' then
    v_missing := array_append(v_missing, 'Chassi (VIN)'::text);
  elsif upper(btrim(v_doc.vin)) !~ '^[A-HJ-NPR-Z0-9]{17}$' then
    v_missing := array_append(v_missing, 'Chassi (VIN) inválido: 17 caracteres, sem I, O e Q'::text);
  end if;
  select * into v_client from public.clients where id = v_doc.client_id;
  if coalesce(btrim(v_client.document), '') = '' then
    v_missing := array_append(v_missing, 'CPF/CNPJ do cliente'::text);
  end if;
  if coalesce(btrim(v_doc.product_model), '') = '' then
    v_missing := array_append(v_missing, 'Modelo do produto'::text);
  end if;
  return v_missing;
end;
$$;

-- Uma documentação por unidade vendida (idempotente). Quantidade fracionada não vira veículo.
create or replace function public.vehicle_documentation_generate(p_sales_order_id uuid, p_user text default null)
returns integer
language plpgsql
as $$
declare
  v_order public.sales_orders%rowtype;
  v_item record;
  v_created integer := 0;
  v_rows integer;
  v_n integer;
begin
  select * into v_order from public.sales_orders where id = p_sales_order_id for update;
  if not found then
    raise exception 'Pedido de venda não encontrado.';
  end if;
  if v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Este pedido pertence a outra empresa.';
  end if;
  if v_order.status in ('Rascunho', 'Aguardando confirmacao', 'Cancelado') then
    raise exception 'A documentação só é iniciada para pedido confirmado.';
  end if;
  for v_item in
    select i.*, m.name as product_name, m.product_model, coalesce(i.bom_version_id, (select id from public.product_bom_versions where product_id = i.material_id and status = 'Ativa')) as bom
    from public.sales_order_items i join public.materials m on m.id = i.material_id
    where i.sales_order_id = p_sales_order_id and i.line_type = 'Produto' and m.item_type = 'Produto' and m.requires_vehicle_documentation order by i.position
  loop
    if v_item.quantity <> trunc(v_item.quantity) then
      raise exception 'O item "%" tem quantidade fracionada (%): cada veículo precisa de uma unidade inteira.', v_item.description, v_item.quantity;
    end if;
    for v_n in 1..v_item.quantity::integer loop
      insert into public.vehicle_documentation (sales_order_id, sales_order_item_id, unit_number, client_id, product_id, bom_version_id, product_name, product_model, channel, responsible, created_by, system_company_id)
      values (p_sales_order_id, v_item.id, v_n, v_order.client_id, v_item.material_id, v_item.bom, v_item.product_name, coalesce(v_item.product_model, v_item.product_name), public.sales_setting('channel'),
              v_order.created_by, coalesce(p_user, public.request_actor()), v_order.system_company_id)
      on conflict (sales_order_item_id, unit_number) do nothing;
      get diagnostics v_rows = row_count;
      v_created := v_created + v_rows;
    end loop;
  end loop;
  return v_created;
end;
$$;

create or replace function public.vehicle_doc_status_log()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.vehicle_doc_log(new.id, 'Criada', 'Documentação da unidade ' || new.unit_number || ' criada para o pedido.', null, new.created_by);
  elsif new.status is distinct from old.status then
    perform public.vehicle_doc_log(new.id, 'Situação', 'Situação alterada de ' || old.status || ' para ' || new.status || '.');
    perform public.sales_order_refresh(new.sales_order_id);  -- a liberação da produção depende destas situações
  end if;
  return null;
end;
$$;
drop trigger if exists trg_vehicle_doc_status_log on public.vehicle_documentation;
create trigger trg_vehicle_doc_status_log after insert or update of status on public.vehicle_documentation for each row execute function public.vehicle_doc_status_log();

-- ================================================================ 6. Edição dos dados da unidade (chassi, CAT, código marca/modelo/versão)
create or replace function public.vehicle_doc_update(p jsonb, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_doc public.vehicle_documentation%rowtype;
  v_vin text;
  v_missing text[];
  v_new text;
begin
  select * into v_doc from public.vehicle_documentation where id = (p->>'documentation_id')::uuid for update;
  if not found then
    raise exception 'Documentação não encontrada.';
  end if;
  if v_doc.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Esta documentação pertence a outra empresa.';
  end if;
  if v_doc.status not in ('Pendente de dados', 'Pronto para envio', 'Em exigencia', 'Rejeitado') then
    raise exception 'A documentação está "%" e não aceita alteração de dados agora.', v_doc.status;
  end if;
  v_vin := case when p ? 'vin' then nullif(upper(btrim(p->>'vin')), '') else v_doc.vin end;
  begin
    update public.vehicle_documentation set
      vin = v_vin,
      cat_number = case when p ? 'cat_number' then nullif(btrim(p->>'cat_number'), '') else cat_number end,
      brand_model_version_code = case when p ? 'brand_model_version_code' then nullif(btrim(p->>'brand_model_version_code'), '') else brand_model_version_code end,
      product_model = case when p ? 'product_model' then nullif(btrim(p->>'product_model'), '') else product_model end,
      responsible = case when p ? 'responsible' then nullif(btrim(p->>'responsible'), '') else responsible end,
      notes = case when p ? 'notes' then nullif(btrim(p->>'notes'), '') else notes end,
      updated_at = now()
    where id = v_doc.id;
  exception when unique_violation then
    raise exception 'O chassi % já está em outra documentação de veículo.', v_vin;
  end;
  v_missing := public.vehicle_doc_missing(v_doc.id);
  -- corrigir uma exigência/rejeição devolve a unidade para "Pronto para envio" (reenvio), sem apagar o histórico
  v_new := case when array_length(v_missing, 1) is null then 'Pronto para envio' else 'Pendente de dados' end;
  if v_new is distinct from v_doc.status then
    update public.vehicle_documentation set status = v_new, pendencies = case when v_new = 'Pendente de dados' then to_jsonb(v_missing) else '[]'::jsonb end where id = v_doc.id;
  end if;
  perform public.vehicle_doc_log(v_doc.id, 'Dados', 'Dados da unidade atualizados.', jsonb_build_object('vin', jsonb_build_array(v_doc.vin, v_vin)), p_user);
  return jsonb_build_object('documentation_id', v_doc.id, 'status', v_new, 'missing', to_jsonb(coalesce(v_missing, '{}')));
end;
$$;

-- ================================================================ 7. Envio (duas fases: registra a tentativa e, depois da chamada ao canal, grava o resultado)
create or replace function public.vehicle_doc_begin_submit(p_doc uuid, p_key text, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_doc public.vehicle_documentation%rowtype;
  v_existing public.vehicle_documentation_attempts%rowtype;
  v_missing text[];
  v_attempt uuid := gen_random_uuid();
  v_number integer;
  v_kind text;
  v_client public.clients%rowtype;
  v_payload jsonb;
begin
  if coalesce(btrim(p_key), '') = '' then
    raise exception 'Informe a chave de idempotência do envio.';
  end if;
  select * into v_doc from public.vehicle_documentation where id = p_doc for update;
  if not found then
    raise exception 'Documentação não encontrada.';
  end if;
  if v_doc.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Esta documentação pertence a outra empresa.';
  end if;
  select * into v_existing from public.vehicle_documentation_attempts where documentation_id = p_doc and idempotency_key = p_key;
  if found then
    return jsonb_build_object('attempt_id', v_existing.id, 'duplicate', true, 'outcome', v_existing.outcome, 'protocol', v_existing.protocol);
  end if;
  if v_doc.status in ('Envio em andamento', 'Enviado', 'Aguardando processamento', 'Aprovado para liberacao') then
    raise exception 'Esta unidade já foi enviada (situação: %).', v_doc.status || coalesce(', protocolo ' || v_doc.protocol, '');
  end if;
  if v_doc.status = 'Cancelado' then
    raise exception 'A documentação está cancelada.';
  end if;
  v_missing := public.vehicle_doc_missing(p_doc);
  if array_length(v_missing, 1) is not null then
    raise exception 'Dados incompletos para o envio: %.', array_to_string(v_missing, '; ');
  end if;
  select * into v_client from public.clients where id = v_doc.client_id;
  select count(*) + 1 into v_number from public.vehicle_documentation_attempts where documentation_id = p_doc and kind in ('envio', 'reenvio');
  v_kind := case when v_number > 1 then 'reenvio' else 'envio' end;
  v_payload := jsonb_build_object('vin', upper(btrim(v_doc.vin)), 'cat_number', v_doc.cat_number, 'brand_model_version_code', v_doc.brand_model_version_code,
    'product_model', v_doc.product_model, 'product_name', v_doc.product_name, 'client_name', v_client.name, 'client_document', regexp_replace(v_client.document, '\W', '', 'g'),
    'sales_order', (select order_number from public.sales_orders where id = v_doc.sales_order_id), 'unit_number', v_doc.unit_number, 'documentation_id', v_doc.id);
  insert into public.vehicle_documentation_attempts (id, documentation_id, attempt_number, kind, channel, idempotency_key, request, actor, system_company_id)
  values (v_attempt, p_doc, v_number, v_kind, v_doc.channel, p_key, v_payload, coalesce(p_user, public.request_actor()), v_doc.system_company_id);
  update public.vehicle_documentation set status = 'Envio em andamento', last_error = null, updated_at = now() where id = p_doc;
  return jsonb_build_object('attempt_id', v_attempt, 'duplicate', false, 'payload', v_payload, 'channel', v_doc.channel);
end;
$$;

create or replace function public.vehicle_doc_finish_submit(p_attempt uuid, p jsonb, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_attempt public.vehicle_documentation_attempts%rowtype;
  v_doc public.vehicle_documentation%rowtype;
  v_outcome text := coalesce(p->>'outcome', 'erro');
  v_protocol text := nullif(btrim(p->>'protocol'), '');
  v_message text := p->>'message';
  v_new text;
begin
  select * into v_attempt from public.vehicle_documentation_attempts where id = p_attempt for update;
  if not found then
    raise exception 'Tentativa de envio não encontrada.';
  end if;
  if v_attempt.outcome is not null then
    return jsonb_build_object('attempt_id', p_attempt, 'duplicate', true, 'outcome', v_attempt.outcome, 'protocol', v_attempt.protocol);
  end if;
  select * into v_doc from public.vehicle_documentation where id = v_attempt.documentation_id for update;
  if v_doc.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Esta documentação pertence a outra empresa.';
  end if;
  if v_outcome not in ('sucesso', 'erro', 'indisponivel', 'rejeitado') then
    raise exception 'Resultado de envio inválido: %.', v_outcome;
  end if;
  if v_outcome = 'sucesso' and v_protocol is null then
    raise exception 'O envio só é aceito com o protocolo devolvido pelo portal.';
  end if;
  update public.vehicle_documentation_attempts set outcome = v_outcome, response = p->'response', message = v_message, protocol = v_protocol, finished_at = now() where id = p_attempt;
  v_new := case v_outcome when 'sucesso' then 'Enviado' when 'rejeitado' then 'Rejeitado' else 'Pronto para envio' end;
  begin
    update public.vehicle_documentation set status = v_new, protocol = coalesce(v_protocol, protocol), submitted_at = case when v_outcome = 'sucesso' then now() else submitted_at end,
           last_error = case when v_outcome in ('erro', 'indisponivel', 'rejeitado') then v_message else null end,
           pendencies = case when v_outcome = 'rejeitado' then coalesce(p->'pendencies', '[]'::jsonb) else pendencies end,
           external_response = coalesce(p->'response', external_response), next_check_at = case when v_outcome = 'sucesso' then now() + interval '30 minutes' else next_check_at end, updated_at = now()
    where id = v_doc.id;
  exception when unique_violation then
    raise exception 'O protocolo % já está vinculado a outra documentação.', v_protocol;
  end;
  perform public.vehicle_doc_log(v_doc.id, 'Envio', 'Envio ' || v_outcome || coalesce(': ' || v_message, '') || coalesce(' (protocolo ' || v_protocol || ')', '') || '.', null, p_user);
  return jsonb_build_object('attempt_id', p_attempt, 'duplicate', false, 'outcome', v_outcome, 'status', v_new, 'protocol', v_protocol);
end;
$$;

-- ================================================================ 8. Resultado do portal (consulta automática, retorno manual ou arquivo de retorno): idempotente por chave
create or replace function public.vehicle_doc_apply_result(p_doc uuid, p jsonb, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_doc public.vehicle_documentation%rowtype;
  v_result text := p->>'result';            -- aprovado | rejeitado | exigencia | processando
  v_key text := nullif(p->>'result_key', '');
  v_kind text := coalesce(nullif(p->>'kind', ''), 'consulta');
  v_new text;
  v_attempt uuid := gen_random_uuid();
  v_next integer;
begin
  select * into v_doc from public.vehicle_documentation where id = p_doc for update;
  if not found then
    raise exception 'Documentação não encontrada.';
  end if;
  if v_doc.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Esta documentação pertence a outra empresa.';
  end if;
  if v_result not in ('aprovado', 'rejeitado', 'exigencia', 'processando') then
    raise exception 'Resultado inválido: %.', v_result;
  end if;
  if v_key is not null and exists (select 1 from public.vehicle_documentation_attempts where documentation_id = p_doc and idempotency_key = v_key) then
    return jsonb_build_object('duplicate', true, 'status', v_doc.status);
  end if;
  select coalesce(max(attempt_number), 0) + 1 into v_next from public.vehicle_documentation_attempts where documentation_id = p_doc;
  if v_doc.status in ('Cancelado', 'Aprovado para liberacao') and v_result <> 'processando' then
    insert into public.vehicle_documentation_attempts (id, documentation_id, attempt_number, kind, channel, idempotency_key, response, outcome, message, protocol, actor, finished_at, system_company_id)
    values (v_attempt, p_doc, v_next, v_kind, v_doc.channel, v_key, p->'response', 'ignorado', 'Resultado ignorado: a documentação já está ' || v_doc.status || '.', v_doc.protocol, coalesce(p_user, public.request_actor()), now(), v_doc.system_company_id);
    perform public.vehicle_doc_log(p_doc, 'Resultado ignorado', 'Retorno "' || v_result || '" ignorado: a documentação já está ' || v_doc.status || '.', p->'response', p_user);
    return jsonb_build_object('duplicate', false, 'ignored', true, 'status', v_doc.status);
  end if;
  if v_doc.status not in ('Enviado', 'Aguardando processamento', 'Em exigencia', 'Rejeitado', 'Envio em andamento') then
    raise exception 'A unidade está "%": só há resultado do portal para o que foi enviado.', v_doc.status;
  end if;
  v_new := case v_result when 'aprovado' then 'Aprovado para liberacao' when 'rejeitado' then 'Rejeitado' when 'exigencia' then 'Em exigencia' else 'Aguardando processamento' end;
  insert into public.vehicle_documentation_attempts (id, documentation_id, attempt_number, kind, channel, idempotency_key, response, outcome, message, protocol, actor, finished_at, system_company_id)
  values (v_attempt, p_doc, v_next, v_kind, v_doc.channel, v_key, p->'response', v_result, p->>'message', v_doc.protocol, coalesce(p_user, public.request_actor()), now(), v_doc.system_company_id);
  update public.vehicle_documentation set status = v_new, last_checked_at = now(),
         approved_at = case when v_new = 'Aprovado para liberacao' then now() else approved_at end,
         pendencies = case when v_new in ('Rejeitado', 'Em exigencia') then coalesce(p->'pendencies', jsonb_build_array(coalesce(p->>'message', 'Sem detalhe informado pelo portal'))) else '[]'::jsonb end,
         last_error = case when v_new in ('Rejeitado', 'Em exigencia') then p->>'message' else null end,
         external_response = coalesce(p->'response', external_response),
         next_check_at = case when v_new in ('Enviado', 'Aguardando processamento') then now() + interval '2 hours' else null end, updated_at = now()
  where id = p_doc;
  perform public.vehicle_doc_log(p_doc, 'Retorno', 'Retorno do portal: ' || v_result || coalesce(' - ' || (p->>'message'), '') || '.', p->'response', p_user);
  return jsonb_build_object('duplicate', false, 'ignored', false, 'status', v_new);
end;
$$;

create or replace function public.vehicle_doc_mark_checked(p_doc uuid, p_minutes integer default 120, p_message text default null)
returns void
language plpgsql
as $$
begin
  update public.vehicle_documentation set last_checked_at = now(), next_check_at = now() + make_interval(mins => greatest(coalesce(p_minutes, 120), 5)), last_error = coalesce(p_message, last_error)
  where id = p_doc and system_company_id = public.request_system_company_id();
end;
$$;

create or replace function public.vehicle_doc_cancel(p_doc uuid, p_reason text, p_user text default null)
returns void
language plpgsql
as $$
declare
  v_doc public.vehicle_documentation%rowtype;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Informe o motivo do cancelamento.';
  end if;
  select * into v_doc from public.vehicle_documentation where id = p_doc for update;
  if not found then
    raise exception 'Documentação não encontrada.';
  end if;
  if v_doc.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Esta documentação pertence a outra empresa.';
  end if;
  if v_doc.status = 'Cancelado' then
    return;
  end if;
  update public.vehicle_documentation set status = 'Cancelado', cancelled_reason = p_reason, next_check_at = null, updated_at = now() where id = p_doc;
  perform public.vehicle_doc_log(p_doc, 'Cancelada', 'Documentação cancelada: ' || p_reason || '.', null, p_user);
end;
$$;

-- Estágio final (CRLV, ATPV-e, emplacamento): separado do pré-cadastro e SEM efeito na liberação da fabricação.
create or replace function public.vehicle_doc_set_final_stage(p_doc uuid, p_stage text, p_note text default null, p_user text default null)
returns void
language plpgsql
as $$
declare
  v_doc public.vehicle_documentation%rowtype;
begin
  if p_stage not in ('Nao iniciada', 'Aguardando fabricacao', 'Em andamento', 'Concluida') then
    raise exception 'Estágio inválido.';
  end if;
  select * into v_doc from public.vehicle_documentation where id = p_doc for update;
  if not found then
    raise exception 'Documentação não encontrada.';
  end if;
  if v_doc.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Esta documentação pertence a outra empresa.';
  end if;
  if v_doc.status <> 'Aprovado para liberacao' then
    raise exception 'O estágio final só se registra depois do pré-cadastro aprovado.';
  end if;
  update public.vehicle_documentation set final_stage = p_stage, final_stage_note = p_note, updated_at = now() where id = p_doc;
  perform public.vehicle_doc_log(p_doc, 'Estágio final', 'Documentação final: ' || p_stage || coalesce(' - ' || p_note, '') || '.', null, p_user);
end;
$$;

-- ================================================================ 9. Autorização operacional e exceção formal
create or replace function public.production_authorize(p_sales_order_id uuid, p_user text, p_note text default null)
returns jsonb
language plpgsql
as $$
declare
  v_order public.sales_orders%rowtype;
begin
  select * into v_order from public.sales_orders where id = p_sales_order_id for update;
  if not found then
    raise exception 'Pedido de venda não encontrado.';
  end if;
  if v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Este pedido pertence a outra empresa.';
  end if;
  if v_order.status in ('Rascunho', 'Aguardando confirmacao', 'Cancelado') then
    raise exception 'Só um pedido confirmado pode ter a produção autorizada.';
  end if;
  if coalesce(btrim(p_user), '') = '' then
    raise exception 'Informe quem autoriza.';
  end if;
  insert into public.production_authorizations (sales_order_id, authorized_by, note, system_company_id) values (p_sales_order_id, p_user, p_note, v_order.system_company_id)
  on conflict (sales_order_id) where revoked_at is null do nothing;
  perform public.sales_order_log(p_sales_order_id, 'Autorização', 'Produção autorizada' || coalesce(': ' || nullif(btrim(p_note), ''), '') || '.', p_user);
  perform public.sales_order_refresh(p_sales_order_id);
  return public.production_eligibility(p_sales_order_id);
end;
$$;

create or replace function public.production_revoke_authorization(p_sales_order_id uuid, p_reason text, p_user text)
returns jsonb
language plpgsql
as $$
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Informe o motivo da revogação.';
  end if;
  if not exists (select 1 from public.sales_orders where id = p_sales_order_id and system_company_id = public.request_system_company_id()) then
    raise exception 'Pedido de venda não encontrado.';
  end if;
  update public.production_authorizations set revoked_at = now(), revoked_by = p_user, revoke_reason = p_reason where sales_order_id = p_sales_order_id and revoked_at is null;
  perform public.sales_order_log(p_sales_order_id, 'Autorização revogada', 'Autorização revogada: ' || p_reason || '.', p_user);
  perform public.sales_order_refresh(p_sales_order_id);
  return public.production_eligibility(p_sales_order_id);
end;
$$;

create or replace function public.production_release_exception(p_sales_order_id uuid, p_component text, p_reason text, p_user text)
returns jsonb
language plpgsql
as $$
declare
  v_order public.sales_orders%rowtype;
begin
  if p_component <> 'pagamento' then
    raise exception 'A exigência "%" não pode ser dispensada: documentação é requisito legal e a autorização é interna.', p_component;
  end if;
  if not public.sales_setting('payment_exception')::boolean then
    raise exception 'A empresa não tem a regra formal de exceção comercial ligada.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Descreva a justificativa da exceção (mínimo 10 caracteres).';
  end if;
  select * into v_order from public.sales_orders where id = p_sales_order_id for update;
  if not found or v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Pedido de venda não encontrado.';
  end if;
  insert into public.production_release_exceptions (sales_order_id, component, reason, approved_by, system_company_id) values (p_sales_order_id, p_component, p_reason, p_user, v_order.system_company_id)
  on conflict (sales_order_id, component) where revoked_at is null do nothing;
  perform public.sales_order_log(p_sales_order_id, 'Exceção', 'Exigência de pagamento dispensada pela regra formal: ' || p_reason || '.', p_user);
  perform public.sales_order_refresh(p_sales_order_id);
  return public.production_eligibility(p_sales_order_id);
end;
$$;

-- ================================================================ 10. Confirmação do pedido: documentação por unidade + títulos previstos (se a empresa ligar) + demanda
create or replace function public.sales_order_generate_receivables(p_sales_order_id uuid, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_order public.sales_orders%rowtype;
  v_rule jsonb;
  v_n integer;
  v_first integer;
  v_interval integer;
  v_each numeric;
  v_amount numeric;
  v_group uuid := gen_random_uuid();
  v_i integer;
begin
  select * into v_order from public.sales_orders where id = p_sales_order_id for update;
  if not found then
    raise exception 'Pedido de venda não encontrado.';
  end if;
  if v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Este pedido pertence a outra empresa.';
  end if;
  if v_order.receivables_generated_at is not null then
    return jsonb_build_object('generated', 0, 'duplicate', true);
  end if;
  if not public.sales_setting('receivables')::boolean then
    return jsonb_build_object('generated', 0, 'skipped', 'A empresa não gera títulos a receber automaticamente na confirmação.');
  end if;
  v_rule := v_order.payment_condition_snapshot;
  if v_rule is null or v_order.total_amount <= 0 then
    return jsonb_build_object('generated', 0, 'skipped', 'Pedido sem condição de pagamento ou com valor zerado.');
  end if;
  v_n := greatest(coalesce(nullif(v_rule->>'installments', '')::integer, 1), 1);
  v_first := coalesce(nullif(v_rule->>'firstDueDays', '')::integer, 0);
  v_interval := coalesce(nullif(v_rule->>'intervalDays', '')::integer, 30);
  v_each := round(v_order.total_amount / v_n, 2);
  for v_i in 1..v_n loop
    v_amount := case when v_i = v_n then v_order.total_amount - v_each * (v_n - 1) else v_each end;
    insert into public.accounts_receivable (client_id, description, competence_date, due_date, expected_amount, received_amount, receipt_method, status, origin,
                                            installment_number, installment_count, installment_group_id, payment_condition_id, source_type, source_reference, notes)
    values (v_order.client_id, 'Pedido ' || v_order.order_number || case when v_n > 1 then ' - parcela ' || v_i || '/' || v_n else '' end || case when v_i = 1 and v_first = 0 then ' (entrada)' else '' end,
            current_date, current_date + v_first + (v_i - 1) * v_interval, v_amount, 0, coalesce(v_rule->>'paymentMethod', ''), 'Aberta', 'Pedido de venda',
            case when v_n > 1 then v_i end, case when v_n > 1 then v_n end, case when v_n > 1 then v_group end, v_order.payment_condition_id, 'Pedido de venda', v_order.order_number,
            'Gerado na confirmação do pedido ' || v_order.order_number || '.');
  end loop;
  update public.sales_orders set receivables_generated_at = now() where id = p_sales_order_id;
  perform public.sales_order_log(p_sales_order_id, 'Financeiro', v_n || ' título(s) a receber previsto(s) gerado(s) pela condição de pagamento.', p_user);
  return jsonb_build_object('generated', v_n, 'duplicate', false);
end;
$$;

create or replace function public.confirm_sales_order(p_sales_order_id uuid, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_order public.sales_orders%rowtype;
  v_result jsonb;
  v_docs integer;
  v_receivables jsonb;
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
  return v_result || jsonb_build_object('documentation_created', v_docs, 'receivables', v_receivables, 'release', public.production_eligibility(p_sales_order_id));
end;
$$;

-- ================================================================ 11. Consultas: listas, detalhe, resumos e monitoramento
create or replace function public.vehicle_doc_list(p_search text default null, p_status text default null, p_order uuid default null, p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, sales_order_id uuid, order_number text, client_name text, product_name text, product_model text, unit_number integer, units_in_item integer, vin text, protocol text, portal text, channel text,
               status text, final_stage text, submitted_at timestamptz, last_checked_at timestamptz, approved_at timestamptz, responsible text, pendencies jsonb, last_error text, stale boolean, total_count bigint)
language sql
stable
as $$
  with base as (
    select d.id, d.sales_order_id, so.order_number, c.name as client_name, d.product_name, d.product_model, d.unit_number, i.quantity::integer as units_in_item, d.vin, d.protocol, d.portal, d.channel, d.status,
           d.final_stage, d.submitted_at, d.last_checked_at, d.approved_at, d.responsible, d.pendencies, d.last_error, d.created_at,
           (d.status in ('Enviado', 'Aguardando processamento') and coalesce(d.last_checked_at, d.submitted_at, d.created_at) < now() - make_interval(days => public.sales_setting('stale_days')::integer)) as stale
    from public.vehicle_documentation d join public.sales_orders so on so.id = d.sales_order_id join public.clients c on c.id = d.client_id join public.sales_order_items i on i.id = d.sales_order_item_id
    where d.system_company_id = public.request_system_company_id()
      and (p_order is null or d.sales_order_id = p_order)
      and (p_status is null or p_status = '' or (p_status = 'abertas' and d.status not in ('Aprovado para liberacao', 'Cancelado')) or (p_status = 'atencao' and d.status in ('Em exigencia', 'Rejeitado', 'Pendente de dados')) or d.status = p_status)
      and (p_search is null or btrim(p_search) = '' or so.order_number ilike '%' || btrim(p_search) || '%' or c.name ilike '%' || btrim(p_search) || '%' or d.vin ilike '%' || btrim(p_search) || '%'
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
  select to_jsonb(d) || jsonb_build_object('order_number', so.order_number, 'client_name', c.name, 'client_document', c.document, 'quote_number', so.quote_number, 'opportunity_id', q.opportunity_id,
         'bom_version', bv.version, 'missing', to_jsonb(public.vehicle_doc_missing(d.id)), 'stale',
         (d.status in ('Enviado', 'Aguardando processamento') and coalesce(d.last_checked_at, d.submitted_at, d.created_at) < now() - make_interval(days => public.sales_setting('stale_days')::integer)))
  into v_doc
  from public.vehicle_documentation d join public.sales_orders so on so.id = d.sales_order_id join public.clients c on c.id = d.client_id left join public.quotes q on q.id = so.quote_id
  left join public.product_bom_versions bv on bv.id = d.bom_version_id
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

create or replace function public.vehicle_doc_add_file(p_doc uuid, p_kind text, p_name text, p_path text, p_user text default null)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if not exists (select 1 from public.vehicle_documentation where id = p_doc and system_company_id = public.request_system_company_id()) then
    raise exception 'Documentação não encontrada.';
  end if;
  insert into public.vehicle_documentation_files (id, documentation_id, kind, name, file_path, created_by) values (v_id, p_doc, coalesce(nullif(p_kind, ''), 'Comprovante'), p_name, p_path, coalesce(p_user, public.request_actor()));
  perform public.vehicle_doc_log(p_doc, 'Arquivo', 'Arquivo anexado: ' || p_name || '.', null, p_user);
  return v_id;
end;
$$;

-- Resumo por pedido / oportunidade (para a tela do pedido, da oportunidade e da ordem de produção)
create or replace function public.vehicle_doc_summary(p_sales_order_id uuid default null, p_opportunity_id uuid default null)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'total', count(*), 'approved', count(*) filter (where d.status = 'Aprovado para liberacao'), 'cancelled', count(*) filter (where d.status = 'Cancelado'),
    'needs_action', count(*) filter (where d.status in ('Pendente de dados', 'Pronto para envio', 'Em exigencia', 'Rejeitado')),
    'waiting', count(*) filter (where d.status in ('Envio em andamento', 'Enviado', 'Aguardando processamento')),
    'by_status', coalesce((select jsonb_object_agg(s, n) from (select status s, count(*) n from public.vehicle_documentation x
        where x.system_company_id = public.request_system_company_id() and ((p_sales_order_id is not null and x.sales_order_id = p_sales_order_id)
          or (p_opportunity_id is not null and x.sales_order_id in (select so2.id from public.sales_orders so2 join public.quotes q2 on q2.id = so2.quote_id where q2.opportunity_id = p_opportunity_id))) group by status) t), '{}'::jsonb))
  from public.vehicle_documentation d
  where d.system_company_id = public.request_system_company_id() and (
    (p_sales_order_id is not null and d.sales_order_id = p_sales_order_id)
    or (p_opportunity_id is not null and d.sales_order_id in (select so.id from public.sales_orders so join public.quotes q on q.id = so.quote_id where q.opportunity_id = p_opportunity_id)))
$$;

create or replace function public.vehicle_doc_dashboard()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'open', count(*) filter (where status not in ('Aprovado para liberacao', 'Cancelado')),
    'pending_data', count(*) filter (where status = 'Pendente de dados'),
    'ready', count(*) filter (where status = 'Pronto para envio'),
    'waiting', count(*) filter (where status in ('Envio em andamento', 'Enviado', 'Aguardando processamento')),
    'requirements', count(*) filter (where status = 'Em exigencia'),
    'rejected', count(*) filter (where status = 'Rejeitado'),
    'approved', count(*) filter (where status = 'Aprovado para liberacao'),
    'stale', count(*) filter (where status in ('Enviado', 'Aguardando processamento') and coalesce(last_checked_at, submitted_at, created_at) < now() - make_interval(days => public.sales_setting('stale_days')::integer)))
  from public.vehicle_documentation where system_company_id = public.request_system_company_id()
$$;

-- Fila do monitoramento: protocolos enviados cuja próxima consulta venceu.
create or replace function public.vehicle_doc_pending_checks(p_limit integer default 50)
returns table (id uuid, protocol text, channel text, status text, vin text)
language sql
stable
as $$
  select d.id, d.protocol, d.channel, d.status, d.vin from public.vehicle_documentation d
  where d.system_company_id = public.request_system_company_id() and d.status in ('Enviado', 'Aguardando processamento') and d.protocol is not null
    and (d.next_check_at is null or d.next_check_at <= now())
  order by coalesce(d.last_checked_at, d.submitted_at) nulls first limit greatest(least(coalesce(p_limit, 50), 200), 1)
$$;

-- Liberação de cada ordem aberta (para a lista e o detalhe da produção).
create or replace function public.production_release_map()
returns table (production_order_id uuid, eligible boolean, reasons text)
language sql
stable
as $$
  select po.id, coalesce((e.r->>'eligible')::boolean, true),
         (select string_agg(b->>'message', ' ') from jsonb_array_elements(coalesce(e.r->'blockers', '[]'::jsonb)) b)
  from public.production_orders po
  left join lateral (select public.production_eligibility(po.sales_order_id) as r where po.sales_order_id is not null) e on true
  where po.system_company_id = public.request_system_company_id() and po.status not in ('Concluida', 'Cancelada')
$$;

-- ================================================================ 12. Tenant, auditoria e acesso das tabelas novas
do $$
declare
  table_name text;
begin
  foreach table_name in array array['vehicle_documentation', 'vehicle_documentation_attempts', 'vehicle_documentation_events', 'vehicle_documentation_files', 'production_authorizations',
                                    'production_release_exceptions', 'sales_settings_log'] loop
    execute format('create index if not exists %I on public.%I (system_company_id)', table_name || '_system_company_idx', table_name);
    execute format('drop trigger if exists assign_system_company on public.%I', table_name);
    execute format('create trigger assign_system_company before insert on public.%I for each row execute function public.assign_request_system_company()', table_name);
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists tenant_authenticated_access on public.%I', table_name);
    execute format('drop policy if exists tenant_company_isolation on public.%I', table_name);
    execute format('create policy tenant_authenticated_access on public.%I as permissive for all to authenticated using (true) with check (true)', table_name);
    execute format('create policy tenant_company_isolation on public.%I as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id())', table_name);
  end loop;
end;
$$;
