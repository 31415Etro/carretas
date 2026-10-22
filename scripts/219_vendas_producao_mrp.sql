-- 219: pedido de venda, ordem de produção, MRP e solicitação de compra. ADITIVA e idempotente. Requer 217 e 218.
-- Fluxo: Orçamento aprovado -> Pedido de venda confirmado -> (estoque de acabados) -> Ordem de produção -> kits -> matérias-primas.
-- O consumo/entrada de estoque usa apply_stock_movement (as movimentações já são auditadas pelos gatilhos existentes).

-- ---------------------------------------------------------------- Pedido de venda
create table if not exists public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  quote_id uuid references public.quotes(id) on delete set null,
  client_id uuid not null references public.clients(id) on delete restrict,
  status text not null default 'Rascunho' check (status in ('Rascunho', 'Confirmado', 'Em producao', 'Atendido', 'Entregue', 'Cancelado')),
  order_date date not null default current_date,
  delivery_date date,
  items_total numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  total_amount numeric(14,2) not null default 0,
  notes text,
  confirmed_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  unique (system_company_id, order_number)
);
create index if not exists sales_orders_status_idx on public.sales_orders (system_company_id, status);
create index if not exists sales_orders_client_idx on public.sales_orders (client_id);
create unique index if not exists sales_orders_quote_uidx on public.sales_orders (quote_id) where quote_id is not null and status <> 'Cancelado';

