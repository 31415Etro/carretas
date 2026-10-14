-- ERP Carretas - arquivo consolidado para o SQL Editor do Supabase.
-- Scripts de origem, nesta ordem: 200_add_material_erp_fields.sql 201_financeiro_erp.sql 202_estoque_movimentacoes.sql 203_compras.sql 204_dashboard_preferencias.sql 205_catalogo_produtos_servicos.sql 206_ordem_servico_erp.sql
-- Nao edite aqui; os originais continuam em scripts/ e scripts/base/.

-- ============================================================
-- >>> INICIO: 200_add_material_erp_fields.sql
-- ============================================================
-- Cadastro de produtos/materiais no padrão ERP: identificação, dados fiscais,
-- logística, custos/preços e fornecedor padrão.
-- Rode no SQL Editor do Supabase.

alter table if exists public.materials
  add column if not exists barcode text,
  add column if not exists ncm text,
  add column if not exists cest text,
  add column if not exists origin text,
  add column if not exists sped_item_type text,
  add column if not exists maximum_stock numeric(12,3) not null default 0,
  add column if not exists gross_weight numeric(12,3) not null default 0,
  add column if not exists net_weight numeric(12,3) not null default 0,
  add column if not exists height numeric(12,3) not null default 0,
  add column if not exists width numeric(12,3) not null default 0,
  add column if not exists length numeric(12,3) not null default 0,
  add column if not exists location text,
  add column if not exists cost_price numeric(14,4) not null default 0,
  add column if not exists sale_price numeric(14,4) not null default 0,
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists supplier_code text;

-- Até aqui o campo internal_code era exibido como "NCM". Copia os valores que
-- parecem NCM (8 dígitos) para a nova coluna, sem apagar o código interno.
update public.materials
  set ncm = regexp_replace(internal_code, '\D', '', 'g')
  where (ncm is null or ncm = '')
    and regexp_replace(coalesce(internal_code, ''), '\D', '', 'g') ~ '^\d{8}$';

comment on column public.materials.internal_code is 'SKU / código interno do item.';
comment on column public.materials.barcode is 'Código de barras GTIN/EAN.';
comment on column public.materials.ncm is 'Nomenclatura Comum do Mercosul (8 dígitos).';
comment on column public.materials.cest is 'Código Especificador da Substituição Tributária (7 dígitos).';
comment on column public.materials.origin is 'Origem da mercadoria (Tabela A do CST: 0 a 8).';
comment on column public.materials.sped_item_type is 'Tipo do item no SPED (registro 0200: 00 a 99).';
comment on column public.materials.location is 'Endereço no depósito (corredor, prateleira, posição).';
comment on column public.materials.supplier_code is 'Código do item no fornecedor padrão.';


-- <<< FIM: 200_add_material_erp_fields.sql

-- ============================================================
-- >>> INICIO: 201_financeiro_erp.sql
-- ============================================================
-- Financeiro ERP Carretas: contas bancárias, condições de pagamento, parcelas,
-- juros/multa/desconto, documento, origem do lançamento e auditoria.
-- Rode no SQL Editor do Supabase depois de 159_add_multi_company_tenancy.sql.

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bank_name text,
  bank_code text,
  agency text,
  account_number text,
  account_type text not null default 'Corrente' check (account_type in ('Corrente', 'Poupanca', 'Pagamento', 'Caixa', 'Investimento')),
  holder_name text,
  holder_document text,
  pix_key text,
  initial_balance numeric(14,2) not null default 0,
  initial_balance_date date,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_conditions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  installments integer not null default 1 check (installments between 1 and 120),
  first_due_days integer not null default 0 check (first_due_days >= 0),
  interval_days integer not null default 30 check (interval_days >= 0),
  payment_method text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table if exists public.financial_categories
  add column if not exists code text,
  add column if not exists "group" text;

