-- 217: estrutura dos itens (matéria-prima, kit, produto) e estoque por empresa. ADITIVA e idempotente: nenhum registro é apagado.
-- `materials` continua sendo o cadastro mestre COMPARTILHADO entre as empresas (estoque, orçamentos, compras e OS apontam para ele).
-- O que é operacional (depósitos, saldos, reservas, compras, vendas, produção) pertence a uma empresa e não atravessa para outra sem transferência formal.

-- ---------------------------------------------------------------- Colunas novas em materials
alter table public.materials
  add column if not exists material_kind text,                       -- tipo do material (aço, madeira, elétrica...) para matéria-prima
  add column if not exists thickness numeric(14,3) check (thickness is null or thickness >= 0),
  add column if not exists diameter numeric(14,3) check (diameter is null or diameter >= 0),
  add column if not exists technical_attributes jsonb not null default '{}'::jsonb,
  add column if not exists lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  add column if not exists min_purchase_qty numeric(14,3) check (min_purchase_qty is null or min_purchase_qty >= 0),
  add column if not exists product_model text,                       -- produto: modelo
  add column if not exists payload_capacity numeric(14,3) check (payload_capacity is null or payload_capacity >= 0), -- produto: capacidade de carga (kg)
  add column if not exists ncm_description text,                     -- descrição oficial do NCM confirmado
  add column if not exists ncm_source text,                          -- fonte da classificação
  add column if not exists ncm_valid_from date,
  add column if not exists ncm_confirmed_by text,
  add column if not exists ncm_confirmed_at timestamptz,
  add column if not exists replacement_lead_note text;

-- ---------------------------------------------------------------- SKU: código único em TODO o catálogo compartilhado
-- Prefixos do gerador: MP- (matéria-prima), KIT- (kit), PRD- (produto). A busca por SKU nunca devolve dois itens.
-- O índice só é criado se não houver SKU repetido hoje; se houver, o script avisa e nada é apagado (veja scripts/resolver-sku-duplicado.py).
do $$
declare
  v_dup integer;
begin
  select count(*) into v_dup from (
    select lower(btrim(internal_code)) from public.materials
    where internal_code is not null and btrim(internal_code) <> ''
    group by 1 having count(*) > 1
  ) d;
  if v_dup > 0 then
    raise notice 'ATENÇÃO: % SKU(s) repetido(s) em materials. O índice único materials_sku_uidx NÃO foi criado. Resolva as duplicidades (renomeando, sem apagar) e rode este script de novo.', v_dup;
  else
    create unique index if not exists materials_sku_uidx on public.materials (lower(btrim(internal_code))) where internal_code is not null and btrim(internal_code) <> '';
  end if;
end;
$$;

create table if not exists public.item_sku_counters (
  prefix text primary key,
  last_number integer not null default 0
);

-- Próximo SKU livre do tipo (MP-000001, KIT-000001, PRD-000001), seguro sob concorrência e sem colidir com nenhum código existente.
create or replace function public.next_item_sku(p_item_type text)
returns text
language plpgsql
as $$
declare
  v_prefix text;
  v_number integer;
  v_sku text;
begin
  v_prefix := case p_item_type when 'Materia-prima' then 'MP' when 'Kit' then 'KIT' when 'Produto' then 'PRD' else null end;
  if v_prefix is null then
    raise exception 'Tipo de item inválido para gerar SKU: %.', p_item_type;
  end if;
  insert into public.item_sku_counters (prefix, last_number) values (v_prefix, 0) on conflict (prefix) do nothing;
  loop
    update public.item_sku_counters set last_number = last_number + 1 where prefix = v_prefix returning last_number into v_number;
    v_sku := v_prefix || '-' || lpad(v_number::text, 6, '0');
    exit when not exists (select 1 from public.materials where lower(btrim(internal_code)) = lower(v_sku));
  end loop;
  return v_sku;
end;
$$;

-- Busca global por SKU: devolve no máximo um item (o código é único no catálogo).
create or replace function public.find_item_by_sku(p_sku text)
returns table (id uuid, internal_code text, name text, item_type text)
language sql
stable
as $$
  select m.id, m.internal_code, m.name, m.item_type from public.materials m where lower(btrim(m.internal_code)) = lower(btrim(p_sku))
$$;

