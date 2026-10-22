-- 223: Integração Orçamento -> Pedido de venda -> Produção -> Estoque de acabados.
-- ADITIVA e idempotente. Requer 217 a 222. Não apaga nem altera dados existentes e não mexe em financeiro.
-- Hierarquia: Orçamento aprovado -> Pedido de venda (aguardando confirmação) -> Confirmado -> [exigência de sinal, se configurada] -> estoque de acabados reservado +
-- ordem de produção (estrutura e kits congelados) -> MRP -> solicitação de compra -> reserva -> consumo -> entrada do acabado (reservado ao pedido) -> entrega.

-- ================================================================ 0. Correção do snapshot do orçamento (222): produto SEM estrutura não pode derrubar a consulta
create or replace function public.product_quote_snapshot(p_ids uuid[])
returns table (id uuid, sku text, sale_price numeric, est_cost numeric, margin_percent numeric, bom_version_id uuid, bom_version integer, lead_time_days integer, available_for_quote boolean)
language sql
stable
as $$
  select m.id, m.internal_code, m.sale_price,
         case when bv.id is null then 0 else coalesce((select c.total_cost from public.product_bom_cost(bv.id) c), 0) end,
         case when bv.id is not null and m.sale_price > 0 then round((m.sale_price - coalesce((select c.total_cost from public.product_bom_cost(bv.id) c), 0)) / m.sale_price * 100, 2) else null end,
         bv.id, bv.version, m.lead_time_days, m.available_for_quote
  from public.materials m
  left join public.product_bom_versions bv on bv.product_id = m.id and bv.status = 'Ativa'
  where m.id = any(p_ids) and m.item_type = 'Produto'
$$;

-- ================================================================ 1. Orçamento: "Em negociação" e conversão em pedido de venda
do $$
declare
  c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.quotes'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) like '%Rascunho%' and pg_get_constraintdef(oid) like '%Expirado%' loop
    execute format('alter table public.quotes drop constraint %I', c.conname);
  end loop;
  alter table public.quotes add constraint quotes_status_check check (status in ('Rascunho', 'Enviado', 'Em negociação', 'Aprovado', 'Recusado', 'Expirado', 'Convertido', 'Cancelado', 'Substituído'));
  alter table public.quotes drop constraint if exists quotes_converted_to_check;
  alter table public.quotes add constraint quotes_converted_to_check check (converted_to in ('Venda', 'OS', 'Contrato', 'Pedido de venda'));
end;
$$;

-- ================================================================ 2. Pedido de venda: situações, vínculos com o orçamento e snapshot comercial
do $$
declare
  c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.sales_orders'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) like '%Rascunho%' and pg_get_constraintdef(oid) like '%Atendido%' loop
    execute format('alter table public.sales_orders drop constraint %I', c.conname);
  end loop;
  alter table public.sales_orders add constraint sales_orders_status_check check (status in (
    'Rascunho', 'Aguardando confirmacao', 'Confirmado', 'Aguardando producao', 'Em producao', 'Parcialmente disponivel', 'Pronto para entrega', 'Atendido', 'Entregue', 'Cancelado'));
end;
$$;

alter table public.sales_orders
  add column if not exists quote_number text,
  add column if not exists quote_version integer,
  add column if not exists salesperson_id uuid references public.salespeople(id) on delete set null,
  add column if not exists freight_amount numeric(14,2) not null default 0,
  add column if not exists expenses_amount numeric(14,2) not null default 0,
  add column if not exists taxes_amount numeric(14,2) not null default 0,
  add column if not exists payment_condition_id uuid references public.payment_conditions(id) on delete set null,
  add column if not exists payment_condition_name text,
  add column if not exists payment_condition_snapshot jsonb,
  add column if not exists warranty_days integer not null default 0,
  add column if not exists confirmed_by text,
  add column if not exists payment_confirmed_at timestamptz,
  add column if not exists payment_confirmed_by text,
  add column if not exists payment_note text,
  add column if not exists production_released_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists cancel_reason text;

alter table public.sales_order_items
  add column if not exists quote_item_id uuid references public.quote_items(id) on delete set null,
  add column if not exists catalog_price numeric(14,4),
  add column if not exists quoted_bom_version_id uuid references public.product_bom_versions(id) on delete restrict,
  add column if not exists quoted_bom_version_number integer,
  add column if not exists lead_time_days integer,
  add column if not exists product_sku text,
  add column if not exists planned_at timestamptz,
  add column if not exists quantity_delivered numeric(14,3) not null default 0 check (quantity_delivered >= 0);

alter table public.production_orders
  add column if not exists started_at timestamptz,
  add column if not exists status_before_pause text;

-- A estrutura usada em orçamento, venda ou produção nunca é apagada (222 já protege; venda também referencia a versão do orçamento).