alter table if exists public.cost_centers
  add column if not exists code text,
  add column if not exists responsible text,
  add column if not exists unit text;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['accounts_payable', 'accounts_receivable'] loop
    execute format('alter table public.%I
      add column if not exists document_number text,
      add column if not exists installment_number integer,
      add column if not exists installment_count integer,
      add column if not exists installment_group_id uuid,
      add column if not exists payment_condition_id uuid references public.payment_conditions(id) on delete set null,
      add column if not exists interest_amount numeric(14,2) not null default 0,
      add column if not exists fine_amount numeric(14,2) not null default 0,
      add column if not exists discount_amount numeric(14,2) not null default 0,
      add column if not exists source_type text not null default ''Manual'',
      add column if not exists source_reference text,
      add column if not exists created_by text,
      add column if not exists updated_by text', table_name);
    execute format('create index if not exists %I on public.%I (installment_group_id)', table_name || '_installment_group_idx', table_name);
  end loop;
end;
$$;

-- bank_account_id (já existente) guarda o id de bank_accounts. Fica sem FK para
-- não apagar valores antigos digitados como texto livre.

-- Mesmo isolamento por empresa (CNPJ) das demais tabelas financeiras.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['bank_accounts', 'payment_conditions'] loop
    execute format('alter table public.%I add column if not exists system_company_id uuid not null default %L::uuid references public.system_companies(id) on delete restrict', table_name, '00000000-0000-4000-8000-000000000001');
    execute format('create index if not exists %I on public.%I (system_company_id)', table_name || '_system_company_idx', table_name);
    execute format('drop trigger if exists assign_system_company on public.%I', table_name);
    execute format('create trigger assign_system_company before insert on public.%I for each row execute function public.assign_request_system_company()', table_name);
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists tenant_authenticated_access on public.%I', table_name);
    execute format('drop policy if exists tenant_company_isolation on public.%I', table_name);
    execute format('create policy tenant_authenticated_access on public.%I as permissive for all to authenticated using (true) with check (true)', table_name);
    execute format('create policy tenant_company_isolation on public.%I as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id())', table_name);
  end loop;
end;
$$;


-- <<< FIM: 201_financeiro_erp.sql

-- ============================================================
-- >>> INICIO: 202_estoque_movimentacoes.sql
-- ============================================================
-- Estoque ERP Carretas: depósitos, saldo por depósito, movimentações, reservas,
-- custo médio e controle de lote/série/validade.
-- Rode no SQL Editor do Supabase depois de 200_add_material_erp_fields.sql.
--
-- Regra: o saldo (materials.current_stock e stock_balances) só muda pela função
-- public.apply_stock_movement, que grava a movimentação e atualiza os saldos na
-- mesma transação.

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  address text,
  responsible text,
  is_default boolean not null default false,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists warehouses_single_default_uidx on public.warehouses (is_default) where is_default;

insert into public.warehouses (id, code, name, is_default)
values ('00000000-0000-4000-8000-0000000000d1', 'DEP-01', 'Depósito principal', true)
on conflict (id) do nothing;

alter table if exists public.materials
  add column if not exists warehouse_id uuid references public.warehouses(id) on delete set null,
  add column if not exists reorder_point numeric(12,3) not null default 0,
  add column if not exists reserved_stock numeric(12,3) not null default 0,
  add column if not exists average_cost numeric(14,4) not null default 0,
  add column if not exists last_purchase_cost numeric(14,4) not null default 0,
  add column if not exists controls_lot boolean not null default false,
  add column if not exists controls_serial boolean not null default false,
  add column if not exists controls_expiry boolean not null default false;

update public.materials set warehouse_id = '00000000-0000-4000-8000-0000000000d1' where warehouse_id is null;
update public.materials set average_cost = cost_price where average_cost = 0 and coalesce(cost_price, 0) > 0;

create table if not exists public.stock_balances (
  material_id uuid not null references public.materials(id) on delete cascade,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  quantity numeric(14,3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (material_id, warehouse_id)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete restrict,
  movement_type text not null check (movement_type in (
    'Saldo inicial', 'Entrada por compra', 'Saida por venda', 'Consumo em OS', 'Consumo em kit',
    'Transferencia', 'Devolucao', 'Ajuste de inventario', 'Perda'
  )),
  quantity numeric(14,3) not null check (quantity > 0),
  from_warehouse_id uuid references public.warehouses(id) on delete restrict,
  to_warehouse_id uuid references public.warehouses(id) on delete restrict,
  unit_cost numeric(14,4) not null default 0,
  total_cost numeric(14,2) not null default 0,
  balance_after numeric(14,3),
  occurred_at timestamptz not null default now(),
  responsible text,
  document_reference text,
  reason text,
  notes text,
  service_order_id uuid,
  reservation_id uuid,
  lot_number text,
  serial_number text,
  expiry_date date,
  created_at timestamptz not null default now()
);

create index if not exists stock_movements_material_idx on public.stock_movements (material_id, occurred_at desc);
create index if not exists stock_movements_order_idx on public.stock_movements (service_order_id) where service_order_id is not null;
create index if not exists stock_movements_lot_idx on public.stock_movements (material_id, lot_number) where lot_number is not null;

create table if not exists public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  service_order_id uuid,
  quantity numeric(14,3) not null check (quantity > 0),
  status text not null default 'Ativa' check (status in ('Ativa', 'Consumida', 'Cancelada')),
  responsible text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stock_reservations_material_idx on public.stock_reservations (material_id) where status = 'Ativa';
create index if not exists stock_reservations_order_idx on public.stock_reservations (service_order_id);

-- Quantidade reservada do item = soma das reservas ativas.
create or replace function public.refresh_material_reserved_stock()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update public.materials set reserved_stock = coalesce((select sum(quantity) from public.stock_reservations where material_id = old.material_id and status = 'Ativa'), 0) where id = old.material_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update public.materials set reserved_stock = coalesce((select sum(quantity) from public.stock_reservations where material_id = new.material_id and status = 'Ativa'), 0) where id = new.material_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_stock_reservations_reserved on public.stock_reservations;
create trigger trg_stock_reservations_reserved after insert or update or delete on public.stock_reservations
for each row execute function public.refresh_material_reserved_stock();

drop trigger if exists trg_warehouses_updated_at on public.warehouses;
create trigger trg_warehouses_updated_at before update on public.warehouses for each row execute function public.set_updated_at();
drop trigger if exists trg_stock_reservations_updated_at on public.stock_reservations;
create trigger trg_stock_reservations_updated_at before update on public.stock_reservations for each row execute function public.set_updated_at();

-- Registra a movimentação e atualiza saldo por depósito, saldo total e custos.
-- Entradas: Saldo inicial, Entrada por compra, Devolucao (destino).
-- Saídas: Saida por venda, Consumo em OS, Consumo em kit, Perda (origem).
-- Transferencia: origem e destino. Ajuste de inventario: só origem (baixa) ou só destino (acréscimo).
create or replace function public.apply_stock_movement(p jsonb)
returns public.stock_movements
language plpgsql
as $$
declare
  v_type text := p->>'movement_type';
  v_qty numeric := nullif(p->>'quantity', '')::numeric;
  v_from uuid := nullif(p->>'from_warehouse_id', '')::uuid;
  v_to uuid := nullif(p->>'to_warehouse_id', '')::uuid;
  v_cost numeric := nullif(p->>'unit_cost', '')::numeric;
  v_default uuid;
  v_material public.materials%rowtype;
  v_balance numeric;
  v_delta numeric := 0;
  v_avg numeric;
  v_last numeric;
  v_movement public.stock_movements%rowtype;
begin
  if v_qty is null or v_qty <= 0 then
    raise exception 'Quantidade deve ser maior que zero.';
  end if;

  select * into v_material from public.materials where id = (p->>'material_id')::uuid for update;
  if not found then
    raise exception 'Item de estoque não encontrado.';
  end if;

  select id into v_default from public.warehouses where is_default limit 1;

  if v_type in ('Saldo inicial', 'Entrada por compra', 'Devolucao') then
    v_from := null;
    v_to := coalesce(v_to, v_material.warehouse_id, v_default);
  elsif v_type in ('Saida por venda', 'Consumo em OS', 'Consumo em kit', 'Perda') then
    v_to := null;
    v_from := coalesce(v_from, v_material.warehouse_id, v_default);
  elsif v_type = 'Transferencia' then
    if v_from is null or v_to is null or v_from = v_to then
      raise exception 'Transferência exige depósitos de origem e destino diferentes.';
    end if;
  elsif v_type = 'Ajuste de inventario' then
    if (v_from is null) = (v_to is null) then
      raise exception 'Ajuste de inventário exige somente o depósito de origem (baixa) ou somente o de destino (acréscimo).';
    end if;
  else
    raise exception 'Tipo de movimentação inválido: %', v_type;
  end if;

  if v_material.controls_lot and v_to is not null and v_type <> 'Transferencia' and coalesce(p->>'lot_number', '') = '' then
    raise exception 'O item % controla lote: informe o número do lote.', v_material.name;
  end if;
  if v_material.controls_serial and coalesce(p->>'serial_number', '') = '' then
    raise exception 'O item % controla número de série: informe o número de série.', v_material.name;
  end if;
  if v_material.controls_expiry and v_to is not null and v_type <> 'Transferencia' and coalesce(p->>'expiry_date', '') = '' then
    raise exception 'O item % controla validade: informe a data de validade.', v_material.name;
  end if;

  if v_from is not null then
    insert into public.stock_balances (material_id, warehouse_id, quantity) values (v_material.id, v_from, 0) on conflict do nothing;
    select quantity into v_balance from public.stock_balances where material_id = v_material.id and warehouse_id = v_from for update;
    if v_balance < v_qty then
      raise exception 'Saldo insuficiente de % no depósito de origem: disponível %, solicitado %.', v_material.name, v_balance, v_qty;
    end if;
    update public.stock_balances set quantity = quantity - v_qty, updated_at = now() where material_id = v_material.id and warehouse_id = v_from;
    v_delta := v_delta - v_qty;
  end if;

  if v_to is not null then
    insert into public.stock_balances (material_id, warehouse_id, quantity) values (v_material.id, v_to, v_qty)
    on conflict (material_id, warehouse_id) do update set quantity = public.stock_balances.quantity + excluded.quantity, updated_at = now();
    v_delta := v_delta + v_qty;
  end if;

  v_avg := coalesce(v_material.average_cost, 0);
  v_last := coalesce(v_material.last_purchase_cost, 0);
  if v_type in ('Entrada por compra', 'Saldo inicial') and v_cost is not null and v_cost >= 0 then
    -- custo médio ponderado sobre o saldo positivo existente
    v_avg := case
      when greatest(v_material.current_stock, 0) + v_qty > 0
        then (greatest(v_material.current_stock, 0) * v_avg + v_qty * v_cost) / (greatest(v_material.current_stock, 0) + v_qty)
      else v_cost
    end;
    if v_type = 'Entrada por compra' then v_last := v_cost; end if;
  end if;
  v_cost := coalesce(v_cost, v_avg);

  update public.materials
    set current_stock = current_stock + v_delta,
        average_cost = round(v_avg, 4),
        last_purchase_cost = round(v_last, 4),
        updated_at = now()
    where id = v_material.id;

  insert into public.stock_movements (
    id, material_id, movement_type, quantity, from_warehouse_id, to_warehouse_id, unit_cost, total_cost, balance_after,
    occurred_at, responsible, document_reference, reason, notes, service_order_id, reservation_id, lot_number, serial_number, expiry_date
  ) values (
    coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid()), v_material.id, v_type, v_qty, v_from, v_to, round(v_cost, 4), round(v_cost * v_qty, 2),
    v_material.current_stock + v_delta,
    coalesce(nullif(p->>'occurred_at', '')::timestamptz, now()), p->>'responsible', p->>'document_reference', p->>'reason', p->>'notes',
    nullif(p->>'service_order_id', '')::uuid, nullif(p->>'reservation_id', '')::uuid,
    nullif(p->>'lot_number', ''), nullif(p->>'serial_number', ''), nullif(p->>'expiry_date', '')::date
  ) returning * into v_movement;

  return v_movement;
end;
$$;

-- Saldo existente vira movimentação "Saldo inicial" no depósito padrão do item,
-- para que saldo e histórico comecem consistentes. Roda uma única vez.
do $$
declare
  v_row record;
begin
  if exists (select 1 from public.stock_movements) then
    return;
  end if;
  for v_row in select id, current_stock, warehouse_id, average_cost from public.materials where current_stock > 0 loop
    update public.materials set current_stock = 0 where id = v_row.id;
    perform public.apply_stock_movement(jsonb_build_object(
      'material_id', v_row.id,
      'movement_type', 'Saldo inicial',
      'quantity', v_row.current_stock,
      'to_warehouse_id', v_row.warehouse_id,
      'unit_cost', v_row.average_cost,
      'responsible', 'Migração 202',
      'reason', 'Saldo existente antes do controle por movimentações'
    ));
  end loop;
end;
$$;

-- Estoque é compartilhado pelo grupo, como o cadastro de materiais (160_share_master_registries.sql).
do $$
declare
  table_name text;
begin
  foreach table_name in array array['warehouses', 'stock_balances', 'stock_movements', 'stock_reservations'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists shared_authenticated_access on public.%I', table_name);
    execute format('create policy shared_authenticated_access on public.%I for all to authenticated using (true) with check (true)', table_name);
  end loop;
end;
$$;


-- <<< FIM: 202_estoque_movimentacoes.sql

-- ============================================================
-- >>> INICIO: 203_compras.sql
-- ============================================================
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


-- <<< FIM: 203_compras.sql

-- ============================================================
-- >>> INICIO: 204_dashboard_preferencias.sql
-- ============================================================
-- Dashboard ERP Carretas: configuração do painel por usuário (período, filtros,
-- indicadores visíveis, tipo de gráfico e frequência de atualização).
-- A visibilidade das seções segue as permissões de página do usuário.

create table if not exists public.dashboard_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.dashboard_preferences enable row level security;
drop policy if exists dashboard_preferences_owner on public.dashboard_preferences;
create policy dashboard_preferences_owner on public.dashboard_preferences
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());


-- <<< FIM: 204_dashboard_preferencias.sql

-- ============================================================
-- >>> INICIO: 205_catalogo_produtos_servicos.sql
-- ============================================================
-- Catálogo único ERP Carretas: produtos, matérias-primas, kits/composições e serviços.
-- Regras fiscais por operação (CFOP, CST/CSOSN, IBS/CBS) com vigência, composições
-- versionadas e montagem/fabricação com baixa automática dos componentes.
-- Rode no SQL Editor do Supabase depois de 202_estoque_movimentacoes.sql.

-- ---------------------------------------------------------------- Produtos
alter table if exists public.materials
  add column if not exists item_type text not null default 'Produto',
  add column if not exists description text,
  add column if not exists subcategory text,
  add column if not exists brand text,
  add column if not exists manufacturer text,
  add column if not exists controls_stock boolean not null default true,
  add column if not exists allows_sale boolean not null default true,
  add column if not exists warranty_months integer not null default 0,
  add column if not exists photo_url text,
  add column if not exists technical_sheet_url text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'materials_item_type_check') then
    alter table public.materials add constraint materials_item_type_check check (item_type in ('Produto', 'Materia-prima', 'Kit'));
  end if;
