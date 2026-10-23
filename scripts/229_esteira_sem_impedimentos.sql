-- 229: esteira sem impedimentos. Designar um colaborador e a tarefa roda.
-- ADITIVA e idempotente. Requer 217 a 228. Não altera dados financeiros nem apaga nada.
--  - falta de material NÃO trava a fabricação (a ordem fica "Aguardando materiais" no MRP, mas as tarefas andam);
--  - pagamento/autorização do pedido e número de chassi deixam de bloquear as tarefas (o chassi vira opção da empresa, desligada);
--  - designar uma tarefa não exige justificativa (só reatribuir quem já está executando).
--  - a ordem nunca fica 'Aguardando materiais' (o MRP continua listando as faltas, mas a produção não olha para isso);
--  - consumo sem saldo é registrado na tarefa (sem baixa) e concluir a unidade não exige material apontado.
-- Continuam valendo: a sequência da esteira (uma etapa só abre quando a anterior termina), checklists obrigatórios, medidas e a documentação na expedição.

alter table public.shop_settings alter column require_vin_before_tasks set default false;
update public.shop_settings set require_vin_before_tasks = false where require_vin_before_tasks;

create or replace function public.shop_settings_row()
returns public.shop_settings
language plpgsql
stable
as $$
declare
  v public.shop_settings%rowtype;
begin
  select * into v from public.shop_settings where system_company_id = public.shop_cid();
  if not found then
    v.system_company_id := public.shop_cid(); v.require_vin_before_tasks := false; v.idle_minutes := 10; v.max_pin_attempts := 5; v.lockout_minutes := 10;
  end if;
  return v;
end;
$$;

-- Aguardando / Pronta pelas dependências da esteira. O chassi só bloqueia se a empresa ligar a opção; pagamento e autorização não bloqueiam mais.
create or replace function public.shop_task_refresh(p_order uuid)
returns void
language plpgsql
as $$
declare
  v_po public.production_orders%rowtype;
  v_set public.shop_settings := public.shop_settings_row();
  v_needs_vin boolean;
  v_task record;
  v_deps_ok boolean;
  v_new text;
  v_reason text;
begin
  select * into v_po from public.production_orders where id = p_order;
  if not found then return; end if;
  select coalesce(m.requires_vehicle_documentation, false) into v_needs_vin from public.materials m where m.id = v_po.product_id;
  for v_task in select t.*, s.depends_on from public.shop_tasks t join public.shop_steps s on s.id = t.step_id
                where t.production_order_id = p_order and t.status in ('Aguardando', 'Pronta', 'Bloqueada') and (t.blocked_reason is null or t.blocked_reason not like 'Manual:%') order by t.unit_number, t.seq loop
    v_reason := null;
    if v_po.status in ('Cancelada') then
      v_new := 'Cancelada';
    else
      select not exists (select 1 from unnest(v_task.depends_on) d where not exists (
               select 1 from public.shop_tasks x where x.production_order_id = p_order and x.unit_number = v_task.unit_number and x.step_code = d and x.status in ('Concluida', 'Cancelada'))) into v_deps_ok;
      if v_set.require_vin_before_tasks and v_needs_vin and coalesce(btrim(public.shop_unit_vin(p_order, v_task.unit_number)), '') = '' then
        v_new := 'Bloqueada'; v_reason := 'Aguardando a reserva/informação do número de chassi da unidade ' || v_task.unit_number || '.';
      elsif v_deps_ok then
        v_new := 'Pronta';
      else
        v_new := 'Aguardando';
      end if;
    end if;
    if v_new is distinct from v_task.status or v_reason is distinct from v_task.blocked_reason then
      update public.shop_tasks set status = v_new, blocked_reason = v_reason, updated_at = now() where id = v_task.id;
    end if;
  end loop;
end;
$$;

