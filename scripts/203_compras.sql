-- Compras ERP Carretas: pedidos de compra, aprovação, recebimento (total ou
-- parcial) com entrada no estoque e geração das contas a pagar.
-- Rode no SQL Editor do Supabase depois de 201_financeiro_erp.sql e
-- 202_estoque_movimentacoes.sql.

create sequence if not exists public.purchase_order_number_seq;

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null default ('PC-' || lpad(nextval('public.purchase_order_number_seq')::text, 6, '0')),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  supplier_name text not null,
  status text not null default 'Rascunho' check (status in ('Rascunho', 'Aprovado', 'Parcialmente recebido', 'Recebido', 'Encerrado', 'Cancelado')),
  order_date date not null default current_date,
  expected_date date,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  payment_condition_id uuid references public.payment_conditions(id) on delete set null,
  payment_method text,
  financial_category_id uuid references public.financial_categories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  supplier_reference text,
  items_total numeric(14,2) not null default 0,
  freight_amount numeric(14,2) not null default 0,
  other_costs numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  notes text,
  created_by text,
  approved_by text,
  approved_at timestamptz,
  closed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists purchase_orders_number_uidx on public.purchase_orders (order_number);
create index if not exists purchase_orders_status_idx on public.purchase_orders (status, order_date desc);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  description text not null,
  unit text not null default 'UN',
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  discount_percent numeric(6,3) not null default 0 check (discount_percent between 0 and 100),
  total numeric(14,2) not null default 0,
  received_quantity numeric(14,3) not null default 0 check (received_quantity >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_order_items_order_idx on public.purchase_order_items (purchase_order_id);

create table if not exists public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  invoice_number text not null,
  invoice_date date,
  received_at date not null default current_date,
  items_amount numeric(14,2) not null default 0,
  extra_costs_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  payables_generated integer not null default 0,
  responsible text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists purchase_receipts_order_idx on public.purchase_receipts (purchase_order_id);

create table if not exists public.purchase_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.purchase_receipts(id) on delete cascade,
  order_item_id uuid not null references public.purchase_order_items(id) on delete restrict,
  material_id uuid not null references public.materials(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,4) not null default 0,
  lot_number text,
  serial_number text,
  expiry_date date,
  stock_movement_id uuid references public.stock_movements(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Recebe itens de um pedido aprovado numa única transação:
-- 1) valida quantidades pendentes; 2) rateia frete/outros custos/desconto pelo valor
-- recebido; 3) dá entrada no estoque ("Entrada por compra", atualiza custo médio);
-- 4) atualiza o pedido; 5) gera as contas a pagar pela condição de pagamento.
create or replace function public.receive_purchase_order(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_order public.purchase_orders%rowtype;
  v_item public.purchase_order_items%rowtype;
  v_condition public.payment_conditions%rowtype;
  v_line jsonb;
  v_qty numeric;
  v_net_unit numeric;
  v_items_value numeric := 0;
  v_extra numeric := 0;
  v_unit_cost numeric;
  v_receipt_id uuid := gen_random_uuid();
  v_movement public.stock_movements%rowtype;
  v_received_at date := coalesce(nullif(p->>'received_at', '')::date, current_date);
  v_invoice text := trim(coalesce(p->>'invoice_number', ''));
  v_responsible text := coalesce(nullif(p->>'responsible', ''), 'Sistema');
  v_total numeric;
  v_installments integer := 1;
  v_interval integer := 30;
  v_first_due date;
  v_group uuid := gen_random_uuid();
  v_amount numeric;
  v_paid_cents bigint := 0;
  v_total_cents bigint;
  v_dre uuid;
  v_payables integer := 0;
  v_pending numeric;
  i integer;
begin
  select * into v_order from public.purchase_orders where id = (p->>'purchase_order_id')::uuid for update;
  if not found then
    raise exception 'Pedido de compra não encontrado.';
  end if;
  if v_order.status not in ('Aprovado', 'Parcialmente recebido') then
    raise exception 'Só é possível receber pedidos aprovados (situação atual: %).', v_order.status;
  end if;
  if v_invoice = '' then
    raise exception 'Informe o número da nota fiscal do recebimento.';
  end if;
  if jsonb_typeof(p->'lines') <> 'array' then
    raise exception 'Informe os itens recebidos.';
  end if;

  -- 1) valida e soma o valor recebido
  for v_line in select value from jsonb_array_elements(p->'lines') loop
    v_qty := nullif(v_line->>'quantity', '')::numeric;
    continue when v_qty is null or v_qty <= 0;
    select * into v_item from public.purchase_order_items
      where id = (v_line->>'order_item_id')::uuid and purchase_order_id = v_order.id for update;
    if not found then
      raise exception 'Item não pertence a este pedido.';
    end if;
    if v_item.received_quantity + v_qty > v_item.quantity + 0.0005 then
      raise exception 'Recebimento de % maior que o pendente (pendente: %).', v_item.description, v_item.quantity - v_item.received_quantity;
    end if;
    v_items_value := v_items_value + v_qty * v_item.unit_cost * (1 - v_item.discount_percent / 100);
  end loop;
  if v_items_value <= 0 then
    raise exception 'Informe ao menos um item com quantidade recebida.';
  end if;

  -- 2) frete, outros custos e desconto do pedido, proporcionais ao valor recebido
  if v_order.items_total > 0 then
    v_extra := round((v_order.freight_amount + v_order.other_costs - v_order.discount_amount) * v_items_value / v_order.items_total, 2);
  end if;
  v_items_value := round(v_items_value, 2);
  v_total := v_items_value + v_extra;

  insert into public.purchase_receipts (id, purchase_order_id, invoice_number, invoice_date, received_at, items_amount, extra_costs_amount, total_amount, responsible, notes)
  values (v_receipt_id, v_order.id, v_invoice, nullif(p->>'invoice_date', '')::date, v_received_at, v_items_value, v_extra, v_total, v_responsible, p->>'notes');

  -- 3) entrada no estoque com custo unitário já com o rateio
  for v_line in select value from jsonb_array_elements(p->'lines') loop
    v_qty := nullif(v_line->>'quantity', '')::numeric;
    continue when v_qty is null or v_qty <= 0;
    select * into v_item from public.purchase_order_items where id = (v_line->>'order_item_id')::uuid;
    v_net_unit := v_item.unit_cost * (1 - v_item.discount_percent / 100);
    v_unit_cost := v_net_unit + case when v_items_value > 0 then v_extra * v_net_unit / v_items_value else 0 end;

    v_movement := public.apply_stock_movement(jsonb_build_object(
      'material_id', v_item.material_id,
      'movement_type', 'Entrada por compra',
      'quantity', v_qty,
      'to_warehouse_id', coalesce(nullif(v_line->>'warehouse_id', ''), v_order.warehouse_id::text, ''),
      'unit_cost', round(v_unit_cost, 4),
      'occurred_at', v_received_at::text,
      'responsible', v_responsible,
      'document_reference', v_order.order_number || ' / NF ' || v_invoice,
      'reason', 'Recebimento de compra',
      'lot_number', coalesce(v_line->>'lot_number', ''),
      'serial_number', coalesce(v_line->>'serial_number', ''),
      'expiry_date', coalesce(v_line->>'expiry_date', '')
    ));

    insert into public.purchase_receipt_items (receipt_id, order_item_id, material_id, quantity, unit_cost, lot_number, serial_number, expiry_date, stock_movement_id)
    values (v_receipt_id, v_item.id, v_item.material_id, v_qty, round(v_unit_cost, 4), nullif(v_line->>'lot_number', ''), nullif(v_line->>'serial_number', ''), nullif(v_line->>'expiry_date', '')::date, v_movement.id);

    update public.purchase_order_items set received_quantity = received_quantity + v_qty, updated_at = now() where id = v_item.id;
  end loop;

  -- 4) situação do pedido
  select coalesce(sum(greatest(quantity - received_quantity, 0)), 0) into v_pending from public.purchase_order_items where purchase_order_id = v_order.id;
  update public.purchase_orders
    set status = case when v_pending <= 0.0005 then 'Recebido' else 'Parcialmente recebido' end, updated_at = now()
    where id = v_order.id;

  -- 5) contas a pagar pela condição de pagamento do pedido
  if coalesce((p->>'generate_payables')::boolean, true) and v_total > 0 then
    if v_order.payment_condition_id is not null then
      select * into v_condition from public.payment_conditions where id = v_order.payment_condition_id;
      if found then
        v_installments := greatest(1, v_condition.installments);
        v_interval := coalesce(v_condition.interval_days, 30);
      end if;
    end if;
    v_first_due := coalesce(nullif(p->>'first_due_date', '')::date, v_received_at + coalesce(v_condition.first_due_days, 0));
    select dre_account_id into v_dre from public.financial_categories where id = v_order.financial_category_id;
    v_total_cents := round(v_total * 100);

    for i in 1..v_installments loop
      v_amount := case when i = v_installments then (v_total_cents - v_paid_cents)::numeric / 100 else floor(v_total_cents::numeric / v_installments) / 100 end;
      v_paid_cents := v_paid_cents + round(v_amount * 100);
      insert into public.accounts_payable (
        supplier_id, supplier_name, description, category_id, cost_center_id, dre_account_id,
        competence_date, due_date, expected_amount, paid_amount, payment_method, status, origin, notes,
        document_number, installment_number, installment_count, installment_group_id, payment_condition_id,
        source_type, source_reference, created_by, updated_by
      ) values (
        v_order.supplier_id, v_order.supplier_name,
        'Compra ' || v_order.order_number || ' - NF ' || v_invoice,
        v_order.financial_category_id, v_order.cost_center_id, v_dre,
        coalesce(nullif(p->>'invoice_date', '')::date, v_received_at),
        case when v_interval = 30 then (v_first_due + make_interval(months => i - 1))::date else v_first_due + v_interval * (i - 1) end,
        v_amount, 0, coalesce(v_order.payment_method, v_condition.payment_method, 'Boleto'), 'Aberta', 'Compra',
        'Gerada no recebimento do pedido ' || v_order.order_number,
        v_invoice, case when v_installments > 1 then i end, case when v_installments > 1 then v_installments end,
        case when v_installments > 1 then v_group end, v_order.payment_condition_id,
        'Compra', v_order.order_number, v_responsible, v_responsible
      );
      v_payables := v_payables + 1;
    end loop;
    update public.purchase_receipts set payables_generated = v_payables where id = v_receipt_id;
  end if;

  return jsonb_build_object('receipt_id', v_receipt_id, 'items_amount', v_items_value, 'extra_costs_amount', v_extra, 'total_amount', v_total, 'payables', v_payables);
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['purchase_orders', 'purchase_order_items', 'purchase_receipts', 'purchase_receipt_items'] loop
    execute format('alter table public.%I add column if not exists system_company_id uuid not null default %L::uuid references public.system_companies(id) on delete restrict', table_name, '00000000-0000-4000-8000-000000000001');
    execute format('create index if not exists %I on public.%I (system_company_id)', table_name || '_system_company_idx', table_name);
    execute format('drop trigger if exists assign_system_company on public.%I', table_name);
    execute format('create trigger assign_system_company before insert on public.%I for each row execute function public.assign_request_system_company()', table_name);
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists tenant_authenticated_access on public.%I', table_name);
    execute format('drop policy if exists tenant_company_isolation on public.%I', table_name);
    execute format('create policy tenant_authenticated_access on public.%I as permissive for all to authenticated using (true) with check (true)', table_name);
    execute format('create policy tenant_company_isolation on public.%I as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id())', table_name);
  end loop;
  foreach table_name in array array['purchase_orders', 'purchase_order_items'] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end;
$$;