end;
$$;

-- CFOP e CST/CSOSN variam por operação, destinatário e regime: ficam em regras
-- parametrizáveis com vigência, nunca fixos no produto. Inclui IBS/CBS (reforma tributária).
create table if not exists public.product_fiscal_rules (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  operation text not null,
  tax_regime text not null default 'Todos' check (tax_regime in ('Todos', 'Simples Nacional', 'Lucro Presumido', 'Lucro Real', 'MEI')),
  cfop text check (cfop is null or cfop ~ '^[1-7][0-9]{3}$'),
  cst_csosn text,
  ibs_cbs_cst text,
  ibs_cbs_class text,
  valid_from date,
  valid_to date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create index if not exists product_fiscal_rules_material_idx on public.product_fiscal_rules (material_id);

-- ---------------------------------------------------------------- Serviços
alter table if exists public.service_types
  add column if not exists code text,
  add column if not exists category text,
  add column if not exists billing_unit text not null default 'Servico',
  add column if not exists default_price numeric(14,2) not null default 0,
  add column if not exists estimated_cost numeric(14,2) not null default 0,
  add column if not exists estimated_minutes integer not null default 0,
  add column if not exists nfse_national_code text,
  add column if not exists lc116_item text,
  add column if not exists municipal_tax_code text,
  add column if not exists nbs_code text,
  add column if not exists iss_rate numeric(6,3) not null default 0,
  add column if not exists iss_retained boolean not null default false,
  add column if not exists retentions jsonb not null default '{}'::jsonb,
  add column if not exists responsible_provider_id uuid references public.providers(id) on delete set null,
  add column if not exists warranty_days integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'service_types_billing_unit_check') then
    alter table public.service_types add constraint service_types_billing_unit_check check (billing_unit in ('Hora', 'Unidade', 'Servico', 'Diaria', 'Km'));
  end if;