-- ================================================================ 3. Configuração, histórico, entregas e origem das solicitações de compra
create table if not exists public.sales_settings (
  system_company_id uuid primary key default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete cascade,
  require_payment_before_production boolean not null default false,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_order_events (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  event text not null,
  description text not null,
  actor text,
  created_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create index if not exists sales_order_events_order_idx on public.sales_order_events (sales_order_id, created_at desc);

create table if not exists public.sales_order_deliveries (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  request_key text,
  items jsonb not null default '[]'::jsonb,
  delivered_by text,
  notes text,
  created_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create unique index if not exists sales_order_deliveries_key_uidx on public.sales_order_deliveries (sales_order_id, request_key) where request_key is not null;

create table if not exists public.production_events (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  event text not null,
  description text not null,
  actor text,
  created_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create index if not exists production_events_order_idx on public.production_events (production_order_id, created_at desc);

-- Uma solicitação de compra consolidada pode atender várias ordens: registra de qual ordem veio cada quantidade.
create table if not exists public.purchase_request_sources (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  quantity numeric(14,4) not null check (quantity > 0),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create index if not exists purchase_request_sources_request_idx on public.purchase_request_sources (purchase_request_id);
create index if not exists purchase_request_sources_order_idx on public.purchase_request_sources (production_order_id);

-- ================================================================ 4. Registro de eventos (situações do pedido e da ordem; consumo e entrada)
create or replace function public.sales_order_log(p_order uuid, p_event text, p_description text, p_actor text default null)
returns void
language sql
as $$
  insert into public.sales_order_events (sales_order_id, event, description, actor) values (p_order, p_event, p_description, coalesce(p_actor, public.request_actor()))
$$;

create or replace function public.sales_order_status_log()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    perform public.sales_order_log(new.id, 'Criado', 'Pedido ' || new.order_number || ' criado' || coalesce(' a partir do orçamento ' || new.quote_number, '') || '.');
  elsif new.status is distinct from old.status then
    perform public.sales_order_log(new.id, 'Situação', 'Situação alterada de ' || old.status || ' para ' || new.status || '.');
  end if;
  return null;
end;
$$;
drop trigger if exists trg_sales_order_status_log on public.sales_orders;
create trigger trg_sales_order_status_log after insert or update of status on public.sales_orders for each row execute function public.sales_order_status_log();

create or replace function public.production_order_status_log()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.production_events (production_order_id, event, description, actor, system_company_id)
    values (new.id, 'Criada', 'Ordem ' || new.code || ' criada para ' || new.quantity || ' unidade(s)' || '.', coalesce(new.created_by, public.request_actor()), new.system_company_id);
  elsif new.status is distinct from old.status then
    insert into public.production_events (production_order_id, event, description, actor, system_company_id)
    values (new.id, 'Situação', 'Situação alterada de ' || old.status || ' para ' || new.status || '.', public.request_actor(), new.system_company_id);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_production_order_status_log on public.production_orders;
create trigger trg_production_order_status_log after insert or update of status on public.production_orders for each row execute function public.production_order_status_log();

create or replace function public.production_order_started_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'Em producao' and new.started_at is null then
    new.started_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_production_order_started_at on public.production_orders;
create trigger trg_production_order_started_at before insert or update of status on public.production_orders for each row execute function public.production_order_started_at();

create or replace function public.production_consumption_log()
returns trigger
language plpgsql
as $$
begin
  insert into public.production_events (production_order_id, event, description, actor, system_company_id)
  values (new.production_order_id, 'Consumo', new.kind || ': ' || new.quantity || ' de ' || (select name from public.materials where id = new.material_id) || ' (custo unitário ' || new.unit_cost || ').',
          coalesce(new.responsible, public.request_actor()), new.system_company_id);
  return null;
end;
$$;
drop trigger if exists trg_production_consumption_log on public.production_consumptions;
create trigger trg_production_consumption_log after insert on public.production_consumptions for each row execute function public.production_consumption_log();

-- Entrada do acabado: registra o evento e RESERVA a unidade para o pedido de origem (a mesma unidade nunca fica "livre" e "do pedido" ao mesmo tempo).
create or replace function public.production_receipt_after_insert()
returns trigger
language plpgsql
as $$
declare
  v_po public.production_orders%rowtype;
begin
  select * into v_po from public.production_orders where id = new.production_order_id;
  insert into public.production_events (production_order_id, event, description, actor, system_company_id)
  values (new.production_order_id, 'Conclusão parcial/total', new.quantity || ' unidade(s) concluída(s) e recebida(s) no estoque a ' || new.unit_cost || ' cada.', coalesce(new.responsible, public.request_actor()), new.system_company_id);
  if v_po.sales_order_item_id is not null then
    insert into public.stock_reservations (material_id, quantity, status, sales_order_item_id, responsible, notes)
    values (v_po.product_id, new.quantity, 'Ativa', v_po.sales_order_item_id, new.responsible, 'Produzido para o pedido (ordem ' || v_po.code || ')');
    perform public.sales_order_refresh(v_po.sales_order_id);
  end if;
  return null;
end;
$$;
drop trigger if exists trg_production_receipt_after_insert on public.production_receipts;
create trigger trg_production_receipt_after_insert after insert on public.production_receipts for each row execute function public.production_receipt_after_insert();

-- ================================================================ 5. Configuração: exigir sinal / confirmação de pagamento antes de fabricar
create or replace function public.sales_requires_payment()
returns boolean
language sql
stable
as $$
  select coalesce((select require_payment_before_production from public.sales_settings where system_company_id = public.request_system_company_id()), false)
$$;

create or replace function public.sales_settings_save(p_require boolean, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_company uuid := public.request_system_company_id();
begin
  insert into public.sales_settings (system_company_id, require_payment_before_production, updated_by, updated_at)
  values (v_company, coalesce(p_require, false), coalesce(p_user, public.request_actor()), now())
  on conflict (system_company_id) do update set require_payment_before_production = excluded.require_payment_before_production, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('require_payment_before_production', coalesce(p_require, false));
end;
$$;

-- ================================================================ 6. Orçamento aprovado -> Pedido de venda (idempotente)
create or replace function public.sales_order_from_quote(p_quote_id uuid, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_quote public.quotes%rowtype;
  v_client public.clients%rowtype;
  v_existing public.sales_orders%rowtype;
  v_item record;
  v_order uuid := gen_random_uuid();
  v_number text;
  v_delivery date;
  v_count integer := 0;
begin
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Orçamento não encontrado.';
  end if;
  if v_quote.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Este orçamento pertence a outra empresa.';
  end if;
  -- clique duplo / requisição repetida: devolve o pedido já criado
  select * into v_existing from public.sales_orders where quote_id = p_quote_id and status <> 'Cancelado';
  if found then
    return jsonb_build_object('sales_order_id', v_existing.id, 'order_number', v_existing.order_number, 'status', v_existing.status, 'duplicate', true);
  end if;
  if v_quote.status <> 'Aprovado' then
    raise exception 'Só é possível converter um orçamento aprovado (situação atual: %).', v_quote.status;
  end if;
  select * into v_client from public.clients where id = v_quote.client_id;
  if not found or coalesce(btrim(v_client.name), '') = '' then
    raise exception 'O orçamento não tem cliente identificado.';
  end if;
  if coalesce(v_client.status, '') = 'Inativo' then
    raise exception 'O cliente % está inativo.', v_client.name;
  end if;
  if coalesce(btrim(v_client.document), '') = '' then
    raise exception 'O cliente % não tem CPF/CNPJ cadastrado: complete o cadastro antes de gerar o pedido.', v_client.name;
  end if;
  if not exists (select 1 from public.quote_items where quote_id = p_quote_id) then
    raise exception 'O orçamento não tem itens.';
  end if;
  for v_item in select qi.*, m.item_type, m.name as material_name from public.quote_items qi left join public.materials m on m.id = qi.material_id where qi.quote_id = p_quote_id order by qi.position loop
    if v_item.quantity <= 0 or v_item.unit_price < 0 then
      raise exception 'O item "%" tem quantidade ou valor inválido.', v_item.description;
    end if;
    if v_item.line_type = 'Produto' then
      if v_item.material_id is null then
        raise exception 'O item "%" não está ligado a um produto do catálogo.', v_item.description;
      end if;
      if v_item.item_type = 'Kit' then
        raise exception 'Kit não é vendido diretamente: o item "%" deve ser o produto final.', v_item.description;
      end if;
    end if;
    v_count := v_count + 1;
  end loop;

  v_number := public.next_sales_order_number();
  select current_date + max(lead_time_days) into v_delivery from public.quote_items where quote_id = p_quote_id;
  insert into public.sales_orders (id, order_number, quote_id, quote_number, quote_version, client_id, salesperson_id, status, order_date, delivery_date, items_total, discount_amount, total_amount,
                                   freight_amount, expenses_amount, taxes_amount, payment_condition_id, payment_condition_name, payment_condition_snapshot, warranty_days, notes, created_by)
  values (v_order, v_number, p_quote_id, v_quote.quote_number, v_quote.version, v_quote.client_id, v_quote.salesperson_id, 'Aguardando confirmacao', current_date, v_delivery, v_quote.items_subtotal, v_quote.discount_amount,
          v_quote.total_amount, v_quote.freight_amount, v_quote.expenses_amount, v_quote.taxes_amount, v_quote.payment_condition_id, v_quote.payment_condition_name, v_quote.payment_condition_snapshot,
          v_quote.warranty_days, v_quote.notes, coalesce(p_user, public.request_actor()));
  insert into public.sales_order_items (sales_order_id, position, line_type, material_id, service_type_id, description, unit, quantity, unit_price, discount_percent, total, unit_cost, make_to_order,
                                        quote_item_id, catalog_price, quoted_bom_version_id, quoted_bom_version_number, lead_time_days, product_sku, notes)
  select v_order, qi.position, qi.line_type, qi.material_id, qi.service_type_id, qi.description, qi.unit, qi.quantity, qi.unit_price, qi.discount_percent, qi.total, qi.unit_cost,
         coalesce(m.make_to_order, false), qi.id, qi.catalog_price, qi.bom_version_id, qi.bom_version_number, qi.lead_time_days, qi.product_sku, qi.notes
  from public.quote_items qi left join public.materials m on m.id = qi.material_id where qi.quote_id = p_quote_id order by qi.position;

  update public.quotes set status = 'Convertido', converted_to = 'Pedido de venda', converted_at = now(), updated_at = now() where id = p_quote_id;
  insert into public.quote_events (quote_id, event, description, author)
  values (p_quote_id, 'Convertido', 'Convertido no pedido de venda ' || v_number || '. Nenhum estoque foi reservado nem consumido; os lançamentos financeiros não foram gerados.', coalesce(p_user, public.request_actor()));
  return jsonb_build_object('sales_order_id', v_order, 'order_number', v_number, 'status', 'Aguardando confirmacao', 'items', v_count, 'duplicate', false);
end;
$$;

-- ================================================================ 7. Pré-visualização do atendimento (só leitura): estoque de acabados x fabricação
create or replace function public.sales_order_availability(p_sales_order_id uuid)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'item_id', i.id, 'description', i.description, 'sku', m.internal_code, 'quantity', i.quantity, 'make_to_order', i.make_to_order,
    'available_finished', av.available,
    'would_reserve', case when i.make_to_order then 0 else least(av.available, i.quantity - i.quantity_delivered) end,
    'would_produce', i.quantity - i.quantity_delivered - case when i.make_to_order then 0 else least(av.available, i.quantity - i.quantity_delivered) end,
    'active_bom_version', bv.version, 'quoted_bom_version', i.quoted_bom_version_number,
    'structure_changed', (i.quoted_bom_version_id is not null and bv.id is not null and i.quoted_bom_version_id <> bv.id),
    'has_structure', bv.id is not null) order by i.position), '[]'::jsonb)
  from public.sales_order_items i
  join public.materials m on m.id = i.material_id and m.item_type = 'Produto'
  cross join lateral public.material_availability(i.material_id) av
  left join public.product_bom_versions bv on bv.product_id = i.material_id and bv.status = 'Ativa'
  where i.sales_order_id = p_sales_order_id and i.line_type = 'Produto'
$$;

-- ================================================================ 8. Situação do pedido a partir do atendimento real
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
  v_new := case when v_all_delivered then 'Entregue' when v_all_ready then 'Pronto para entrega' when v_any then 'Parcialmente disponivel' when v_open then 'Em producao' else v_status end;
  if v_new <> v_status then
    update public.sales_orders set status = v_new, delivered_at = case when v_new = 'Entregue' then now() else delivered_at end, updated_at = now() where id = p_order;
  end if;
  return v_new;
end;
$$;

-- ================================================================ 9. Pedido confirmado -> reserva de acabados + ordem de produção (idempotente)
-- Estoque de acabados disponível é reservado (não consumido); o restante vira UMA ordem de produção por item, com estrutura e kits congelados.
-- Com "exigir sinal" ligado, nada é reservado nem gerado até a confirmação do pagamento.
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
  if public.sales_requires_payment() and v_order.payment_confirmed_at is null then
    update public.sales_orders set status = 'Aguardando producao', updated_at = now() where id = p_sales_order_id and status = 'Confirmado';
    return jsonb_build_object('sales_order_id', p_sales_order_id, 'blocked', true, 'reason', 'Produção aguardando a confirmação do pagamento/sinal.', 'production_orders_created', '[]'::jsonb, 'already_existing', '[]'::jsonb);
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
      continue;  -- atendido só pelo estoque de acabados: nada a replanejar
    end if;
    if v_item.planned_at is not null then
      -- ordem anterior cancelada (sem produção): replaneja do zero
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
  return jsonb_build_object('sales_order_id', p_sales_order_id, 'blocked', false, 'production_orders_created', v_created, 'already_existing', v_reused);
end;
$$;

create or replace function public.confirm_sales_order(p_sales_order_id uuid, p_user text default null)
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
  if v_order.status = 'Cancelado' then
    raise exception 'Pedido cancelado não pode ser confirmado.';
  end if;
  if not exists (select 1 from public.sales_order_items where sales_order_id = p_sales_order_id) then
    raise exception 'O pedido não tem itens.';
  end if;
  if v_order.status in ('Rascunho', 'Aguardando confirmacao') then
    update public.sales_orders set status = 'Confirmado', confirmed_by = coalesce(p_user, public.request_actor()) where id = p_sales_order_id;
  end if;
  return public.create_production_from_sale(p_sales_order_id, p_user);
end;
$$;

-- Confirmação do sinal/pagamento: libera a fabricação quando a empresa exige (idempotente).
create or replace function public.confirm_sales_payment(p_sales_order_id uuid, p_user text default null, p_note text default null)
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
  if v_order.status in ('Rascunho', 'Aguardando confirmacao') then
    raise exception 'Confirme o pedido antes de registrar o pagamento.';
  end if;
  if v_order.status = 'Cancelado' then
    raise exception 'Pedido cancelado.';
  end if;
  if v_order.payment_confirmed_at is null then
    update public.sales_orders set payment_confirmed_at = now(), payment_confirmed_by = coalesce(p_user, public.request_actor()), payment_note = p_note where id = p_sales_order_id;
    perform public.sales_order_log(p_sales_order_id, 'Pagamento', 'Pagamento/sinal confirmado' || coalesce(': ' || nullif(btrim(p_note), ''), '') || '.', p_user);
  end if;
  return public.create_production_from_sale(p_sales_order_id, p_user);
end;
$$;

-- ================================================================ 10. Entrega (saída efetiva do acabado) — idempotente
create or replace function public.deliver_sales_order(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_order public.sales_orders%rowtype;
  v_key text := nullif(p->>'request_key', '');
  v_existing uuid;
  v_item record;
  v_reserved numeric;
  v_qty numeric;
  v_release numeric;
  v_res record;
  v_movement public.stock_movements%rowtype;
  v_lines jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_id uuid := gen_random_uuid();
begin
  select * into v_order from public.sales_orders where id = (p->>'sales_order_id')::uuid for update;
  if not found then
    raise exception 'Pedido de venda não encontrado.';
  end if;
  if v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Este pedido pertence a outra empresa.';
  end if;
  if v_key is not null then
    select id into v_existing from public.sales_order_deliveries where sales_order_id = v_order.id and request_key = v_key;
    if found then
      return jsonb_build_object('delivery_id', v_existing, 'duplicate', true);
    end if;
  end if;
  if v_order.status not in ('Parcialmente disponivel', 'Pronto para entrega') then
    raise exception 'O pedido % está % e não tem produtos prontos para entrega.', v_order.order_number, v_order.status;
  end if;
  for v_item in select i.* from public.sales_order_items i where i.sales_order_id = v_order.id and i.line_type = 'Produto' and i.material_id is not null order by i.position loop
    v_reserved := coalesce((select sum(quantity) from public.stock_reservations where sales_order_item_id = v_item.id and status = 'Ativa'), 0);
    v_qty := case when p ? 'items' then coalesce((select (e->>'quantity')::numeric from jsonb_array_elements(p->'items') e where (e->>'item_id')::uuid = v_item.id), 0) else v_reserved end;
    if v_qty <= 0 then
      continue;
    end if;
    if v_qty > v_reserved + 0.0005 then
      raise exception 'O item "%" tem apenas % unidade(s) pronta(s) para entrega.', v_item.description, v_reserved;
    end if;
    v_movement := public.apply_stock_movement(jsonb_build_object(
      'material_id', v_item.material_id, 'movement_type', 'Saida por venda', 'quantity', v_qty, 'document_reference', v_order.order_number,
      'responsible', p->>'user', 'reason', 'Entrega do pedido ' || v_order.order_number, 'from_warehouse_id', coalesce(p->>'warehouse_id', '')));
    v_release := v_qty;
    for v_res in select id, quantity from public.stock_reservations where sales_order_item_id = v_item.id and status = 'Ativa' order by created_at for update loop
      exit when v_release <= 0;
      if v_res.quantity <= v_release then
        update public.stock_reservations set status = 'Consumida' where id = v_res.id;
        v_release := v_release - v_res.quantity;
      else
        update public.stock_reservations set quantity = quantity - v_release where id = v_res.id;
        insert into public.stock_reservations (material_id, quantity, status, sales_order_item_id, notes) values (v_item.material_id, v_release, 'Consumida', v_item.id, 'Entrega parcial do pedido ' || v_order.order_number);
        v_release := 0;
      end if;
    end loop;
    update public.sales_order_items set quantity_delivered = quantity_delivered + v_qty where id = v_item.id;
    v_lines := v_lines || jsonb_build_object('item_id', v_item.id, 'description', v_item.description, 'quantity', v_qty, 'stock_movement_id', v_movement.id, 'unit_cost', v_movement.unit_cost);
    v_total := v_total + v_qty;
  end loop;
  if v_total = 0 then
    raise exception 'Nenhum item pronto para entrega foi informado.';
  end if;
  insert into public.sales_order_deliveries (id, sales_order_id, request_key, items, delivered_by, notes, system_company_id)
  values (v_id, v_order.id, v_key, v_lines, coalesce(p->>'user', public.request_actor()), p->>'notes', v_order.system_company_id);
  perform public.sales_order_log(v_order.id, 'Entrega', v_total || ' unidade(s) entregue(s) (baixa do estoque de acabados).', p->>'user');
  perform public.sales_order_refresh(v_order.id);
  return jsonb_build_object('delivery_id', v_id, 'delivered', v_total, 'items', v_lines, 'status', (select status from public.sales_orders where id = v_order.id), 'duplicate', false);
end;
$$;

-- ================================================================ 11. Cancelamento do pedido (sem movimentar estoque indevidamente)
create or replace function public.cancel_sales_order(p_sales_order_id uuid, p_reason text, p_user text default null)
returns void
language plpgsql
as $$
declare
  v_order public.sales_orders%rowtype;
  v_po record;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Informe o motivo do cancelamento do pedido.';
  end if;
  select * into v_order from public.sales_orders where id = p_sales_order_id for update;
  if not found then
    raise exception 'Pedido de venda não encontrado.';
  end if;
  if v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Este pedido pertence a outra empresa.';
  end if;
  if v_order.status = 'Cancelado' then
    return;
  end if;
  if exists (select 1 from public.sales_order_items where sales_order_id = p_sales_order_id and quantity_delivered > 0) then
    raise exception 'O pedido % já teve entrega e não pode ser cancelado.', v_order.order_number;
  end if;
  for v_po in select id from public.production_orders where sales_order_id = p_sales_order_id and status <> 'Cancelada' loop
    perform public.cancel_production_order(v_po.id, 'Pedido ' || v_order.order_number || ' cancelado: ' || p_reason);
  end loop;
  update public.stock_reservations set status = 'Cancelada' where status = 'Ativa' and sales_order_item_id in (select id from public.sales_order_items where sales_order_id = p_sales_order_id);
  update public.sales_orders set status = 'Cancelado', cancel_reason = p_reason, updated_at = now() where id = p_sales_order_id;
  perform public.sales_order_log(p_sales_order_id, 'Cancelado', 'Pedido cancelado: ' || p_reason || '.', p_user);
end;
$$;

-- ================================================================ 12. Execução da produção: situações controladas
create or replace function public.production_change_status(p_order uuid, p_action text, p_user text default null, p_reason text default null)
returns text
language plpgsql
as $$
declare
  v_order public.production_orders%rowtype;
  v_new text;
begin
  select * into v_order from public.production_orders where id = p_order for update;
  if not found then
    raise exception 'Ordem de produção não encontrada.';
  end if;
  if v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Esta ordem pertence a outra empresa.';
  end if;
  if v_order.status in ('Concluida', 'Cancelada') then
    raise exception 'Ordem % está %.', v_order.code, lower(v_order.status);
  end if;
  if p_action = 'start' then
    if v_order.status <> 'Pronta para producao' then
      raise exception 'A ordem % está "%": reserve os materiais (ou aguarde o recebimento) antes de iniciar.', v_order.code, v_order.status;
    end if;
    v_new := 'Em producao';
  elsif p_action = 'pause' then
    if v_order.status = 'Pausada' or v_order.status = 'Aguardando planejamento' then
      raise exception 'A ordem % não pode ser pausada agora.', v_order.code;
    end if;
    if coalesce(btrim(p_reason), '') = '' then
      raise exception 'Informe o motivo da pausa.';
    end if;
    update public.production_orders set status_before_pause = v_order.status where id = p_order;
    v_new := 'Pausada';
  elsif p_action = 'resume' then
    if v_order.status <> 'Pausada' then
      raise exception 'A ordem % não está pausada.', v_order.code;
    end if;
    v_new := coalesce(v_order.status_before_pause, 'Em producao');
  elsif p_action = 'inspection' then
    if v_order.status <> 'Em producao' then
      raise exception 'Só uma ordem em produção pode ir para inspeção.';
    end if;
    v_new := 'Aguardando inspecao';
  elsif p_action = 'back_to_production' then
    if v_order.status <> 'Aguardando inspecao' then
      raise exception 'A ordem não está aguardando inspeção.';
    end if;
    v_new := 'Em producao';
  else
    raise exception 'Ação de produção desconhecida: %.', p_action;
  end if;
  update public.production_orders set status = v_new, updated_at = now() where id = p_order;
  if coalesce(btrim(p_reason), '') <> '' then
    insert into public.production_events (production_order_id, event, description, actor, system_company_id)
    values (p_order, 'Motivo', p_reason, coalesce(p_user, public.request_actor()), v_order.system_company_id);
  end if;
  return v_new;
end;
$$;

-- Plano da ordem (responsável, prioridade e datas previstas).
create or replace function public.production_update_plan(p jsonb)
returns void
language plpgsql
as $$
declare
  v_order public.production_orders%rowtype;
begin
  select * into v_order from public.production_orders where id = (p->>'production_order_id')::uuid for update;
  if not found then
    raise exception 'Ordem de produção não encontrada.';
  end if;
  if v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Esta ordem pertence a outra empresa.';
  end if;
  if v_order.status in ('Concluida', 'Cancelada') then
    raise exception 'Ordem % está %.', v_order.code, lower(v_order.status);
  end if;
  update public.production_orders set
    responsible = case when p ? 'responsible' then nullif(btrim(p->>'responsible'), '') else responsible end,
    priority = coalesce(nullif(p->>'priority', '')::integer, priority),
    planned_start = case when p ? 'planned_start' then nullif(p->>'planned_start', '')::date else planned_start end,
    planned_end = case when p ? 'planned_end' then nullif(p->>'planned_end', '')::date else planned_end end,
    updated_at = now()
  where id = v_order.id;
end;
$$;

-- ================================================================ 12b. Conclusão (total ou parcial): entrada do acabado, custo por lote e atendimento do pedido
-- A entrada do acabado RESERVA a unidade para o pedido de origem (gatilho production_receipt_after_insert). Mesma regra de custeio da 219.
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
      if coalesce((p->>'auto_consume')::boolean, false) then
        perform public.record_production_consumption(jsonb_build_object('production_order_id', v_order.id, 'material_id', v_missing.material_id,
          'quantity', round(v_missing.req * v_ratio - v_missing.cons, 4), 'responsible', p->>'responsible', 'kind', 'Consumo',
          'request_key', coalesce(v_key, gen_random_uuid()::text) || ':' || v_missing.material_id::text));
      else
        raise exception 'Faltam apontamentos de consumo do material % (previsto %, apontado %). Aponte o consumo ou use a conclusão com consumo automático.',
          (select name from public.materials where id = v_missing.material_id), round(v_missing.req * v_ratio, 4), v_missing.cons;
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
-- ================================================================ 12c. Mesmas funções da 219, agora recusando ordens de outra empresa
create or replace function public.reserve_production_materials(p_production_order_id uuid, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_order public.production_orders%rowtype;
  v_row record;
  v_free numeric;
  v_target numeric;
  v_new numeric;
  v_short integer := 0;
begin
  select * into v_order from public.production_orders where id = p_production_order_id for update;
  if not found then
    raise exception 'Ordem de produção não encontrada.';
  end if;
  if v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Esta ordem pertence a outra empresa.';
  end if;
  if v_order.status in ('Concluida', 'Cancelada') then
    raise exception 'Ordem % está %: não reserva materiais.', v_order.code, lower(v_order.status);
  end if;
  for v_row in select * from public.production_order_materials where production_order_id = p_production_order_id order by material_id, kit_id for update loop
    v_target := greatest(v_row.required_quantity - v_row.consumed_quantity - v_row.reserved_quantity, 0);
    if v_target > 0 then
      select available into v_free from public.material_availability(v_row.material_id);
      v_new := least(coalesce(v_free, 0), v_target);
      if v_new > 0 then
        insert into public.stock_reservations (material_id, quantity, status, production_order_id, responsible, notes)
        values (v_row.material_id, v_new, 'Ativa', p_production_order_id, p_user, 'Reserva da ordem ' || v_order.code);
        update public.production_order_materials set reserved_quantity = reserved_quantity + v_new where id = v_row.id;
      end if;
      if v_new < v_target then
        v_short := v_short + 1;
      end if;
    end if;
  end loop;
  update public.production_orders
  set status = case when v_short > 0 then 'Aguardando materiais' when status in ('Aguardando planejamento', 'Aguardando materiais') then 'Pronta para producao' else status end, updated_at = now()
  where id = p_production_order_id and status in ('Aguardando planejamento', 'Aguardando materiais', 'Pronta para producao');
  return jsonb_build_object('production_order_id', p_production_order_id, 'materials_with_shortage', v_short);
end;
$$;

create or replace function public.record_production_consumption(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_order public.production_orders%rowtype;
  v_material uuid := (p->>'material_id')::uuid;
  v_qty numeric := nullif(p->>'quantity', '')::numeric;
  v_kind text := coalesce(nullif(p->>'kind', ''), 'Consumo');
  v_key text := nullif(p->>'request_key', '');
  v_row public.production_order_materials%rowtype;
  v_movement public.stock_movements%rowtype;
  v_existing public.production_consumptions%rowtype;
  v_release numeric;
  v_left numeric;
  v_res record;
begin
  if v_qty is null or v_qty <= 0 then
    raise exception 'Quantidade deve ser maior que zero.';
  end if;
  select * into v_order from public.production_orders where id = (p->>'production_order_id')::uuid for update;
  if not found then
    raise exception 'Ordem de produção não encontrada.';
  end if;
  if v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Esta ordem pertence a outra empresa.';
  end if;
  if v_order.status in ('Concluida', 'Cancelada', 'Pausada') then
    raise exception 'Ordem % está %: não aceita apontamento de consumo.', v_order.code, lower(v_order.status);
  end if;
  if v_key is not null then
    select * into v_existing from public.production_consumptions where production_order_id = v_order.id and request_key = v_key;
    if found then
      return jsonb_build_object('consumption_id', v_existing.id, 'duplicate', true);
    end if;
  end if;
  if not exists (select 1 from public.production_order_materials where production_order_id = v_order.id and material_id = v_material) then
    if v_kind <> 'Adicional' then
      raise exception 'O material não faz parte da ordem. Use o tipo "Adicional" para consumo extra.';
    end if;
  end if;

  v_movement := public.apply_stock_movement(jsonb_build_object(
    'material_id', v_material, 'movement_type', 'Consumo em producao', 'quantity', v_qty,
    'document_reference', v_order.code, 'responsible', p->>'responsible', 'reason', v_kind || ' na ordem ' || v_order.code,
    'from_warehouse_id', coalesce(p->>'from_warehouse_id', '')));

  insert into public.production_consumptions (production_order_id, material_id, quantity, kind, unit_cost, stock_movement_id, request_key, responsible, notes, system_company_id)
  values (v_order.id, v_material, v_qty, v_kind, v_movement.unit_cost, v_movement.id, v_key, p->>'responsible', p->>'notes', v_order.system_company_id);

  -- reparte o consumo entre as linhas do material (kits de origem) e libera a reserva correspondente
  v_left := v_qty;
  for v_row in select * from public.production_order_materials where production_order_id = v_order.id and material_id = v_material order by (required_quantity - consumed_quantity) desc for update loop
    exit when v_left <= 0;
    declare v_take numeric := least(v_left, greatest(v_row.required_quantity - v_row.consumed_quantity, 0)); begin
      if v_take > 0 then
        update public.production_order_materials set consumed_quantity = consumed_quantity + v_take, reserved_quantity = greatest(reserved_quantity - v_take, 0) where id = v_row.id;
        v_left := v_left - v_take;
      end if;
    end;
  end loop;
  if v_left > 0 then  -- consumo além do previsto: fica na primeira linha do material (ou criada como adicional)
    update public.production_order_materials set consumed_quantity = consumed_quantity + v_left
    where id = (select id from public.production_order_materials where production_order_id = v_order.id and material_id = v_material order by required_quantity desc limit 1);
    if not found then
      insert into public.production_order_materials (production_order_id, material_id, kit_id, unit, required_quantity, consumed_quantity, system_company_id)
      select v_order.id, v_material, coalesce((select kit_id from public.production_order_kits where production_order_id = v_order.id limit 1), v_order.product_id),
             (select unit from public.materials where id = v_material), v_left, v_left, v_order.system_company_id;
    end if;
  end if;

  -- libera da reserva da ordem o que foi consumido (reservas mais antigas primeiro)
  v_release := v_qty;
  for v_res in select id, quantity from public.stock_reservations where production_order_id = v_order.id and material_id = v_material and status = 'Ativa' order by created_at for update loop
    exit when v_release <= 0;
    if v_res.quantity <= v_release then
      update public.stock_reservations set status = 'Consumida' where id = v_res.id;
      v_release := v_release - v_res.quantity;
    else
      update public.stock_reservations set quantity = quantity - v_release where id = v_res.id;
      insert into public.stock_reservations (material_id, quantity, status, production_order_id, notes) values (v_material, v_release, 'Consumida', v_order.id, 'Consumo parcial da ordem ' || v_order.code);
      v_release := 0;
    end if;
  end loop;

  update public.production_orders set status = 'Em producao', updated_at = now(),
         actual_materials_cost = actual_materials_cost + round(v_movement.total_cost, 2)
  where id = v_order.id and status in ('Pronta para producao', 'Aguardando materiais', 'Aguardando planejamento', 'Em producao', 'Aguardando inspecao');
  return jsonb_build_object('stock_movement_id', v_movement.id, 'unit_cost', v_movement.unit_cost, 'total_cost', v_movement.total_cost, 'duplicate', false);
end;
$$;

create or replace function public.cancel_production_order(p_production_order_id uuid, p_reason text default null)
returns void
language plpgsql
as $$
declare
  v_order public.production_orders%rowtype;
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
  if exists (select 1 from public.production_consumptions where production_order_id = v_order.id) then
    raise exception 'A ordem % já tem consumo apontado: devolva os materiais ao estoque (ajuste) antes de cancelar.', v_order.code;
  end if;
  update public.stock_reservations set status = 'Cancelada' where production_order_id = v_order.id and status = 'Ativa';
  update public.production_order_materials set reserved_quantity = 0 where production_order_id = v_order.id;
  update public.production_orders set status = 'Cancelada', notes = coalesce(notes || E'\n', '') || 'Cancelada: ' || coalesce(p_reason, 'sem motivo informado'), updated_at = now() where id = v_order.id;
end;
$$;

create or replace function public.generate_purchase_request(p_production_order_id uuid, p_requested_by text default null)
returns uuid
language plpgsql
as $$
declare
  v_order public.production_orders%rowtype;
  v_request uuid;
  v_row record;
  v_qty numeric;
  v_min numeric;
begin
  select * into v_order from public.production_orders where id = p_production_order_id;
  if not found then
    raise exception 'Ordem de produção não encontrada.';
  end if;
  if v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Esta ordem pertence a outra empresa.';
  end if;
  if not exists (select 1 from public.plan_materials(p_production_order_id) where shortage > 0) then
    raise exception 'A ordem % não tem falta de material.', v_order.code;
  end if;
  delete from public.purchase_requests where production_order_id = p_production_order_id and status = 'Pendente';
  v_request := gen_random_uuid();
  insert into public.purchase_requests (id, request_number, production_order_id, requested_by, notes, system_company_id)
  values (v_request, public.next_production_code('SC'), p_production_order_id, p_requested_by, 'Gerada pelo planejamento de materiais da ordem ' || v_order.code, v_order.system_company_id);
  for v_row in select * from public.plan_materials(p_production_order_id) where shortage > 0 loop
    select coalesce(min_purchase_qty, 0) into v_min from public.materials where id = v_row.material_id;
    v_qty := greatest(v_row.shortage, v_min);
    insert into public.purchase_request_items (purchase_request_id, material_id, quantity, unit, needed_by, suggested_supplier_id, system_company_id)
    values (v_request, v_row.material_id, v_qty, v_row.unit, v_order.planned_start,
            (select supplier_id from public.raw_material_suppliers where material_id = v_row.material_id and is_primary), v_order.system_company_id);
  end loop;
  return v_request;
end;
$$;



-- ================================================================ 13. MRP consolidado das ordens abertas da empresa (só leitura)
-- Necessidade ainda sem reserva = (previsto - consumido) - reservado para as ordens. Como as reservas já reduzem o saldo livre, duas ordens nunca contam o mesmo saldo.
create or replace function public.mrp_overview()
returns table (material_id uuid, sku text, name text, unit text, required numeric, reserved_for_orders numeric, unreserved_need numeric, physical numeric, reserved_total numeric, available numeric,
               incoming numeric, shortage_now numeric, shortage_projected numeric, requested numeric, to_request numeric, supplier_id uuid, supplier_name text, lead_time_days integer,
               next_arrival date, needed_by date, orders jsonb, arrivals jsonb)
language sql
stable
as $$
  with open_orders as (
    select o.id, o.code, o.planned_start, o.planned_end, o.priority from public.production_orders o
    where o.system_company_id = public.request_system_company_id() and o.status not in ('Concluida', 'Cancelada')
  ), need as (
    select pom.material_id, max(pom.unit) as unit,
           sum(greatest(pom.required_quantity - pom.consumed_quantity, 0)) as required, sum(pom.reserved_quantity) as reserved_for_orders,
           sum(greatest(pom.required_quantity - pom.consumed_quantity - pom.reserved_quantity, 0)) as unreserved_need,
           min(coalesce(oo.planned_start, oo.planned_end)) as needed_by,
           jsonb_agg(distinct jsonb_build_object('production_order_id', oo.id, 'code', oo.code)) as orders
    from public.production_order_materials pom join open_orders oo on oo.id = pom.production_order_id
    where pom.required_quantity - pom.consumed_quantity > 0
    group by pom.material_id
  ), pending as (
    select i.material_id, sum(i.quantity) as qty from public.purchase_request_items i join public.purchase_requests r on r.id = i.purchase_request_id
    where r.status in ('Pendente', 'Aprovada') and r.system_company_id = public.request_system_company_id() group by i.material_id
  )
  select n.material_id, m.internal_code, m.name, n.unit, n.required, n.reserved_for_orders, n.unreserved_need, av.physical, av.reserved, av.available, av.incoming,
         greatest(n.unreserved_need - av.available, 0), greatest(n.unreserved_need - av.available - av.incoming, 0), coalesce(p.qty, 0),
         greatest(greatest(n.unreserved_need - av.available - av.incoming, 0) - coalesce(p.qty, 0), 0),
         ps.supplier_id, s.name, coalesce(ps.lead_time_days, m.lead_time_days),
         (select min(po.expected_date) from public.purchase_order_items poi join public.purchase_orders po on po.id = poi.purchase_order_id
           where poi.material_id = n.material_id and po.status in ('Aprovado', 'Parcialmente recebido') and po.system_company_id = public.request_system_company_id() and poi.quantity > poi.received_quantity),
         n.needed_by, n.orders,
         coalesce((select jsonb_agg(jsonb_build_object('purchase_order', po.order_number, 'expected_date', po.expected_date, 'quantity', poi.quantity - poi.received_quantity) order by po.expected_date nulls last)
           from public.purchase_order_items poi join public.purchase_orders po on po.id = poi.purchase_order_id
           where poi.material_id = n.material_id and po.status in ('Aprovado', 'Parcialmente recebido') and po.system_company_id = public.request_system_company_id() and poi.quantity > poi.received_quantity), '[]'::jsonb)
  from need n
  join public.materials m on m.id = n.material_id
  cross join lateral public.material_availability(n.material_id) av
  left join pending p on p.material_id = n.material_id
  left join lateral (select r.supplier_id, r.lead_time_days from public.raw_material_suppliers r where r.material_id = n.material_id order by r.is_primary desc, r.last_cost nulls last limit 1) ps on true
  left join public.suppliers s on s.id = ps.supplier_id
  order by (greatest(n.unreserved_need - av.available - av.incoming, 0) > 0) desc, m.name
$$;

-- ================================================================ 14. Solicitação de compra consolidada (sem emitir pedido ao fornecedor)
-- Cobre só o que falta no projetado e ainda não está em solicitação pendente/aprovada: repetir a chamada não duplica.
create or replace function public.generate_purchase_request_consolidated(p_requested_by text default null)
returns uuid
language plpgsql
as $$
declare
  v_company uuid := public.request_system_company_id();
  v_request uuid;
  v_row record;
  v_qty numeric;
  v_min numeric;
  v_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('purchase_request:' || v_company::text));
  if not exists (select 1 from public.mrp_overview() where to_request > 0) then
    raise exception 'Não há falta de material a solicitar: o que falta já está em solicitação ou será coberto pelas compras em andamento.';
  end if;
  v_request := gen_random_uuid();
  insert into public.purchase_requests (id, request_number, requested_by, notes, system_company_id)
  values (v_request, public.next_production_code('SC'), coalesce(p_requested_by, public.request_actor()), 'Gerada pelo planejamento consolidado de materiais (ordens abertas).', v_company);
  for v_row in select * from public.mrp_overview() where to_request > 0 loop
    select coalesce(min_purchase_qty, 0) into v_min from public.materials where id = v_row.material_id;
    v_qty := greatest(v_row.to_request, v_min);
    insert into public.purchase_request_items (purchase_request_id, material_id, quantity, unit, needed_by, suggested_supplier_id, notes, system_company_id)
    values (v_request, v_row.material_id, v_qty, v_row.unit, v_row.needed_by, v_row.supplier_id, 'Falta consolidada: ' || round(v_row.to_request, 3) || ' ' || v_row.unit, v_company);
    insert into public.purchase_request_sources (purchase_request_id, production_order_id, material_id, quantity, system_company_id)
    select v_request, pom.production_order_id, pom.material_id, sum(greatest(pom.required_quantity - pom.consumed_quantity - pom.reserved_quantity, 0)), v_company
    from public.production_order_materials pom join public.production_orders po on po.id = pom.production_order_id
    where pom.material_id = v_row.material_id and po.system_company_id = v_company and po.status not in ('Concluida', 'Cancelada')
    group by pom.production_order_id, pom.material_id having sum(greatest(pom.required_quantity - pom.consumed_quantity - pom.reserved_quantity, 0)) > 0;
    v_count := v_count + 1;
  end loop;
  return v_request;
end;
$$;

create or replace function public.purchase_request_set_status(p_request uuid, p_status text, p_user text default null)
returns void
language plpgsql
as $$
declare
  v_request public.purchase_requests%rowtype;
begin
  select * into v_request from public.purchase_requests where id = p_request for update;
  if not found then
    raise exception 'Solicitação de compra não encontrada.';
  end if;
  if v_request.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Esta solicitação pertence a outra empresa.';
  end if;
  if p_status not in ('Aprovada', 'Rejeitada', 'Cancelada') then
    raise exception 'Situação inválida para a solicitação.';
  end if;
  if v_request.status not in ('Pendente', 'Aprovada') or (v_request.status = 'Aprovada' and p_status = 'Aprovada') then
    raise exception 'A solicitação % está % e não pode ir para %.', v_request.request_number, v_request.status, p_status;
  end if;
  update public.purchase_requests set status = p_status, approved_by = case when p_status = 'Aprovada' then coalesce(p_user, public.request_actor()) else approved_by end,
         approved_at = case when p_status = 'Aprovada' then now() else approved_at end, updated_at = now() where id = p_request;
end;
$$;

create or replace function public.purchase_request_list(p_status text default null)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object('id', r.id, 'request_number', r.request_number, 'status', r.status, 'requested_by', r.requested_by, 'approved_by', r.approved_by, 'created_at', r.created_at, 'notes', r.notes,
      'production_order', (select code from public.production_orders where id = r.production_order_id),
      'items', coalesce((select jsonb_agg(jsonb_build_object('material_id', i.material_id, 'name', m.name, 'sku', m.internal_code, 'quantity', i.quantity, 'unit', i.unit, 'needed_by', i.needed_by,
                  'supplier', s.name, 'purchase_order_id', i.purchase_order_id) order by m.name)
                from public.purchase_request_items i join public.materials m on m.id = i.material_id left join public.suppliers s on s.id = i.suggested_supplier_id where i.purchase_request_id = r.id), '[]'::jsonb),
      'orders', coalesce((select jsonb_agg(distinct po.code) from public.purchase_request_sources src join public.production_orders po on po.id = src.production_order_id where src.purchase_request_id = r.id), '[]'::jsonb)) as x
    from public.purchase_requests r
    where r.system_company_id = public.request_system_company_id() and (p_status is null or p_status = '' or r.status = p_status)
    order by r.created_at desc limit 100
  ) t
$$;

-- ================================================================ 15. Listas e detalhes (pedido de venda e ordem de produção)
create or replace function public.sales_order_list(p_search text default null, p_status text default null, p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, order_number text, status text, client_id uuid, client_name text, order_date date, delivery_date date, total_amount numeric, quote_number text, items_count integer,
               units_ordered numeric, units_ready numeric, units_delivered numeric, units_in_production numeric, payment_confirmed boolean, created_at timestamptz, total_count bigint)
language sql
stable
as $$
  with base as (
    select so.id, so.order_number, so.status, so.client_id, c.name as client_name, so.order_date, so.delivery_date, so.total_amount, so.quote_number, so.payment_confirmed_at is not null as payment_confirmed, so.created_at,
           (select count(*)::integer from public.sales_order_items i where i.sales_order_id = so.id) as items_count,
           coalesce((select sum(i.quantity) from public.sales_order_items i where i.sales_order_id = so.id and i.line_type = 'Produto'), 0) as units_ordered,
           coalesce((select sum(r.quantity) from public.stock_reservations r join public.sales_order_items i on i.id = r.sales_order_item_id where i.sales_order_id = so.id and r.status = 'Ativa'), 0) as units_ready,
           coalesce((select sum(i.quantity_delivered) from public.sales_order_items i where i.sales_order_id = so.id), 0) as units_delivered,
           coalesce((select sum(po.quantity - po.produced_quantity) from public.production_orders po where po.sales_order_id = so.id and po.status not in ('Concluida', 'Cancelada')), 0) as units_in_production
    from public.sales_orders so join public.clients c on c.id = so.client_id
    where so.system_company_id = public.request_system_company_id()
      and (p_status is null or p_status = '' or (p_status = 'abertos' and so.status not in ('Entregue', 'Cancelado', 'Atendido')) or so.status = p_status)
      and (p_search is null or btrim(p_search) = '' or so.order_number ilike '%' || btrim(p_search) || '%' or c.name ilike '%' || btrim(p_search) || '%' or so.quote_number ilike '%' || btrim(p_search) || '%')
  )
  select b.id, b.order_number, b.status, b.client_id, b.client_name, b.order_date, b.delivery_date, b.total_amount, b.quote_number, b.items_count, b.units_ordered, b.units_ready, b.units_delivered,
         b.units_in_production, b.payment_confirmed, b.created_at, count(*) over ()
  from base b order by b.created_at desc limit greatest(least(coalesce(p_limit, 25), 200), 1) offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function public.sales_order_detail(p_sales_order_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_order jsonb;
  v_status text;
begin
  select to_jsonb(so) || jsonb_build_object('client_name', c.name, 'client_document', c.document, 'salesperson_name', sp.name), so.status into v_order, v_status
  from public.sales_orders so join public.clients c on c.id = so.client_id left join public.salespeople sp on sp.id = so.salesperson_id
  where so.id = p_sales_order_id and so.system_company_id = public.request_system_company_id();
  if v_order is null then
    raise exception 'Pedido de venda não encontrado.';
  end if;
  return jsonb_build_object(
    'order', v_order,
    'require_payment', public.sales_requires_payment(),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', i.id, 'position', i.position, 'line_type', i.line_type, 'material_id', i.material_id, 'sku', coalesce(i.product_sku, m.internal_code), 'description', i.description, 'unit', i.unit,
        'quantity', i.quantity, 'unit_price', i.unit_price, 'discount_percent', i.discount_percent, 'total', i.total, 'unit_cost', i.unit_cost, 'make_to_order', i.make_to_order,
        'quantity_from_stock', i.quantity_from_stock, 'quantity_to_produce', i.quantity_to_produce, 'lead_time_days', i.lead_time_days,
        'reserved', coalesce((select sum(r.quantity) from public.stock_reservations r where r.sales_order_item_id = i.id and r.status = 'Ativa'), 0),
        'delivered', i.quantity_delivered,
        'produced', coalesce((select sum(po.produced_quantity) from public.production_orders po where po.sales_order_item_id = i.id and po.status <> 'Cancelada'), 0),
        'in_production', coalesce((select sum(po.quantity - po.produced_quantity) from public.production_orders po where po.sales_order_item_id = i.id and po.status not in ('Concluida', 'Cancelada')), 0),
        'quoted_bom_version', i.quoted_bom_version_number, 'bom_version', bv.version,
        'structure_changed', (i.quoted_bom_version_id is not null and i.bom_version_id is not null and i.quoted_bom_version_id <> i.bom_version_id),
        'planned', i.planned_at is not null) order by i.position)
      from public.sales_order_items i left join public.materials m on m.id = i.material_id left join public.product_bom_versions bv on bv.id = i.bom_version_id
      where i.sales_order_id = p_sales_order_id), '[]'::jsonb),
    'production_orders', coalesce((select jsonb_agg(jsonb_build_object('id', po.id, 'code', po.code, 'status', po.status, 'quantity', po.quantity, 'produced_quantity', po.produced_quantity, 'planned_end', po.planned_end,
        'product', m.name, 'sku', m.internal_code) order by po.created_at)
      from public.production_orders po join public.materials m on m.id = po.product_id where po.sales_order_id = p_sales_order_id), '[]'::jsonb),
    'deliveries', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'items', d.items, 'delivered_by', d.delivered_by, 'created_at', d.created_at) order by d.created_at desc)
      from public.sales_order_deliveries d where d.sales_order_id = p_sales_order_id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('event', e.event, 'description', e.description, 'actor', e.actor, 'created_at', e.created_at) order by e.created_at desc, e.id)
      from public.sales_order_events e where e.sales_order_id = p_sales_order_id), '[]'::jsonb),
    'availability', case when v_status in ('Rascunho', 'Aguardando confirmacao', 'Confirmado', 'Aguardando producao') then public.sales_order_availability(p_sales_order_id) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.production_order_list(p_search text default null, p_status text default null, p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, code text, status text, product_id uuid, product_name text, sku text, quantity numeric, produced_quantity numeric, remaining numeric, sales_order_id uuid, order_number text, client_name text,
               planned_end date, priority integer, responsible text, estimated_cost numeric, actual_materials_cost numeric, materials_missing integer, late boolean, created_at timestamptz, total_count bigint)
