-- 222: Produtos finais: especificações, estrutura de fabricação versionada com motivo, custos, explosão, capacidade, estoque de acabados e base do orçamento.
-- ADITIVA e idempotente. Requer 217 a 221. Não altera dados existentes e não cria movimentação de estoque.
-- Hierarquia: matéria-prima -> kit -> produto final. O produto referencia kits (por ID e versão); nunca copia matérias-primas.

-- ---------------------------------------------------------------- Colunas do produto (em materials, item_type = 'Produto')
-- Peso vazio = net_weight; peso bruto total = gross_weight; dimensões em length/width/height (cm); prazo de fabricação = lead_time_days; garantia = warranty_months.
alter table public.materials
  add column if not exists product_line text,
  add column if not exists axle_count integer check (axle_count is null or axle_count >= 0),
  add column if not exists finish_type text,
  add column if not exists structural_notes text,
  add column if not exists engineering_notes text,
  add column if not exists internal_ref text,                                    -- código interno / do legado, quando existir
  add column if not exists product_attributes jsonb not null default '{}'::jsonb, -- especificações extras conforme a categoria
  add column if not exists available_for_quote boolean not null default true,
  add column if not exists make_to_order boolean not null default false;         -- sob encomenda (fabrica mesmo havendo saldo de acabado)

create table if not exists public.product_documents (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.materials(id) on delete cascade,
  name text not null,
  url text not null,
  kind text not null default 'Outro' check (kind in ('Ficha técnica', 'Desenho', 'Manual', 'Certificado', 'Outro')),
  uploaded_by text,
  created_at timestamptz not null default now()
);
create index if not exists product_documents_product_idx on public.product_documents (product_id);

-- ---------------------------------------------------------------- Motivo, responsável e proteção das versões da estrutura
alter table public.product_bom_versions add column if not exists change_reason text;
alter table public.product_bom_versions add column if not exists activated_by text;

-- Versão usada por ordem de produção ou orçamento nunca é apagada.
alter table public.quote_items
  add column if not exists bom_version_id uuid references public.product_bom_versions(id) on delete restrict,
  add column if not exists bom_version_number integer,
  add column if not exists lead_time_days integer,
  add column if not exists product_sku text;

create or replace function public.product_bom_versions_protect_delete()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.production_orders where bom_version_id = old.id) or exists (select 1 from public.quote_items where bom_version_id = old.id)
     or exists (select 1 from public.sales_order_items where bom_version_id = old.id) then
    raise exception 'A versão % da estrutura já foi usada em ordem de produção, orçamento ou venda e não pode ser apagada.', old.version;
  end if;
  return old;
end;
$$;
drop trigger if exists trg_product_bom_versions_protect_delete on public.product_bom_versions;
create trigger trg_product_bom_versions_protect_delete before delete on public.product_bom_versions for each row execute function public.product_bom_versions_protect_delete();

-- ---------------------------------------------------------------- Histórico de alterações do produto
create table if not exists public.product_change_log (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.materials(id) on delete cascade,
  bom_version_id uuid references public.product_bom_versions(id) on delete set null,
  action text not null,
  description text not null,
  detail jsonb,
  changed_by text,
  changed_at timestamptz not null default now()
);
create index if not exists product_change_log_product_idx on public.product_change_log (product_id, changed_at desc);

create or replace function public.product_log_version_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.product_change_log (product_id, bom_version_id, action, description, detail, changed_by)
    values (new.product_id, new.id, 'versao_criada', 'Versão ' || new.version || ' da estrutura criada em rascunho' || coalesce(' (motivo: ' || nullif(new.change_reason, '') || ')', '') || '.',
            jsonb_build_object('reason', new.change_reason), coalesce(new.created_by, public.request_actor()));
  elsif new.status is distinct from old.status then
    insert into public.product_change_log (product_id, bom_version_id, action, description, changed_by)
    values (new.product_id, new.id, case new.status when 'Ativa' then 'versao_ativada' else 'versao_obsoleta' end,
            case new.status when 'Ativa' then 'Versão ' || new.version || ' da estrutura ativada (passou a ser a vigente).' else 'Versão ' || new.version || ' da estrutura marcada como obsoleta (continua guardada).' end,
            coalesce(new.activated_by, public.request_actor()));
  end if;
  return null;
end;
$$;
drop trigger if exists trg_product_versions_log on public.product_bom_versions;
create trigger trg_product_versions_log after insert or update of status on public.product_bom_versions for each row execute function public.product_log_version_change();

create or replace function public.product_log_kit_change()
returns trigger
language plpgsql
as $$
declare
  v_version public.product_bom_versions%rowtype;
  v_name text;
begin
  select * into v_version from public.product_bom_versions where id = coalesce(new.bom_version_id, old.bom_version_id);
  if not found then
    return null;
  end if;
  select name into v_name from public.materials where id = coalesce(new.kit_id, old.kit_id);
  if tg_op = 'INSERT' then
    insert into public.product_change_log (product_id, bom_version_id, action, description, detail, changed_by)
    values (v_version.product_id, v_version.id, 'kit_adicionado', 'v' || v_version.version || ': kit ' || v_name || ' adicionado (' || new.quantity || ' por unidade).', jsonb_build_object('kit_id', new.kit_id, 'quantity', new.quantity), public.request_actor());
  elsif tg_op = 'UPDATE' then
    insert into public.product_change_log (product_id, bom_version_id, action, description, detail, changed_by)
    values (v_version.product_id, v_version.id, 'kit_alterado', 'v' || v_version.version || ': kit ' || v_name || ' passou de ' || old.quantity || ' para ' || new.quantity || ' por unidade.',
            jsonb_build_object('kit_id', new.kit_id, 'before', old.quantity, 'after', new.quantity), public.request_actor());
  else
    insert into public.product_change_log (product_id, bom_version_id, action, description, detail, changed_by)
    values (v_version.product_id, v_version.id, 'kit_removido', 'v' || v_version.version || ': kit ' || v_name || ' removido.', jsonb_build_object('kit_id', old.kit_id), public.request_actor());
  end if;
  return null;