end;
$$;

-- ---------------------------------------------------------------- Composições
create table if not exists public.product_compositions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.materials(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'Ativa' check (status in ('Ativa', 'Inativa')),
  labor_cost numeric(14,2) not null default 0 check (labor_cost >= 0),
  assembly_minutes integer not null default 0 check (assembly_minutes >= 0),
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (product_id, version)
);

create unique index if not exists product_compositions_single_active_uidx on public.product_compositions (product_id) where status = 'Ativa';

create table if not exists public.product_composition_items (
  id uuid primary key default gen_random_uuid(),
  composition_id uuid not null references public.product_compositions(id) on delete cascade,
  component_id uuid not null references public.materials(id) on delete restrict,
  quantity numeric(14,4) not null check (quantity > 0),
  unit text not null,
  loss_percent numeric(6,3) not null default 0 check (loss_percent >= 0 and loss_percent < 100),
  notes text
);

create index if not exists product_composition_items_composition_idx on public.product_composition_items (composition_id);

create table if not exists public.production_records (
  id uuid primary key default gen_random_uuid(),
  composition_id uuid not null references public.product_compositions(id) on delete restrict,
  product_id uuid not null references public.materials(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  materials_cost numeric(14,2) not null default 0,
  labor_cost numeric(14,2) not null default 0,
  unit_cost numeric(14,4) not null default 0,
  from_warehouse_id uuid references public.warehouses(id) on delete set null,
  to_warehouse_id uuid references public.warehouses(id) on delete set null,
  document_reference text,
  responsible text,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- Movimentações de produção
alter table public.stock_movements drop constraint if exists stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check check (movement_type in (
  'Saldo inicial', 'Entrada por compra', 'Saida por venda', 'Consumo em OS', 'Consumo em kit',
  'Transferencia', 'Devolucao', 'Ajuste de inventario', 'Perda', 'Consumo em producao', 'Entrada por producao'
));

-- Mesma função de 202, com os tipos de produção:
-- 'Consumo em producao' (saída de componente) e 'Entrada por producao' (produto final, atualiza custo médio).
create or replace function public.apply_stock_movement(p jsonb)
returns public.stock_movements
language plpgsql
as $$
declare
  v_type text := p->>'movement_type';
  v_qty numeric := nullif(p->>'quantity', '')::numeric;
  v_from uuid := nullif(p->>'from_warehouse_id', '')::uuid;
  v_to uuid := nullif(p->>'to_warehouse_id', '')::uuid;
  v_cost numeric := nullif(p->>'unit_cost', '')::numeric;
  v_default uuid;
  v_material public.materials%rowtype;
  v_balance numeric;
  v_delta numeric := 0;
  v_avg numeric;
  v_last numeric;
  v_movement public.stock_movements%rowtype;
begin
  if v_qty is null or v_qty <= 0 then
    raise exception 'Quantidade deve ser maior que zero.';
  end if;

  select * into v_material from public.materials where id = (p->>'material_id')::uuid for update;
  if not found then
    raise exception 'Item de estoque não encontrado.';
  end if;
  if not coalesce(v_material.controls_stock, true) then
    raise exception 'O item % não controla estoque.', v_material.name;
  end if;

  select id into v_default from public.warehouses where is_default limit 1;

  if v_type in ('Saldo inicial', 'Entrada por compra', 'Devolucao', 'Entrada por producao') then
    v_from := null;
    v_to := coalesce(v_to, v_material.warehouse_id, v_default);
  elsif v_type in ('Saida por venda', 'Consumo em OS', 'Consumo em kit', 'Perda', 'Consumo em producao') then
    v_to := null;
    v_from := coalesce(v_from, v_material.warehouse_id, v_default);
  elsif v_type = 'Transferencia' then
    if v_from is null or v_to is null or v_from = v_to then
      raise exception 'Transferência exige depósitos de origem e destino diferentes.';
    end if;
  elsif v_type = 'Ajuste de inventario' then
    if (v_from is null) = (v_to is null) then
      raise exception 'Ajuste de inventário exige somente o depósito de origem (baixa) ou somente o de destino (acréscimo).';
    end if;
  else
    raise exception 'Tipo de movimentação inválido: %', v_type;
  end if;

  if v_material.controls_lot and v_to is not null and v_type <> 'Transferencia' and coalesce(p->>'lot_number', '') = '' then
    raise exception 'O item % controla lote: informe o número do lote.', v_material.name;
  end if;
  if v_material.controls_serial and coalesce(p->>'serial_number', '') = '' then
    raise exception 'O item % controla número de série: informe o número de série.', v_material.name;
  end if;
  if v_material.controls_expiry and v_to is not null and v_type <> 'Transferencia' and coalesce(p->>'expiry_date', '') = '' then
    raise exception 'O item % controla validade: informe a data de validade.', v_material.name;
  end if;

  if v_from is not null then
    insert into public.stock_balances (material_id, warehouse_id, quantity) values (v_material.id, v_from, 0) on conflict do nothing;
    select quantity into v_balance from public.stock_balances where material_id = v_material.id and warehouse_id = v_from for update;
    if v_balance < v_qty then
      raise exception 'Saldo insuficiente de % no depósito de origem: disponível %, solicitado %.', v_material.name, v_balance, v_qty;
    end if;
    update public.stock_balances set quantity = quantity - v_qty, updated_at = now() where material_id = v_material.id and warehouse_id = v_from;
    v_delta := v_delta - v_qty;
  end if;

  if v_to is not null then
    insert into public.stock_balances (material_id, warehouse_id, quantity) values (v_material.id, v_to, v_qty)
    on conflict (material_id, warehouse_id) do update set quantity = public.stock_balances.quantity + excluded.quantity, updated_at = now();
    v_delta := v_delta + v_qty;
  end if;

  v_avg := coalesce(v_material.average_cost, 0);
  v_last := coalesce(v_material.last_purchase_cost, 0);
  if v_type in ('Entrada por compra', 'Saldo inicial', 'Entrada por producao') and v_cost is not null and v_cost >= 0 then
    v_avg := case
      when greatest(v_material.current_stock, 0) + v_qty > 0
        then (greatest(v_material.current_stock, 0) * v_avg + v_qty * v_cost) / (greatest(v_material.current_stock, 0) + v_qty)
      else v_cost
    end;
    if v_type = 'Entrada por compra' then v_last := v_cost; end if;
  end if;
  v_cost := coalesce(v_cost, v_avg);

  update public.materials
    set current_stock = current_stock + v_delta,
        average_cost = round(v_avg, 4),
        last_purchase_cost = round(v_last, 4),
        updated_at = now()
    where id = v_material.id;

  insert into public.stock_movements (
    id, material_id, movement_type, quantity, from_warehouse_id, to_warehouse_id, unit_cost, total_cost, balance_after,
    occurred_at, responsible, document_reference, reason, notes, service_order_id, reservation_id, lot_number, serial_number, expiry_date
  ) values (
    coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid()), v_material.id, v_type, v_qty, v_from, v_to, round(v_cost, 4), round(v_cost * v_qty, 2),
    v_material.current_stock + v_delta,
    coalesce(nullif(p->>'occurred_at', '')::timestamptz, now()), p->>'responsible', p->>'document_reference', p->>'reason', p->>'notes',
    nullif(p->>'service_order_id', '')::uuid, nullif(p->>'reservation_id', '')::uuid,
    nullif(p->>'lot_number', ''), nullif(p->>'serial_number', ''), nullif(p->>'expiry_date', '')::date
  ) returning * into v_movement;

  return v_movement;
end;
$$;

-- Montagem/fabricação de N unidades pela composição ativa (tudo ou nada):
-- baixa cada componente (quantidade x (1 + perda%)), soma o custo real dos materiais
-- (custo médio no momento) + mão de obra e dá entrada no produto final com esse custo.
create or replace function public.produce_composition(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_composition public.product_compositions%rowtype;
  v_product public.materials%rowtype;
  v_item record;
  v_qty numeric := nullif(p->>'quantity', '')::numeric;
  v_need numeric;
  v_movement public.stock_movements%rowtype;
  v_materials_cost numeric := 0;
  v_labor numeric;
  v_unit_cost numeric;
  v_reference text;
  v_record uuid := gen_random_uuid();
begin
  if v_qty is null or v_qty <= 0 then
    raise exception 'Informe a quantidade a montar/fabricar.';
  end if;
  select * into v_composition from public.product_compositions where id = (p->>'composition_id')::uuid;
  if not found then
    raise exception 'Composição não encontrada.';
  end if;
  if v_composition.status <> 'Ativa' then
    raise exception 'Use a versão ativa da composição (esta é a versão %).', v_composition.version;
  end if;
  select * into v_product from public.materials where id = v_composition.product_id;
  v_reference := coalesce(nullif(p->>'document_reference', ''), 'Montagem ' || coalesce(v_product.internal_code, v_product.name) || ' v' || v_composition.version);

  for v_item in select i.*, m.name from public.product_composition_items i join public.materials m on m.id = i.component_id where i.composition_id = v_composition.id loop
    v_need := round(v_item.quantity * (1 + v_item.loss_percent / 100) * v_qty, 3);
    v_movement := public.apply_stock_movement(jsonb_build_object(
      'material_id', v_item.component_id,
      'movement_type', 'Consumo em producao',
      'quantity', v_need,
      'from_warehouse_id', coalesce(p->>'from_warehouse_id', ''),
      'responsible', p->>'responsible',
      'document_reference', v_reference,
      'reason', 'Componente de ' || v_product.name,
      'serial_number', coalesce(p->'serials'->>(v_item.component_id::text), '')
    ));
    v_materials_cost := v_materials_cost + v_movement.total_cost;
  end loop;
  if v_materials_cost = 0 and not exists (select 1 from public.product_composition_items where composition_id = v_composition.id) then
    raise exception 'A composição não tem componentes.';
  end if;

  v_labor := round(v_composition.labor_cost * v_qty, 2);
  v_unit_cost := (v_materials_cost + v_labor) / v_qty;

  perform public.apply_stock_movement(jsonb_build_object(
    'material_id', v_product.id,
    'movement_type', 'Entrada por producao',
    'quantity', v_qty,
    'to_warehouse_id', coalesce(p->>'to_warehouse_id', ''),
    'unit_cost', round(v_unit_cost, 4),
    'responsible', p->>'responsible',
    'document_reference', v_reference,
    'reason', 'Montagem/fabricação',
    'lot_number', coalesce(p->>'lot_number', ''),
    'serial_number', coalesce(p->>'serial_number', ''),
    'expiry_date', coalesce(p->>'expiry_date', '')
  ));

  insert into public.production_records (id, composition_id, product_id, quantity, materials_cost, labor_cost, unit_cost, from_warehouse_id, to_warehouse_id, document_reference, responsible, notes)
  values (v_record, v_composition.id, v_product.id, v_qty, round(v_materials_cost, 2), v_labor, round(v_unit_cost, 4), nullif(p->>'from_warehouse_id', '')::uuid, nullif(p->>'to_warehouse_id', '')::uuid, v_reference, p->>'responsible', p->>'notes');

  return jsonb_build_object('production_id', v_record, 'materials_cost', round(v_materials_cost, 2), 'labor_cost', v_labor, 'unit_cost', round(v_unit_cost, 4));
end;
$$;

-- Catálogo é compartilhado pelo grupo, como materiais e serviços.
do $$
declare
  table_name text;
begin
  foreach table_name in array array['product_fiscal_rules', 'product_compositions', 'product_composition_items', 'production_records'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists shared_authenticated_access on public.%I', table_name);
    execute format('create policy shared_authenticated_access on public.%I for all to authenticated using (true) with check (true)', table_name);
  end loop;
end;
$$;

-- Fotos e fichas técnicas do catálogo.
insert into storage.buckets (id, name, public)
values ('catalog-files', 'catalog-files', true)
on conflict (id) do nothing;


-- <<< FIM: 205_catalogo_produtos_servicos.sql

-- ============================================================
-- >>> INICIO: 206_ordem_servico_erp.sql
-- ============================================================
-- Ordem de Serviço ERP Carretas: novo fluxo de situações, carretas/veículos do
-- cliente, serviços executados, peças com preço, apontamento de horas, desconto
-- autorizado, garantia, histórico de situação e aceite do cliente.
-- Rode no SQL Editor do Supabase depois de 205_catalogo_produtos_servicos.sql.

-- ---------------------------------------------------------------- Carretas / veículos / equipamentos do cliente
create table if not exists public.customer_assets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  asset_type text not null default 'Carreta' check (asset_type in ('Carreta', 'Semirreboque', 'Reboque', 'Caminhão', 'Cavalo mecânico', 'Veículo', 'Equipamento')),
  identification text not null,
  plate text,
  chassis text,
  renavam text,
  brand text,
  model text,
  manufacture_year integer,
  axles integer,
  notes text,
  status text not null default 'Ativo' check (status in ('Ativo', 'Inativo')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_assets_client_idx on public.customer_assets (client_id);
create unique index if not exists customer_assets_plate_uidx on public.customer_assets (upper(regexp_replace(plate, '[^A-Za-z0-9]', '', 'g'))) where plate is not null and plate <> '';
create unique index if not exists customer_assets_chassis_uidx on public.customer_assets (upper(chassis)) where chassis is not null and chassis <> '';

-- ---------------------------------------------------------------- Ordem de serviço
create sequence if not exists public.service_order_erp_seq;

-- Número da OS: OS26-00001 (ano + sequência), sem colidir com a numeração antiga.
create or replace function public.next_service_order_number()
returns text
language sql
as $$ select 'OS' || to_char(current_date, 'YY') || '-' || lpad(nextval('public.service_order_erp_seq')::text, 5, '0') $$;

alter table public.service_orders alter column work_id drop not null;
alter table public.service_orders drop constraint if exists service_orders_status_check;
alter table public.service_orders add constraint service_orders_status_check check (status in (
  'Aberta', 'Em análise', 'Aguardando orçamento', 'Aguardando aprovação', 'Aguardando peças', 'Em execução', 'Em conferência', 'Concluída', 'Entregue', 'Suspensa', 'Cancelada',
  -- situações do sistema anterior, mantidas para OS antigas
  'Criada', 'Agendada', 'A caminho', 'Em execucao', 'Pausada', 'Aguardando material', 'Finalizada', 'Finalizada parcialmente', 'Aguardando retorno'
));

alter table public.service_orders
  add column if not exists order_kind text,
  add column if not exists customer_asset_id uuid references public.customer_assets(id) on delete set null,
  add column if not exists due_date date,
  add column if not exists team_provider_ids uuid[] not null default '{}',
  add column if not exists entry_checklist jsonb not null default '[]'::jsonb,
  add column if not exists services_summary text,
  add column if not exists hours_worked numeric(10,2) not null default 0,
  add column if not exists labor_amount numeric(14,2) not null default 0,
  add column if not exists materials_amount numeric(14,2) not null default 0,
  add column if not exists discount_amount numeric(14,2) not null default 0,
  add column if not exists discount_authorized_by text,
  add column if not exists cost_amount numeric(14,2) not null default 0,
  add column if not exists warranty_days integer not null default 0,
  add column if not exists warranty_until date,
  add column if not exists technical_notes text,
  add column if not exists status_reason text,
  add column if not exists suspended_from_status text,
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_by text,
  add column if not exists source_budget_id uuid,
  -- OS de fabricação/montagem: carreta (produto do catálogo) produzida ao concluir
  add column if not exists production_product_id uuid references public.materials(id) on delete set null,
  add column if not exists production_quantity numeric(12,3) not null default 1 check (production_quantity > 0),
  add column if not exists production_serial text,
  add column if not exists production_record_id uuid references public.production_records(id) on delete set null;

-- ---------------------------------------------------------------- Serviços executados
create table if not exists public.service_order_services (
  id uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  service_type_id uuid references public.service_types(id) on delete set null,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit text not null default 'Servico',
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  executed boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists service_order_services_order_idx on public.service_order_services (service_order_id);

-- ---------------------------------------------------------------- Peças: preço de venda e custo
alter table public.service_order_materials
  add column if not exists unit_price numeric(14,4) not null default 0,
  add column if not exists unit_cost numeric(14,4) not null default 0;

-- ---------------------------------------------------------------- Apontamento de horas
create table if not exists public.service_order_time_entries (
  id uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  provider_id uuid references public.providers(id) on delete set null,
  work_date date not null default current_date,
  hours numeric(8,2) not null check (hours > 0 and hours <= 24),
  hourly_cost numeric(14,2) not null default 0 check (hourly_cost >= 0),
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists service_order_time_entries_order_idx on public.service_order_time_entries (service_order_id);

-- ---------------------------------------------------------------- Histórico de situações
create table if not exists public.service_order_status_history (
  id uuid primary key default gen_random_uuid(),
  service_order_id uuid not null references public.service_orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  changed_by text,
  changed_at timestamptz not null default now()
);

create index if not exists service_order_status_history_order_idx on public.service_order_status_history (service_order_id, changed_at desc);

-- ---------------------------------------------------------------- Empresa (CNPJ) e compartilhamento
do $$
declare
  table_name text;
begin
  foreach table_name in array array['service_order_services', 'service_order_time_entries', 'service_order_status_history'] loop
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

  -- Carretas do cliente são compartilhadas pelo grupo, como o cadastro de clientes.
  alter table public.customer_assets enable row level security;
  drop policy if exists shared_authenticated_access on public.customer_assets;
  create policy shared_authenticated_access on public.customer_assets for all to authenticated using (true) with check (true);
end;
$$;

drop trigger if exists trg_customer_assets_updated_at on public.customer_assets;
create trigger trg_customer_assets_updated_at before update on public.customer_assets for each row execute function public.set_updated_at();
drop trigger if exists trg_service_order_services_updated_at on public.service_order_services;
create trigger trg_service_order_services_updated_at before update on public.service_order_services for each row execute function public.set_updated_at();


-- <<< FIM: 206_ordem_servico_erp.sql