language sql
stable
as $$
  with base as (
    select po.id, po.code, po.status, po.product_id, m.name as product_name, m.internal_code as sku, po.quantity, po.produced_quantity, po.quantity - po.produced_quantity as remaining,
           po.sales_order_id, so.order_number, c.name as client_name, po.planned_end, po.priority, po.responsible,
           po.estimated_materials_cost + po.estimated_labor_cost + po.estimated_other_cost as estimated_cost, po.actual_materials_cost,
           (select count(*)::integer from public.production_order_materials pom where pom.production_order_id = po.id and pom.required_quantity - pom.consumed_quantity - pom.reserved_quantity > 0.0005) as materials_missing,
           (po.planned_end is not null and po.planned_end < current_date and po.status not in ('Concluida', 'Cancelada')) as late, po.created_at
    from public.production_orders po join public.materials m on m.id = po.product_id left join public.sales_orders so on so.id = po.sales_order_id left join public.clients c on c.id = po.client_id
    where po.system_company_id = public.request_system_company_id()
      and (p_status is null or p_status = '' or (p_status = 'abertas' and po.status not in ('Concluida', 'Cancelada')) or po.status = p_status)
      and (p_search is null or btrim(p_search) = '' or po.code ilike '%' || btrim(p_search) || '%' or m.name ilike '%' || btrim(p_search) || '%' or so.order_number ilike '%' || btrim(p_search) || '%' or c.name ilike '%' || btrim(p_search) || '%')
  )
  select b.id, b.code, b.status, b.product_id, b.product_name, b.sku, b.quantity, b.produced_quantity, b.remaining, b.sales_order_id, b.order_number, b.client_name, b.planned_end, b.priority, b.responsible,
         b.estimated_cost, b.actual_materials_cost, b.materials_missing, b.late, b.created_at, count(*) over ()
  from base b order by (b.status in ('Concluida', 'Cancelada')), b.priority, b.planned_end nulls last, b.created_at desc limit greatest(least(coalesce(p_limit, 25), 200), 1) offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function public.production_order_detail(p_order uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_order jsonb;
  v_coverage numeric;
  v_consumed_cost numeric;
  v_allocated numeric;
  v_receipts_cost numeric;
  v_labor_other numeric;
  v_qty numeric;
  v_produced numeric;
begin
  select to_jsonb(po) || jsonb_build_object('product_name', m.name, 'sku', m.internal_code, 'client_name', c.name, 'order_number', so.order_number, 'bom_version', bv.version, 'bom_status', bv.status,
         'sales_status', so.status), po.quantity, po.produced_quantity
  into v_order, v_qty, v_produced
  from public.production_orders po join public.materials m on m.id = po.product_id join public.product_bom_versions bv on bv.id = po.bom_version_id
  left join public.sales_orders so on so.id = po.sales_order_id left join public.clients c on c.id = po.client_id
  where po.id = p_order and po.system_company_id = public.request_system_company_id();
  if v_order is null then
    raise exception 'Ordem de produção não encontrada.';
  end if;
  select least(coalesce(min(cons / nullif(req, 0)), 1), 1) into v_coverage
  from (select sum(required_quantity) req, sum(consumed_quantity) cons from public.production_order_materials where production_order_id = p_order group by material_id) x;
  select coalesce(sum(quantity * unit_cost), 0) into v_consumed_cost from public.production_consumptions where production_order_id = p_order;
  select coalesce(sum(amount), 0) into v_allocated from public.production_cost_allocations where production_order_id = p_order and cost_type = 'materiais';
  select coalesce(sum(quantity * unit_cost), 0), coalesce(sum(labor_cost), 0) into v_receipts_cost, v_labor_other from public.production_receipts where production_order_id = p_order;
  return jsonb_build_object(
    'order', v_order,
    'progress', jsonb_build_object('planned', v_qty, 'started', least(v_qty, greatest(v_produced, floor(v_coverage * v_qty))), 'produced', v_produced, 'remaining', v_qty - v_produced),
    'kits', coalesce((select jsonb_agg(jsonb_build_object('kit_id', k.kit_id, 'sku', km.internal_code, 'name', km.name, 'kit_version', kv.version, 'quantity', k.quantity) order by km.name)
      from public.production_order_kits k join public.materials km on km.id = k.kit_id join public.kit_versions kv on kv.id = k.kit_version_id where k.production_order_id = p_order), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(jsonb_build_object('id', pom.id, 'material_id', pom.material_id, 'sku', mm.internal_code, 'name', mm.name, 'kit', km.name, 'unit', pom.unit,
        'required', pom.required_quantity, 'reserved', pom.reserved_quantity, 'consumed', pom.consumed_quantity, 'remaining', greatest(pom.required_quantity - pom.consumed_quantity, 0),
        'unit_cost_estimated', pom.estimated_unit_cost, 'cost_estimated', round(pom.required_quantity * pom.estimated_unit_cost, 2)) order by mm.name, km.name)
      from public.production_order_materials pom join public.materials mm on mm.id = pom.material_id join public.materials km on km.id = pom.kit_id where pom.production_order_id = p_order), '[]'::jsonb),
    'plan', coalesce((select jsonb_agg(jsonb_build_object('material_id', pl.material_id, 'name', pl.material_name, 'unit', pl.unit, 'required', pl.required, 'reserved_for_order', pl.reserved_for_order,
        'consumed', pl.consumed, 'available_free', pl.available_free, 'incoming', pl.incoming, 'shortage', pl.shortage) order by pl.material_name) from public.plan_materials(p_order) pl), '[]'::jsonb),
    'consumptions', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'material', mm.name, 'quantity', c.quantity, 'unit', mm.unit, 'kind', c.kind, 'unit_cost', c.unit_cost, 'total_cost', round(c.quantity * c.unit_cost, 2),
        'responsible', c.responsible, 'occurred_at', c.occurred_at, 'notes', c.notes) order by c.occurred_at desc)
      from public.production_consumptions c join public.materials mm on mm.id = c.material_id where c.production_order_id = p_order), '[]'::jsonb),
    'receipts', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'quantity', r.quantity, 'unit_cost', r.unit_cost, 'materials_cost', r.materials_cost, 'labor_other_cost', r.labor_cost, 'created_at', r.created_at,
        'responsible', r.responsible, 'warehouse', w.name,
        'allocations', coalesce((select jsonb_agg(jsonb_build_object('cost_type', a.cost_type, 'amount', a.amount, 'criterion', a.criterion) order by a.cost_type) from public.production_cost_allocations a where a.receipt_id = r.id), '[]'::jsonb),
        'adjustments', coalesce((select jsonb_agg(jsonb_build_object('cost_type', j.cost_type, 'amount', j.amount, 'reason', j.reason, 'by', j.adjusted_by, 'at', j.created_at) order by j.created_at) from public.production_cost_adjustments j where j.receipt_id = r.id), '[]'::jsonb)
      ) order by r.created_at desc)
      from public.production_receipts r left join public.warehouses w on w.id = r.warehouse_id where r.production_order_id = p_order), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('event', e.event, 'description', e.description, 'actor', e.actor, 'created_at', e.created_at) order by e.created_at desc, e.id) from public.production_events e where e.production_order_id = p_order), '[]'::jsonb),
    'costs', jsonb_build_object(
      'estimated_materials', (v_order->>'estimated_materials_cost')::numeric, 'estimated_labor', (v_order->>'estimated_labor_cost')::numeric, 'estimated_other', (v_order->>'estimated_other_cost')::numeric,
      'estimated_total', (v_order->>'estimated_materials_cost')::numeric + (v_order->>'estimated_labor_cost')::numeric + (v_order->>'estimated_other_cost')::numeric,
      'consumed_materials', round(v_consumed_cost, 2), 'allocated_materials', round(v_allocated, 2), 'in_process_materials', round(greatest(v_consumed_cost - v_allocated, 0), 2),
      'received_cost', round(v_receipts_cost, 2), 'labor_other_applied', round(v_labor_other, 2),
      'adjustments', coalesce((select sum(amount) from public.production_cost_adjustments where production_order_id = p_order), 0)),
    'purchase_requests', coalesce((select jsonb_agg(distinct jsonb_build_object('id', r.id, 'request_number', r.request_number, 'status', r.status))
      from public.purchase_requests r where r.production_order_id = p_order or exists (select 1 from public.purchase_request_sources s where s.purchase_request_id = r.id and s.production_order_id = p_order)), '[]'::jsonb)
  );
