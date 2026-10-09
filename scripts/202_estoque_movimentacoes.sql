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