end;
$$;
drop trigger if exists trg_product_kits_log on public.product_kits;
create trigger trg_product_kits_log after insert or update or delete on public.product_kits for each row execute function public.product_log_kit_change();

create or replace function public.product_log_header_change()
returns trigger
language plpgsql
as $$
begin
  if new.item_type = 'Produto' and (new.name, new.category, new.status, new.internal_code, new.sale_price, new.lead_time_days, new.allows_sale, new.available_for_quote, new.ncm)
     is distinct from (old.name, old.category, old.status, old.internal_code, old.sale_price, old.lead_time_days, old.allows_sale, old.available_for_quote, old.ncm) then
    insert into public.product_change_log (product_id, action, description, detail, changed_by)
    values (new.id, case when new.sale_price is distinct from old.sale_price then 'preco_alterado' else 'cadastro_alterado' end,
            case when new.sale_price is distinct from old.sale_price then 'Preço de venda alterado de ' || coalesce(old.sale_price, 0) || ' para ' || coalesce(new.sale_price, 0) || '.' else 'Dados do produto alterados.' end,
            jsonb_build_object('before', jsonb_build_object('name', old.name, 'status', old.status, 'sku', old.internal_code, 'sale_price', old.sale_price, 'ncm', old.ncm),
                               'after', jsonb_build_object('name', new.name, 'status', new.status, 'sku', new.internal_code, 'sale_price', new.sale_price, 'ncm', new.ncm)), public.request_actor());
  end if;
  return null;
end;
$$;
drop trigger if exists trg_product_header_log on public.materials;
create trigger trg_product_header_log after update on public.materials for each row execute function public.product_log_header_change();

-- ---------------------------------------------------------------- Histórico de custo da estrutura (estimativa da versão ao longo do tempo)
create table if not exists public.product_bom_cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  bom_version_id uuid not null references public.product_bom_versions(id) on delete cascade,
  materials_cost numeric(14,2) not null,
  labor_cost numeric(14,2) not null,
  overhead_cost numeric(14,2) not null,
  other_cost numeric(14,2) not null,
  total_cost numeric(14,2) not null,
  computed_at timestamptz not null default now()
);
create index if not exists product_bom_cost_snapshots_idx on public.product_bom_cost_snapshots (bom_version_id, computed_at desc);

create or replace function public.product_record_cost_snapshot(p_bom_version_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_cost record;
  v_cost_json jsonb;
  v_last numeric;
  v_id uuid := gen_random_uuid();
begin
  select * into v_cost from public.product_bom_cost(p_bom_version_id);
  select total_cost into v_last from public.product_bom_cost_snapshots where bom_version_id = p_bom_version_id order by computed_at desc limit 1;
  if v_last is not null and abs(v_last - v_cost.total_cost) < 0.005 then
    return null;
  end if;
  insert into public.product_bom_cost_snapshots (id, bom_version_id, materials_cost, labor_cost, overhead_cost, other_cost, total_cost)
  values (v_id, p_bom_version_id, v_cost.materials_cost, v_cost.labor_cost, v_cost.overhead_cost, v_cost.other_cost, v_cost.total_cost);
  return v_id;
end;
$$;

-- Ativa a versão e guarda a estimativa do momento (custo "da versão da composição").
create or replace function public.product_activate_version(p_version_id uuid, p_user text default null)
returns void
language plpgsql
as $$
begin
  perform public.product_bom_activate_version(p_version_id);
  update public.product_bom_versions set activated_by = coalesce(p_user, public.request_actor()) where id = p_version_id;
  perform public.product_record_cost_snapshot(p_version_id);
end;
$$;

-- ---------------------------------------------------------------- Base do orçamento: valores comerciais do produto no momento da proposta
-- Devolve preço, custo estimado da estrutura vigente, margem, prazo e versão. O orçamento grava estes valores (e não os relê depois).
create or replace function public.product_quote_snapshot(p_ids uuid[])
returns table (id uuid, sku text, sale_price numeric, est_cost numeric, margin_percent numeric, bom_version_id uuid, bom_version integer, lead_time_days integer, available_for_quote boolean)
language sql
stable
as $$
  select m.id, m.internal_code, m.sale_price,
         coalesce((select c.total_cost from public.product_bom_cost(bv.id) c), 0),
         case when m.sale_price > 0 then round((m.sale_price - coalesce((select c.total_cost from public.product_bom_cost(bv.id) c), 0)) / m.sale_price * 100, 2) else null end,
         bv.id, bv.version, m.lead_time_days, m.available_for_quote
  from public.materials m
  left join public.product_bom_versions bv on bv.product_id = m.id and bv.status = 'Ativa'
  where m.id = any(p_ids) and m.item_type = 'Produto'
$$;

-- ---------------------------------------------------------------- Seletor de kits para a estrutura do produto
create or replace function public.product_kit_options(p_search text default null, p_limit integer default 20)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.name), '[]'::jsonb) from (
    select k.id, k.internal_code as sku, k.name, k.category, v.id as version_id, v.version, v.status as version_status,
           (select count(*) from public.kit_components c where c.kit_version_id = v.id) as components_count,
           case when v.id is null then 0 else public.kit_version_cost(v.id) end as cost,
           (select count(distinct bv.product_id) from public.product_kits pk join public.product_bom_versions bv on bv.id = pk.bom_version_id where pk.kit_id = k.id and bv.status = 'Ativa') as products_count
    from public.materials k
    left join public.kit_versions v on v.kit_id = k.id and v.status = 'Ativa'
    where k.item_type = 'Kit' and k.status = 'Ativo' and v.id is not null
      and (p_search is null or btrim(p_search) = '' or k.name ilike '%' || btrim(p_search) || '%' or k.internal_code ilike '%' || btrim(p_search) || '%' or k.category ilike '%' || btrim(p_search) || '%')
    order by (case when lower(k.internal_code) = lower(btrim(coalesce(p_search, ''))) then 0 else 1 end), k.name limit greatest(least(coalesce(p_limit, 20), 100), 1)
  ) t
