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