-- Iniciar: a ordem vai para "Em produção" sozinha, com ou sem material reservado (falta de material é assunto do MRP e do consumo, não da tarefa).
create or replace function public.shop_task_start(p_token text, p_task uuid, p_key text default null, p_device text default null, p_client_at timestamptz default null)
returns jsonb
language plpgsql
as $$
declare
  v_w public.shop_workers := public.shop_session_worker(p_token);
  v_t public.shop_tasks := public.shop_load_task(p_token, p_task);
  v_step public.shop_steps%rowtype;
  v_po public.production_orders%rowtype;
  v_open record;
  v_now timestamptz := clock_timestamp();
begin
  if p_key is not null and exists (select 1 from public.shop_task_events where task_id = p_task and request_key = p_key) then
    return jsonb_build_object('duplicate', true, 'status', v_t.status);
  end if;
  if not public.shop_worker_can(v_w, v_t) then
    raise exception 'Você não está autorizado a apontar esta tarefa.';
  end if;
  perform public.shop_task_refresh(v_t.production_order_id);
  select * into v_t from public.shop_tasks where id = p_task;
  select * into v_step from public.shop_steps where id = v_t.step_id;
  select * into v_po from public.production_orders where id = v_t.production_order_id;
  if v_step.kind = 'terceirizada' then
    raise exception 'Esta etapa é terceirizada: registre o envio e o retorno do prestador.';
  end if;
  if v_t.status = 'Bloqueada' then
    raise exception 'Tarefa bloqueada: %', coalesce(v_t.blocked_reason, 'aguarde a liberação.');
  end if;
  if v_t.status in ('Concluida', 'Cancelada', 'Com pendencia') then
    raise exception 'A tarefa está % e não pode ser iniciada.', lower(replace(v_t.status, 'Com pendencia', 'com pendência'));
  end if;
  if v_t.status = 'Aguardando' then
    raise exception 'A etapa anterior ainda não foi concluída.';
  end if;
  if v_t.status = 'Em execucao' and not v_step.allow_multiple then
    raise exception 'Esta tarefa já está em execução por outro colaborador.';
  end if;
  if v_po.status in ('Cancelada', 'Concluida', 'Pausada') then
    raise exception 'A ordem % está %.', v_po.code, lower(v_po.status);
  end if;
  select t.step_name, t.unit_number, po.code into v_open from public.shop_time_entries e join public.shop_tasks t on t.id = e.task_id join public.production_orders po on po.id = t.production_order_id where e.worker_id = v_w.id and e.ended_at is null;
  if found then
    raise exception 'Você já está executando "%" (unidade %, ordem %). Pause ou finalize antes de iniciar outra.', v_open.step_name, v_open.unit_number, v_open.code;
  end if;
  if v_step.kind <> 'administrativa' and v_po.status in ('Aguardando planejamento', 'Aguardando materiais', 'Pronta para producao') then
    update public.production_orders set status = 'Em producao', updated_at = now() where id = v_po.id;
  end if;
  insert into public.shop_time_entries (task_id, worker_id, started_at, system_company_id) values (p_task, v_w.id, v_now, v_t.system_company_id);
  update public.shop_tasks set status = 'Em execucao', started_at = coalesce(started_at, v_now), updated_at = now() where id = p_task;
  perform public.shop_event(p_task, v_w.id, 'Iniciada', jsonb_build_object('at', v_now), p_key, v_w.name, p_device, p_client_at);
  return jsonb_build_object('duplicate', false, 'status', 'Em execucao', 'started_at', v_now);
end;
$$;

-- Designar: sem justificativa quando a tarefa ainda não está com ninguém. Trocar quem já está executando continua exigindo o motivo.
create or replace function public.shop_task_reassign(p_task uuid, p_worker uuid, p_reason text, p_actor text)
returns void
language plpgsql
as $$
declare
  v_t public.shop_tasks%rowtype;
  v_w public.shop_workers%rowtype;
  v_now timestamptz := clock_timestamp();
  v_working boolean;