$$;

-- ---------------------------------------------------------------- Explosão: Produto -> Kits -> Matérias-primas (e lista consolidada). Só leitura.
create or replace function public.product_explosion(p_bom_version_id uuid, p_quantity numeric default 1)
returns jsonb
language plpgsql
stable
as $$
declare
  v_tree jsonb;
  v_flat jsonb;
  v_total numeric;
  v_product uuid;
begin
  select product_id into v_product from public.product_bom_versions where id = p_bom_version_id;
  if v_product is null then
    raise exception 'Estrutura do produto não encontrada.';
  end if;
  with r as (select * from public.explode_bom(p_bom_version_id, p_quantity)),
  g as (select kit_id, kit_version_id, max(kit_quantity) as kit_quantity, material_id, sum(required_quantity) as required, max(unit) as unit from r group by kit_id, kit_version_id, material_id),
  tree as (
    select jsonb_build_object('kit_id', g.kit_id, 'sku', km.internal_code, 'name', km.name, 'kit_version_id', g.kit_version_id, 'kit_version', kv.version, 'quantity', max(g.kit_quantity),
      'cost', round(sum(g.required * public.material_unit_cost(g.material_id)), 2),
      'components', jsonb_agg(jsonb_build_object('material_id', g.material_id, 'sku', mm.internal_code, 'name', mm.name, 'unit', g.unit, 'required', round(g.required, 4),
          'unit_cost', public.material_unit_cost(g.material_id), 'cost', round(g.required * public.material_unit_cost(g.material_id), 2),
          'available', (select available from public.material_availability(g.material_id))) order by mm.name)) as k
    from g join public.materials km on km.id = g.kit_id join public.kit_versions kv on kv.id = g.kit_version_id join public.materials mm on mm.id = g.material_id
    group by g.kit_id, km.internal_code, km.name, g.kit_version_id, kv.version
  ),
  flat as (
    select jsonb_build_object('material_id', t.material_id, 'sku', mm.internal_code, 'name', mm.name, 'unit', t.unit, 'required', round(t.required, 4),
      'unit_cost', public.material_unit_cost(t.material_id), 'cost', round(t.required * public.material_unit_cost(t.material_id), 2),
      'available', av.available, 'incoming', av.incoming, 'shortage', greatest(round(t.required - av.available, 4), 0), 'origins', t.origins) as c
    from (select material_id, max(unit) as unit, sum(required) as required,
                 jsonb_agg(jsonb_build_object('kit_id', kit_id, 'kit_name', (select name from public.materials where id = kit_id), 'required', round(required, 4)) order by kit_id) as origins
          from (select kit_id, material_id, max(unit) as unit, sum(required) as required from g group by kit_id, material_id) s group by material_id) t
    join public.materials mm on mm.id = t.material_id cross join lateral public.material_availability(t.material_id) av
  )
  select (select coalesce(jsonb_agg(k order by k->>'name'), '[]'::jsonb) from tree),
         (select coalesce(jsonb_agg(c order by c->>'name'), '[]'::jsonb) from flat),
         (select coalesce(sum((c->>'cost')::numeric), 0) from flat)
  into v_tree, v_flat, v_total;
  return jsonb_build_object('product_id', v_product, 'bom_version_id', p_bom_version_id, 'quantity', p_quantity, 'kits', v_tree, 'consolidated', v_flat, 'materials_cost', v_total);
end;
$$;

-- ---------------------------------------------------------------- Capacidade de fabricação (sem reservar nem consumir nada)
-- Imediata: só saldo físico livre da EMPRESA em uso (físico - reservas). Projetada: soma pedidos de compra aprovados ainda não recebidos.
create or replace function public.product_capacity_detail(p_product_id uuid, p_bom_version_id uuid default null)
returns jsonb
language plpgsql
stable
as $$
declare
  v_bom uuid := p_bom_version_id;
  v_company uuid := public.request_system_company_id();
  v_rows jsonb;
  v_immediate numeric;
  v_projected numeric;