create table if not exists public.item_sku_history (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  old_sku text,
  new_sku text not null,
  reason text not null,
  changed_by text,
  changed_at timestamptz not null default now()
);
create index if not exists item_sku_history_material_idx on public.item_sku_history (material_id);

-- O item já tem história (movimento, kit, estrutura, orçamento, pedido de compra)? Então o SKU só muda pela troca controlada.
create or replace function public.item_has_history(p_material_id uuid)
returns boolean
language plpgsql
stable
as $$
begin
  return exists (select 1 from public.stock_movements where material_id = p_material_id)
      or exists (select 1 from public.purchase_order_items where material_id = p_material_id)
      or exists (select 1 from public.quote_items where material_id = p_material_id)
      or exists (select 1 from public.product_composition_items where component_id = p_material_id)
      or exists (select 1 from public.service_order_materials where material_id = p_material_id);
end;
$$;

create or replace function public.materials_sku_guard()
returns trigger
language plpgsql
as $$
begin
  if new.internal_code is not null then
    new.internal_code := btrim(new.internal_code);
    if new.internal_code = '' then
      new.internal_code := null;
    elsif new.internal_code !~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$' then
      raise exception 'SKU inválido: use letras, números, ponto, hífen, barra ou sublinhado (até 40 caracteres), sem espaços.';
    end if;
  end if;
  if tg_op = 'INSERT' then
    if new.internal_code is not null and exists (select 1 from public.materials where lower(btrim(internal_code)) = lower(new.internal_code)) then
      raise exception 'O SKU % já existe no catálogo. Escolha outro ou use o gerador automático.', new.internal_code;
    end if;
    return new;
  end if;
  if new.internal_code is distinct from old.internal_code then
    if coalesce(current_setting('app.sku_change', true), '') <> 'on' and old.internal_code is not null and public.item_has_history(old.id) then
      raise exception 'Este item já tem movimentações ou vínculos: o SKU só pode ser trocado pela troca controlada (informando o motivo).';
    end if;
    if new.internal_code is not null and exists (select 1 from public.materials where id <> new.id and lower(btrim(internal_code)) = lower(new.internal_code)) then
      raise exception 'O SKU % já pertence a outro item.', new.internal_code;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_materials_sku_guard on public.materials;
create trigger trg_materials_sku_guard before insert or update of internal_code on public.materials for each row execute function public.materials_sku_guard();

-- Troca controlada de SKU: exige motivo, mantém o histórico.
create or replace function public.change_item_sku(p_material_id uuid, p_new_sku text, p_reason text, p_user text default null)
returns text
language plpgsql
as $$
declare
  v_old text;
begin
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'Informe o motivo da troca de SKU.';
  end if;
  select internal_code into v_old from public.materials where id = p_material_id for update;
  if not found then
    raise exception 'Item não encontrado.';
  end if;
  perform set_config('app.sku_change', 'on', true);
  update public.materials set internal_code = p_new_sku where id = p_material_id;
  perform set_config('app.sku_change', 'off', true);
  insert into public.item_sku_history (material_id, old_sku, new_sku, reason, changed_by) values (p_material_id, v_old, btrim(p_new_sku), p_reason, p_user);
  return btrim(p_new_sku);
end;
$$;

-- ---------------------------------------------------------------- Regras por tipo e "Disponível para venda"
-- Kit nunca é vendido diretamente. Matéria-prima é de consumo interno por padrão; quando "Disponível para venda" é ligado,
-- o backend exige os dados comerciais (preço de venda, unidade e NCM de 8 dígitos). Desligado, o preço de venda é zerado.
create or replace function public.materials_validate_by_type()
returns trigger
language plpgsql
as $$
begin
  if new.item_type = 'Kit' then
    new.allows_sale := false;
    if coalesce(new.sale_price, 0) <> 0 then
      raise exception 'Kit não possui preço de venda: o preço é do produto final.';
    end if;
  end if;
  if new.item_type = 'Materia-prima' then
    -- a coluna allows_sale nasce ligada nos cadastros antigos: na criação, sem nenhum dado comercial informado, a matéria-prima nasce como consumo interno
    if tg_op = 'INSERT' and coalesce(new.allows_sale, false) and coalesce(new.sale_price, 0) = 0 and coalesce(btrim(new.ncm), '') = '' then
      new.allows_sale := false;
    end if;
    if coalesce(new.allows_sale, false) then
      if coalesce(new.sale_price, 0) <= 0 then
        raise exception 'Matéria-prima disponível para venda exige preço de venda maior que zero.';
      end if;
      if coalesce(btrim(new.unit), '') = '' then
        raise exception 'Matéria-prima disponível para venda exige a unidade comercial.';
      end if;
      if regexp_replace(coalesce(new.ncm, ''), '\D', '', 'g') !~ '^\d{8}$' then
        raise exception 'Matéria-prima disponível para venda exige NCM de 8 dígitos.';
      end if;
    else
      new.allows_sale := false;
      new.sale_price := 0;
    end if;
  end if;
  if new.ncm is not null and btrim(new.ncm) <> '' and regexp_replace(new.ncm, '\D', '', 'g') !~ '^\d{8}$' then
    raise exception 'NCM deve ter 8 dígitos.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_materials_validate_by_type on public.materials;
