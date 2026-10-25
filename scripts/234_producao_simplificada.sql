-- 234 — Produção simplificada: pedido confirmado já vai para a esteira e cada carreta avança com um clique.
-- 1) shop_unit_advance: conclui a etapa atual da carreta (o gestor não precisa de PIN, checklist nem medidas) e libera a próxima.
--    Ao concluir a última etapa de fabricação, a carreta já entra no estoque de acabados (shop_unit_receive).
-- 2) production_eligibility: só exige o pedido confirmado. Sinal/pagamento e autorização operacional deixam de bloquear
--    (as regras do Financeiro e as contas a receber continuam como estavam, só não travam mais a fábrica).
-- Rode no SQL Editor do Supabase depois de 229_esteira_sem_impedimentos.sql. Não apaga nem altera dados existentes.

-- ================================================================ 1. Avançar a carreta
create or replace function public.shop_unit_advance(p_order uuid, p_unit integer, p_actor text default null)
returns jsonb
language plpgsql
as $$
declare
  v_po public.production_orders%rowtype;
  v_t public.shop_tasks%rowtype;
  v_now timestamptz := clock_timestamp();
  v_pending integer;
  v_received jsonb := null;
  v_next text;
begin
  select * into v_po from public.production_orders where id = p_order and system_company_id = public.shop_cid();
  if not found then
    raise exception 'Ordem de produção não encontrada.';
  end if;
  if v_po.status = 'Cancelada' then
    raise exception 'A ordem de produção está cancelada.';
  end if;
  select * into v_t from public.shop_tasks
   where production_order_id = p_order and unit_number = p_unit and status not in ('Concluida', 'Cancelada')
   order by seq limit 1 for update;
  if not found then
    raise exception 'Todas as etapas desta carreta já foram concluídas.';
  end if;
  -- fecha o tempo de quem estiver apontando e conclui a etapa
  update public.shop_time_entries set ended_at = v_now, end_reason = 'fim' where task_id = v_t.id and ended_at is null;
  update public.shop_tasks set status = 'Concluida', started_at = coalesce(started_at, v_now), finished_at = v_now, blocked_reason = null, pending_reason = null,
         quantity_done = coalesce(quantity_done, 1), updated_at = now()
   where id = v_t.id;
  perform public.shop_event(v_t.id, null, 'Concluída pelo gestor', jsonb_build_object('step', v_t.step_name), null, p_actor, 'gestor', null);
  if v_po.status in ('Aguardando planejamento', 'Aguardando materiais', 'Pronta para producao') then
    update public.production_orders set status = 'Em producao' where id = p_order;
  end if;
  perform public.shop_task_refresh(p_order);

  select count(*) into v_pending from public.shop_tasks
   where production_order_id = p_order and unit_number = p_unit and kind <> 'administrativa' and status not in ('Concluida', 'Cancelada');
  if v_pending = 0 then
    begin
      v_received := public.shop_unit_receive(p_order, p_unit, p_actor);
    exception when others then
      v_received := jsonb_build_object('error', sqlerrm);   -- a etapa fica concluída; a entrada no estoque pode ser refeita pela ficha da carreta
    end;
  else
    select step_name into v_next from public.shop_tasks
     where production_order_id = p_order and unit_number = p_unit and status not in ('Concluida', 'Cancelada') order by seq limit 1;
  end if;
  return jsonb_build_object('concluded', v_t.step_name, 'next', v_next, 'unit_finished', v_pending = 0, 'received', v_received);
end;
$$;

-- ================================================================ 2. Liberação: pedido confirmado basta
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
  v_docs_required boolean := public.sales_setting('documentation')::boolean;
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
  select count(*), count(*) filter (where status = 'Aprovado para liberacao' and not config_review_required), count(*) filter (where status = 'Cancelado')
  into v_total, v_approved, v_cancelled from public.vehicle_documentation where sales_order_id = p_sales_order_id;
  -- a documentação segue em paralelo: informada, mas só exigida na expedição (ver expedition_eligibility)
  return jsonb_build_object('eligible', jsonb_array_length(v_blockers) = 0, 'blockers', v_blockers,
    'documentation', jsonb_build_object('required', v_docs_required and v_needs_docs > 0, 'units', v_total, 'approved', v_approved, 'cancelled', v_cancelled, 'items_requiring', v_needs_docs, 'blocks_production', false, 'blocks_expedition', v_docs_required and v_needs_docs > 0));
end;
$$;