begin
  if v_bom is null then
    select id into v_bom from public.product_bom_versions where product_id = p_product_id and status = 'Ativa';
  end if;
  if v_bom is null or not exists (select 1 from public.product_bom_versions where id = v_bom and product_id = p_product_id) then
    raise exception 'O produto não tem estrutura de fabricação para calcular a capacidade.';
  end if;
  with per_unit as (
    select e.material_id, sum(e.required_quantity) as required from public.explode_bom(v_bom, 1) e group by e.material_id
  ), calc as (
    select pu.material_id, mm.internal_code as sku, mm.name, mm.unit, pu.required, av.physical, av.reserved, av.available, av.incoming,
           floor(av.available / pu.required) as immediate_units, floor((av.available + av.incoming) / pu.required) as projected_units
    from per_unit pu join public.materials mm on mm.id = pu.material_id cross join lateral public.material_availability(pu.material_id) av
  )
  select coalesce(jsonb_agg(jsonb_build_object('material_id', material_id, 'sku', sku, 'name', name, 'unit', unit, 'required_per_unit', round(required, 4), 'physical', physical, 'reserved', reserved,
           'available', available, 'incoming', incoming, 'immediate_units', immediate_units, 'projected_units', projected_units,
           'limits_immediate', immediate_units = (select min(immediate_units) from calc), 'limits_projected', projected_units = (select min(projected_units) from calc),
           'missing_for_one', greatest(round(required - available, 4), 0)) order by immediate_units, name), '[]'::jsonb),
         min(immediate_units), min(projected_units)
  into v_rows, v_immediate, v_projected from calc;
  return jsonb_build_object('product_id', p_product_id, 'bom_version_id', v_bom, 'immediate_capacity', coalesce(v_immediate, 0), 'projected_capacity', coalesce(v_projected, 0),
    'materials', v_rows, 'company_id', v_company, 'company_name', (select name from public.system_companies where id = v_company),
    'warehouses', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name) order by w.name) from public.warehouses w where w.system_company_id = v_company and w.status = 'Ativo'), '[]'::jsonb),
    'computed_at', now(), 'note', 'Considera só o saldo físico livre da empresa (descontadas as reservas). Pedidos de compra não recebidos entram apenas na capacidade projetada.');
end;
$$;

-- ---------------------------------------------------------------- Comparação entre duas versões da estrutura
create or replace function public.product_compare_versions(p_version_a uuid, p_version_b uuid)
returns table (kit_id uuid, sku text, name text, qty_a numeric, kit_version_a integer, qty_b numeric, kit_version_b integer, cost_a numeric, cost_b numeric, change text)
language sql
stable
as $$
  with a as (
    select pk.kit_id, pk.quantity, coalesce(kv.version, av.version) as kit_version, pk.kit_version_id is null as follows_active,
           round(pk.quantity * public.kit_version_cost(coalesce(pk.kit_version_id, av.id)), 2) as cost
    from public.product_kits pk left join public.kit_versions kv on kv.id = pk.kit_version_id left join public.kit_versions av on av.kit_id = pk.kit_id and av.status = 'Ativa' where pk.bom_version_id = p_version_a
  ), b as (
    select pk.kit_id, pk.quantity, coalesce(kv.version, av.version) as kit_version, pk.kit_version_id is null as follows_active,
           round(pk.quantity * public.kit_version_cost(coalesce(pk.kit_version_id, av.id)), 2) as cost
    from public.product_kits pk left join public.kit_versions kv on kv.id = pk.kit_version_id left join public.kit_versions av on av.kit_id = pk.kit_id and av.status = 'Ativa' where pk.bom_version_id = p_version_b
  )
  select coalesce(a.kit_id, b.kit_id), m.internal_code, m.name, a.quantity, a.kit_version, b.quantity, b.kit_version, coalesce(a.cost, 0), coalesce(b.cost, 0),
         case when a.kit_id is null then 'adicionado' when b.kit_id is null then 'removido'
              when (a.quantity, a.kit_version) is distinct from (b.quantity, b.kit_version) then 'alterado' else 'igual' end
  from a full join b on b.kit_id = a.kit_id join public.materials m on m.id = coalesce(a.kit_id, b.kit_id) order by m.name
$$;

-- ---------------------------------------------------------------- Lista de produtos
create or replace function public.product_list(p_search text default null, p_status text default null, p_category text default null, p_order text default 'name', p_desc boolean default false, p_limit integer default 25, p_offset integer default 0)
returns table (id uuid, sku text, name text, model text, category text, product_line text, status text, sale_price numeric, photo_url text, updated_at timestamptz,
               bom_version_id uuid, bom_version integer, bom_status text, kits_count integer, est_cost numeric, margin numeric, margin_percent numeric,
               physical numeric, reserved numeric, available numeric, in_production numeric, make_to_order boolean, available_for_quote boolean, total_count bigint)
language sql
stable
as $$
  with base as (
    select m.id, m.internal_code as sku, m.name, m.product_model as model, m.category, m.product_line, m.status, m.sale_price, m.photo_url, m.updated_at, m.make_to_order, m.available_for_quote,
           cv.id as bom_version_id, cv.version as bom_version, cv.status as bom_status,
           (select count(*)::integer from public.product_kits pk where pk.bom_version_id = cv.id) as kits_count,
           case when cv.id is null then 0 else (select c.total_cost from public.product_bom_cost(cv.id) c) end as est_cost
    from public.materials m
    left join lateral (select v.id, v.version, v.status from public.product_bom_versions v where v.product_id = m.id order by (v.status = 'Ativa') desc, v.version desc limit 1) cv on true
    where m.item_type = 'Produto'
      and (p_status is null or p_status = '' or m.status = p_status)
      and (p_category is null or p_category = '' or m.category = p_category)
      and (p_search is null or btrim(p_search) = '' or m.name ilike '%' || btrim(p_search) || '%' or m.internal_code ilike '%' || btrim(p_search) || '%'
           or m.product_model ilike '%' || btrim(p_search) || '%' or m.category ilike '%' || btrim(p_search) || '%' or m.internal_ref ilike '%' || btrim(p_search) || '%')
  ), enriched as (
    select b.*, b.sale_price - b.est_cost as margin, case when b.sale_price > 0 then round((b.sale_price - b.est_cost) / b.sale_price * 100, 2) end as margin_percent,
           av.physical, av.reserved, av.available,
           coalesce((select sum(po.quantity - po.produced_quantity) from public.production_orders po where po.product_id = b.id and po.status not in ('Concluida', 'Cancelada')
                     and po.system_company_id = public.request_system_company_id()), 0) as in_production
    from base b cross join lateral public.material_availability(b.id) av
  )
  select e.id, e.sku, e.name, e.model, e.category, e.product_line, e.status, e.sale_price, e.photo_url, e.updated_at, e.bom_version_id, e.bom_version, e.bom_status, e.kits_count, e.est_cost, e.margin, e.margin_percent,
         e.physical, e.reserved, e.available, e.in_production, e.make_to_order, e.available_for_quote, count(*) over ()
  from enriched e
  order by
    case when p_order = 'name' and not p_desc then lower(e.name) end asc, case when p_order = 'name' and p_desc then lower(e.name) end desc,
    case when p_order = 'sku' and not p_desc then lower(e.sku) end asc, case when p_order = 'sku' and p_desc then lower(e.sku) end desc,
    case when p_order = 'price' and not p_desc then e.sale_price end asc, case when p_order = 'price' and p_desc then e.sale_price end desc,
    case when p_order = 'cost' and not p_desc then e.est_cost end asc, case when p_order = 'cost' and p_desc then e.est_cost end desc,
    case when p_order = 'margin' and not p_desc then e.margin_percent end asc, case when p_order = 'margin' and p_desc then e.margin_percent end desc,
    case when p_order = 'stock' and not p_desc then e.available end asc, case when p_order = 'stock' and p_desc then e.available end desc,
    case when p_order = 'updated' and not p_desc then e.updated_at end asc, case when p_order = 'updated' and p_desc then e.updated_at end desc,
    lower(e.name)
  limit greatest(least(coalesce(p_limit, 25), 200), 1) offset greatest(coalesce(p_offset, 0), 0)
