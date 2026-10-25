-- 237 — Kits são fixos: gerar o pedido (e a ordem de produção) já BAIXA do estoque as matérias-primas dos kits, nas quantidades exatas.
--  1) production_order_consume_kits: baixa, da ordem, tudo o que a composição congelada pede (kit x quantidade). Se o estoque não cobre tudo, baixa o que existe
--     e deixa o restante como "faltante" (aparece no MRP e vira solicitação de compra); quando o material chegar, a baixa do restante é feita pela mesma função
--     (production_consume_pending_all baixa o que ficou pendente em todas as ordens abertas). Nunca baixa duas vezes (chave de idempotência por estado).
--  2) confirm_sales_order: depois de gerar a produção, baixa os kits das ordens do pedido (mesmo corpo do script 235 + a baixa).
--  3) cancel_production_order: ordem sem produção cancelada devolve ao estoque a baixa automática dos kits (movimento de Devolução + registro de estorno; o histórico de consumo é imutável e fica preservado).
-- Rode no SQL Editor do Supabase depois do 235. Não apaga dados; só muda as funções e acrescenta colunas.

-- O histórico de consumo é imutável: o estorno é um registro à parte (um por consumo), ligado ao movimento de devolução ao estoque.
create table if not exists public.production_consumption_reversals (
  id uuid primary key default gen_random_uuid(),
  consumption_id uuid not null unique references public.production_consumptions(id) on delete restrict,
  reversal_movement_id uuid not null references public.stock_movements(id) on delete restrict,
  reason text,
  reversed_by text,
  reversed_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create index if not exists production_consumption_reversals_company_idx on public.production_consumption_reversals (system_company_id);
drop trigger if exists assign_system_company on public.production_consumption_reversals;
create trigger assign_system_company before insert on public.production_consumption_reversals for each row execute function public.assign_request_system_company();
alter table public.production_consumption_reversals enable row level security;
drop policy if exists tenant_authenticated_access on public.production_consumption_reversals;
drop policy if exists tenant_company_isolation on public.production_consumption_reversals;
create policy tenant_authenticated_access on public.production_consumption_reversals as permissive for all to authenticated using (true) with check (true);
create policy tenant_company_isolation on public.production_consumption_reversals as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id());

