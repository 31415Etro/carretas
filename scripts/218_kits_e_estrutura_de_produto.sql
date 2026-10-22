-- 218: kits com versões e estrutura de fabricação do produto (produto -> kits -> matérias-primas). ADITIVA e idempotente.
-- Requer o 217. Kits e produtos são itens de `materials` (tipo 'Kit' e 'Produto'); estas tabelas guardam a composição por versão.

-- ---------------------------------------------------------------- Kit: versões
create table if not exists public.kit_versions (
  id uuid primary key default gen_random_uuid(),
  kit_id uuid not null references public.materials(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'Rascunho' check (status in ('Rascunho', 'Ativa', 'Obsoleta')),
  composition_kind text not null default 'fabricacao' check (composition_kind in ('fabricacao', 'fisico', 'multinivel')),
  reference_unit text not null default 'UN',
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (kit_id, version)
);
create unique index if not exists kit_versions_single_active_uidx on public.kit_versions (kit_id) where status = 'Ativa';
create index if not exists kit_versions_kit_idx on public.kit_versions (kit_id);

create table if not exists public.kit_components (
  id uuid primary key default gen_random_uuid(),
  kit_version_id uuid not null references public.kit_versions(id) on delete cascade,
  component_id uuid not null references public.materials(id) on delete restrict,
  position integer not null default 0,
  quantity numeric(14,4) not null check (quantity > 0),
  unit text not null,
  loss_percent numeric(6,3) not null default 0 check (loss_percent >= 0 and loss_percent < 100),
  notes text,
  created_at timestamptz not null default now(),
  unique (kit_version_id, component_id)
);
create index if not exists kit_components_version_idx on public.kit_components (kit_version_id);
create index if not exists kit_components_component_idx on public.kit_components (component_id);

-- O item do kit precisa ser do tipo Kit; os componentes são matérias-primas (subkits só em composição multinível, sem ciclos).
create or replace function public.kit_versions_validate()
returns trigger
language plpgsql
as $$
declare
  v_type text;
begin
  select item_type into v_type from public.materials where id = new.kit_id;
  if v_type is distinct from 'Kit' then
    raise exception 'Versão de kit exige um item do tipo Kit (o item informado é %).', coalesce(v_type, 'inexistente');
  end if;
  if tg_op = 'UPDATE' and old.status in ('Ativa', 'Obsoleta') and new.status = 'Rascunho' then
    raise exception 'Uma versão ativa ou obsoleta não volta para rascunho: crie uma nova versão.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_kit_versions_validate on public.kit_versions;
create trigger trg_kit_versions_validate before insert or update on public.kit_versions for each row execute function public.kit_versions_validate();

-- Há ciclo se, a partir de `p_start`, algum subkit leva de volta ao kit de origem (usa a versão ativa de cada subkit).
create or replace function public.kit_has_cycle(p_origin_kit uuid, p_start_kit uuid)
returns boolean
language sql
stable
as $$
  with recursive walk(kit_id, path) as (
    select p_start_kit, array[p_start_kit]
    union all
    select c.component_id, w.path || c.component_id
    from walk w
    join public.kit_versions v on v.kit_id = w.kit_id and v.status = 'Ativa'
    join public.kit_components c on c.kit_version_id = v.id
    join public.materials m on m.id = c.component_id and m.item_type = 'Kit'
    where not c.component_id = any(w.path)
  )
  select exists (select 1 from walk where kit_id = p_origin_kit) or p_origin_kit = p_start_kit
$$;

create or replace function public.kit_components_validate()
returns trigger
language plpgsql
as $$
declare
  v_version public.kit_versions%rowtype;
  v_type text;
begin
  select * into v_version from public.kit_versions where id = coalesce(new.kit_version_id, old.kit_version_id);
  if tg_op in ('UPDATE', 'DELETE') and v_version.status <> 'Rascunho' then
    raise exception 'A versão % do kit está % e não pode ser alterada: crie uma nova versão.', v_version.version, lower(v_version.status);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if v_version.status <> 'Rascunho' then
    raise exception 'A versão % do kit está % e não aceita novos componentes: crie uma nova versão.', v_version.version, lower(v_version.status);
  end if;
  select item_type into v_type from public.materials where id = new.component_id;
  if v_type = 'Materia-prima' then
    return new;
  elsif v_type = 'Kit' then
    if v_version.composition_kind <> 'multinivel' then
      raise exception 'Subkits só podem ser usados em composição multinível.';
    end if;
    if public.kit_has_cycle(v_version.kit_id, new.component_id) then
      raise exception 'Referência circular: o kit não pode conter a si mesmo, direta ou indiretamente.';
    end if;
    return new;
  end if;
  raise exception 'Componente de kit deve ser matéria-prima (ou kit, em composição multinível). Tipo informado: %.', coalesce(v_type, 'inexistente');
end;
$$;
drop trigger if exists trg_kit_components_validate on public.kit_components;
create trigger trg_kit_components_validate before insert or update or delete on public.kit_components for each row execute function public.kit_components_validate();

-- Cria uma nova versão em rascunho copiando os componentes da versão indicada (ou da ativa).
create or replace function public.kit_new_version(p_kit_id uuid, p_from_version uuid default null, p_created_by text default null)
returns uuid
language plpgsql
as $$
declare
  v_source public.kit_versions%rowtype;
  v_new uuid := gen_random_uuid();
  v_next integer;
begin
  if p_from_version is not null then
    select * into v_source from public.kit_versions where id = p_from_version and kit_id = p_kit_id;
  else
    select * into v_source from public.kit_versions where kit_id = p_kit_id order by (status = 'Ativa') desc, version desc limit 1;
  end if;
  select coalesce(max(version), 0) + 1 into v_next from public.kit_versions where kit_id = p_kit_id;
  insert into public.kit_versions (id, kit_id, version, status, composition_kind, reference_unit, notes, created_by)
  values (v_new, p_kit_id, v_next, 'Rascunho', coalesce(v_source.composition_kind, 'fabricacao'), coalesce(v_source.reference_unit, 'UN'), v_source.notes, p_created_by);
  if v_source.id is not null then
    insert into public.kit_components (kit_version_id, component_id, position, quantity, unit, loss_percent, notes)
    select v_new, component_id, position, quantity, unit, loss_percent, notes from public.kit_components where kit_version_id = v_source.id;
  end if;
  return v_new;
end;
$$;

-- Ativa uma versão: exige ao menos um componente; a ativa anterior vira obsoleta (continua guardada para o histórico).
create or replace function public.kit_activate_version(p_version_id uuid)
returns void
language plpgsql
as $$
declare
  v_version public.kit_versions%rowtype;
begin
  select * into v_version from public.kit_versions where id = p_version_id for update;
  if not found then
    raise exception 'Versão do kit não encontrada.';
  end if;
  if v_version.status = 'Ativa' then
    return;
  end if;
  if v_version.status = 'Obsoleta' then
    raise exception 'Versão obsoleta não pode ser reativada: crie uma nova a partir dela.';
  end if;
  if not exists (select 1 from public.kit_components where kit_version_id = p_version_id) then
    raise exception 'Adicione ao menos uma matéria-prima antes de ativar a versão.';
  end if;
  update public.kit_versions set status = 'Obsoleta' where kit_id = v_version.kit_id and status = 'Ativa';
  update public.kit_versions set status = 'Ativa', activated_at = now() where id = p_version_id;
end;
$$;

-- Custo de uma versão do kit: soma de quantidade x (1 + perda) x custo vigente da matéria-prima (subkits entram pela versão ativa).
create or replace function public.kit_version_cost(p_version_id uuid)
returns numeric
language plpgsql
stable
as $$
declare
  v_total numeric := 0;
  v_row record;
  v_sub uuid;
begin
  for v_row in
    select c.component_id, c.quantity, c.loss_percent, m.item_type
    from public.kit_components c join public.materials m on m.id = c.component_id
    where c.kit_version_id = p_version_id
  loop
    if v_row.item_type = 'Kit' then
      select id into v_sub from public.kit_versions where kit_id = v_row.component_id and status = 'Ativa';
      v_total := v_total + v_row.quantity * (1 + v_row.loss_percent / 100) * coalesce(public.kit_version_cost(v_sub), 0);
    else
      v_total := v_total + v_row.quantity * (1 + v_row.loss_percent / 100) * public.material_unit_cost(v_row.component_id);
    end if;
  end loop;
  return round(v_total, 4);
end;
$$;

-- ---------------------------------------------------------------- Produto: estrutura de fabricação por versão
create table if not exists public.product_bom_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.materials(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null default 'Rascunho' check (status in ('Rascunho', 'Ativa', 'Obsoleta')),
  labor_cost numeric(14,2) not null default 0 check (labor_cost >= 0),
  labor_minutes integer not null default 0 check (labor_minutes >= 0),
  overhead_cost numeric(14,2) not null default 0 check (overhead_cost >= 0),
  other_cost numeric(14,2) not null default 0 check (other_cost >= 0),
  estimated_production_days integer not null default 0 check (estimated_production_days >= 0),
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (product_id, version)
);
create unique index if not exists product_bom_single_active_uidx on public.product_bom_versions (product_id) where status = 'Ativa';
create index if not exists product_bom_versions_product_idx on public.product_bom_versions (product_id);

create table if not exists public.product_kits (
  id uuid primary key default gen_random_uuid(),
  bom_version_id uuid not null references public.product_bom_versions(id) on delete cascade,
  kit_id uuid not null references public.materials(id) on delete restrict,
  kit_version_id uuid references public.kit_versions(id) on delete restrict, -- nulo = acompanha a versão ativa do kit no momento do planejamento
  quantity numeric(14,4) not null check (quantity > 0),
  position integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  unique (bom_version_id, kit_id)
);
create index if not exists product_kits_bom_idx on public.product_kits (bom_version_id);
create index if not exists product_kits_kit_idx on public.product_kits (kit_id);

create or replace function public.product_bom_versions_validate()
returns trigger
language plpgsql
as $$
declare
  v_type text;
begin
  select item_type into v_type from public.materials where id = new.product_id;
  if v_type is distinct from 'Produto' then
    raise exception 'Estrutura de fabricação exige um item do tipo Produto (o item informado é %).', coalesce(v_type, 'inexistente');
  end if;
  if tg_op = 'UPDATE' and old.status in ('Ativa', 'Obsoleta') and new.status = 'Rascunho' then
    raise exception 'Uma versão ativa ou obsoleta não volta para rascunho: crie uma nova versão.';
  end if;
  if tg_op = 'UPDATE' and old.status <> 'Rascunho' and (new.labor_cost, new.overhead_cost, new.other_cost, new.labor_minutes) is distinct from (old.labor_cost, old.overhead_cost, old.other_cost, old.labor_minutes) then
    raise exception 'Os custos de uma versão ativa ou obsoleta não podem ser alterados: crie uma nova versão.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_product_bom_versions_validate on public.product_bom_versions;
create trigger trg_product_bom_versions_validate before insert or update on public.product_bom_versions for each row execute function public.product_bom_versions_validate();

create or replace function public.product_kits_validate()
returns trigger
language plpgsql
as $$
declare
  v_bom public.product_bom_versions%rowtype;
  v_type text;
  v_kit_version public.kit_versions%rowtype;
begin
  select * into v_bom from public.product_bom_versions where id = coalesce(new.bom_version_id, old.bom_version_id);
  if v_bom.status <> 'Rascunho' then
    raise exception 'A estrutura versão % do produto está % e não pode ser alterada: crie uma nova versão.', v_bom.version, lower(v_bom.status);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  select item_type into v_type from public.materials where id = new.kit_id;
  if v_type is distinct from 'Kit' then
    raise exception 'Somente kits podem ser vinculados ao produto (o item informado é %).', coalesce(v_type, 'inexistente');
  end if;
  if new.kit_version_id is not null then
    select * into v_kit_version from public.kit_versions where id = new.kit_version_id;
    if v_kit_version.kit_id is distinct from new.kit_id then
      raise exception 'A versão informada não pertence ao kit selecionado.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_product_kits_validate on public.product_kits;
create trigger trg_product_kits_validate before insert or update or delete on public.product_kits for each row execute function public.product_kits_validate();

create or replace function public.product_bom_new_version(p_product_id uuid, p_from_version uuid default null, p_created_by text default null)
returns uuid
language plpgsql
as $$
declare
  v_source public.product_bom_versions%rowtype;
  v_new uuid := gen_random_uuid();
  v_next integer;
begin
  if p_from_version is not null then
    select * into v_source from public.product_bom_versions where id = p_from_version and product_id = p_product_id;
  else
    select * into v_source from public.product_bom_versions where product_id = p_product_id order by (status = 'Ativa') desc, version desc limit 1;
  end if;
  select coalesce(max(version), 0) + 1 into v_next from public.product_bom_versions where product_id = p_product_id;
  insert into public.product_bom_versions (id, product_id, version, status, labor_cost, labor_minutes, overhead_cost, other_cost, estimated_production_days, notes, created_by)
  values (v_new, p_product_id, v_next, 'Rascunho', coalesce(v_source.labor_cost, 0), coalesce(v_source.labor_minutes, 0), coalesce(v_source.overhead_cost, 0), coalesce(v_source.other_cost, 0),
          coalesce(v_source.estimated_production_days, 0), v_source.notes, p_created_by);
  if v_source.id is not null then
    insert into public.product_kits (bom_version_id, kit_id, kit_version_id, quantity, position, notes)
    select v_new, kit_id, kit_version_id, quantity, position, notes from public.product_kits where bom_version_id = v_source.id;
  end if;
  return v_new;
end;
$$;

create or replace function public.product_bom_activate_version(p_version_id uuid)
returns void
language plpgsql
as $$
declare
  v_version public.product_bom_versions%rowtype;
begin
  select * into v_version from public.product_bom_versions where id = p_version_id for update;
  if not found then
    raise exception 'Versão da estrutura do produto não encontrada.';
  end if;
  if v_version.status = 'Ativa' then
    return;
  end if;
  if v_version.status = 'Obsoleta' then
    raise exception 'Versão obsoleta não pode ser reativada: crie uma nova a partir dela.';
  end if;
  if not exists (select 1 from public.product_kits where bom_version_id = p_version_id) then
    raise exception 'Vincule ao menos um kit ao produto antes de ativar a estrutura.';
  end if;
  update public.product_bom_versions set status = 'Obsoleta' where product_id = v_version.product_id and status = 'Ativa';
  update public.product_bom_versions set status = 'Ativa', activated_at = now() where id = p_version_id;
end;
$$;

-- ---------------------------------------------------------------- Explosão da lista de materiais (BOM)
-- Para `p_quantity` unidades do produto: cada kit com a quantidade total e cada matéria-prima consolidada por kit de origem.
-- Considera perdas; subkits (composição multinível) são expandidos pela versão ativa.
create or replace function public.explode_bom(p_bom_version_id uuid, p_quantity numeric)
returns table (kit_id uuid, kit_version_id uuid, kit_quantity numeric, material_id uuid, required_quantity numeric, unit text)
language plpgsql
stable
as $$
declare
  v_pk record;
  v_version uuid;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Informe uma quantidade maior que zero.';
  end if;
  for v_pk in select pk.kit_id, pk.kit_version_id, pk.quantity from public.product_kits pk where pk.bom_version_id = p_bom_version_id order by pk.position loop
    v_version := coalesce(v_pk.kit_version_id, (select id from public.kit_versions where kit_versions.kit_id = v_pk.kit_id and status = 'Ativa'));
    if v_version is null then
      raise exception 'O kit % não tem versão ativa.', (select name from public.materials where id = v_pk.kit_id);
    end if;
    return query select v_pk.kit_id, v_version, round(v_pk.quantity * p_quantity, 4), f.material_id, f.required_quantity, f.unit
                 from public.explode_kit_version(v_version, round(v_pk.quantity * p_quantity, 4)) f;
  end loop;
end;
$$;

-- Matérias-primas de uma versão de kit para `p_quantity` kits (recursivo para subkits).
create or replace function public.explode_kit_version(p_version_id uuid, p_quantity numeric, p_depth integer default 0)
returns table (material_id uuid, required_quantity numeric, unit text)
language plpgsql
stable
as $$
declare
  v_row record;
  v_sub uuid;
begin
  if p_depth > 10 then
    raise exception 'Composição de kits com mais de 10 níveis: verifique referências circulares.';
  end if;
  for v_row in
    select c.component_id, c.quantity, c.unit, c.loss_percent, m.item_type, m.name
    from public.kit_components c join public.materials m on m.id = c.component_id
    where c.kit_version_id = p_version_id order by c.position
  loop
    if v_row.item_type = 'Kit' then
      select id into v_sub from public.kit_versions where kit_id = v_row.component_id and status = 'Ativa';
      if v_sub is null then
        raise exception 'O subkit % não tem versão ativa.', v_row.name;
      end if;
      return query select * from public.explode_kit_version(v_sub, round(v_row.quantity * (1 + v_row.loss_percent / 100) * p_quantity, 4), p_depth + 1);
    else
      return query select v_row.component_id, round(v_row.quantity * (1 + v_row.loss_percent / 100) * p_quantity, 4), v_row.unit;
    end if;
  end loop;
end;
$$;

-- Custos da estrutura de fabricação (materiais, mão de obra, indiretos, outros) para 1 unidade do produto.
create or replace function public.product_bom_cost(p_bom_version_id uuid)
returns table (materials_cost numeric, labor_cost numeric, overhead_cost numeric, other_cost numeric, total_cost numeric)
language plpgsql
stable
as $$
declare
  v_bom public.product_bom_versions%rowtype;
  v_materials numeric := 0;
  v_pk record;
  v_version uuid;
begin
  select * into v_bom from public.product_bom_versions where id = p_bom_version_id;
  if not found then
    raise exception 'Estrutura do produto não encontrada.';
  end if;
  for v_pk in select pk.kit_id, pk.kit_version_id, pk.quantity from public.product_kits pk where pk.bom_version_id = p_bom_version_id loop
    v_version := coalesce(v_pk.kit_version_id, (select id from public.kit_versions where kit_versions.kit_id = v_pk.kit_id and status = 'Ativa'));
    if v_version is not null then
      v_materials := v_materials + v_pk.quantity * public.kit_version_cost(v_version);
    end if;
  end loop;
  return query select round(v_materials, 2), v_bom.labor_cost, v_bom.overhead_cost, v_bom.other_cost, round(v_materials + v_bom.labor_cost + v_bom.overhead_cost + v_bom.other_cost, 2);
end;
$$;

-- ---------------------------------------------------------------- Migração da composição antiga (produto -> componentes) para o novo modelo
-- NÃO roda sozinha. Para cada composição ativa antiga cria um kit "(legado)" com os componentes e uma estrutura de produto que o usa.
create or replace function public.migrate_legacy_compositions()
returns integer
language plpgsql
as $$
declare
  v_comp record;
  v_kit uuid;
  v_kit_version uuid;
  v_bom uuid;
  v_count integer := 0;
  v_product public.materials%rowtype;
begin
  for v_comp in select * from public.product_compositions where status = 'Ativa' loop
    select * into v_product from public.materials where id = v_comp.product_id;
    if v_product.item_type is distinct from 'Produto' then
      continue;
    end if;
    if exists (select 1 from public.product_bom_versions where product_id = v_comp.product_id) then
      continue;
    end if;
    v_kit := gen_random_uuid();
    insert into public.materials (id, name, unit, item_type, internal_code, status, allows_sale, controls_stock, description)
    values (v_kit, 'Kit ' || v_product.name || ' (legado)', 'UN', 'Kit', public.next_item_sku('Kit'), 'Ativo', false, false, 'Criado a partir da composição antiga do produto.');
    insert into public.kit_versions (kit_id, version, status, notes) values (v_kit, 1, 'Rascunho', 'Migrado da composição antiga') returning id into v_kit_version;
    insert into public.kit_components (kit_version_id, component_id, quantity, unit, loss_percent, notes)
    select v_kit_version, component_id, quantity, unit, loss_percent, notes from public.product_composition_items where composition_id = v_comp.id;
    perform public.kit_activate_version(v_kit_version);
    insert into public.product_bom_versions (product_id, version, status, labor_cost, labor_minutes, notes)
    values (v_comp.product_id, 1, 'Rascunho', v_comp.labor_cost, v_comp.assembly_minutes, 'Migrado da composição antiga') returning id into v_bom;
    insert into public.product_kits (bom_version_id, kit_id, quantity) values (v_bom, v_kit, 1);
    perform public.product_bom_activate_version(v_bom);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------- Acesso (cadastros mestres compartilhados, como `materials`)
do $$
declare
  table_name text;
begin
  foreach table_name in array array['kit_versions', 'kit_components', 'product_bom_versions', 'product_kits'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists shared_authenticated_access on public.%I', table_name);
    execute format('create policy shared_authenticated_access on public.%I for all to authenticated using (true) with check (true)', table_name);
  end loop;
end;
$$;

-- ---------------------------------------------------------------- Histórico do item (inclui kits, estrutura e produção) para a troca controlada de SKU
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
      or exists (select 1 from public.service_order_materials where material_id = p_material_id)
      or exists (select 1 from public.kit_components where component_id = p_material_id)
      or exists (select 1 from public.kit_versions where kit_id = p_material_id and status <> 'Rascunho')
      or exists (select 1 from public.product_kits where kit_id = p_material_id)
      or exists (select 1 from public.product_bom_versions where product_id = p_material_id and status <> 'Rascunho');
end;
$$;