end;
$$;

-- ================================================================ 16. Indicadores operacionais (dados reais da empresa em uso)
create or replace function public.production_dashboard()
returns jsonb
language plpgsql
stable
as $$
declare
  v_company uuid := public.request_system_company_id();
begin
  return jsonb_build_object(
    'sales_awaiting_confirmation', (select count(*) from public.sales_orders where system_company_id = v_company and status = 'Aguardando confirmacao'),
    'sales_awaiting_production', (select count(*) from public.sales_orders where system_company_id = v_company and status = 'Aguardando producao'),
    'sales_ready_for_delivery', (select count(*) from public.sales_orders where system_company_id = v_company and status in ('Pronto para entrega', 'Parcialmente disponivel')),
    'orders_in_progress', (select count(*) from public.production_orders where system_company_id = v_company and status in ('Em producao', 'Aguardando inspecao')),
    'orders_waiting_materials', (select count(*) from public.production_orders where system_company_id = v_company and status = 'Aguardando materiais'),
    'orders_open', (select count(*) from public.production_orders where system_company_id = v_company and status not in ('Concluida', 'Cancelada')),
    'units_pending', coalesce((select sum(quantity - produced_quantity) from public.production_orders where system_company_id = v_company and status not in ('Concluida', 'Cancelada')), 0),
    'units_planned', coalesce((select sum(quantity) from public.production_orders where system_company_id = v_company and status not in ('Concluida', 'Cancelada')), 0),
    'units_completed_30d', coalesce((select sum(quantity) from public.production_receipts where system_company_id = v_company and created_at >= now() - interval '30 days'), 0),
    'orders_late', (select count(*) from public.production_orders where system_company_id = v_company and status not in ('Concluida', 'Cancelada') and planned_end < current_date),
    'materials_short', (select count(*) from public.mrp_overview() where shortage_projected > 0),
    'materials_short_now', (select count(*) from public.mrp_overview() where shortage_now > 0),
    'purchase_requests_pending', (select count(*) from public.purchase_requests where system_company_id = v_company and status = 'Pendente'),
    'cost_completed', (select jsonb_build_object('orders', count(*), 'estimated', coalesce(sum(po.estimated_materials_cost + po.estimated_labor_cost + po.estimated_other_cost), 0),
        'actual', coalesce(sum((select coalesce(sum(r.quantity * r.unit_cost), 0) from public.production_receipts r where r.production_order_id = po.id)), 0))
      from public.production_orders po where po.system_company_id = v_company and po.status = 'Concluida'),
    'require_payment', public.sales_requires_payment());
end;
$$;

-- ================================================================ 17. Tenant, auditoria e acesso das tabelas novas
do $$
declare
  table_name text;
begin
  foreach table_name in array array['sales_settings', 'sales_order_events', 'sales_order_deliveries', 'production_events', 'purchase_request_sources'] loop
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