$$;

-- ---------------------------------------------------------------- Detalhes do produto
create or replace function public.product_detail(p_product_id uuid, p_bom_version_id uuid default null)
returns jsonb
language plpgsql
stable
as $$
declare
  v_company uuid := public.request_system_company_id();
  v_product jsonb;
  v_current uuid;
  v_shown uuid;
  v_cost record;
  v_cost_json jsonb;
  v_price numeric;
  v_real jsonb;
begin
  select to_jsonb(m) into v_product from public.materials m where m.id = p_product_id and m.item_type = 'Produto';
  if v_product is null then
    raise exception 'Produto não encontrado.';
  end if;
  v_price := coalesce((v_product->>'sale_price')::numeric, 0);
  select id into v_current from public.product_bom_versions where product_id = p_product_id order by (status = 'Ativa') desc, version desc limit 1;
  v_shown := coalesce(p_bom_version_id, v_current);
  if v_shown is not null and not exists (select 1 from public.product_bom_versions where id = v_shown and product_id = p_product_id) then
    raise exception 'A versão informada não pertence a este produto.';
  end if;
  if v_shown is not null then
    select * into v_cost from public.product_bom_cost(v_shown);
    v_cost_json := jsonb_build_object('materials', v_cost.materials_cost, 'labor', v_cost.labor_cost, 'overhead', v_cost.overhead_cost, 'other', v_cost.other_cost,
        'total', v_cost.total_cost, 'price', v_price, 'margin', round(v_price - v_cost.total_cost, 2), 'margin_percent', case when v_price > 0 then round((v_price - v_cost.total_cost) / v_price * 100, 2) end);
  end if;
  -- custo REAL das ordens executadas (lotes recebidos no estoque da empresa)
  select jsonb_build_object('quantity', coalesce(sum(r.quantity), 0), 'unit_cost', case when coalesce(sum(r.quantity), 0) > 0 then round(sum(r.quantity * r.unit_cost) / sum(r.quantity), 4) end,
                            'total_cost', coalesce(round(sum(r.quantity * r.unit_cost), 2), 0), 'lots', count(*))
  into v_real from public.production_receipts r join public.production_orders po on po.id = r.production_order_id where po.product_id = p_product_id and po.system_company_id = v_company;

  return jsonb_build_object(
    'product', v_product,
    'availability', (select to_jsonb(av) from public.material_availability(p_product_id) av),
    'in_production', (select jsonb_build_object('open_orders', count(*), 'quantity', coalesce(sum(po.quantity - po.produced_quantity), 0), 'expected_end', min(po.planned_end))
                      from public.production_orders po where po.product_id = p_product_id and po.system_company_id = v_company and po.status not in ('Concluida', 'Cancelada')),
    'stock_by_warehouse', coalesce((select jsonb_agg(jsonb_build_object('warehouse_id', w.id, 'warehouse', w.name, 'code', w.code, 'quantity', b.quantity) order by w.name)
      from public.stock_balances b join public.warehouses w on w.id = b.warehouse_id where b.material_id = p_product_id and w.system_company_id = v_company), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(x order by x->>'occurred_at' desc) from (
      select jsonb_build_object('id', sm.id, 'movement_type', sm.movement_type, 'quantity', sm.quantity, 'unit_cost', sm.unit_cost, 'total_cost', sm.total_cost, 'occurred_at', sm.occurred_at,
        'document_reference', sm.document_reference, 'responsible', sm.responsible, 'from_warehouse', wf.name, 'to_warehouse', wt.name, 'balance_after', sm.balance_after) x
      from public.stock_movements sm left join public.warehouses wf on wf.id = sm.from_warehouse_id left join public.warehouses wt on wt.id = sm.to_warehouse_id
      where sm.material_id = p_product_id and coalesce(wf.system_company_id, wt.system_company_id) = v_company order by sm.occurred_at desc limit 100) q), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
      select jsonb_build_object('production_order_id', po.id, 'code', po.code, 'status', po.status, 'quantity', po.quantity, 'produced_quantity', po.produced_quantity, 'planned_end', po.planned_end,
        'bom_version', bv.version, 'sales_order', so.order_number, 'created_at', po.created_at) x
      from public.production_orders po join public.product_bom_versions bv on bv.id = po.bom_version_id left join public.sales_orders so on so.id = po.sales_order_id
      where po.product_id = p_product_id and po.system_company_id = v_company order by po.created_at desc limit 50) q), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'url', d.url, 'kind', d.kind, 'uploaded_by', d.uploaded_by, 'created_at', d.created_at) order by d.created_at desc)
      from public.product_documents d where d.product_id = p_product_id), '[]'::jsonb),
    'current_version_id', v_current,
    'shown_version_id', v_shown,
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'status', v.status, 'labor_cost', v.labor_cost, 'labor_minutes', v.labor_minutes, 'overhead_cost', v.overhead_cost,
        'other_cost', v.other_cost, 'estimated_production_days', v.estimated_production_days, 'notes', v.notes, 'change_reason', v.change_reason, 'created_by', v.created_by, 'created_at', v.created_at,
        'activated_at', v.activated_at, 'activated_by', v.activated_by, 'kits_count', (select count(*) from public.product_kits pk where pk.bom_version_id = v.id),
        'total_cost', (select c.total_cost from public.product_bom_cost(v.id) c),
        'used_in_production', exists (select 1 from public.production_orders po where po.bom_version_id = v.id),
        'used_in_quotes', exists (select 1 from public.quote_items qi where qi.bom_version_id = v.id)) order by v.version desc)
      from public.product_bom_versions v where v.product_id = p_product_id), '[]'::jsonb),
    'kits', coalesce((select jsonb_agg(jsonb_build_object('id', pk.id, 'kit_id', k.id, 'sku', k.internal_code, 'name', k.name, 'kit_status', k.status, 'category', k.category, 'quantity', pk.quantity,
        'pinned_version_id', pk.kit_version_id, 'follows_active', pk.kit_version_id is null, 'kit_version_id', kvu.id, 'kit_version', kvu.version, 'kit_version_status', kvu.status,
        'kit_cost', case when kvu.id is null then 0 else public.kit_version_cost(kvu.id) end,
        'line_cost', case when kvu.id is null then 0 else round(pk.quantity * public.kit_version_cost(kvu.id), 2) end,
        'components_count', (select count(*) from public.kit_components c where c.kit_version_id = kvu.id), 'notes', pk.notes, 'position', pk.position) order by pk.position, k.name)
      from public.product_kits pk join public.materials k on k.id = pk.kit_id
      left join public.kit_versions kvu on kvu.id = coalesce(pk.kit_version_id, (select id from public.kit_versions where kit_id = pk.kit_id and status = 'Ativa'))
      where pk.bom_version_id = v_shown), '[]'::jsonb),
    'cost', v_cost_json,
    'cost_of_version', (select jsonb_build_object('total', s.total_cost, 'materials', s.materials_cost, 'computed_at', s.computed_at) from public.product_bom_cost_snapshots s
                        where s.bom_version_id = v_shown order by s.computed_at asc limit 1),
    'cost_history', coalesce((select jsonb_agg(jsonb_build_object('total_cost', s.total_cost, 'materials_cost', s.materials_cost, 'computed_at', s.computed_at, 'version', v.version) order by s.computed_at desc)
      from (select * from public.product_bom_cost_snapshots where bom_version_id in (select id from public.product_bom_versions where product_id = p_product_id) order by computed_at desc limit 40) s
      join public.product_bom_versions v on v.id = s.bom_version_id), '[]'::jsonb),
    'real_cost', v_real,
    'change_log', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'action', l.action, 'description', l.description, 'detail', l.detail, 'changed_by', l.changed_by, 'changed_at', l.changed_at,
        'version', (select version from public.product_bom_versions where id = l.bom_version_id)) order by l.changed_at desc)
      from (select * from public.product_change_log where product_id = p_product_id order by changed_at desc limit 100) l), '[]'::jsonb),
    'sku_history', coalesce((select jsonb_agg(jsonb_build_object('old_sku', h.old_sku, 'new_sku', h.new_sku, 'reason', h.reason, 'changed_by', h.changed_by, 'changed_at', h.changed_at) order by h.changed_at desc)
      from public.item_sku_history h where h.material_id = p_product_id), '[]'::jsonb),
    'used_in_production', exists (select 1 from public.production_orders po join public.product_bom_versions bv on bv.id = po.bom_version_id where bv.product_id = p_product_id)
  );