create trigger trg_materials_validate_by_type
before insert or update of item_type, sale_price, allows_sale, ncm, unit on public.materials
for each row execute function public.materials_validate_by_type();

-- Orçamento/pedido só aceitam como produto vendável: Produto, ou matéria-prima com "Disponível para venda"; kit nunca.
create or replace function public.sellable_item_guard()
returns trigger
language plpgsql
as $$
declare
  v_item public.materials%rowtype;
begin
  if new.material_id is null then
    return new;
  end if;
  select * into v_item from public.materials where id = new.material_id;
  if v_item.item_type = 'Kit' then
    raise exception 'Kit não é vendido diretamente: venda o produto final.';
  end if;
  if v_item.item_type = 'Materia-prima' and not coalesce(v_item.allows_sale, false) then
    raise exception 'A matéria-prima % não está marcada como "Disponível para venda".', v_item.name;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_quote_items_sellable on public.quote_items;
create trigger trg_quote_items_sellable before insert or update of material_id on public.quote_items for each row execute function public.sellable_item_guard();

-- ---------------------------------------------------------------- Fornecedores da matéria-prima
create table if not exists public.raw_material_suppliers (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  supplier_code text,
  is_primary boolean not null default false,
  last_cost numeric(14,4) check (last_cost is null or last_cost >= 0),
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  min_purchase_qty numeric(14,3) check (min_purchase_qty is null or min_purchase_qty >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (material_id, supplier_id)
);
create unique index if not exists raw_material_suppliers_primary_uidx on public.raw_material_suppliers (material_id) where is_primary;
create index if not exists raw_material_suppliers_supplier_idx on public.raw_material_suppliers (supplier_id);
drop trigger if exists trg_raw_material_suppliers_updated_at on public.raw_material_suppliers;
create trigger trg_raw_material_suppliers_updated_at before update on public.raw_material_suppliers for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------- Tabela de NCM vigente (cache da fonte oficial; nunca preenchida por palpite)
create table if not exists public.ncm_classifications (
  code text primary key check (code ~ '^\d{8}$'),
  description text not null,
  valid_from date,
  valid_to date,
  source text not null,
  fetched_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create index if not exists ncm_classifications_description_idx on public.ncm_classifications using gin (to_tsvector('portuguese', description));

-- ---------------------------------------------------------------- Custo vigente do item (usado por kits e produtos)
create or replace function public.material_unit_cost(p_material_id uuid)
returns numeric
language sql
stable
as $$
  select coalesce(nullif(average_cost, 0), nullif(last_purchase_cost, 0), nullif(cost_price, 0), 0)
  from public.materials where id = p_material_id
$$;

-- ================================================================ ESTOQUE POR EMPRESA
-- Cada depósito pertence a uma empresa. Saldo, reserva e consumo só acontecem em depósitos da empresa em uso.
-- Passar estoque de uma empresa para outra exige a transferência formal (transfer_stock_between_companies), registrada e auditável.
alter table public.warehouses add column if not exists system_company_id uuid references public.system_companies(id) on delete restrict;
update public.warehouses set system_company_id = '00000000-0000-4000-8000-000000000001'::uuid where system_company_id is null;   -- os depósitos atuais pertencem à empresa padrão
alter table public.warehouses alter column system_company_id set default '00000000-0000-4000-8000-000000000001'::uuid;
alter table public.warehouses alter column system_company_id set not null;
drop index if exists public.warehouses_single_default_uidx;
create unique index if not exists warehouses_single_default_company_uidx on public.warehouses (system_company_id) where is_default;
create index if not exists warehouses_system_company_idx on public.warehouses (system_company_id);

-- Toda empresa precisa de um depósito padrão (sem isso a empresa não consegue dar entrada em estoque).
-- O gatilho assign_system_company grava a empresa do contexto da requisição; por isso o contexto é ajustado empresa por empresa.
do $$
declare
  v_company record;
begin
  for v_company in select id from public.system_companies loop
    if not exists (select 1 from public.warehouses w where w.system_company_id = v_company.id) then
      perform set_config('request.headers', json_build_object('x-system-company-id', v_company.id)::text, true);
      insert into public.warehouses (code, name, is_default, system_company_id)
      values ('DEP-' || upper(substr(replace(v_company.id::text, '-', ''), 1, 6)), 'Depósito principal', true, v_company.id);
    end if;
  end loop;
  perform set_config('request.headers', '', true);
end;
$$;

alter table public.stock_reservations add column if not exists system_company_id uuid references public.system_companies(id) on delete restrict;
update public.stock_reservations r set system_company_id = coalesce((select w.system_company_id from public.warehouses w where w.id = r.warehouse_id), '00000000-0000-4000-8000-000000000001'::uuid) where r.system_company_id is null;
alter table public.stock_reservations alter column system_company_id set default '00000000-0000-4000-8000-000000000001'::uuid;
alter table public.stock_reservations alter column system_company_id set not null;
create index if not exists stock_reservations_system_company_idx on public.stock_reservations (system_company_id);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['warehouses', 'stock_reservations'] loop
    execute format('drop trigger if exists assign_system_company on public.%I', table_name);
    execute format('create trigger assign_system_company before insert on public.%I for each row execute function public.assign_request_system_company()', table_name);
    execute format('drop policy if exists tenant_company_isolation on public.%I', table_name);
    execute format('create policy tenant_company_isolation on public.%I as restrictive for all to authenticated using (system_company_id = public.request_system_company_id()) with check (system_company_id = public.request_system_company_id())', table_name);
  end loop;
end;
$$;

create or replace function public.company_default_warehouse(p_company uuid default null)
returns uuid
language sql
stable
as $$
  select id from public.warehouses where is_default and system_company_id = coalesce(p_company, public.request_system_company_id()) limit 1
$$;

-- Transferências formais entre empresas (rastro de quem pediu, o quê, quanto e por qual movimento).
create table if not exists public.stock_company_transfers (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete restrict,
  quantity numeric(14,3) not null check (quantity > 0),
  from_company_id uuid not null references public.system_companies(id) on delete restrict,
  to_company_id uuid not null references public.system_companies(id) on delete restrict,
  from_warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  to_warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  stock_movement_id uuid references public.stock_movements(id) on delete restrict,
  unit_cost numeric(14,4) not null default 0,
  reference text,
  requested_by text,
  created_at timestamptz not null default now(),
  check (from_company_id <> to_company_id)
);
create index if not exists stock_company_transfers_material_idx on public.stock_company_transfers (material_id);

-- Barreira: nenhuma movimentação usa depósito de outra empresa, exceto a transferência formal.
create or replace function public.stock_movements_company_guard()
returns trigger
language plpgsql
as $$
declare
  v_company uuid := public.request_system_company_id();
  v_owner uuid;
begin
  if coalesce(current_setting('app.company_transfer', true), '') = 'on' then
    return new;
  end if;
  if new.from_warehouse_id is not null then
    select system_company_id into v_owner from public.warehouses where id = new.from_warehouse_id;
    if v_owner is distinct from v_company then
      raise exception 'O depósito de origem pertence a outra empresa. Use a transferência formal entre empresas.';
    end if;
  end if;
  if new.to_warehouse_id is not null then
    select system_company_id into v_owner from public.warehouses where id = new.to_warehouse_id;
    if v_owner is distinct from v_company then
      raise exception 'O depósito de destino pertence a outra empresa. Use a transferência formal entre empresas.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_stock_movements_company_guard on public.stock_movements;
create trigger trg_stock_movements_company_guard before insert on public.stock_movements for each row execute function public.stock_movements_company_guard();

-- apply_stock_movement: igual ao existente, mas o depósito padrão e o do item são os da EMPRESA em uso.
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
  v_item_wh uuid;
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

  v_default := public.company_default_warehouse();
  select id into v_item_wh from public.warehouses where id = v_material.warehouse_id and system_company_id = public.request_system_company_id();
  v_item_wh := coalesce(v_item_wh, v_default);

  if v_type in ('Saldo inicial', 'Entrada por compra', 'Devolucao', 'Entrada por producao') then
    v_from := null;
    v_to := coalesce(v_to, v_item_wh);
  elsif v_type in ('Saida por venda', 'Consumo em OS', 'Consumo em kit', 'Perda', 'Consumo em producao') then
    v_to := null;
    v_from := coalesce(v_from, v_item_wh);
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

-- Transferência formal de estoque entre empresas do grupo: sai do depósito da origem e entra no depósito do destino, na mesma transação.
create or replace function public.transfer_stock_between_companies(p_material_id uuid, p_quantity numeric, p_from_warehouse uuid, p_to_warehouse uuid, p_user text default null, p_reference text default null)
returns uuid
language plpgsql
as $$
declare
  v_from_company uuid;
  v_to_company uuid;
  v_movement public.stock_movements%rowtype;
  v_id uuid := gen_random_uuid();
begin
  select system_company_id into v_from_company from public.warehouses where id = p_from_warehouse;
  select system_company_id into v_to_company from public.warehouses where id = p_to_warehouse;
  if v_from_company is null or v_to_company is null then
    raise exception 'Depósito de origem ou destino não encontrado.';
  end if;
  if v_from_company = v_to_company then
    raise exception 'Os depósitos são da mesma empresa: use a transferência comum entre depósitos.';
  end if;
  perform set_config('app.company_transfer', 'on', true);
  v_movement := public.apply_stock_movement(jsonb_build_object('material_id', p_material_id::text, 'movement_type', 'Transferencia', 'quantity', p_quantity,
    'from_warehouse_id', p_from_warehouse::text, 'to_warehouse_id', p_to_warehouse::text, 'responsible', p_user,
    'document_reference', coalesce(p_reference, 'Transferência entre empresas'), 'reason', 'Transferência formal entre empresas'));
  perform set_config('app.company_transfer', 'off', true);
  insert into public.stock_company_transfers (id, material_id, quantity, from_company_id, to_company_id, from_warehouse_id, to_warehouse_id, stock_movement_id, unit_cost, reference, requested_by)
  values (v_id, p_material_id, p_quantity, v_from_company, v_to_company, p_from_warehouse, p_to_warehouse, v_movement.id, v_movement.unit_cost, p_reference, p_user);
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- Disponibilidade POR EMPRESA
-- Físico = soma dos saldos nos depósitos da empresa. Reservado = reservas ativas da empresa. Projetado = disponível + compras aprovadas da empresa.
create or replace function public.material_availability(p_material_id uuid, p_company uuid default null)
returns table (physical numeric, reserved numeric, available numeric, incoming numeric, projected numeric)
language sql
stable
as $$
  with c as (select coalesce(p_company, public.request_system_company_id()) id),
  phys as (
    select coalesce(sum(b.quantity), 0) q from public.stock_balances b join public.warehouses w on w.id = b.warehouse_id, c
    where b.material_id = p_material_id and w.system_company_id = c.id
  ), res as (
    select coalesce(sum(r.quantity), 0) q from public.stock_reservations r, c where r.material_id = p_material_id and r.status = 'Ativa' and r.system_company_id = c.id
  ), inc as (
    select coalesce(sum(greatest(i.quantity - i.received_quantity, 0)), 0) q
    from public.purchase_order_items i join public.purchase_orders o on o.id = i.purchase_order_id, c
    where i.material_id = p_material_id and o.status in ('Aprovado', 'Parcialmente recebido') and o.system_company_id = c.id
  )
  select phys.q, res.q, greatest(phys.q - res.q, 0), inc.q, greatest(phys.q - res.q, 0) + inc.q from phys, res, inc
$$;

-- ---------------------------------------------------------------- Acesso (mesmo padrão dos cadastros mestres compartilhados)
do $$
declare
  table_name text;
begin
  foreach table_name in array array['raw_material_suppliers', 'ncm_classifications', 'item_sku_counters', 'item_sku_history', 'stock_company_transfers'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists shared_authenticated_access on public.%I', table_name);
    execute format('create policy shared_authenticated_access on public.%I for all to authenticated using (true) with check (true)', table_name);
  end loop;
end;
$$;