create table if not exists public.sales_order_items (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete cascade,
  position integer not null default 0,
  line_type text not null default 'Produto' check (line_type in ('Produto', 'Serviço')),
  material_id uuid references public.materials(id) on delete restrict,
  service_type_id uuid references public.service_types(id) on delete set null,
  description text not null,
  unit text not null default 'UN',
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  discount_percent numeric(6,3) not null default 0 check (discount_percent between 0 and 100),
  total numeric(14,2) not null default 0,
  unit_cost numeric(14,4) not null default 0,
  make_to_order boolean not null default false,          -- sob encomenda: fabrica mesmo havendo saldo de acabado
  bom_version_id uuid references public.product_bom_versions(id) on delete restrict,   -- estrutura vigente na confirmação (congelada)
  cost_snapshot jsonb,                                    -- custos usados na confirmação (histórico)
  quantity_from_stock numeric(14,3) not null default 0 check (quantity_from_stock >= 0),
  quantity_to_produce numeric(14,3) not null default 0 check (quantity_to_produce >= 0),
  notes text,
  created_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create index if not exists sales_order_items_order_idx on public.sales_order_items (sales_order_id, position);
create index if not exists sales_order_items_material_idx on public.sales_order_items (material_id);

create table if not exists public.sales_order_counters (
  system_company_id uuid not null references public.system_companies(id) on delete cascade,
  year integer not null,
  last_number integer not null default 0,
  primary key (system_company_id, year)
);

create or replace function public.next_sales_order_number()
returns text
language plpgsql
as $$
declare
  v_company uuid := public.request_system_company_id();
  v_year integer := extract(year from current_date)::integer;
  v_number integer;
begin
  insert into public.sales_order_counters (system_company_id, year, last_number) values (v_company, v_year, 0) on conflict do nothing;
  update public.sales_order_counters set last_number = last_number + 1 where system_company_id = v_company and year = v_year returning last_number into v_number;
  return 'PV-' || v_year || '-' || lpad(v_number::text, 5, '0');
end;
$$;

-- ---------------------------------------------------------------- Ordem de produção
create table if not exists public.production_orders (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  sales_order_id uuid references public.sales_orders(id) on delete restrict,
  sales_order_item_id uuid references public.sales_order_items(id) on delete restrict,
  client_id uuid references public.clients(id) on delete set null,
  product_id uuid not null references public.materials(id) on delete restrict,
  bom_version_id uuid not null references public.product_bom_versions(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  produced_quantity numeric(14,3) not null default 0 check (produced_quantity >= 0),
  status text not null default 'Aguardando planejamento' check (status in (
    'Aguardando planejamento', 'Aguardando materiais', 'Pronta para producao', 'Em producao', 'Pausada', 'Aguardando inspecao', 'Concluida', 'Cancelada')),
  priority integer not null default 3 check (priority between 1 and 5),
  responsible text,
  planned_start date,
  planned_end date,
  estimated_materials_cost numeric(14,2) not null default 0,
  estimated_labor_cost numeric(14,2) not null default 0,
  estimated_other_cost numeric(14,2) not null default 0,
  actual_materials_cost numeric(14,2) not null default 0,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  unique (system_company_id, code),
  check (produced_quantity <= quantity)
);
-- Impede ordens duplicadas: um item de pedido gera no máximo uma ordem ativa.
create unique index if not exists production_orders_item_uidx on public.production_orders (sales_order_item_id) where sales_order_item_id is not null and status <> 'Cancelada';
create index if not exists production_orders_status_idx on public.production_orders (system_company_id, status);
create index if not exists production_orders_product_idx on public.production_orders (product_id);

create table if not exists public.production_order_kits (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  kit_id uuid not null references public.materials(id) on delete restrict,
  kit_version_id uuid not null references public.kit_versions(id) on delete restrict,   -- versão congelada na criação da ordem
  quantity numeric(14,4) not null check (quantity > 0),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  unique (production_order_id, kit_id)
);

create table if not exists public.production_order_materials (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  kit_id uuid not null references public.materials(id) on delete restrict,              -- kit de origem (a mesma matéria-prima pode vir de kits diferentes)
  unit text not null,
  required_quantity numeric(14,4) not null check (required_quantity > 0),
  reserved_quantity numeric(14,4) not null default 0 check (reserved_quantity >= 0),
  consumed_quantity numeric(14,4) not null default 0 check (consumed_quantity >= 0),
  estimated_unit_cost numeric(14,4) not null default 0,
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  unique (production_order_id, material_id, kit_id)
);
create index if not exists production_order_materials_order_idx on public.production_order_materials (production_order_id);
create index if not exists production_order_materials_material_idx on public.production_order_materials (material_id);

create table if not exists public.production_consumptions (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete restrict,
  material_id uuid not null references public.materials(id) on delete restrict,
  quantity numeric(14,4) not null check (quantity > 0),
  kind text not null default 'Consumo' check (kind in ('Consumo', 'Perda', 'Retrabalho', 'Adicional')),
  unit_cost numeric(14,4) not null default 0,
  stock_movement_id uuid references public.stock_movements(id) on delete restrict,
  request_key text,                                       -- chave de idempotência do apontamento (evita baixa duplicada)
  responsible text,
  notes text,
  occurred_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create unique index if not exists production_consumptions_request_uidx on public.production_consumptions (production_order_id, request_key) where request_key is not null;
create index if not exists production_consumptions_order_idx on public.production_consumptions (production_order_id);

create table if not exists public.production_receipts (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,4) not null default 0,
  materials_cost numeric(14,2) not null default 0,
  labor_cost numeric(14,2) not null default 0,
  stock_movement_id uuid references public.stock_movements(id) on delete restrict,
  warehouse_id uuid references public.warehouses(id) on delete set null,
  request_key text,
  responsible text,
  notes text,
  created_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create unique index if not exists production_receipts_request_uidx on public.production_receipts (production_order_id, request_key) where request_key is not null;

-- ---------------------------------------------------------------- Custeio rastreável da produção
-- Cada lote concluído grava como o custo foi apropriado (critério, base e valor por tipo de custo). Nada é recalculado depois:
-- correções só entram como AJUSTE (production_cost_adjustments), sempre com motivo e usuário.
create table if not exists public.production_cost_allocations (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete restrict,
  receipt_id uuid not null references public.production_receipts(id) on delete restrict,
  cost_type text not null check (cost_type in ('materiais', 'mao_de_obra', 'indiretos', 'outros')),
  criterion text not null,
  basis_numerator numeric(18,4) not null,
  basis_denominator numeric(18,4) not null check (basis_denominator > 0),
  amount numeric(14,2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create index if not exists production_cost_allocations_receipt_idx on public.production_cost_allocations (receipt_id);

create table if not exists public.production_cost_adjustments (
  id uuid primary key default gen_random_uuid(),
  production_order_id uuid not null references public.production_orders(id) on delete restrict,
  receipt_id uuid not null references public.production_receipts(id) on delete restrict,
  cost_type text not null check (cost_type in ('materiais', 'mao_de_obra', 'indiretos', 'outros')),
  amount numeric(14,2) not null check (amount <> 0),
  reason text not null check (btrim(reason) <> ''),
  adjusted_by text,
  average_cost_before numeric(14,4) not null,
  average_cost_after numeric(14,4) not null,
  created_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create index if not exists production_cost_adjustments_receipt_idx on public.production_cost_adjustments (receipt_id);

-- Históricos imutáveis: consumo, entrada do acabado, apropriações e ajustes não são alterados nem apagados.
create or replace function public.production_history_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'O histórico de produção (%) não pode ser alterado nem apagado. Para corrigir custos, use um ajuste rastreável.', tg_table_name;
end;
$$;
do $$
declare
  t text;
begin
  foreach t in array array['production_consumptions', 'production_receipts', 'production_cost_allocations', 'production_cost_adjustments'] loop
    execute format('drop trigger if exists trg_%I_immutable on public.%I', t, t);
    execute format('create trigger trg_%I_immutable before update or delete on public.%I for each row execute function public.production_history_immutable()', t, t);
  end loop;
end;
$$;

-- Reservas passam a poder pertencer a uma ordem de produção ou a um pedido de venda (acabados).
alter table public.stock_reservations add column if not exists production_order_id uuid references public.production_orders(id) on delete cascade;
alter table public.stock_reservations add column if not exists sales_order_item_id uuid references public.sales_order_items(id) on delete cascade;
create index if not exists stock_reservations_production_idx on public.stock_reservations (production_order_id) where production_order_id is not null;
create index if not exists stock_reservations_sale_item_idx on public.stock_reservations (sales_order_item_id) where sales_order_item_id is not null;

-- ---------------------------------------------------------------- Solicitação de compra (necessidade do MRP; aprovação humana)
create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null,
  production_order_id uuid references public.production_orders(id) on delete set null,
  status text not null default 'Pendente' check (status in ('Pendente', 'Aprovada', 'Convertida', 'Rejeitada', 'Cancelada')),
  requested_by text,
  approved_by text,
  approved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict,
  unique (system_company_id, request_number)
);
create table if not exists public.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  unit text not null,
  needed_by date,
  suggested_supplier_id uuid references public.suppliers(id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  notes text,
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create index if not exists purchase_request_items_request_idx on public.purchase_request_items (purchase_request_id);
create unique index if not exists purchase_requests_open_order_uidx on public.purchase_requests (production_order_id) where production_order_id is not null and status = 'Pendente';

create table if not exists public.production_counters (
  system_company_id uuid not null references public.system_companies(id) on delete cascade,
  kind text not null,
  year integer not null,
  last_number integer not null default 0,
  primary key (system_company_id, kind, year)
);
create or replace function public.next_production_code(p_kind text)
returns text
language plpgsql
as $$
declare
  v_company uuid := public.request_system_company_id();
  v_year integer := extract(year from current_date)::integer;
  v_number integer;
begin
  insert into public.production_counters (system_company_id, kind, year, last_number) values (v_company, p_kind, v_year, 0) on conflict do nothing;
  update public.production_counters set last_number = last_number + 1 where system_company_id = v_company and kind = p_kind and year = v_year returning last_number into v_number;
  return p_kind || '-' || v_year || '-' || lpad(v_number::text, 5, '0');
end;
$$;

-- ---------------------------------------------------------------- Planejamento de materiais (MRP)
-- A disponibilidade (físico - reservado + a receber) é POR EMPRESA e está em public.material_availability (script 217).

-- Planejamento de materiais da ordem: necessidade x disponível x a receber -> falta.
-- O que já foi reservado para ESTA ordem conta como disponível para ela.
create or replace function public.plan_materials(p_production_order_id uuid)
returns table (material_id uuid, material_name text, unit text, required numeric, reserved_for_order numeric, consumed numeric, available_free numeric, incoming numeric, shortage numeric)
language sql
stable
as $$
  with need as (
    select pom.material_id, max(pom.unit) unit, sum(pom.required_quantity) required, sum(pom.reserved_quantity) reserved_for_order, sum(pom.consumed_quantity) consumed
    from public.production_order_materials pom where pom.production_order_id = p_production_order_id group by pom.material_id
  )
  select n.material_id, m.name, n.unit, n.required, n.reserved_for_order, n.consumed,
         av.available, av.incoming,
         greatest(n.required - n.consumed - n.reserved_for_order - av.available - av.incoming, 0)
  from need n
  join public.materials m on m.id = n.material_id
  cross join lateral public.material_availability(n.material_id) av
  order by m.name
$$;

-- ---------------------------------------------------------------- Pedido de venda -> produção (idempotente)
-- Para cada item de produto: usa o saldo de acabados disponível (se não for sob encomenda), reserva essa parte e cria UMA ordem de produção
-- para o restante, congelando a versão da estrutura e dos kits e consolidando as matérias-primas por kit de origem.
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
  if v_order.status not in ('Confirmado', 'Em producao') then
    raise exception 'O pedido % precisa estar confirmado para gerar produção (status atual: %).', v_order.order_number, v_order.status;
  end if;

  for v_item in
    select i.*, m.name as product_name, m.item_type from public.sales_order_items i
    left join public.materials m on m.id = i.material_id
    where i.sales_order_id = p_sales_order_id and i.line_type = 'Produto' order by i.position
  loop
    if v_item.item_type is distinct from 'Produto' then
      continue;
    end if;
    -- Idempotência: item que já tem ordem ativa não gera outra.
    select id into v_po from public.production_orders where sales_order_item_id = v_item.id and status <> 'Cancelada';
    if v_po is not null then
      v_reused := v_reused || to_jsonb(v_po);
      continue;
    end if;
    if v_item.quantity_to_produce > 0 or v_item.quantity_from_stock > 0 then
      -- item já planejado antes e sem ordem ativa (ex.: ordem cancelada): replaneja do zero
      update public.sales_order_items set quantity_from_stock = 0, quantity_to_produce = 0 where id = v_item.id;
      delete from public.stock_reservations where sales_order_item_id = v_item.id and status = 'Ativa';
    end if;

    select id into v_bom from public.product_bom_versions where product_id = v_item.material_id and status = 'Ativa';
    -- 1) acabados disponíveis
    v_from_stock := 0;
    if not v_item.make_to_order then
      select available into v_available from public.material_availability(v_item.material_id);
      v_from_stock := least(coalesce(v_available, 0), v_item.quantity);
    end if;
    v_to_produce := v_item.quantity - v_from_stock;
    if v_from_stock > 0 then
      insert into public.stock_reservations (material_id, quantity, status, sales_order_item_id, responsible, notes)
      values (v_item.material_id, v_from_stock, 'Ativa', v_item.id, p_created_by, 'Acabado reservado para o pedido ' || v_order.order_number);
    end if;
    update public.sales_order_items set quantity_from_stock = v_from_stock, quantity_to_produce = v_to_produce where id = v_item.id;

    if v_to_produce > 0 then
      if v_bom is null then
        raise exception 'O produto % não tem estrutura de fabricação ativa: ative uma versão em Produtos antes de confirmar a venda.', v_item.product_name;
      end if;
      select * into v_cost from public.product_bom_cost(v_bom);
      v_po := gen_random_uuid();
      insert into public.production_orders (id, code, sales_order_id, sales_order_item_id, client_id, product_id, bom_version_id, quantity, planned_end,
                                            estimated_materials_cost, estimated_labor_cost, estimated_other_cost, created_by, system_company_id)
      values (v_po, public.next_production_code('OP'), v_order.id, v_item.id, v_order.client_id, v_item.material_id, v_bom, v_to_produce, v_order.delivery_date,
              round(v_cost.materials_cost * v_to_produce, 2), round(v_cost.labor_cost * v_to_produce, 2), round((v_cost.overhead_cost + v_cost.other_cost) * v_to_produce, 2),
              p_created_by, v_order.system_company_id);
      -- kits congelados na versão usada
      insert into public.production_order_kits (production_order_id, kit_id, kit_version_id, quantity, system_company_id)
      select v_po, e.kit_id, e.kit_version_id, max(e.kit_quantity), v_order.system_company_id from public.explode_bom(v_bom, v_to_produce) e group by e.kit_id, e.kit_version_id;
      -- matérias-primas consolidadas por (material, kit de origem)
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

  update public.sales_orders set status = 'Em producao', updated_at = now() where id = p_sales_order_id and exists (select 1 from public.production_orders where sales_order_id = p_sales_order_id and status <> 'Cancelada');
  return jsonb_build_object('sales_order_id', p_sales_order_id, 'production_orders_created', v_created, 'already_existing', v_reused);
end;
$$;

-- Confirmar o pedido dispara a geração (idempotente). Também pode ser chamado manualmente via create_production_from_sale.
create or replace function public.sales_orders_confirm_trigger()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'Confirmado' and (tg_op = 'INSERT' or old.status is distinct from 'Confirmado') then
    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;
  return new;
end;
$$;
drop trigger if exists trg_sales_orders_confirm on public.sales_orders;
create trigger trg_sales_orders_confirm before insert or update of status on public.sales_orders for each row execute function public.sales_orders_confirm_trigger();

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
  if v_order.status = 'Cancelado' then
    raise exception 'Pedido cancelado não pode ser confirmado.';
  end if;
  if not exists (select 1 from public.sales_order_items where sales_order_id = p_sales_order_id) then
    raise exception 'O pedido não tem itens.';
  end if;
  if v_order.status = 'Rascunho' then
    update public.sales_orders set status = 'Confirmado' where id = p_sales_order_id;
  end if;
  return public.create_production_from_sale(p_sales_order_id, p_user);
end;
$$;

-- ---------------------------------------------------------------- Reserva de matérias-primas para a ordem
-- Reserva o que houver de saldo livre (parcial se faltar). Idempotente: só reserva a diferença.
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

-- Gera a solicitação de compra com as FALTAS da ordem (sem emitir pedido ao fornecedor). Substitui a solicitação pendente anterior da mesma ordem.
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

-- ---------------------------------------------------------------- Consumo real (baixa só aqui)
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

-- ---------------------------------------------------------------- Conclusão (total ou parcial) com entrada do produto acabado
-- Custeio do lote (tudo gravado em production_cost_allocations):
--   materiais: custo HISTÓRICO consumido ainda não apropriado x unidades do lote / unidades cobertas pelo consumo e ainda não produzidas;
--   mão de obra, indiretos e outros: padrão da estrutura (versão congelada na ordem) x unidades do lote.
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
  if v_order.status in ('Concluida', 'Cancelada') then
    raise exception 'Ordem % está %.', v_order.code, lower(v_order.status);
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
    update public.sales_orders so set status = 'Atendido', updated_at = now()
    where so.id = v_order.sales_order_id and not exists (select 1 from public.production_orders po where po.sales_order_id = so.id and po.status not in ('Concluida', 'Cancelada'));
  end if;
  return jsonb_build_object('receipt_id', v_receipt, 'unit_cost', v_unit_cost, 'quantity', v_qty, 'produced_total', v_new_total, 'materials_cost', v_materials, 'duplicate', false);
end;
$$;

-- Ajuste de custo de um lote já movimentado: nunca reescreve o histórico; grava o ajuste (motivo e usuário obrigatórios) e reflete no custo médio do produto.
create or replace function public.adjust_production_cost(p_receipt_id uuid, p_cost_type text, p_amount numeric, p_reason text, p_user text default null)
returns uuid
language plpgsql
as $$
declare
  v_receipt public.production_receipts%rowtype;
  v_product public.materials%rowtype;
  v_before numeric;
  v_after numeric;
  v_id uuid := gen_random_uuid();
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Informe o motivo do ajuste de custo.';
  end if;
  if p_amount is null or p_amount = 0 then
    raise exception 'O valor do ajuste não pode ser zero.';
  end if;
  select * into v_receipt from public.production_receipts where id = p_receipt_id;
  if not found then
    raise exception 'Lote de produção não encontrado.';
  end if;
  select m.* into v_product from public.materials m join public.production_orders o on o.product_id = m.id where o.id = v_receipt.production_order_id for update;
  v_before := coalesce(v_product.average_cost, 0);
  v_after := case when v_product.current_stock > 0 then round(v_before + p_amount / v_product.current_stock, 4) else v_before end;
  if v_after < 0 then
    raise exception 'O ajuste deixaria o custo médio do produto negativo.';
  end if;
  insert into public.production_cost_adjustments (id, production_order_id, receipt_id, cost_type, amount, reason, adjusted_by, average_cost_before, average_cost_after, system_company_id)
  values (v_id, v_receipt.production_order_id, p_receipt_id, p_cost_type, p_amount, p_reason, p_user, v_before, v_after, v_receipt.system_company_id);
  update public.materials set average_cost = v_after, updated_at = now() where id = v_product.id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- Cancelamento sem movimentação indevida
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

-- ---------------------------------------------------------------- Capacidade de fabricação com o estoque atual
-- Quantas unidades completas do produto dá para fabricar com o saldo livre e quais materiais limitam.
create or replace function public.product_capacity(p_product_id uuid)
returns table (capacity numeric, limiting_material_id uuid, limiting_material text, required_per_unit numeric, available numeric, possible_units numeric)
language plpgsql
stable
as $$
declare
  v_bom uuid;
begin
  select id into v_bom from public.product_bom_versions where product_id = p_product_id and status = 'Ativa';
  if v_bom is null then
    raise exception 'O produto não tem estrutura de fabricação ativa.';
  end if;
  return query
  with per_unit as (
    select e.material_id, sum(e.required_quantity) req from public.explode_bom(v_bom, 1) e group by e.material_id
  ), calc as (
    select pu.material_id, m.name, pu.req, av.available, floor(av.available / pu.req) units
    from per_unit pu join public.materials m on m.id = pu.material_id cross join lateral public.material_availability(pu.material_id) av
  )
  select (select min(units) from calc), c.material_id, c.name, c.req, c.available, c.units from calc c order by c.units, c.name;
end;
$$;

drop trigger if exists trg_sales_order_items_sellable on public.sales_order_items;
create trigger trg_sales_order_items_sellable before insert or update of material_id on public.sales_order_items for each row execute function public.sellable_item_guard();

-- ---------------------------------------------------------------- Tenant, auditoria e acesso das tabelas operacionais
do $$
declare
  table_name text;
begin
  foreach table_name in array array['sales_orders', 'sales_order_items', 'production_orders', 'production_order_kits', 'production_order_materials', 'production_consumptions', 'production_receipts',
                                    'purchase_requests', 'purchase_request_items', 'production_cost_allocations', 'production_cost_adjustments'] loop
    execute format('create index if not exists %I on public.%I (system_company_id)', table_name || '_system_company_idx', table_name);
    execute format('drop trigger if exists assign_system_company on public.%I', table_name);
    execute format('create trigger assign_system_company before insert on public.%I for each row execute function public.assign_request_system_company()', table_name);
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists tenant_authenticated_access on public.%I', table_name);
    execute format('drop policy if exists tenant_company_isolation on public.%I', table_name);
    execute format('create policy tenant_authenticated_access on public.%I as permissive for all to authenticated using (true) with check (true)', table_name);
    execute format('create policy tenant_company_isolation on public.%I as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id())', table_name);
  end loop;
  foreach table_name in array array['sales_orders', 'production_orders', 'purchase_requests'] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end;
$$;

-- Contadores: acesso interno às funções (sem RLS necessária; só as funções gravam)
alter table public.sales_order_counters enable row level security;
alter table public.production_counters enable row level security;
drop policy if exists shared_authenticated_access on public.sales_order_counters;
drop policy if exists shared_authenticated_access on public.production_counters;
create policy shared_authenticated_access on public.sales_order_counters for all to authenticated using (true) with check (true);
create policy shared_authenticated_access on public.production_counters for all to authenticated using (true) with check (true);