end;
$$;

-- ---------------------------------------------------------------- Salvar produto (cadastro + estrutura) de uma vez, atômico
-- p: { product_id?, name, sku?, auto_sku, model, category, product_line, description, status, photo_url, technical_sheet_url, internal_ref, unit,
--      specs: { length, width, height, net_weight, gross_weight, payload_capacity, axle_count, finish_type, structural_notes, engineering_notes }, attributes: {},
--      sale_price, lead_time_days, warranty_months, allows_sale, available_for_quote, make_to_order,
--      ncm, ncm_description, ncm_source, ncm_valid_from, ncm_confirmed, user,
--      documents: [{ name, url, kind }] (omitido = não mexe),
--      structure: { version_id? (rascunho a editar), kits: [{ kit_id, quantity, pin_version }], labor_cost, labor_minutes, overhead_cost, other_cost, estimated_days, notes, change_reason, activate } (omitido = só o cadastro) }
-- Editar a estrutura de um produto que já tem versão cria NOVA versão em rascunho (a vigente nunca muda). Nenhuma movimentação de estoque é criada.
create or replace function public.product_save(p jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_product uuid := nullif(p->>'product_id', '')::uuid;
  v_name text := btrim(coalesce(p->>'name', ''));
  v_sku text;
  v_specs jsonb := coalesce(p->'specs', '{}'::jsonb);
  v_structure jsonb := p->'structure';
  v_has_structure boolean := p ? 'structure' and jsonb_typeof(p->'structure') = 'object';
  v_version uuid;
  v_new_version boolean := false;
  v_item jsonb;
  v_kit public.materials%rowtype;
  v_kit_version uuid;
  v_position integer := 0;
  v_next integer;
  v_seen uuid[] := '{}';
  v_created boolean := false;
  v_ncm text := regexp_replace(coalesce(p->>'ncm', ''), '\D', '', 'g');
  v_confirmed boolean := coalesce((p->>'ncm_confirmed')::boolean, false);
  v_old_ncm text;
  v_price numeric := coalesce(nullif(p->>'sale_price', '')::numeric, 0);
  v_allows_sale boolean := coalesce((p->>'allows_sale')::boolean, true);
  v_ver public.product_bom_versions%rowtype;
  v_has_versions boolean := false;
  v_status text;
  v_attrs jsonb := coalesce(p->'attributes', '{}'::jsonb);
  v_unit text := upper(btrim(coalesce(nullif(p->>'unit', ''), 'UN')));
begin
  if length(v_name) < 3 then
    raise exception 'Informe o nome comercial do produto (mínimo 3 letras).';
  end if;
  if v_price < 0 then
    raise exception 'O preço de venda não pode ser negativo.';
  end if;
  if v_allows_sale and v_price <= 0 then
    raise exception 'Produto disponível para venda exige preço de venda maior que zero.';
  end if;
  if v_ncm <> '' and v_ncm !~ '^\d{8}$' then
    raise exception 'NCM deve ter 8 dígitos.';
  end if;

  if v_product is null then
    v_sku := case when coalesce((p->>'auto_sku')::boolean, true) or coalesce(btrim(p->>'sku'), '') = '' then public.next_item_sku('Produto') else btrim(p->>'sku') end;
    insert into public.materials (name, unit, item_type, internal_code, status, controls_stock, allows_sale, sale_price) values (v_name, v_unit, 'Produto', v_sku, coalesce(nullif(p->>'status', ''), 'Ativo'), true, v_allows_sale, v_price)
    returning id into v_product;
    v_created := true;
  else
    select ncm into v_old_ncm from public.materials where id = v_product and item_type = 'Produto';
    if not found then
      raise exception 'Produto não encontrado.';
    end if;
    if nullif(btrim(p->>'sku'), '') is not null then
      update public.materials set internal_code = btrim(p->>'sku') where id = v_product and internal_code is distinct from btrim(p->>'sku');
    end if;
  end if;

  update public.materials set
    name = v_name, unit = v_unit, status = coalesce(nullif(p->>'status', ''), status), category = nullif(btrim(p->>'category'), ''), product_model = nullif(btrim(p->>'model'), ''),
    product_line = nullif(btrim(p->>'product_line'), ''), description = nullif(btrim(p->>'description'), ''), photo_url = nullif(p->>'photo_url', ''), technical_sheet_url = nullif(p->>'technical_sheet_url', ''),
    internal_ref = nullif(btrim(p->>'internal_ref'), ''),
    length = coalesce(nullif(v_specs->>'length', '')::numeric, 0), width = coalesce(nullif(v_specs->>'width', '')::numeric, 0), height = coalesce(nullif(v_specs->>'height', '')::numeric, 0),
    net_weight = coalesce(nullif(v_specs->>'net_weight', '')::numeric, 0), gross_weight = coalesce(nullif(v_specs->>'gross_weight', '')::numeric, 0),
    payload_capacity = nullif(v_specs->>'payload_capacity', '')::numeric, axle_count = nullif(v_specs->>'axle_count', '')::integer, finish_type = nullif(btrim(v_specs->>'finish_type'), ''),
    structural_notes = nullif(btrim(v_specs->>'structural_notes'), ''), engineering_notes = nullif(btrim(v_specs->>'engineering_notes'), ''), product_attributes = v_attrs,
    sale_price = v_price, allows_sale = v_allows_sale, lead_time_days = nullif(p->>'lead_time_days', '')::integer, warranty_months = coalesce(nullif(p->>'warranty_months', '')::integer, 0),
    available_for_quote = coalesce((p->>'available_for_quote')::boolean, true), make_to_order = coalesce((p->>'make_to_order')::boolean, false), updated_at = now()
  where id = v_product;

  -- NCM do produto final: próprio, confirmado por uma pessoa; nunca copiado das matérias-primas
  if v_ncm = '' then
    update public.materials set ncm = null, ncm_description = null, ncm_source = null, ncm_valid_from = null, ncm_confirmed_by = null, ncm_confirmed_at = null where id = v_product;
  elsif v_created or coalesce(regexp_replace(v_old_ncm, '\D', '', 'g'), '') is distinct from v_ncm then
    if not v_confirmed then
      raise exception 'Confirme o NCM do produto antes de salvar.';
    end if;
    update public.materials set ncm = v_ncm, ncm_description = nullif(p->>'ncm_description', ''), ncm_source = coalesce(nullif(p->>'ncm_source', ''), 'Informado manualmente'),
           ncm_valid_from = nullif(p->>'ncm_valid_from', '')::date, ncm_confirmed_by = coalesce(nullif(p->>'user', ''), public.request_actor()), ncm_confirmed_at = now() where id = v_product;
  end if;

  if p ? 'documents' and jsonb_typeof(p->'documents') = 'array' then
    delete from public.product_documents where product_id = v_product;
    insert into public.product_documents (product_id, name, url, kind, uploaded_by)
    select v_product, btrim(d->>'name'), d->>'url', coalesce(nullif(d->>'kind', ''), 'Outro'), coalesce(nullif(p->>'user', ''), public.request_actor()) from jsonb_array_elements(p->'documents') d where coalesce(btrim(d->>'url'), '') <> '';
  end if;

  if v_has_structure then
    if jsonb_typeof(v_structure->'kits') <> 'array' or jsonb_array_length(v_structure->'kits') = 0 then
      raise exception 'Vincule ao menos um kit à estrutura de fabricação do produto.';
    end if;
    for v_item in select * from jsonb_array_elements(v_structure->'kits') loop
      if (v_item->>'kit_id')::uuid = any(v_seen) then
        raise exception 'O kit % aparece mais de uma vez na estrutura.', (select name from public.materials where id = (v_item->>'kit_id')::uuid);
      end if;
      v_seen := v_seen || (v_item->>'kit_id')::uuid;
      if coalesce(nullif(v_item->>'quantity', '')::numeric, 0) <= 0 then
        raise exception 'Informe a quantidade de cada kit por unidade do produto (maior que zero).';
      end if;
    end loop;
    select exists (select 1 from public.product_bom_versions where product_id = v_product) into v_has_versions;
    v_version := nullif(v_structure->>'version_id', '')::uuid;
    if v_version is not null then
      select * into v_ver from public.product_bom_versions where id = v_version and product_id = v_product;
      if not found then
        raise exception 'A versão informada não pertence a este produto.';
      end if;
      if v_ver.status <> 'Rascunho' then
        raise exception 'A estrutura versão % está % e não pode ser alterada: salve como nova versão.', v_ver.version, lower(v_ver.status);
      end if;
      delete from public.product_kits where bom_version_id = v_version;
      update public.product_bom_versions set labor_cost = coalesce(nullif(v_structure->>'labor_cost', '')::numeric, 0), labor_minutes = coalesce(nullif(v_structure->>'labor_minutes', '')::integer, 0),
        overhead_cost = coalesce(nullif(v_structure->>'overhead_cost', '')::numeric, 0), other_cost = coalesce(nullif(v_structure->>'other_cost', '')::numeric, 0),
        estimated_production_days = coalesce(nullif(v_structure->>'estimated_days', '')::integer, 0), notes = nullif(btrim(v_structure->>'notes'), ''),
        change_reason = coalesce(nullif(btrim(v_structure->>'change_reason'), ''), change_reason) where id = v_version;
    else
      if v_has_versions and coalesce(btrim(v_structure->>'change_reason'), '') = '' then
        raise exception 'Informe o motivo da nova versão da estrutura.';
      end if;
      select coalesce(max(version), 0) + 1 into v_next from public.product_bom_versions where product_id = v_product;
      insert into public.product_bom_versions (product_id, version, status, labor_cost, labor_minutes, overhead_cost, other_cost, estimated_production_days, notes, change_reason, created_by)
      values (v_product, v_next, 'Rascunho', coalesce(nullif(v_structure->>'labor_cost', '')::numeric, 0), coalesce(nullif(v_structure->>'labor_minutes', '')::integer, 0),
              coalesce(nullif(v_structure->>'overhead_cost', '')::numeric, 0), coalesce(nullif(v_structure->>'other_cost', '')::numeric, 0), coalesce(nullif(v_structure->>'estimated_days', '')::integer, 0),
              nullif(btrim(v_structure->>'notes'), ''), coalesce(nullif(btrim(v_structure->>'change_reason'), ''), 'Estrutura inicial'), coalesce(nullif(p->>'user', ''), public.request_actor()))
      returning id into v_version;
      v_new_version := true;
    end if;
    for v_item in select * from jsonb_array_elements(v_structure->'kits') loop
      select * into v_kit from public.materials where id = (v_item->>'kit_id')::uuid;
      if not found or v_kit.item_type <> 'Kit' then
        raise exception 'Somente kits cadastrados podem compor a estrutura do produto.';
      end if;
      v_kit_version := null;
      if coalesce((v_item->>'pin_version')::boolean, false) then
        select id into v_kit_version from public.kit_versions where kit_id = v_kit.id and status = 'Ativa';
        if v_kit_version is null then
          raise exception 'O kit % não tem versão ativa para fixar.', v_kit.name;
        end if;
      elsif not exists (select 1 from public.kit_versions where kit_id = v_kit.id and status = 'Ativa') then
        raise exception 'O kit % não tem versão ativa: ative uma versão do kit antes de usá-lo no produto.', v_kit.name;
      end if;
      insert into public.product_kits (bom_version_id, kit_id, kit_version_id, quantity, position, notes)
      values (v_version, v_kit.id, v_kit_version, (v_item->>'quantity')::numeric, v_position, nullif(v_item->>'notes', ''));
      v_position := v_position + 1;
    end loop;
    if coalesce((v_structure->>'activate')::boolean, false) then
      perform public.product_activate_version(v_version, nullif(p->>'user', ''));
    else
      perform public.product_record_cost_snapshot(v_version);
    end if;
    select status into v_status from public.product_bom_versions where id = v_version;
  end if;

  return jsonb_build_object('product_id', v_product, 'created', v_created, 'sku', (select internal_code from public.materials where id = v_product), 'version_id', v_version,
                            'version', (select version from public.product_bom_versions where id = v_version), 'version_status', v_status);
end;
$$;

-- ---------------------------------------------------------------- Acesso (catálogo compartilhado, como `materials`)
do $$
declare
  table_name text;
begin
  foreach table_name in array array['product_documents', 'product_change_log', 'product_bom_cost_snapshots'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists shared_authenticated_access on public.%I', table_name);
    execute format('create policy shared_authenticated_access on public.%I for all to authenticated using (true) with check (true)', table_name);
  end loop;
end;
$$;