-- ================================================================ 1. Baixa dos kits de uma ordem
create or replace function public.production_order_consume_kits(p_order uuid, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_po public.production_orders%rowtype;
  v_row record;
  v_free numeric;
  v_take numeric;
  v_status text;
  v_key text;
  v_consumed jsonb := '[]'::jsonb;
  v_missing jsonb := '[]'::jsonb;
begin
  select * into v_po from public.production_orders where id = p_order and system_company_id = public.request_system_company_id() for update;
  if not found then
    raise exception 'Ordem de produção não encontrada.';
  end if;
  if v_po.status in ('Concluida', 'Cancelada', 'Pausada') then
    return jsonb_build_object('production_order_id', p_order, 'consumed', v_consumed, 'missing', v_missing, 'skipped', v_po.status);
  end if;
  v_status := v_po.status;
  for v_row in
    select pom.material_id, max(pom.unit) unit, sum(greatest(pom.required_quantity - pom.consumed_quantity, 0)) remaining, sum(pom.consumed_quantity) consumed, sum(pom.reserved_quantity) mine
      from public.production_order_materials pom where pom.production_order_id = p_order
     group by pom.material_id having sum(greatest(pom.required_quantity - pom.consumed_quantity, 0)) > 0
  loop
    -- a baixa substitui a reserva da própria ordem para este material (senão sobraria reserva de material que já saiu do estoque)
    update public.stock_reservations set status = 'Cancelada' where production_order_id = p_order and material_id = v_row.material_id and status = 'Ativa';
    update public.production_order_materials set reserved_quantity = 0 where production_order_id = p_order and material_id = v_row.material_id;
    select greatest(av.physical - av.reserved, 0) into v_free from public.material_availability(v_row.material_id) av;
    v_take := round(least(v_row.remaining, coalesce(v_free, 0)), 3);
    if v_take > 0 then
      v_key := 'kit:' || v_row.material_id || ':' || round(v_row.consumed, 3);
      begin
        perform public.record_production_consumption(jsonb_build_object('production_order_id', p_order, 'material_id', v_row.material_id, 'quantity', v_take, 'kind', 'Consumo',
                 'request_key', v_key, 'responsible', p_user, 'notes', 'Baixa automática dos kits da ordem'));
        v_consumed := v_consumed || jsonb_build_object('material_id', v_row.material_id, 'quantity', v_take);
        if v_take < round(v_row.remaining, 3) then
          v_missing := v_missing || jsonb_build_object('material_id', v_row.material_id, 'missing', round(v_row.remaining - v_take, 3), 'reason', 'estoque insuficiente');
        end if;
      exception when others then
        v_missing := v_missing || jsonb_build_object('material_id', v_row.material_id, 'missing', round(v_row.remaining, 3), 'reason', sqlerrm);
      end;
    else
      v_missing := v_missing || jsonb_build_object('material_id', v_row.material_id, 'missing', round(v_row.remaining, 3), 'reason', 'sem estoque');
    end if;
  end loop;
  -- baixar material não é começar a fabricar: a ordem mantém a situação que tinha
  if v_status <> 'Em producao' then
    update public.production_orders set status = v_status where id = p_order and status = 'Em producao';
  end if;
  return jsonb_build_object('production_order_id', p_order, 'consumed', v_consumed, 'missing', v_missing);
end;
$$;

-- Baixa, em todas as ordens abertas, o que ficou pendente por falta de estoque e agora existe (use depois de receber compras).
create or replace function public.production_consume_pending_all(p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_order record;
  v_result jsonb;
  v_orders integer := 0;
  v_lines integer := 0;
begin
  for v_order in select id from public.production_orders where system_company_id = public.request_system_company_id() and status not in ('Concluida', 'Cancelada', 'Pausada') order by priority, created_at loop
    v_result := public.production_order_consume_kits(v_order.id, p_user);
    if jsonb_array_length(v_result->'consumed') > 0 then
      v_orders := v_orders + 1;
      v_lines := v_lines + jsonb_array_length(v_result->'consumed');
    end if;
  end loop;
  return jsonb_build_object('orders', v_orders, 'materials', v_lines);
end;
$$;

-- ================================================================ 2. Confirmar o pedido: gera a produção, baixa os kits e congela o snapshot
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
  v_po record;
  v_consumed jsonb := '[]'::jsonb;
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
  for v_po in select id from public.production_orders where sales_order_id = p_sales_order_id and status not in ('Concluida', 'Cancelada') order by created_at loop
    v_consumed := v_consumed || jsonb_build_array(public.production_order_consume_kits(v_po.id, p_user));
  end loop;
  v_frozen := public.sales_order_freeze_snapshots(p_sales_order_id);
  return v_result || jsonb_build_object('documentation_created', v_docs, 'receivables', v_receivables, 'release', public.production_eligibility(p_sales_order_id), 'snapshots_frozen', v_frozen, 'materials_consumed', v_consumed);
end;
$$;

-- ================================================================ 3. Cancelar a ordem devolve ao estoque a baixa automática dos kits
create or replace function public.cancel_production_order(p_production_order_id uuid, p_reason text default null)
returns void
language plpgsql
as $$
declare
  v_order public.production_orders%rowtype;
  v_c record;
  v_movement public.stock_movements%rowtype;
begin
  select * into v_order from public.production_orders where id = p_production_order_id for update;
  if not found then
    raise exception 'Ordem de produção não encontrada.';
  end if;
  if v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Esta ordem pertence a outra empresa.';
  end if;
  if v_order.status = 'Cancelada' then
    return;
  end if;
  if v_order.status = 'Concluida' or v_order.produced_quantity > 0 then
    raise exception 'A ordem % já produziu unidades e não pode ser cancelada.', v_order.code;
  end if;
  -- consumo apontado por pessoas (tablet ou manual) continua exigindo ajuste antes de cancelar; a baixa automática dos kits é devolvida aqui
  if exists (select 1 from public.production_consumptions c where c.production_order_id = v_order.id and coalesce(c.request_key, '') not like 'kit:%' and not exists (select 1 from public.production_consumption_reversals r where r.consumption_id = c.id)) then
    raise exception 'A ordem % já tem consumo apontado: devolva os materiais ao estoque (ajuste) antes de cancelar.', v_order.code;
  end if;
  for v_c in select * from public.production_consumptions c where c.production_order_id = v_order.id and c.request_key like 'kit:%' and not exists (select 1 from public.production_consumption_reversals r where r.consumption_id = c.id) order by c.occurred_at loop
    v_movement := public.apply_stock_movement(jsonb_build_object('material_id', v_c.material_id, 'movement_type', 'Devolucao', 'quantity', v_c.quantity, 'unit_cost', v_c.unit_cost,
                    'document_reference', v_order.code, 'reason', 'Estorno da baixa dos kits: ordem ' || v_order.code || ' cancelada'));
    insert into public.production_consumption_reversals (consumption_id, reversal_movement_id, reason, reversed_by, system_company_id)
    values (v_c.id, v_movement.id, 'Ordem ' || v_order.code || ' cancelada: ' || coalesce(p_reason, 'sem motivo informado'), public.request_actor(), v_order.system_company_id);
  end loop;
  update public.stock_reservations set status = 'Cancelada' where production_order_id = v_order.id and status = 'Ativa';
  update public.production_order_materials set reserved_quantity = 0, consumed_quantity = 0 where production_order_id = v_order.id;
  update public.production_orders set status = 'Cancelada', actual_materials_cost = 0, notes = coalesce(notes || E'\n', '') || 'Cancelada: ' || coalesce(p_reason, 'sem motivo informado'), updated_at = now() where id = v_order.id;
end;
$$;