begin
  if coalesce(btrim(p_actor), '') = '' then
    raise exception 'Informe quem designa a tarefa.';
  end if;
  select * into v_t from public.shop_tasks where id = p_task and system_company_id = public.shop_cid() for update;
  if not found then raise exception 'Tarefa não encontrada.'; end if;
  if v_t.status in ('Concluida', 'Cancelada') then
    raise exception 'A tarefa está % e não pode ser reatribuída.', lower(v_t.status);
  end if;
  v_working := exists (select 1 from public.shop_time_entries where task_id = p_task and ended_at is null and worker_id is distinct from p_worker);
  if (v_working or (v_t.assigned_worker_id is not null and v_t.assigned_worker_id is distinct from p_worker)) and length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Para trocar quem já está com a tarefa, informe a justificativa.';
  end if;
  if p_worker is not null then
    select * into v_w from public.shop_workers where id = p_worker and system_company_id = public.shop_cid() and active;
    if not found then raise exception 'Colaborador não encontrado ou inativo.'; end if;
  end if;
  update public.shop_time_entries set ended_at = v_now, end_reason = 'reatribuicao' where task_id = p_task and ended_at is null and worker_id is distinct from p_worker;
  update public.shop_tasks set assigned_worker_id = p_worker, status = case when status = 'Em execucao' and not exists (select 1 from public.shop_time_entries where task_id = p_task and ended_at is null) then 'Pausada' else status end, updated_at = now() where id = p_task;
  perform public.shop_event(p_task, p_worker, case when v_t.assigned_worker_id is null and not v_working then 'Designada' else 'Reatribuída' end,
    jsonb_build_object('to', p_worker, 'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'previous', v_t.assigned_worker_id), null, p_actor);
end;
$$;

-- Designar todas as tarefas de uma unidade (ou da ordem toda) ao mesmo colaborador de uma vez.
create or replace function public.shop_order_assign(p_order uuid, p_unit integer, p_worker uuid, p_actor text)
returns integer
language plpgsql
as $$
declare
  v_t record;
  v_count integer := 0;
begin
  for v_t in select id from public.shop_tasks where production_order_id = p_order and system_company_id = public.shop_cid() and (p_unit is null or unit_number = p_unit)
             and status not in ('Concluida', 'Cancelada', 'Em execucao') and kind <> 'terceirizada' and assigned_worker_id is null order by unit_number, seq loop
    perform public.shop_task_reassign(v_t.id, p_worker, null, p_actor);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ================================================================ Material não bloqueia a produção
-- A ordem nunca espera material: onde antes ficava 'Aguardando materiais', agora fica 'Pronta para producao'. Faltas aparecem no MRP e nas solicitações de compra.
create or replace function public.production_orders_no_material_wait()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'Aguardando materiais' then
    new.status := 'Pronta para producao';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_production_orders_no_material_wait on public.production_orders;
create trigger trg_production_orders_no_material_wait before insert or update of status on public.production_orders for each row execute function public.production_orders_no_material_wait();
update public.production_orders set status = 'Pronta para producao' where status = 'Aguardando materiais';

-- Ordem aberta direto na produção: não reserva nem confere material (o MRP planeja as compras).
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
  insert into public.production_orders (id, code, client_id, product_id, bom_version_id, quantity, status, priority, responsible, planned_end, notes,
                                        estimated_materials_cost, estimated_labor_cost, estimated_other_cost, created_by, system_company_id)
  values (v_po, public.next_production_code('OP'), v_client, v_product.id, v_bom, v_qty, 'Pronta para producao', coalesce(nullif(p->>'priority', '')::integer, 3), nullif(btrim(p->>'responsible'), ''), nullif(p->>'planned_end', '')::date,
          coalesce(nullif(btrim(p->>'notes'), ''), 'Ordem aberta direto na produção (sem pedido de venda).'),
          round(v_cost.materials_cost * v_qty, 2), round(v_cost.labor_cost * v_qty, 2), round((v_cost.overhead_cost + v_cost.other_cost) * v_qty, 2), coalesce(p_user, public.request_actor()), v_company);
  insert into public.production_order_kits (production_order_id, kit_id, kit_version_id, quantity, system_company_id)
  select v_po, e.kit_id, e.kit_version_id, max(e.kit_quantity), v_company from public.explode_bom(v_bom, v_qty) e group by e.kit_id, e.kit_version_id;
  insert into public.production_order_materials (production_order_id, material_id, kit_id, unit, required_quantity, estimated_unit_cost, system_company_id)
  select v_po, e.material_id, e.kit_id, max(e.unit), sum(e.required_quantity), public.material_unit_cost(e.material_id), v_company from public.explode_bom(v_bom, v_qty) e group by e.material_id, e.kit_id;
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

-- Consumo apontado na tarefa: com saldo, baixa do estoque; sem saldo, fica registrado na tarefa (sem baixa) e o trabalho segue.
create or replace function public.shop_task_consume(p_token text, p_task uuid, p_material uuid, p_quantity numeric, p_key text, p_kind text default 'Consumo', p_notes text default null)
returns jsonb
language plpgsql
as $$
declare
  v_w public.shop_workers := public.shop_session_worker(p_token);
  v_t public.shop_tasks := public.shop_load_task(p_token, p_task);
  v_res jsonb;
  v_cons uuid;
  v_noted boolean := false;
begin
  if coalesce(btrim(p_key), '') = '' then
    raise exception 'Chave de idempotência obrigatória no apontamento de consumo.';
  end if;
  if exists (select 1 from public.shop_task_events where task_id = p_task and request_key = 'consumo-' || p_key) then
    return jsonb_build_object('duplicate', true);
  end if;
  if not public.shop_worker_can(v_w, v_t) then
    raise exception 'Você não está autorizado a apontar esta tarefa.';
  end if;
  if v_t.status not in ('Em execucao', 'Pausada') then
    raise exception 'Só se aponta consumo em tarefa em execução ou pausada (situação atual: %).', lower(v_t.status);
  end if;
  if p_kind not in ('Consumo', 'Perda', 'Retrabalho') then
    raise exception 'Tipo de consumo inválido.';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantidade deve ser maior que zero.';
  end if;
  if not exists (select 1 from jsonb_array_elements(public.shop_task_materials(p_task)) m where (m->>'material_id')::uuid = p_material) then
    raise exception 'Este material não faz parte da composição desta tarefa.';
  end if;
  begin
    v_res := public.record_production_consumption(jsonb_build_object('production_order_id', v_t.production_order_id, 'material_id', p_material, 'quantity', p_quantity, 'kind', p_kind,
              'request_key', 'shop-' || p_task::text || '-' || p_key, 'responsible', v_w.name, 'notes', coalesce(p_notes, 'Tarefa ' || v_t.step_name || ' (unidade ' || v_t.unit_number || ')')));
    select id into v_cons from public.production_consumptions where production_order_id = v_t.production_order_id and request_key = 'shop-' || p_task::text || '-' || p_key;
  exception when others then
    if sqlerrm like 'Saldo insuficiente%' then
      v_noted := true;
      v_res := jsonb_build_object('stock_movement', null, 'note', 'Sem saldo em estoque: consumo registrado na tarefa, sem baixa.');
    else
      raise;
    end if;
  end;
  insert into public.shop_task_consumptions (task_id, worker_id, material_id, quantity, kind, production_consumption_id, system_company_id) values (p_task, v_w.id, p_material, p_quantity, p_kind, v_cons, v_t.system_company_id);
  perform public.shop_event(p_task, v_w.id, 'Consumo', jsonb_build_object('material_id', p_material, 'quantity', p_quantity, 'kind', p_kind, 'sem_baixa_de_estoque', v_noted), 'consumo-' || p_key, v_w.name);
  return jsonb_build_object('duplicate', false, 'stock', v_res, 'without_stock_write_off', v_noted);
end;
$$;

-- Entrada do acabado: consome o que houver de material e conclui mesmo faltando.
create or replace function public.shop_unit_receive(p_order uuid, p_unit integer, p_actor text)
returns jsonb
language plpgsql
as $$
declare
  v_pending integer;
begin
  select count(*) into v_pending from public.shop_tasks where production_order_id = p_order and unit_number = p_unit and kind <> 'administrativa' and status not in ('Concluida', 'Cancelada');
  if v_pending > 0 then
    raise exception 'A unidade % ainda tem % etapa(s) de fabricação sem concluir.', p_unit, v_pending;
  end if;
  return public.complete_production(jsonb_build_object('production_order_id', p_order, 'quantity', 1, 'request_key', 'shop-unit-' || p_unit, 'responsible', p_actor, 'auto_consume', true));
end;
$$;

-- Conclusão da ordem sem exigir material apontado (consome o que existir, se pedido).
create or replace function public.complete_production(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_order public.production_orders%rowtype;
  v_qty numeric := nullif(p->>'quantity', '')::numeric;
  v_key text := nullif(p->>'request_key', '');
  v_bom public.product_bom_versions%rowtype;
  v_movement public.stock_movements%rowtype;
  v_existing public.production_receipts%rowtype;
  v_missing record;
  v_receipt uuid := gen_random_uuid();
  v_new_total numeric;
  v_ratio numeric;
  v_consumed_cost numeric;
  v_allocated numeric;
  v_coverage numeric;
  v_denominator numeric;
  v_materials numeric;
  v_labor numeric;
  v_overhead numeric;
  v_other numeric;
  v_unit_cost numeric;
begin
  select * into v_order from public.production_orders where id = (p->>'production_order_id')::uuid for update;
  if not found then
    raise exception 'Ordem de produção não encontrada.';
  end if;
  if v_key is not null then
    select * into v_existing from public.production_receipts where production_order_id = v_order.id and request_key = v_key;
    if found then
      return jsonb_build_object('receipt_id', v_existing.id, 'duplicate', true);
    end if;
  end if;
  if v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Esta ordem pertence a outra empresa.';
  end if;
  if v_order.status in ('Concluida', 'Cancelada') then
    raise exception 'Ordem % está %.', v_order.code, lower(v_order.status);
  end if;
  if v_order.status = 'Pausada' then
    raise exception 'A ordem % está pausada: retome a produção antes de concluir.', v_order.code;
  end if;
  v_qty := coalesce(v_qty, v_order.quantity - v_order.produced_quantity);
  if v_qty <= 0 or v_order.produced_quantity + v_qty > v_order.quantity then
    raise exception 'Quantidade inválida: faltam % unidade(s) para concluir a ordem %.', v_order.quantity - v_order.produced_quantity, v_order.code;
  end if;
  v_new_total := v_order.produced_quantity + v_qty;
  v_ratio := v_new_total / v_order.quantity;

  -- todo material previsto precisa ter sido apontado na proporção produzida (ou o apontamento é feito aqui, se auto_consume = true)
  for v_missing in
    select material_id, sum(required_quantity) req, sum(consumed_quantity) cons from public.production_order_materials where production_order_id = v_order.id group by material_id
  loop
    if v_missing.cons + 0.0005 < round(v_missing.req * v_ratio, 4) then
      -- sem impedimento por material: consome o que houver (auto_consume) e, faltando saldo, conclui assim mesmo
      if coalesce((p->>'auto_consume')::boolean, false) then
        begin
          perform public.record_production_consumption(jsonb_build_object('production_order_id', v_order.id, 'material_id', v_missing.material_id,
            'quantity', round(v_missing.req * v_ratio - v_missing.cons, 4), 'responsible', p->>'responsible', 'kind', 'Consumo',
            'request_key', coalesce(v_key, gen_random_uuid()::text) || ':' || v_missing.material_id::text));
        exception when others then
          null;
        end;
      end if;
    end if;
  end loop;

  select * into v_bom from public.product_bom_versions where id = v_order.bom_version_id;
  -- materiais: custo histórico consumido (cada baixa guarda o custo do momento)
  select coalesce(sum(quantity * unit_cost), 0) into v_consumed_cost from public.production_consumptions where production_order_id = v_order.id;
  select coalesce(sum(amount), 0) into v_allocated from public.production_cost_allocations where production_order_id = v_order.id and cost_type = 'materiais';
  -- unidades cobertas pelo consumo: o material menos consumido (em relação ao previsto) define quantas unidades já têm material apontado
  select least(coalesce(min(cons / nullif(req, 0)), 1), 1) into v_coverage
  from (select sum(required_quantity) req, sum(consumed_quantity) cons from public.production_order_materials where production_order_id = v_order.id group by material_id) m;
  v_denominator := greatest(round(v_order.quantity * v_coverage, 4) - v_order.produced_quantity, v_qty);
  v_materials := round(greatest(v_consumed_cost - v_allocated, 0) * v_qty / v_denominator, 2);
  v_labor := round(v_bom.labor_cost * v_qty, 2);
  v_overhead := round(v_bom.overhead_cost * v_qty, 2);
  v_other := round(v_bom.other_cost * v_qty, 2);
  v_unit_cost := round((v_materials + v_labor + v_overhead + v_other) / v_qty, 4);

  v_movement := public.apply_stock_movement(jsonb_build_object(
    'material_id', v_order.product_id, 'movement_type', 'Entrada por producao', 'quantity', v_qty, 'unit_cost', v_unit_cost,
    'document_reference', v_order.code, 'responsible', p->>'responsible', 'reason', 'Produção da ordem ' || v_order.code,
    'to_warehouse_id', coalesce(p->>'to_warehouse_id', '')));
  insert into public.production_receipts (id, production_order_id, quantity, unit_cost, materials_cost, labor_cost, stock_movement_id, warehouse_id, request_key, responsible, notes, system_company_id)
  values (v_receipt, v_order.id, v_qty, v_unit_cost, v_materials, v_labor + v_overhead + v_other, v_movement.id, v_movement.to_warehouse_id, v_key, p->>'responsible', p->>'notes', v_order.system_company_id);
  insert into public.production_cost_allocations (production_order_id, receipt_id, cost_type, criterion, basis_numerator, basis_denominator, amount, system_company_id) values
    (v_order.id, v_receipt, 'materiais', 'custo histórico consumido ainda não apropriado × unidades do lote ÷ unidades cobertas pelo consumo e ainda não produzidas', v_qty, v_denominator, v_materials, v_order.system_company_id),
    (v_order.id, v_receipt, 'mao_de_obra', 'padrão da estrutura v' || v_bom.version || ' × unidades do lote', v_qty, 1, v_labor, v_order.system_company_id),
    (v_order.id, v_receipt, 'indiretos', 'padrão da estrutura v' || v_bom.version || ' × unidades do lote', v_qty, 1, v_overhead, v_order.system_company_id),
    (v_order.id, v_receipt, 'outros', 'padrão da estrutura v' || v_bom.version || ' × unidades do lote', v_qty, 1, v_other, v_order.system_company_id);

  update public.production_orders
  set produced_quantity = v_new_total, updated_at = now(),
      status = case when v_new_total >= quantity then 'Concluida' else 'Em producao' end,
      completed_at = case when v_new_total >= quantity then now() else null end
  where id = v_order.id;
  if v_new_total >= v_order.quantity then
    update public.stock_reservations set status = 'Cancelada' where production_order_id = v_order.id and status = 'Ativa';  -- sobra de reserva volta ao saldo livre
    update public.production_order_materials set reserved_quantity = 0 where production_order_id = v_order.id;
  end if;
  if v_order.sales_order_id is not null then
    perform public.sales_order_refresh(v_order.sales_order_id);  -- reserva do acabado ao pedido já foi feita na entrada; aqui só a situação
  end if;
  return jsonb_build_object('receipt_id', v_receipt, 'unit_cost', v_unit_cost, 'quantity', v_qty, 'produced_total', v_new_total, 'materials_cost', v_materials, 'duplicate', false);
end;
$$;
