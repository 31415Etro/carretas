-- 225: Engenharia paramétrica e configurador de carretas.
-- ADITIVA e idempotente. Requer 217 a 224. Não apaga nem altera dados existentes e NÃO cadastra nenhum parâmetro de modelo: os limites de cada carreta são
-- informados por pessoas, com a fonte documental, e só valem como homologados depois da validação técnica (revisão "Validada").
-- Cadastro de engenharia (revisões, documentos, parâmetros, opções, regras, fórmulas, desenho) = catálogo COMPARTILHADO. A configuração de uma venda = dado da EMPRESA.
-- Fórmulas são árvores JSON com operações e funções permitidas (sem código arbitrário), avaliadas aqui no banco.

-- ================================================================ 1. Revisões de engenharia por produto (com os documentos de cada uma)
create table if not exists public.product_engineering_revisions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.materials(id) on delete restrict,
  revision text not null,
  status text not null default 'Rascunho' check (status in ('Rascunho', 'Em validacao', 'Validada', 'Obsoleta')),
  bom_version_id uuid references public.product_bom_versions(id) on delete set null,   -- estrutura de fabricação à qual esta revisão se refere (quando já definida)
  brand_model_version_code text,
  cat_number text,
  cct_number text,
  cct_valid_until date,
  technical_responsible text,
  revised_at date,
  notes text,
  validated_by text,
  validated_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, revision)
);
create unique index if not exists product_engineering_revisions_validated_uidx on public.product_engineering_revisions (product_id) where status = 'Validada';

create table if not exists public.product_engineering_documents (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.product_engineering_revisions(id) on delete restrict,
  product_id uuid not null references public.materials(id) on delete restrict,
  kind text not null check (kind in ('Desenho tecnico', 'CCT', 'CAT', 'Memorial descritivo', 'Fotografia', 'CAD', 'Outro')),
  name text not null,
  file_path text,                       -- arquivo guardado em área privada; pode ficar vazio até a pessoa anexar o original
  document_number text,
  issuer text,
  issued_at date,
  valid_until date,
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists product_engineering_documents_revision_idx on public.product_engineering_documents (revision_id);

-- ================================================================ 2. Parâmetros, fontes documentais e pendências de engenharia
create table if not exists public.product_parameters (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.product_engineering_revisions(id) on delete restrict,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null,
  unit text not null default 'mm',
  scope text not null default 'nao_declarada' check (scope in ('externa', 'util', 'interna', 'referencia', 'nao_declarada')),
  configurable boolean not null default false,      -- o vendedor escolhe o valor (dentro dos limites)
  integer_only boolean not null default false,
  step numeric,                                      -- incremento permitido (ex.: 50 mm)
  default_value numeric,
  adopted_min numeric,                               -- limites ADOTADOS pela engenharia (resolvem conflitos entre fontes)
  adopted_max numeric,
  adopted_fixed numeric,
  adoption_note text,
  adopted_by text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (revision_id, key)
);

create table if not exists public.product_parameter_sources (
  id uuid primary key default gen_random_uuid(),
  parameter_id uuid not null references public.product_parameters(id) on delete restrict,
  document_id uuid not null references public.product_engineering_documents(id) on delete restrict,
  min_value numeric,
  max_value numeric,
  fixed_value numeric,
  note text,
  created_at timestamptz not null default now(),
  check (min_value is not null or max_value is not null or fixed_value is not null)
);
create index if not exists product_parameter_sources_parameter_idx on public.product_parameter_sources (parameter_id);

create table if not exists public.product_engineering_issues (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.product_engineering_revisions(id) on delete restrict,
  parameter_key text,
  kind text not null check (kind in ('conflito_documental', 'dado_ausente', 'outro')),
  description text not null,
  status text not null default 'Aberta' check (status in ('Aberta', 'Resolvida')),
  resolution text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists product_engineering_issues_open_uidx on public.product_engineering_issues (revision_id, coalesce(parameter_key, ''), kind) where status = 'Aberta';

-- ================================================================ 3. Opções comerciais, regras de compatibilidade, fórmulas e modelo de desenho
create table if not exists public.product_options (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.product_engineering_revisions(id) on delete restrict,
  option_group text not null check (option_group in ('acabamento', 'acessorio')),
  code text not null check (code ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null,
  price_delta numeric(14,2) not null default 0,
  cost_delta numeric(14,2) not null default 0,       -- acabamento/serviço terceirizado (custo fora dos kits)
  kit_id uuid references public.materials(id) on delete restrict,
  kit_quantity numeric(14,4) not null default 1 check (kit_quantity > 0),
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (revision_id, option_group, code)
);

create table if not exists public.product_configuration_rules (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.product_engineering_revisions(id) on delete restrict,
  code text not null,
  kind text not null check (kind in ('bloqueia', 'exige')),   -- bloqueia: se a condição for verdadeira, recusa; exige: a condição precisa ser verdadeira
  expr jsonb not null,
  expr_text text,
  message text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (revision_id, code)
);

create table if not exists public.product_formulas (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.product_engineering_revisions(id) on delete restrict,
  kit_id uuid not null references public.materials(id) on delete restrict,
  material_id uuid not null references public.materials(id) on delete restrict,
  label text,
  expr jsonb not null,
  expr_text text,
  unit text not null,
  loss_percent numeric(6,3) not null default 0 check (loss_percent >= 0 and loss_percent < 100),
  rounding text not null default 'nenhum' check (rounding in ('nenhum', 'cima', 'baixo', 'multiplo')),
  rounding_step numeric check (rounding_step is null or rounding_step > 0),
  cut_rule jsonb,                                   -- {"bar_length": 6000, "pieces": [{"label":"...","length": <expr>,"count": <expr>}]}
  status text not null default 'Rascunho' check (status in ('Rascunho', 'Aprovada', 'Obsoleta')),
  version integer not null default 1,
  approved_by text,
  approved_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create unique index if not exists product_formulas_active_uidx on public.product_formulas (revision_id, kit_id, material_id) where status <> 'Obsoleta';

create table if not exists public.product_drawing_templates (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.product_engineering_revisions(id) on delete restrict,
  template_key text not null,                       -- família de geometria desenhada pelo sistema (ver lib/trailer-drawing.ts)
  template_version integer not null default 1,
  grade text not null default 'ilustrativo' check (grade in ('ilustrativo', 'validado')),
  geometry jsonb not null default '{}'::jsonb,
  source_document_id uuid references public.product_engineering_documents(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  unique (revision_id)
);

-- Revisão validada ou obsoleta é imutável (inclusive seus documentos, parâmetros, opções, regras, fórmulas e desenho): mudança = nova revisão.
create or replace function public.eng_children_guard()
returns trigger
language plpgsql
as $$
declare
  v_rev uuid;
  v_status text;
begin
  if tg_table_name = 'product_parameter_sources' then
    select revision_id into v_rev from public.product_parameters where id = case when tg_op = 'DELETE' then old.parameter_id else new.parameter_id end;
  elsif tg_op = 'DELETE' then
    v_rev := old.revision_id;
  else
    v_rev := new.revision_id;
  end if;
  select status into v_status from public.product_engineering_revisions where id = v_rev;
  if v_status in ('Validada', 'Obsoleta') then
    raise exception 'A revisão de engenharia está % e não pode ser alterada: crie uma nova revisão.', lower(v_status);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
do $$
declare
  t text;
begin
  foreach t in array array['product_engineering_documents', 'product_parameters', 'product_parameter_sources', 'product_options', 'product_configuration_rules', 'product_formulas', 'product_drawing_templates'] loop
    execute format('drop trigger if exists trg_%I_guard on public.%I', t, t);
    execute format('create trigger trg_%I_guard before insert or update or delete on public.%I for each row execute function public.eng_children_guard()', t, t);
  end loop;
end;
$$;

create or replace function public.eng_revision_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Revisões de engenharia não são apagadas: marque como obsoleta.';
  end if;
  if old.status in ('Validada', 'Obsoleta') and (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
    raise exception 'A revisão % está % e não pode ser alterada.', old.revision, lower(old.status);
  end if;
  if old.status = 'Obsoleta' and new.status <> 'Obsoleta' then
    raise exception 'Revisão obsoleta não volta a valer.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_eng_revision_guard on public.product_engineering_revisions;
create trigger trg_eng_revision_guard before update or delete on public.product_engineering_revisions for each row execute function public.eng_revision_guard();

-- ================================================================ 4. Motor de expressões SEGURO (somente operações e funções da lista; nenhum código do usuário é executado)
-- Nós: {"n": 1500} número | {"s": "x"} texto | {"p": "comprimento"} parâmetro | {"op": "+", "a": .., "b": ..} | {"op": "not", "a": ..} | {"fn": "ceil", "args": [..]} | {"if": .., "then": .., "else": ..}
create or replace function public.eng_num(p_value jsonb)
returns numeric
language plpgsql
immutable
as $$
begin
  if jsonb_typeof(p_value) <> 'number' then
    raise exception 'A expressão esperava um número, mas recebeu %.', coalesce(jsonb_typeof(p_value), 'nulo');
  end if;
  return (p_value #>> '{}')::numeric;
end;
$$;

create or replace function public.eng_eval(p_node jsonb, p_vars jsonb, p_depth integer default 0)
returns jsonb
language plpgsql
stable
as $$
declare
  v_op text;
  v_fn text;
  v_a jsonb;
  v_b jsonb;
  v_x numeric;
  v_y numeric;
  v_args jsonb;
  v_n integer;
  v_result numeric;
  v_item jsonb;
begin
  if p_depth > 25 then
    raise exception 'Expressão profunda demais (limite de 25 níveis).';
  end if;
  if p_node is null then
    raise exception 'Expressão vazia.';
  end if;
  if jsonb_typeof(p_node) <> 'object' then
    raise exception 'Nó de expressão inválido.';
  end if;
  if p_node ? 'n' then
    return to_jsonb((p_node->>'n')::numeric);
  elsif p_node ? 's' then
    return to_jsonb(p_node->>'s');
  elsif p_node ? 'p' then
    if not (coalesce(p_vars, '{}'::jsonb) ? (p_node->>'p')) then
      raise exception 'Parâmetro desconhecido na expressão: %.', p_node->>'p';
    end if;
    return p_vars->(p_node->>'p');
  elsif p_node ? 'if' then
    v_a := public.eng_eval(p_node->'if', p_vars, p_depth + 1);
    if jsonb_typeof(v_a) <> 'boolean' then
      raise exception 'A condição do "se" precisa ser verdadeira ou falsa.';
    end if;
    return case when v_a = 'true'::jsonb then public.eng_eval(p_node->'then', p_vars, p_depth + 1) else public.eng_eval(p_node->'else', p_vars, p_depth + 1) end;
  elsif p_node ? 'fn' then
    v_fn := p_node->>'fn';
    v_args := coalesce(p_node->'args', '[]'::jsonb);
    v_n := jsonb_array_length(v_args);
    if v_fn in ('ceil', 'floor', 'abs') and v_n = 1 then
      v_x := public.eng_num(public.eng_eval(v_args->0, p_vars, p_depth + 1));
      return to_jsonb(case v_fn when 'ceil' then ceil(v_x) when 'floor' then floor(v_x) else abs(v_x) end);
    elsif v_fn = 'round' and v_n in (1, 2) then
      v_x := public.eng_num(public.eng_eval(v_args->0, p_vars, p_depth + 1));
      v_y := case when v_n = 2 then public.eng_num(public.eng_eval(v_args->1, p_vars, p_depth + 1)) else 0 end;
      return to_jsonb(round(v_x, v_y::integer));
    elsif v_fn in ('max', 'min') and v_n >= 2 and v_n <= 8 then
      v_result := null;
      for v_item in select * from jsonb_array_elements(v_args) loop
        v_x := public.eng_num(public.eng_eval(v_item, p_vars, p_depth + 1));
        v_result := case when v_result is null then v_x when v_fn = 'max' then greatest(v_result, v_x) else least(v_result, v_x) end;
      end loop;
      return to_jsonb(v_result);
    end if;
    raise exception 'Função não permitida ou com número de argumentos inválido: %.', v_fn;
  elsif p_node ? 'op' then
    v_op := p_node->>'op';
    if v_op = 'not' then
      v_a := public.eng_eval(p_node->'a', p_vars, p_depth + 1);
      if jsonb_typeof(v_a) <> 'boolean' then
        raise exception 'O "não" exige uma condição verdadeira ou falsa.';
      end if;
      return to_jsonb(v_a <> 'true'::jsonb);
    end if;
    v_a := public.eng_eval(p_node->'a', p_vars, p_depth + 1);
    if v_op in ('and', 'or') then
      if jsonb_typeof(v_a) <> 'boolean' then
        raise exception 'Operador "%" exige condições verdadeiras ou falsas.', v_op;
      end if;
      if v_op = 'and' and v_a = 'false'::jsonb then return v_a; end if;
      if v_op = 'or' and v_a = 'true'::jsonb then return v_a; end if;
      v_b := public.eng_eval(p_node->'b', p_vars, p_depth + 1);
      if jsonb_typeof(v_b) <> 'boolean' then
        raise exception 'Operador "%" exige condições verdadeiras ou falsas.', v_op;
      end if;
      return v_b;
    end if;
    v_b := public.eng_eval(p_node->'b', p_vars, p_depth + 1);
    if v_op in ('==', '!=') then
      return to_jsonb(case v_op when '==' then v_a = v_b else v_a <> v_b end);
    end if;
    v_x := public.eng_num(v_a);
    v_y := public.eng_num(v_b);
    if v_op = '+' then return to_jsonb(v_x + v_y);
    elsif v_op = '-' then return to_jsonb(v_x - v_y);
    elsif v_op = '*' then return to_jsonb(v_x * v_y);
    elsif v_op = '/' then
      if v_y = 0 then
        raise exception 'Divisão por zero na expressão.';
      end if;
      return to_jsonb(v_x / v_y);
    elsif v_op = '<' then return to_jsonb(v_x < v_y);
    elsif v_op = '<=' then return to_jsonb(v_x <= v_y);
    elsif v_op = '>' then return to_jsonb(v_x > v_y);
    elsif v_op = '>=' then return to_jsonb(v_x >= v_y);
    end if;
    raise exception 'Operador não permitido: %.', v_op;
  end if;
  raise exception 'Nó de expressão desconhecido.';
end;
$$;

-- Valida a estrutura (só nós, operadores e funções permitidos; tamanho limitado) e devolve os parâmetros usados.
create or replace function public.eng_expr_params(p_node jsonb, p_depth integer default 0)
returns text[]
language plpgsql
immutable
as $$
declare
  v_result text[] := '{}';
  v_item jsonb;
  v_fn text;
  v_op text;
begin
  if p_depth > 25 then
    raise exception 'Expressão profunda demais (limite de 25 níveis).';
  end if;
  if p_depth = 0 and length(p_node::text) > 6000 then
    raise exception 'Expressão grande demais.';
  end if;
  if p_node is null or jsonb_typeof(p_node) <> 'object' then
    raise exception 'Nó de expressão inválido.';
  end if;
  if p_node ? 'n' then
    return v_result;
  elsif p_node ? 's' then
    return v_result;
  elsif p_node ? 'p' then
    if (p_node->>'p') !~ '^[a-z][a-z0-9_]{0,39}$' then
      raise exception 'Nome de parâmetro inválido: %.', p_node->>'p';
    end if;
    return array[p_node->>'p'];
  elsif p_node ? 'if' then
    return public.eng_expr_params(p_node->'if', p_depth + 1) || public.eng_expr_params(p_node->'then', p_depth + 1) || public.eng_expr_params(p_node->'else', p_depth + 1);
  elsif p_node ? 'fn' then
    v_fn := p_node->>'fn';
    if v_fn not in ('ceil', 'floor', 'abs', 'round', 'max', 'min') then
      raise exception 'Função não permitida: %.', v_fn;
    end if;
    for v_item in select * from jsonb_array_elements(coalesce(p_node->'args', '[]'::jsonb)) loop
      v_result := v_result || public.eng_expr_params(v_item, p_depth + 1);
    end loop;
    return v_result;
  elsif p_node ? 'op' then
    v_op := p_node->>'op';
    if v_op not in ('+', '-', '*', '/', '==', '!=', '<', '<=', '>', '>=', 'and', 'or', 'not') then
      raise exception 'Operador não permitido: %.', v_op;
    end if;
    return public.eng_expr_params(p_node->'a', p_depth + 1) || case when v_op = 'not' then '{}'::text[] else public.eng_expr_params(p_node->'b', p_depth + 1) end;
  end if;
  raise exception 'Nó de expressão desconhecido.';
end;
$$;

-- Plano de cortes (primeiro encaixe decrescente): barras necessárias e sobra. Só usa dados da regra de corte aprovada.
create or replace function public.eng_cut_plan(p_rule jsonb, p_vars jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_bar numeric := (p_rule->>'bar_length')::numeric;
  v_kerf numeric := coalesce((p_rule->>'kerf')::numeric, 0);
  v_piece jsonb;
  v_pieces jsonb := '[]'::jsonb;
  v_len numeric;
  v_count integer;
  v_i integer;
  v_lengths numeric[] := '{}';
  v_bars numeric[] := '{}';
  v_placed boolean;
  v_idx integer;
  v_total numeric := 0;
begin
  if v_bar is null or v_bar <= 0 then
    raise exception 'A regra de corte precisa do comprimento da barra.';
  end if;
  for v_piece in select * from jsonb_array_elements(coalesce(p_rule->'pieces', '[]'::jsonb)) loop
    v_len := public.eng_num(public.eng_eval(v_piece->'length', p_vars));
    v_count := public.eng_num(public.eng_eval(v_piece->'count', p_vars))::integer;
    if v_len <= 0 or v_count < 0 then
      raise exception 'Peça "%" com medida ou quantidade inválida no plano de corte.', v_piece->>'label';
    end if;
    if v_len + v_kerf > v_bar then
      raise exception 'A peça "%" (% mm) não cabe na barra de % mm.', v_piece->>'label', v_len, v_bar;
    end if;
    v_pieces := v_pieces || jsonb_build_object('label', v_piece->>'label', 'length_mm', v_len, 'count', v_count);
    for v_i in 1..v_count loop
      v_lengths := v_lengths || v_len;
    end loop;
    v_total := v_total + v_len * v_count;
  end loop;
  -- ordena decrescente
  select coalesce(array_agg(x order by x desc), '{}') into v_lengths from unnest(v_lengths) x;
  foreach v_len in array v_lengths loop
    v_placed := false;
    for v_idx in 1..coalesce(array_length(v_bars, 1), 0) loop
      if v_bars[v_idx] >= v_len + v_kerf then
        v_bars[v_idx] := v_bars[v_idx] - v_len - v_kerf;
        v_placed := true;
        exit;
      end if;
    end loop;
    if not v_placed then
      v_bars := v_bars || (v_bar - v_len - v_kerf);
    end if;
  end loop;
  return jsonb_build_object('bar_length_mm', v_bar, 'pieces', v_pieces, 'bars', coalesce(array_length(v_bars, 1), 0),
    'waste_mm', coalesce((select sum(x) from unnest(v_bars) x), 0), 'used_mm', v_total);
end;
$$;

-- ================================================================ 5. Revisão: criação, pendências, validação (publicação)
create or replace function public.eng_revision_save(p jsonb, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_id uuid := nullif(p->>'revision_id', '')::uuid;
  v_product uuid := nullif(p->>'product_id', '')::uuid;
  v_label text := btrim(coalesce(p->>'revision', ''));
  v_row public.product_engineering_revisions%rowtype;
begin
  if v_id is null then
    if v_product is null or not exists (select 1 from public.materials where id = v_product and item_type = 'Produto') then
      raise exception 'Produto não encontrado.';
    end if;
    if v_label = '' then
      select 'R' || (count(*) + 1) into v_label from public.product_engineering_revisions where product_id = v_product;
    end if;
    begin
      insert into public.product_engineering_revisions (product_id, revision, bom_version_id, brand_model_version_code, cat_number, cct_number, cct_valid_until, technical_responsible, revised_at, notes, created_by)
      values (v_product, v_label, nullif(p->>'bom_version_id', '')::uuid, nullif(btrim(p->>'brand_model_version_code'), ''), nullif(btrim(p->>'cat_number'), ''), nullif(btrim(p->>'cct_number'), ''),
              nullif(p->>'cct_valid_until', '')::date, nullif(btrim(p->>'technical_responsible'), ''), nullif(p->>'revised_at', '')::date, nullif(btrim(p->>'notes'), ''), coalesce(p_user, public.request_actor()))
      returning * into v_row;
    exception when unique_violation then
      raise exception 'Já existe a revisão % deste produto.', v_label;
    end;
  else
    update public.product_engineering_revisions set
      bom_version_id = case when p ? 'bom_version_id' then nullif(p->>'bom_version_id', '')::uuid else bom_version_id end,
      brand_model_version_code = case when p ? 'brand_model_version_code' then nullif(btrim(p->>'brand_model_version_code'), '') else brand_model_version_code end,
      cat_number = case when p ? 'cat_number' then nullif(btrim(p->>'cat_number'), '') else cat_number end,
      cct_number = case when p ? 'cct_number' then nullif(btrim(p->>'cct_number'), '') else cct_number end,
      cct_valid_until = case when p ? 'cct_valid_until' then nullif(p->>'cct_valid_until', '')::date else cct_valid_until end,
      technical_responsible = case when p ? 'technical_responsible' then nullif(btrim(p->>'technical_responsible'), '') else technical_responsible end,
      revised_at = case when p ? 'revised_at' then nullif(p->>'revised_at', '')::date else revised_at end,
      notes = case when p ? 'notes' then nullif(btrim(p->>'notes'), '') else notes end,
      updated_at = now()
    where id = v_id returning * into v_row;
    if not found then
      raise exception 'Revisão de engenharia não encontrada.';
    end if;
  end if;
  return to_jsonb(v_row);
end;
$$;

create or replace function public.eng_document_add(p jsonb, p_user text default null)
returns uuid
language plpgsql
as $$
declare
  v_rev public.product_engineering_revisions%rowtype;
  v_id uuid := gen_random_uuid();
begin
  select * into v_rev from public.product_engineering_revisions where id = (p->>'revision_id')::uuid;
  if not found then
    raise exception 'Revisão de engenharia não encontrada.';
  end if;
  if coalesce(btrim(p->>'name'), '') = '' then
    raise exception 'Informe o nome do documento.';
  end if;
  insert into public.product_engineering_documents (id, revision_id, product_id, kind, name, file_path, document_number, issuer, issued_at, valid_until, notes, created_by)
  values (v_id, v_rev.id, v_rev.product_id, p->>'kind', btrim(p->>'name'), nullif(p->>'file_path', ''), nullif(btrim(p->>'document_number'), ''), nullif(btrim(p->>'issuer'), ''),
          nullif(p->>'issued_at', '')::date, nullif(p->>'valid_until', '')::date, nullif(btrim(p->>'notes'), ''), coalesce(p_user, public.request_actor()));
  return v_id;
end;
$$;

-- Anexa o arquivo original a um documento já cadastrado (só enquanto a revisão está em rascunho/validação).
create or replace function public.eng_document_attach(p_document uuid, p_path text)
returns void
language plpgsql
as $$
begin
  update public.product_engineering_documents set file_path = p_path where id = p_document;
  if not found then
    raise exception 'Documento não encontrado.';
  end if;
end;
$$;

create or replace function public.eng_parameter_save(p jsonb, p_user text default null)
returns uuid
language plpgsql
as $$
declare
  v_rev uuid := (p->>'revision_id')::uuid;
  v_id uuid := nullif(p->>'parameter_id', '')::uuid;
  v_source jsonb;
begin
  if not exists (select 1 from public.product_engineering_revisions where id = v_rev) then
    raise exception 'Revisão de engenharia não encontrada.';
  end if;
  if v_id is null then
    insert into public.product_parameters (revision_id, key, label, unit, scope, configurable, integer_only, step, default_value, position)
    values (v_rev, p->>'key', btrim(p->>'label'), coalesce(nullif(btrim(p->>'unit'), ''), 'mm'), coalesce(nullif(p->>'scope', ''), 'nao_declarada'), coalesce((p->>'configurable')::boolean, false),
            coalesce((p->>'integer_only')::boolean, false), nullif(p->>'step', '')::numeric, nullif(p->>'default_value', '')::numeric, coalesce(nullif(p->>'position', '')::integer, 0))
    returning id into v_id;
  else
    update public.product_parameters set label = coalesce(nullif(btrim(p->>'label'), ''), label), unit = coalesce(nullif(btrim(p->>'unit'), ''), unit), scope = coalesce(nullif(p->>'scope', ''), scope),
      configurable = coalesce((p->>'configurable')::boolean, configurable), integer_only = coalesce((p->>'integer_only')::boolean, integer_only),
      step = case when p ? 'step' then nullif(p->>'step', '')::numeric else step end, default_value = case when p ? 'default_value' then nullif(p->>'default_value', '')::numeric else default_value end
    where id = v_id and revision_id = v_rev;
    if not found then
      raise exception 'Parâmetro não encontrado.';
    end if;
  end if;
  if p ? 'sources' and jsonb_typeof(p->'sources') = 'array' then
    delete from public.product_parameter_sources where parameter_id = v_id;
    for v_source in select * from jsonb_array_elements(p->'sources') loop
      if not exists (select 1 from public.product_engineering_documents where id = (v_source->>'document_id')::uuid and revision_id = v_rev) then
        raise exception 'Cada limite precisa apontar para um documento desta revisão (fonte documental).';
      end if;
      insert into public.product_parameter_sources (parameter_id, document_id, min_value, max_value, fixed_value, note)
      values (v_id, (v_source->>'document_id')::uuid, nullif(v_source->>'min', '')::numeric, nullif(v_source->>'max', '')::numeric, nullif(v_source->>'fixed', '')::numeric, nullif(btrim(v_source->>'note'), ''));
    end loop;
  end if;
  return v_id;
end;
$$;

create or replace function public.eng_option_save(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  if p->>'option_group' not in ('acabamento', 'acessorio') then
    raise exception 'Grupo de opção inválido.';
  end if;
  insert into public.product_options (revision_id, option_group, code, label, price_delta, cost_delta, kit_id, kit_quantity, is_default, active)
  values ((p->>'revision_id')::uuid, p->>'option_group', p->>'code', btrim(p->>'label'), coalesce(nullif(p->>'price_delta', '')::numeric, 0), coalesce(nullif(p->>'cost_delta', '')::numeric, 0),
          nullif(p->>'kit_id', '')::uuid, coalesce(nullif(p->>'kit_quantity', '')::numeric, 1), coalesce((p->>'is_default')::boolean, false), coalesce((p->>'active')::boolean, true))
  on conflict (revision_id, option_group, code) do update set label = excluded.label, price_delta = excluded.price_delta, cost_delta = excluded.cost_delta, kit_id = excluded.kit_id,
    kit_quantity = excluded.kit_quantity, is_default = excluded.is_default, active = excluded.active
  returning id into v_id;
  if p->>'option_group' = 'acabamento' and coalesce((p->>'is_default')::boolean, false) then
    update public.product_options set is_default = false where revision_id = (p->>'revision_id')::uuid and option_group = 'acabamento' and id <> v_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.eng_rule_save(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  perform public.eng_expr_params(p->'expr');
  insert into public.product_configuration_rules (revision_id, code, kind, expr, expr_text, message, active)
  values ((p->>'revision_id')::uuid, p->>'code', p->>'kind', p->'expr', p->>'expr_text', btrim(p->>'message'), coalesce((p->>'active')::boolean, true))
  on conflict (revision_id, code) do update set kind = excluded.kind, expr = excluded.expr, expr_text = excluded.expr_text, message = excluded.message, active = excluded.active
  returning id into v_id;
  return v_id;
end;
$$;

-- Fórmula de quantidade: nasce como rascunho; só a engenharia aprova (e aprovada não muda: nova versão).
create or replace function public.eng_formula_save(p jsonb, p_user text default null)
returns uuid
language plpgsql
as $$
declare
  v_rev uuid := (p->>'revision_id')::uuid;
  v_kit uuid := (p->>'kit_id')::uuid;
  v_material uuid := (p->>'material_id')::uuid;
  v_existing public.product_formulas%rowtype;
  v_id uuid;
  v_version integer := 1;
begin
  perform public.eng_expr_params(p->'expr');
  if p->'cut_rule' is not null and jsonb_typeof(p->'cut_rule') = 'object' then
    perform public.eng_expr_params(piece->'length') from jsonb_array_elements(coalesce(p->'cut_rule'->'pieces', '[]'::jsonb)) piece;
    perform public.eng_expr_params(piece->'count') from jsonb_array_elements(coalesce(p->'cut_rule'->'pieces', '[]'::jsonb)) piece;
  end if;
  if not exists (select 1 from public.kit_components c join public.kit_versions v on v.id = c.kit_version_id where v.kit_id = v_kit and c.component_id = v_material) then
    raise exception 'A matéria-prima não faz parte do kit informado: fórmula só substitui a quantidade de um componente existente do kit.';
  end if;
  select * into v_existing from public.product_formulas where revision_id = v_rev and kit_id = v_kit and material_id = v_material and status <> 'Obsoleta';
  if found then
    if v_existing.status = 'Aprovada' then
      update public.product_formulas set status = 'Obsoleta' where id = v_existing.id;   -- nova versão; a anterior fica guardada
      v_version := v_existing.version + 1;
    else
      delete from public.product_formulas where id = v_existing.id;
      v_version := v_existing.version;
    end if;
  end if;
  insert into public.product_formulas (revision_id, kit_id, material_id, label, expr, expr_text, unit, loss_percent, rounding, rounding_step, cut_rule, version, created_by)
  values (v_rev, v_kit, v_material, nullif(btrim(p->>'label'), ''), p->'expr', p->>'expr_text', upper(btrim(p->>'unit')), coalesce(nullif(p->>'loss_percent', '')::numeric, 0),
          coalesce(nullif(p->>'rounding', ''), 'nenhum'), nullif(p->>'rounding_step', '')::numeric, case when jsonb_typeof(p->'cut_rule') = 'object' then p->'cut_rule' end, v_version, coalesce(p_user, public.request_actor()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.eng_formula_approve(p_formula uuid, p_user text)
returns void
language plpgsql
as $$
declare
  v_f public.product_formulas%rowtype;
  v_vars jsonb := '{}'::jsonb;
  v_par record;
  v_value jsonb;
begin
  select * into v_f from public.product_formulas where id = p_formula for update;
  if not found then
    raise exception 'Fórmula não encontrada.';
  end if;
  if v_f.status <> 'Rascunho' then
    raise exception 'A fórmula está %.', lower(v_f.status);
  end if;
  if coalesce(btrim(p_user), '') = '' then
    raise exception 'Informe quem aprova a fórmula.';
  end if;
  -- teste de validação com os valores padrão da revisão: precisa dar número não negativo
  for v_par in select key, coalesce(default_value, adopted_fixed, adopted_min) as v from public.product_parameters where revision_id = v_f.revision_id loop
    if v_par.v is not null then
      v_vars := v_vars || jsonb_build_object(v_par.key, v_par.v);
    end if;
  end loop;
  v_value := public.eng_eval(v_f.expr, v_vars);
  if jsonb_typeof(v_value) <> 'number' or public.eng_num(v_value) < 0 then
    raise exception 'A fórmula precisa resultar em um número maior ou igual a zero (resultado do teste: %).', v_value;
  end if;
  update public.product_formulas set status = 'Aprovada', approved_by = p_user, approved_at = now() where id = p_formula;
end;
$$;

create or replace function public.eng_template_save(p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
begin
  insert into public.product_drawing_templates (revision_id, template_key, template_version, grade, geometry, source_document_id, notes)
  values ((p->>'revision_id')::uuid, p->>'template_key', coalesce(nullif(p->>'template_version', '')::integer, 1), coalesce(nullif(p->>'grade', ''), 'ilustrativo'), coalesce(p->'geometry', '{}'::jsonb),
          nullif(p->>'source_document_id', '')::uuid, nullif(btrim(p->>'notes'), ''))
  on conflict (revision_id) do update set template_key = excluded.template_key, template_version = excluded.template_version, grade = excluded.grade, geometry = excluded.geometry,
    source_document_id = excluded.source_document_id, notes = excluded.notes
  returning id into v_id;
  return v_id;
end;
$$;

-- Conflitos entre fontes documentais: abre uma pendência de engenharia por parâmetro conflitante (idempotente) e NUNCA escolhe um dos valores sozinha.
create or replace function public.eng_revision_conflicts(p_revision uuid)
returns table (parameter_key text, label text, field text, values_found numeric[], documents text[])
language sql
stable
as $$
  with src as (
    select p.key, p.label, s.min_value, s.max_value, s.fixed_value, d.kind || coalesce(' ' || d.document_number, '') as doc
    from public.product_parameters p join public.product_parameter_sources s on s.parameter_id = p.id join public.product_engineering_documents d on d.id = s.document_id
    where p.revision_id = p_revision
  )
  select key, label, 'mínimo', array_agg(distinct min_value order by min_value), array_agg(distinct doc) from src where min_value is not null group by key, label having count(distinct min_value) > 1
  union all
  select key, label, 'máximo', array_agg(distinct max_value order by max_value), array_agg(distinct doc) from src where max_value is not null group by key, label having count(distinct max_value) > 1
  union all
  select key, label, 'valor fixo', array_agg(distinct fixed_value order by fixed_value), array_agg(distinct doc) from src where fixed_value is not null group by key, label having count(distinct fixed_value) > 1
$$;

create or replace function public.eng_revision_detect_issues(p_revision uuid, p_user text default null)
returns integer
language plpgsql
as $$
declare
  v_row record;
  v_count integer := 0;
  v_rows integer;
begin
  for v_row in select c.* from public.eng_revision_conflicts(p_revision) c join public.product_parameters pp on pp.revision_id = p_revision and pp.key = c.parameter_key
               where pp.adopted_min is null and pp.adopted_max is null and pp.adopted_fixed is null loop
    insert into public.product_engineering_issues (revision_id, parameter_key, kind, description)
    values (p_revision, v_row.parameter_key, 'conflito_documental',
            'Conflito no ' || v_row.field || ' de "' || v_row.label || '": ' || array_to_string(v_row.values_found, ' x ') || ' (fontes: ' || array_to_string(v_row.documents, '; ') || '). A engenharia precisa decidir qual vale.')
    on conflict (revision_id, coalesce(parameter_key, ''), kind) where status = 'Aberta' do nothing;
    get diagnostics v_rows = row_count;
    v_count := v_count + v_rows;
  end loop;
  -- conflito que deixou de existir (fonte corrigida) fecha a pendência correspondente
  update public.product_engineering_issues i set status = 'Resolvida', resolution = 'Conflito não existe mais nas fontes cadastradas.', resolved_by = coalesce(p_user, public.request_actor()), resolved_at = now()
  where i.revision_id = p_revision and i.status = 'Aberta' and i.kind = 'conflito_documental'
    and not exists (select 1 from public.eng_revision_conflicts(p_revision) c where c.parameter_key = i.parameter_key);
  return v_count;
end;
$$;

-- Decisão da engenharia: adota os limites oficiais do parâmetro (com justificativa) e resolve a pendência.
create or replace function public.eng_issue_resolve(p jsonb, p_user text)
returns void
language plpgsql
as $$
declare
  v_issue public.product_engineering_issues%rowtype;
begin
  select * into v_issue from public.product_engineering_issues where id = (p->>'issue_id')::uuid for update;
  if not found then
    raise exception 'Pendência não encontrada.';
  end if;
  if coalesce(btrim(p->>'resolution'), '') = '' or coalesce(btrim(p_user), '') = '' then
    raise exception 'Informe a decisão e quem decide.';
  end if;
  if (select status from public.product_engineering_revisions where id = v_issue.revision_id) in ('Validada', 'Obsoleta') then
    raise exception 'A revisão já foi encerrada.';
  end if;
  if v_issue.parameter_key is not null and (p ? 'adopted_min' or p ? 'adopted_max' or p ? 'adopted_fixed') then
    update public.product_parameters set adopted_min = nullif(p->>'adopted_min', '')::numeric, adopted_max = nullif(p->>'adopted_max', '')::numeric, adopted_fixed = nullif(p->>'adopted_fixed', '')::numeric,
           adoption_note = p->>'resolution', adopted_by = p_user where revision_id = v_issue.revision_id and key = v_issue.parameter_key;
  end if;
  update public.product_engineering_issues set status = 'Resolvida', resolution = p->>'resolution', resolved_by = p_user, resolved_at = now() where id = v_issue.id;
end;
$$;

create or replace function public.eng_revision_submit(p_revision uuid, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_rev public.product_engineering_revisions%rowtype;
  v_opened integer;
begin
  select * into v_rev from public.product_engineering_revisions where id = p_revision for update;
  if not found then
    raise exception 'Revisão de engenharia não encontrada.';
  end if;
  if v_rev.status <> 'Rascunho' then
    raise exception 'A revisão está %.', lower(v_rev.status);
  end if;
  v_opened := public.eng_revision_detect_issues(p_revision, p_user);
  update public.product_engineering_revisions set status = 'Em validacao', updated_at = now() where id = p_revision;
  return jsonb_build_object('status', 'Em validacao', 'issues_opened', v_opened, 'open_issues', (select count(*) from public.product_engineering_issues where revision_id = p_revision and status = 'Aberta'));
end;
$$;

create or replace function public.eng_revision_back_to_draft(p_revision uuid)
returns void
language plpgsql
as $$
begin
  update public.product_engineering_revisions set status = 'Rascunho', updated_at = now() where id = p_revision and status = 'Em validacao';
  if not found then
    raise exception 'Só uma revisão em validação volta para rascunho.';
  end if;
end;
$$;

-- Publica a revisão como VALIDADA: exige responsável técnico, pendências resolvidas, limites adotados nos parâmetros conflitantes e ao menos um parâmetro configurável.
-- Uma revisão validada anterior do mesmo produto fica obsoleta (guardada, nunca apagada).
create or replace function public.eng_revision_validate(p_revision uuid, p_user text)
returns jsonb
language plpgsql
as $$
declare
  v_rev public.product_engineering_revisions%rowtype;
  v_open integer;
  v_conflict record;
  v_par record;
  v_min numeric;
  v_max numeric;
  v_fixed numeric;
begin
  select * into v_rev from public.product_engineering_revisions where id = p_revision for update;
  if not found then
    raise exception 'Revisão de engenharia não encontrada.';
  end if;
  if v_rev.status not in ('Rascunho', 'Em validacao') then
    raise exception 'A revisão está %.', lower(v_rev.status);
  end if;
  if coalesce(btrim(p_user), '') = '' then
    raise exception 'Informe quem valida.';
  end if;
  if coalesce(btrim(v_rev.technical_responsible), '') = '' then
    raise exception 'Informe o responsável técnico da revisão antes de validar.';
  end if;
  perform public.eng_revision_detect_issues(p_revision, p_user);
  select count(*) into v_open from public.product_engineering_issues where revision_id = p_revision and status = 'Aberta';
  if v_open > 0 then
    raise exception 'Há % pendência(s) de engenharia em aberto: resolva (decida os limites) antes de validar.', v_open;
  end if;
  for v_conflict in select * from public.eng_revision_conflicts(p_revision) loop
    if not exists (select 1 from public.product_parameters where revision_id = p_revision and key = v_conflict.parameter_key and (adopted_min is not null or adopted_max is not null or adopted_fixed is not null)) then
      raise exception 'O parâmetro "%" tem fontes em conflito e ainda não tem limite adotado pela engenharia.', v_conflict.label;
    end if;
  end loop;
  if not exists (select 1 from public.product_parameters where revision_id = p_revision and configurable) then
    raise exception 'A revisão não tem nenhum parâmetro configurável.';
  end if;
  -- limites sem conflito: adota o valor comum das fontes
  for v_par in select * from public.product_parameters where revision_id = p_revision loop
    if v_par.adopted_min is null and v_par.adopted_max is null and v_par.adopted_fixed is null then
      select max(s.min_value), min(s.max_value), max(s.fixed_value) into v_min, v_max, v_fixed from public.product_parameter_sources s where s.parameter_id = v_par.id;
      if v_par.configurable and (v_min is null or v_max is null) then
        raise exception 'O parâmetro configurável "%" precisa de limite mínimo e máximo documentados.', v_par.label;
      end if;
      update public.product_parameters set adopted_min = v_min, adopted_max = v_max, adopted_fixed = v_fixed, adopted_by = p_user, adoption_note = 'Valor único das fontes documentais.' where id = v_par.id;
    end if;
  end loop;
  update public.product_engineering_revisions set status = 'Obsoleta', updated_at = now() where product_id = v_rev.product_id and status = 'Validada' and id <> p_revision;
  update public.product_engineering_revisions set status = 'Validada', validated_by = p_user, validated_at = now(), updated_at = now() where id = p_revision;
  return jsonb_build_object('status', 'Validada', 'validated_by', p_user);
end;
$$;

-- Revisão nova a partir da vigente (copia documentos, parâmetros, fontes, opções, regras, fórmulas aprovadas e desenho como RASCUNHO para a engenharia revisar).
create or replace function public.eng_revision_copy(p_revision uuid, p_label text default null, p_user text default null)
returns uuid
language plpgsql
as $$
declare
  v_old public.product_engineering_revisions%rowtype;
  v_new uuid := gen_random_uuid();
  v_label text;
  v_doc record;
  v_par record;
  v_newpar uuid;
  v_docmap jsonb := '{}'::jsonb;
  v_newdoc uuid;
begin
  select * into v_old from public.product_engineering_revisions where id = p_revision;
  if not found then
    raise exception 'Revisão de engenharia não encontrada.';
  end if;
  select coalesce(nullif(btrim(p_label), ''), 'R' || (count(*) + 1)) into v_label from public.product_engineering_revisions where product_id = v_old.product_id;
  insert into public.product_engineering_revisions (id, product_id, revision, bom_version_id, brand_model_version_code, cat_number, cct_number, cct_valid_until, technical_responsible, notes, created_by)
  values (v_new, v_old.product_id, v_label, v_old.bom_version_id, v_old.brand_model_version_code, v_old.cat_number, v_old.cct_number, v_old.cct_valid_until, v_old.technical_responsible,
          'Copiada da revisão ' || v_old.revision || '. Confira tudo antes de validar.', coalesce(p_user, public.request_actor()));
  for v_doc in select * from public.product_engineering_documents where revision_id = p_revision loop
    v_newdoc := gen_random_uuid();
    insert into public.product_engineering_documents (id, revision_id, product_id, kind, name, file_path, document_number, issuer, issued_at, valid_until, notes, created_by)
    values (v_newdoc, v_new, v_doc.product_id, v_doc.kind, v_doc.name, v_doc.file_path, v_doc.document_number, v_doc.issuer, v_doc.issued_at, v_doc.valid_until, v_doc.notes, coalesce(p_user, public.request_actor()));
    v_docmap := v_docmap || jsonb_build_object(v_doc.id::text, v_newdoc::text);
  end loop;
  for v_par in select * from public.product_parameters where revision_id = p_revision loop
    insert into public.product_parameters (revision_id, key, label, unit, scope, configurable, integer_only, step, default_value, adopted_min, adopted_max, adopted_fixed, adoption_note, adopted_by, position)
    values (v_new, v_par.key, v_par.label, v_par.unit, v_par.scope, v_par.configurable, v_par.integer_only, v_par.step, v_par.default_value, v_par.adopted_min, v_par.adopted_max, v_par.adopted_fixed, v_par.adoption_note, v_par.adopted_by, v_par.position)
    returning id into v_newpar;
    insert into public.product_parameter_sources (parameter_id, document_id, min_value, max_value, fixed_value, note)
    select v_newpar, (v_docmap->>s.document_id::text)::uuid, s.min_value, s.max_value, s.fixed_value, s.note from public.product_parameter_sources s where s.parameter_id = v_par.id;
  end loop;
  insert into public.product_options (revision_id, option_group, code, label, price_delta, cost_delta, kit_id, kit_quantity, is_default, active)
  select v_new, option_group, code, label, price_delta, cost_delta, kit_id, kit_quantity, is_default, active from public.product_options where revision_id = p_revision;
  insert into public.product_configuration_rules (revision_id, code, kind, expr, expr_text, message, active)
  select v_new, code, kind, expr, expr_text, message, active from public.product_configuration_rules where revision_id = p_revision;
  insert into public.product_formulas (revision_id, kit_id, material_id, label, expr, expr_text, unit, loss_percent, rounding, rounding_step, cut_rule, status, version, created_by)
  select v_new, kit_id, material_id, label, expr, expr_text, unit, loss_percent, rounding, rounding_step, cut_rule, 'Rascunho', version, coalesce(p_user, public.request_actor()) from public.product_formulas where revision_id = p_revision and status = 'Aprovada';
  insert into public.product_drawing_templates (revision_id, template_key, template_version, grade, geometry, source_document_id, notes)
  select v_new, template_key, template_version, 'ilustrativo', geometry, (v_docmap->>source_document_id::text)::uuid, notes from public.product_drawing_templates where revision_id = p_revision;
  return v_new;
end;
$$;

-- ================================================================ 6. Limites efetivos (adotados pela engenharia; sem adoção, a interseção CONSERVADORA das fontes)
create or replace function public.eng_effective_limits(p_revision uuid)
returns table (key text, label text, unit text, scope text, configurable boolean, integer_only boolean, step numeric, default_value numeric, min_value numeric, max_value numeric, fixed_value numeric,
               source text, in_conflict boolean, sort_pos integer)
language sql
stable
as $$
  select p.key, p.label, p.unit, p.scope, p.configurable, p.integer_only, p.step, p.default_value,
         coalesce(p.adopted_min, (select max(s.min_value) from public.product_parameter_sources s where s.parameter_id = p.id)),
         coalesce(p.adopted_max, (select min(s.max_value) from public.product_parameter_sources s where s.parameter_id = p.id)),
         coalesce(p.adopted_fixed, (select max(s.fixed_value) from public.product_parameter_sources s where s.parameter_id = p.id)),
         case when p.adopted_min is not null or p.adopted_max is not null or p.adopted_fixed is not null then 'adotado pela engenharia' else 'interseção conservadora das fontes (não validada)' end,
         exists (select 1 from public.eng_revision_conflicts(p_revision) c where c.parameter_key = p.key) and p.adopted_min is null and p.adopted_max is null and p.adopted_fixed is null,
         p.position
  from public.product_parameters p where p.revision_id = p_revision order by p.position, p.key
$$;

create or replace function public.eng_current_revision(p_product uuid)
returns uuid
language sql
stable
as $$
  select id from public.product_engineering_revisions where product_id = p_product and status <> 'Obsoleta' order by (status = 'Validada') desc, created_at desc limit 1
$$;

-- ================================================================ 7. Configuração do produto (orçamento -> pedido -> produção): vínculos e tabelas da EMPRESA
alter table public.sales_settings add column if not exists min_margin_percent numeric(6,2) not null default 0 check (min_margin_percent >= 0 and min_margin_percent < 100);

create table if not exists public.product_configurations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.materials(id) on delete restrict,
  revision_id uuid references public.product_engineering_revisions(id) on delete restrict,
  revision_label text,
  bom_version_id uuid references public.product_bom_versions(id) on delete restrict,
  bom_version integer,
  status text not null check (status in ('Valida', 'Requer analise tecnica', 'Fora dos limites', 'Invalida', 'Aprovada pela engenharia', 'Rejeitada pela engenharia')),
  homologated boolean not null default false,
  params jsonb not null default '{}'::jsonb,
  options jsonb not null default '{}'::jsonb,
  derived jsonb not null default '{}'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  review_reasons jsonb not null default '[]'::jsonb,
  kits jsonb not null default '[]'::jsonb,
  materials jsonb not null default '[]'::jsonb,
  cut_list jsonb not null default '[]'::jsonb,
  costs jsonb not null default '{}'::jsonb,
  price numeric(14,2) not null default 0,
  cost_total numeric(14,2) not null default 0,
  margin numeric(14,2) not null default 0,
  margin_percent numeric(8,2),
  drawing_spec jsonb,
  summary text,
  approval_id uuid,
  frozen_at timestamptz,
  frozen_by text,
  frozen_context text,
  drift jsonb,
  superseded_at timestamptz,
  superseded_by uuid,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create index if not exists product_configurations_product_idx on public.product_configurations (product_id);

create table if not exists public.product_configuration_reviews (
  id uuid primary key default gen_random_uuid(),
  configuration_id uuid not null references public.product_configurations(id) on delete restrict,
  requested_by text not null,
  reason text not null,
  status text not null default 'Pendente' check (status in ('Pendente', 'Aprovada', 'Rejeitada')),
  decided_by text,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  system_company_id uuid not null default '00000000-0000-4000-8000-000000000001'::uuid references public.system_companies(id) on delete restrict
);
create unique index if not exists product_configuration_reviews_open_uidx on public.product_configuration_reviews (configuration_id) where status = 'Pendente';

alter table public.quote_items add column if not exists configuration_id uuid references public.product_configurations(id) on delete restrict;
alter table public.sales_order_items add column if not exists configuration_id uuid references public.product_configurations(id) on delete restrict;
alter table public.production_orders add column if not exists configuration_id uuid references public.product_configurations(id) on delete restrict;
alter table public.vehicle_documentation add column if not exists configuration_id uuid references public.product_configurations(id) on delete restrict;
alter table public.vehicle_documentation add column if not exists config_review_required boolean not null default false;

-- Configuração CONGELADA (vendida) é imutável: só ganha a marca de que foi substituída por uma revisão controlada do pedido.
create or replace function public.product_configurations_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.frozen_at is not null or exists (select 1 from public.sales_order_items where configuration_id = old.id) then
      raise exception 'A configuração vendida não pode ser apagada.';
    end if;
    return old;
  end if;
  if old.frozen_at is not null and (to_jsonb(new) - 'superseded_at' - 'superseded_by' - 'updated_at') is distinct from (to_jsonb(old) - 'superseded_at' - 'superseded_by' - 'updated_at') then
    raise exception 'A configuração vendida está congelada e não pode ser alterada: faça uma revisão controlada do pedido.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_product_configurations_guard on public.product_configurations;
create trigger trg_product_configurations_guard before update or delete on public.product_configurations for each row execute function public.product_configurations_guard();

-- ================================================================ 8. Cálculo da configuração (somente leitura): valida, recalcula kits, materiais, custos e margem
create or replace function public.product_configure(p jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_product public.materials%rowtype;
  v_bom public.product_bom_versions%rowtype;
  v_rev public.product_engineering_revisions%rowtype;
  v_has_rev boolean := false;
  v_homologated boolean := false;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_reasons text[] := '{}';
  v_input jsonb := coalesce(p->'params', '{}'::jsonb);
  v_sel jsonb := coalesce(p->'options', '{}'::jsonb);
  v_vars jsonb := '{}'::jsonb;
  v_derived jsonb := '{}'::jsonb;
  v_par record;
  v_val numeric;
  v_invalid boolean := false;
  v_out boolean := false;
  v_finish text;
  v_opt record;
  v_option_ids uuid[] := '{}';
  v_selected jsonb := '[]'::jsonb;
  v_acc_codes text[] := '{}';
  v_code text;
  v_price_delta numeric := 0;
  v_cost_finish numeric := 0;
  v_rule record;
  v_res jsonb;
  v_kit record;
  v_kits jsonb := '[]'::jsonb;
  v_comp record;
  v_sub record;
  v_formula public.product_formulas%rowtype;
  v_materials jsonb := '[]'::jsonb;
  v_cuts jsonb := '[]'::jsonb;
  v_qty numeric;
  v_raw numeric;
  v_step numeric;
  v_line jsonb;
  v_cost_materials numeric := 0;
  v_any_formula boolean := false;
  v_dims_changed boolean := false;
  v_price numeric;
  v_cost_total numeric;
  v_status text;
  v_min_margin numeric;
  v_margin_pct numeric;
  v_template public.product_drawing_templates%rowtype;
  v_drawing jsonb;
  v_plan jsonb;
  v_kit_name text;
  v_load numeric := nullif(p->>'planned_load', '')::numeric;
  v_rev_id uuid;
begin
  select * into v_product from public.materials where id = (p->>'product_id')::uuid and item_type = 'Produto';
  if not found then
    raise exception 'Produto não encontrado.';
  end if;
  select * into v_bom from public.product_bom_versions where product_id = v_product.id and status = 'Ativa';
  if not found then
    raise exception 'O produto % não tem estrutura de fabricação ativa: não dá para configurar.', v_product.name;
  end if;
  v_rev_id := public.eng_current_revision(v_product.id);
  if v_rev_id is not null then
    select * into v_rev from public.product_engineering_revisions where id = v_rev_id;
    v_has_rev := true;
    v_homologated := v_rev.status = 'Validada';
  end if;
  if not v_has_rev then
    v_reasons := array_append(v_reasons, 'O produto não tem revisão de engenharia cadastrada: medidas e quantidades não são homologadas.');
  elsif not v_homologated then
    v_reasons := array_append(v_reasons, 'A revisão de engenharia ' || v_rev.revision || ' ainda não foi validada: os limites não são homologados.');
  end if;

  -- parâmetros: configuráveis (escolhidos) e de referência (fixos)
  if v_has_rev then
    for v_par in select * from public.eng_effective_limits(v_rev_id) loop
      if v_par.configurable then
        v_val := coalesce(nullif(v_input->>v_par.key, '')::numeric, v_par.default_value);
        if v_val is null then
          v_errors := v_errors || jsonb_build_object('code', 'dado', 'param', v_par.key, 'message', 'Informe ' || lower(v_par.label) || '.');
          v_invalid := true;
          continue;
        end if;
        if v_par.integer_only and v_val <> trunc(v_val) then
          v_errors := v_errors || jsonb_build_object('code', 'dado', 'param', v_par.key, 'message', v_par.label || ' precisa ser um número inteiro.');
          v_invalid := true;
        end if;
        if v_par.min_value is not null and v_val < v_par.min_value then
          v_errors := v_errors || jsonb_build_object('code', 'limite', 'param', v_par.key, 'message', v_par.label || ' abaixo do mínimo permitido (' || v_par.min_value || ' ' || v_par.unit || ').', 'min', v_par.min_value, 'max', v_par.max_value, 'value', v_val);
          v_out := true;
        end if;
        if v_par.max_value is not null and v_val > v_par.max_value then
          v_errors := v_errors || jsonb_build_object('code', 'limite', 'param', v_par.key, 'message', v_par.label || ' acima do máximo permitido (' || v_par.max_value || ' ' || v_par.unit || ').', 'min', v_par.min_value, 'max', v_par.max_value, 'value', v_val);
          v_out := true;
        end if;
        if v_par.step is not null and v_par.min_value is not null and abs(mod(v_val - v_par.min_value, v_par.step)) > 0.0001 and abs(mod(v_val - v_par.min_value, v_par.step) - v_par.step) > 0.0001 then
          v_errors := v_errors || jsonb_build_object('code', 'dado', 'param', v_par.key, 'message', v_par.label || ' deve variar de ' || v_par.step || ' em ' || v_par.step || ' ' || v_par.unit || ' a partir de ' || v_par.min_value || '.');
          v_invalid := true;
        end if;
        if v_par.min_value is null or v_par.max_value is null then
          v_warnings := v_warnings || jsonb_build_object('code', 'sem_limite', 'param', v_par.key, 'message', v_par.label || ' sem limite mínimo/máximo documentado.');
          v_reasons := array_append(v_reasons, v_par.label || ' sem limites documentados.');
        end if;
        if v_par.in_conflict then
          v_warnings := v_warnings || jsonb_build_object('code', 'conflito', 'param', v_par.key, 'message', 'Os documentos divergem sobre ' || lower(v_par.label) || ': usado o limite mais restritivo até a engenharia decidir.');
          v_reasons := array_append(v_reasons, 'Conflito documental em ' || lower(v_par.label) || ' (pendência de engenharia).');
        end if;
        if v_par.default_value is not null and v_val <> v_par.default_value then
          v_dims_changed := true;
        end if;
      else
        v_val := coalesce(v_par.fixed_value, v_par.default_value);
        if v_val is null then
          continue;
        end if;
      end if;
      v_vars := v_vars || jsonb_build_object(v_par.key, v_val);
      v_derived := v_derived || jsonb_build_object(v_par.key, jsonb_build_object('value', v_val, 'unit', v_par.unit, 'scope', v_par.scope, 'label', v_par.label, 'configurable', v_par.configurable,
                                                                                  'min', v_par.min_value, 'max', v_par.max_value, 'source', v_par.source));
    end loop;
  end if;

  -- capacidade de carga
  if v_load is not null and v_vars ? 'lotacao' then
    if v_load < 0 then
      v_errors := v_errors || jsonb_build_object('code', 'dado', 'message', 'A carga prevista não pode ser negativa.');
      v_invalid := true;
    elsif v_load > (v_vars->>'lotacao')::numeric then
      v_errors := v_errors || jsonb_build_object('code', 'capacidade', 'message', 'A carga prevista (' || v_load || ') excede a lotação (' || (v_vars->>'lotacao') || ').', 'value', v_load);
      v_out := true;
    end if;
  end if;

  -- opções: um acabamento (se houver) e acessórios
  if v_has_rev then
    if exists (select 1 from public.product_options where revision_id = v_rev_id and option_group = 'acabamento' and active) then
      v_finish := coalesce(nullif(v_sel->>'acabamento', ''), (select code from public.product_options where revision_id = v_rev_id and option_group = 'acabamento' and active and is_default limit 1));
      if v_finish is null then
        v_errors := v_errors || jsonb_build_object('code', 'dado', 'message', 'Escolha o acabamento.');
        v_invalid := true;
      else
        select * into v_opt from public.product_options where revision_id = v_rev_id and option_group = 'acabamento' and code = v_finish and active;
        if not found then
          v_errors := v_errors || jsonb_build_object('code', 'dado', 'message', 'Acabamento "' || v_finish || '" não existe ou está inativo.');
          v_invalid := true;
        else
          v_option_ids := array_append(v_option_ids, v_opt.id);
          v_price_delta := v_price_delta + v_opt.price_delta;
          v_cost_finish := v_cost_finish + v_opt.cost_delta;
          v_vars := v_vars || jsonb_build_object('acabamento', v_opt.code);
          v_selected := v_selected || jsonb_build_object('group', 'acabamento', 'code', v_opt.code, 'label', v_opt.label, 'price_delta', v_opt.price_delta);
        end if;
      end if;
    end if;
    select coalesce(array_agg(code), '{}') into v_acc_codes from public.product_options where revision_id = v_rev_id and option_group = 'acessorio' and active;
    foreach v_code in array v_acc_codes loop
      v_vars := v_vars || jsonb_build_object('acc_' || v_code, 0);
    end loop;
    for v_code in select jsonb_array_elements_text(coalesce(v_sel->'acessorios', '[]'::jsonb)) loop
      select * into v_opt from public.product_options where revision_id = v_rev_id and option_group = 'acessorio' and code = v_code and active;
      if not found then
        v_errors := v_errors || jsonb_build_object('code', 'dado', 'message', 'Acessório "' || v_code || '" não existe ou está inativo.');
        v_invalid := true;
      else
        v_option_ids := array_append(v_option_ids, v_opt.id);
        v_price_delta := v_price_delta + v_opt.price_delta;
        v_cost_finish := v_cost_finish + v_opt.cost_delta;
        v_vars := v_vars || jsonb_build_object('acc_' || v_opt.code, 1);
        v_selected := v_selected || jsonb_build_object('group', 'acessorio', 'code', v_opt.code, 'label', v_opt.label, 'price_delta', v_opt.price_delta);
      end if;
    end loop;

    -- regras de compatibilidade aprovadas pela engenharia
    for v_rule in select * from public.product_configuration_rules where revision_id = v_rev_id and active order by code loop
      begin
        v_res := public.eng_eval(v_rule.expr, v_vars);
      exception when others then
        v_errors := v_errors || jsonb_build_object('code', 'regra', 'rule', v_rule.code, 'message', 'Regra "' || v_rule.code || '" não pôde ser avaliada: ' || sqlerrm);
        v_invalid := true;
        continue;
      end;
      if jsonb_typeof(v_res) <> 'boolean' then
        v_errors := v_errors || jsonb_build_object('code', 'regra', 'rule', v_rule.code, 'message', 'Regra "' || v_rule.code || '" não resulta em verdadeiro/falso.');
        v_invalid := true;
      elsif (v_rule.kind = 'bloqueia' and v_res = 'true'::jsonb) or (v_rule.kind = 'exige' and v_res = 'false'::jsonb) then
        v_errors := v_errors || jsonb_build_object('code', 'regra', 'rule', v_rule.code, 'message', v_rule.message);
        v_invalid := true;
      end if;
    end loop;
    v_any_formula := exists (select 1 from public.product_formulas where revision_id = v_rev_id and status = 'Aprovada');
  end if;

  -- kits (estrutura + opções) e matérias-primas, com fórmulas aprovadas no lugar da quantidade fixa
  for v_kit in
    select pk.kit_id, pk.quantity, coalesce(pk.kit_version_id, (select id from public.kit_versions where kit_id = pk.kit_id and status = 'Ativa')) as version_id, 'estrutura'::text as origin, null::text as option_code
    from public.product_kits pk where pk.bom_version_id = v_bom.id
    union all
    select o.kit_id, o.kit_quantity, (select id from public.kit_versions where kit_id = o.kit_id and status = 'Ativa'), 'opcao', o.code
    from public.product_options o where o.id = any(v_option_ids) and o.kit_id is not null
  loop
    select name into v_kit_name from public.materials where id = v_kit.kit_id;
    if v_kit.version_id is null then
      v_errors := v_errors || jsonb_build_object('code', 'kit', 'message', 'O kit ' || v_kit_name || ' não tem versão ativa.');
      v_invalid := true;
      continue;
    end if;
    v_kits := v_kits || jsonb_build_object('kit_id', v_kit.kit_id, 'name', v_kit_name, 'version_id', v_kit.version_id, 'version', (select version from public.kit_versions where id = v_kit.version_id),
                                           'quantity', v_kit.quantity, 'origin', v_kit.origin, 'option_code', v_kit.option_code);
    for v_comp in
      select c.component_id, c.quantity, c.unit as comp_unit, c.loss_percent, m.item_type, m.name, m.unit as base_unit, m.internal_code, public.material_unit_cost(c.component_id) as unit_cost
      from public.kit_components c join public.materials m on m.id = c.component_id where c.kit_version_id = v_kit.version_id order by c.position
    loop
      if v_comp.item_type = 'Kit' then
        for v_sub in select * from public.explode_kit_version((select id from public.kit_versions where kit_id = v_comp.component_id and status = 'Ativa'), round(v_comp.quantity * (1 + v_comp.loss_percent / 100) * v_kit.quantity, 4)) loop
          v_line := jsonb_build_object('kit_id', v_kit.kit_id, 'kit_name', v_kit_name, 'kit_version_id', v_kit.version_id, 'origin', v_kit.origin, 'option_code', v_kit.option_code, 'material_id', v_sub.material_id,
            'sku', (select internal_code from public.materials where id = v_sub.material_id), 'name', (select name from public.materials where id = v_sub.material_id), 'unit', v_sub.unit, 'quantity', v_sub.required_quantity,
            'source', 'subkit', 'unit_cost', public.material_unit_cost(v_sub.material_id), 'cost', round(v_sub.required_quantity * public.material_unit_cost(v_sub.material_id), 2));
          v_materials := v_materials || v_line;
          v_cost_materials := v_cost_materials + (v_line->>'cost')::numeric;
        end loop;
        continue;
      end if;
      select * into v_formula from public.product_formulas
      where revision_id = v_rev_id and kit_id = v_kit.kit_id and material_id = v_comp.component_id and status in ('Aprovada', 'Rascunho') order by (status = 'Aprovada') desc limit 1;
      if found and v_formula.status = 'Aprovada' then
        begin
          v_qty := public.eng_num(public.eng_eval(v_formula.expr, v_vars));
        exception when others then
          v_errors := v_errors || jsonb_build_object('code', 'formula', 'message', 'Fórmula de ' || v_comp.name || ' no kit ' || v_kit_name || ' não pôde ser calculada: ' || sqlerrm);
          v_invalid := true;
          continue;
        end;
        if v_qty < 0 then
          v_errors := v_errors || jsonb_build_object('code', 'formula', 'message', 'A fórmula de ' || v_comp.name || ' resultou em quantidade negativa (' || v_qty || ').');
          v_invalid := true;
          continue;
        end if;
        if upper(v_formula.unit) <> upper(v_comp.base_unit) then
          v_qty := public.convert_quantity(v_comp.component_id, v_qty, v_formula.unit, v_comp.base_unit);
        end if;
        v_raw := v_qty * (1 + v_formula.loss_percent / 100);
        v_step := coalesce(v_formula.rounding_step, 1);
        v_raw := case v_formula.rounding when 'cima' then ceil(v_raw / v_step) * v_step when 'baixo' then floor(v_raw / v_step) * v_step when 'multiplo' then ceil(v_raw / v_step) * v_step else round(v_raw, 4) end;
        v_qty := round(v_raw * v_kit.quantity, 4);
        v_line := jsonb_build_object('kit_id', v_kit.kit_id, 'kit_name', v_kit_name, 'kit_version_id', v_kit.version_id, 'origin', v_kit.origin, 'option_code', v_kit.option_code, 'material_id', v_comp.component_id,
          'sku', v_comp.internal_code, 'name', v_comp.name, 'unit', v_comp.base_unit, 'quantity', v_qty, 'source', 'formula', 'formula_id', v_formula.id, 'formula_version', v_formula.version, 'formula_text', v_formula.expr_text,
          'params_used', to_jsonb(public.eng_expr_params(v_formula.expr)), 'loss_percent', v_formula.loss_percent, 'rounding', v_formula.rounding, 'rounding_step', v_formula.rounding_step, 'approved_by', v_formula.approved_by,
          'unit_cost', v_comp.unit_cost, 'cost', round(v_qty * v_comp.unit_cost, 2));
        if v_formula.cut_rule is not null then
          begin
            v_plan := public.eng_cut_plan(v_formula.cut_rule, v_vars);
            v_cuts := v_cuts || jsonb_build_object('kit_id', v_kit.kit_id, 'material_id', v_comp.component_id, 'name', v_comp.name, 'plan', v_plan);
            v_line := v_line || jsonb_build_object('cut_rule', v_formula.cut_rule);
          exception when others then
            v_errors := v_errors || jsonb_build_object('code', 'corte', 'message', 'Plano de corte de ' || v_comp.name || ': ' || sqlerrm);
            v_invalid := true;
          end;
        end if;
      else
        if found then
          v_warnings := v_warnings || jsonb_build_object('code', 'formula_pendente', 'message', 'A fórmula de ' || v_comp.name || ' (kit ' || v_kit_name || ') ainda não foi aprovada: usada a quantidade fixa do kit.');
          v_reasons := array_append(v_reasons, 'Fórmula de ' || v_comp.name || ' pendente de aprovação da engenharia.');
        end if;
        v_qty := round(public.convert_quantity(v_comp.component_id, v_comp.quantity, v_comp.comp_unit, v_comp.base_unit) * (1 + v_comp.loss_percent / 100) * v_kit.quantity, 4);
        v_line := jsonb_build_object('kit_id', v_kit.kit_id, 'kit_name', v_kit_name, 'kit_version_id', v_kit.version_id, 'origin', v_kit.origin, 'option_code', v_kit.option_code, 'material_id', v_comp.component_id,
          'sku', v_comp.internal_code, 'name', v_comp.name, 'unit', v_comp.base_unit, 'quantity', v_qty, 'source', 'fixa', 'loss_percent', v_comp.loss_percent,
          'unit_cost', v_comp.unit_cost, 'cost', round(v_qty * v_comp.unit_cost, 2));
      end if;
      if v_qty < 0 then
        v_errors := v_errors || jsonb_build_object('code', 'quantidade', 'message', 'Quantidade negativa para ' || v_comp.name || '.');
        v_invalid := true;
      end if;
      v_materials := v_materials || v_line;
      v_cost_materials := v_cost_materials + (v_line->>'cost')::numeric;
    end loop;
  end loop;
  if v_has_rev and v_dims_changed and not v_any_formula then
    v_warnings := v_warnings || jsonb_build_object('code', 'sem_formula', 'message', 'Nenhuma fórmula aprovada: as quantidades de materiais NÃO acompanham as medidas escolhidas.');
    v_reasons := array_append(v_reasons, 'As medidas diferem do padrão, mas não há fórmulas aprovadas: custo e materiais podem não refletir a configuração.');
  end if;

  -- custos, preço e margem (preço = preço do cadastro + acréscimos das opções; nenhuma política de preço por medida foi configurada)
  v_cost_total := round(v_cost_materials + v_bom.labor_cost + v_bom.overhead_cost + v_bom.other_cost + v_cost_finish, 2);
  v_price := round(v_product.sale_price + v_price_delta, 2);
  v_margin_pct := case when v_price > 0 then round((v_price - v_cost_total) / v_price * 100, 2) end;
  select coalesce((select min_margin_percent from public.sales_settings where system_company_id = public.request_system_company_id()), 0) into v_min_margin;
  if v_min_margin > 0 and coalesce(v_margin_pct, 0) < v_min_margin then
    v_warnings := v_warnings || jsonb_build_object('code', 'margem', 'message', 'Margem de ' || coalesce(v_margin_pct::text, '0') || '% abaixo do mínimo da empresa (' || v_min_margin || '%): exige aprovação comercial.');
  end if;
  v_status := case when v_invalid then 'Invalida' when v_out then 'Fora dos limites' when array_length(v_reasons, 1) is not null or not v_homologated then 'Requer analise tecnica' else 'Valida' end;

  v_drawing := null;
  if v_has_rev then
    select * into v_template from public.product_drawing_templates where revision_id = v_rev_id;
    if found then
      v_drawing := jsonb_build_object('template_key', v_template.template_key, 'template_version', v_template.template_version,
        'grade', case when v_homologated and v_template.grade = 'validado' then 'validado' else 'ilustrativo' end, 'geometry', v_template.geometry, 'revision', v_rev.revision, 'product', v_product.name);
    end if;
  end if;
  return jsonb_build_object(
    'product_id', v_product.id, 'product_name', v_product.name, 'product_sku', v_product.internal_code, 'revision_id', v_rev_id, 'revision', v_rev.revision, 'homologated', v_homologated,
    'bom_version_id', v_bom.id, 'bom_version', v_bom.version, 'status', v_status, 'errors', v_errors, 'warnings', v_warnings, 'review_reasons', to_jsonb(v_reasons),
    'params', v_vars, 'derived', v_derived, 'options', jsonb_build_object('acabamento', v_finish, 'acessorios', coalesce(v_sel->'acessorios', '[]'::jsonb), 'selected', v_selected),
    'kits', v_kits, 'materials', v_materials, 'cut_list', v_cuts,
    'costs', jsonb_build_object('materials', round(v_cost_materials, 2), 'labor', v_bom.labor_cost, 'overhead', v_bom.overhead_cost, 'other', v_bom.other_cost, 'finishing', v_cost_finish, 'total', v_cost_total,
                                'labor_rule', 'valor fixo da estrutura (não há regra de mão de obra por medida validada)'),
    'price', v_price, 'price_base', v_product.sale_price, 'price_options', v_price_delta, 'margin', round(v_price - v_cost_total, 2), 'margin_percent', v_margin_pct,
    'margin_alert', v_min_margin > 0 and coalesce(v_margin_pct, 0) < v_min_margin, 'drawing', v_drawing,
    'summary', trim(both ' ' from concat_ws(' ', v_product.name, case when v_vars ? 'comprimento' then (v_vars->>'comprimento') || ' x ' || coalesce(v_vars->>'largura', '?') || ' x ' || coalesce(v_vars->>'altura', '?') || ' mm' end,
                                          case when v_finish is not null then '· ' || v_finish end)));
end;
$$;

-- Grava a configuração (rascunho do orçamento). Se já existir e estiver congelada, ou for compartilhada com outro item de orçamento, cria uma NOVA linha.
create or replace function public.product_configuration_save(p jsonb, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_result jsonb := public.product_configure(p);
  v_existing public.product_configurations%rowtype;
  v_id uuid := nullif(p->>'configuration_id', '')::uuid;
  v_item uuid := nullif(p->>'quote_item_id', '')::uuid;
  v_new uuid;
  v_clone boolean := true;
begin
  if v_id is not null then
    select * into v_existing from public.product_configurations where id = v_id;
    if found and v_existing.product_id = (v_result->>'product_id')::uuid and v_existing.frozen_at is null
       and not exists (select 1 from public.quote_items qi where qi.configuration_id = v_id and (v_item is null or qi.id <> v_item))
       and not exists (select 1 from public.sales_order_items si where si.configuration_id = v_id) then
      v_clone := false;
    end if;
  end if;
  if v_clone then
    v_new := gen_random_uuid();
    insert into public.product_configurations (id, product_id, revision_id, revision_label, bom_version_id, bom_version, status, homologated, params, options, derived, errors, warnings, review_reasons, kits, materials, cut_list,
                                               costs, price, cost_total, margin, margin_percent, drawing_spec, summary, created_by)
    values (v_new, (v_result->>'product_id')::uuid, nullif(v_result->>'revision_id', '')::uuid, v_result->>'revision', (v_result->>'bom_version_id')::uuid, (v_result->>'bom_version')::integer, v_result->>'status',
            (v_result->>'homologated')::boolean, v_result->'params', v_result->'options', v_result->'derived', v_result->'errors', v_result->'warnings', v_result->'review_reasons', v_result->'kits', v_result->'materials',
            v_result->'cut_list', v_result->'costs', (v_result->>'price')::numeric, (v_result->'costs'->>'total')::numeric, (v_result->>'margin')::numeric, nullif(v_result->>'margin_percent', '')::numeric,
            v_result->'drawing', v_result->>'summary', coalesce(p_user, public.request_actor()));
  else
    v_new := v_id;
    update public.product_configurations set revision_id = nullif(v_result->>'revision_id', '')::uuid, revision_label = v_result->>'revision', bom_version_id = (v_result->>'bom_version_id')::uuid,
      bom_version = (v_result->>'bom_version')::integer, status = v_result->>'status', homologated = (v_result->>'homologated')::boolean, params = v_result->'params', options = v_result->'options', derived = v_result->'derived',
      errors = v_result->'errors', warnings = v_result->'warnings', review_reasons = v_result->'review_reasons', kits = v_result->'kits', materials = v_result->'materials', cut_list = v_result->'cut_list',
      costs = v_result->'costs', price = (v_result->>'price')::numeric, cost_total = (v_result->'costs'->>'total')::numeric, margin = (v_result->>'margin')::numeric, margin_percent = nullif(v_result->>'margin_percent', '')::numeric,
      drawing_spec = v_result->'drawing', summary = v_result->>'summary', approval_id = null, updated_at = now()
    where id = v_new;
  end if;
  return v_result || jsonb_build_object('configuration_id', v_new);
end;
$$;

-- ================================================================ 9. Análise técnica de configurações fora do padrão
create or replace function public.product_configuration_request_review(p_config uuid, p_reason text, p_user text)
returns uuid
language plpgsql
as $$
declare
  v_cfg public.product_configurations%rowtype;
  v_id uuid := gen_random_uuid();
begin
  select * into v_cfg from public.product_configurations where id = p_config for update;
  if not found or v_cfg.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Configuração não encontrada.';
  end if;
  if v_cfg.frozen_at is not null then
    raise exception 'A configuração já foi vendida.';
  end if;
  if v_cfg.status = 'Valida' then
    raise exception 'A configuração já está válida: não precisa de análise.';
  end if;
  if v_cfg.status = 'Invalida' then
    raise exception 'A configuração tem erros que precisam ser corrigidos antes de pedir análise.';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Descreva o motivo da análise técnica (mínimo 10 caracteres).';
  end if;
  insert into public.product_configuration_reviews (id, configuration_id, requested_by, reason, system_company_id) values (v_id, p_config, p_user, p_reason, v_cfg.system_company_id);
  return v_id;
end;
$$;

create or replace function public.product_configuration_decide_review(p_review uuid, p_decision text, p_note text, p_user text)
returns jsonb
language plpgsql
as $$
declare
  v_review public.product_configuration_reviews%rowtype;
  v_cfg public.product_configurations%rowtype;
begin
  select * into v_review from public.product_configuration_reviews where id = p_review for update;
  if not found or v_review.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Solicitação de análise não encontrada.';
  end if;
  if v_review.status <> 'Pendente' then
    raise exception 'A solicitação já foi decidida.';
  end if;
  if p_decision not in ('Aprovada', 'Rejeitada') then
    raise exception 'Decisão inválida.';
  end if;
  if coalesce(btrim(p_user), '') = '' or length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Informe quem decide e a justificativa.';
  end if;
  select * into v_cfg from public.product_configurations where id = v_review.configuration_id for update;
  if v_cfg.frozen_at is not null then
    raise exception 'A configuração já foi vendida.';
  end if;
  update public.product_configuration_reviews set status = p_decision, decided_by = p_user, decided_at = now(), decision_note = p_note where id = p_review;
  update public.product_configurations set status = case when p_decision = 'Aprovada' then 'Aprovada pela engenharia' else 'Rejeitada pela engenharia' end,
         approval_id = case when p_decision = 'Aprovada' then p_review end, updated_at = now() where id = v_cfg.id;
  return jsonb_build_object('status', case when p_decision = 'Aprovada' then 'Aprovada pela engenharia' else 'Rejeitada pela engenharia' end);
end;
$$;

-- Congela (snapshot imutável) ao confirmar a venda. Guarda também se algo mudou no cadastro desde o orçamento (deriva), sem alterar a configuração vendida.
create or replace function public.product_configuration_freeze(p_config uuid, p_context text default null, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_cfg public.product_configurations%rowtype;
  v_fresh jsonb;
  v_drift jsonb;
begin
  select * into v_cfg from public.product_configurations where id = p_config for update;
  if not found or v_cfg.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Configuração não encontrada.';
  end if;
  if v_cfg.frozen_at is not null then
    return jsonb_build_object('configuration_id', p_config, 'already_frozen', true);
  end if;
  if v_cfg.status not in ('Valida', 'Aprovada pela engenharia') then
    raise exception 'A configuração "%" está "%" e não pode ser vendida: corrija ou peça análise técnica.', v_cfg.summary, v_cfg.status;
  end if;
  begin
    v_fresh := public.product_configure(jsonb_build_object('product_id', v_cfg.product_id, 'params', v_cfg.params, 'options', v_cfg.options));
    v_drift := jsonb_build_object('checked_at', now(), 'cost_at_quote', v_cfg.cost_total, 'cost_now', (v_fresh->'costs'->>'total')::numeric,
      'bom_changed', (v_fresh->>'bom_version_id')::uuid is distinct from v_cfg.bom_version_id, 'revision_changed', nullif(v_fresh->>'revision_id', '')::uuid is distinct from v_cfg.revision_id, 'status_now', v_fresh->>'status');
  exception when others then
    v_drift := jsonb_build_object('checked_at', now(), 'error', sqlerrm);
  end;
  update public.product_configurations set frozen_at = now(), frozen_by = coalesce(p_user, public.request_actor()), frozen_context = p_context, drift = v_drift, updated_at = now() where id = p_config;
  return jsonb_build_object('configuration_id', p_config, 'already_frozen', false, 'drift', v_drift);
end;
$$;

create or replace function public.product_configuration_get(p_config uuid)
returns jsonb
language sql
stable
as $$
  select to_jsonb(c) || jsonb_build_object('reviews', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from public.product_configuration_reviews r where r.configuration_id = c.id), '[]'::jsonb))
  from public.product_configurations c where c.id = p_config and c.system_company_id = public.request_system_company_id()
$$;

-- ================================================================ 10. Vínculos: documentação veicular herda a configuração vendida (dados, CAT e código marca/modelo/versão)
create or replace function public.vehicle_documentation_defaults()
returns trigger
language plpgsql
as $$
declare
  v_cfg uuid;
  v_rev public.product_engineering_revisions%rowtype;
begin
  select configuration_id into v_cfg from public.sales_order_items where id = new.sales_order_item_id;
  if v_cfg is not null and new.configuration_id is null then
    new.configuration_id := v_cfg;
  end if;
  if new.configuration_id is not null then
    select r.* into v_rev from public.product_configurations c join public.product_engineering_revisions r on r.id = c.revision_id where c.id = new.configuration_id;
    if found then
      new.cat_number := coalesce(new.cat_number, v_rev.cat_number);
      new.brand_model_version_code := coalesce(new.brand_model_version_code, v_rev.brand_model_version_code);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_vehicle_documentation_defaults on public.vehicle_documentation;
create trigger trg_vehicle_documentation_defaults before insert on public.vehicle_documentation for each row execute function public.vehicle_documentation_defaults();

-- Alteração controlada da configuração vendida (nunca silenciosa): só antes de a produção consumir material; reabre o planejamento e sinaliza a documentação para reavaliação.
create or replace function public.sales_item_reconfigure(p_item uuid, p_new_config uuid, p_reason text, p_user text)
returns jsonb
language plpgsql
as $$
declare
  v_item public.sales_order_items%rowtype;
  v_order public.sales_orders%rowtype;
  v_new public.product_configurations%rowtype;
  v_old uuid;
  v_po record;
  v_flagged integer;
begin
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Descreva o motivo da alteração da configuração (mínimo 10 caracteres).';
  end if;
  select * into v_item from public.sales_order_items where id = p_item for update;
  if not found then
    raise exception 'Item do pedido não encontrado.';
  end if;
  select * into v_order from public.sales_orders where id = v_item.sales_order_id for update;
  if v_order.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Este pedido pertence a outra empresa.';
  end if;
  if v_order.status in ('Entregue', 'Cancelado') or v_item.quantity_delivered > 0 then
    raise exception 'O pedido está % e a configuração não pode mais ser alterada.', v_order.status;
  end if;
  select * into v_new from public.product_configurations where id = p_new_config;
  if not found or v_new.product_id is distinct from v_item.material_id then
    raise exception 'A nova configuração precisa ser do mesmo produto do item.';
  end if;
  if exists (select 1 from public.production_orders po where po.sales_order_item_id = p_item and (po.produced_quantity > 0 or exists (select 1 from public.production_consumptions c where c.production_order_id = po.id))) then
    raise exception 'A produção deste item já consumiu material ou concluiu unidades: a configuração não pode mais ser trocada.';
  end if;
  perform public.product_configuration_freeze(p_new_config, 'revisão do pedido', p_user);
  v_old := v_item.configuration_id;
  for v_po in select id from public.production_orders where sales_order_item_id = p_item and status not in ('Concluida', 'Cancelada') loop
    perform public.cancel_production_order(v_po.id, 'Configuração revisada: ' || p_reason);
  end loop;
  update public.sales_order_items set configuration_id = p_new_config, planned_at = null, quantity_from_stock = 0, quantity_to_produce = 0, unit_cost = v_new.cost_total where id = p_item;
  if v_old is not null and v_old <> p_new_config then
    update public.product_configurations set superseded_at = now(), superseded_by = p_new_config where id = v_old;
  end if;
  -- documentação: dados ainda não enviados acompanham a nova configuração; o que já foi enviado fica marcado para reavaliação (pode exigir correção no serviço documental)
  update public.vehicle_documentation set configuration_id = p_new_config where sales_order_item_id = p_item and status in ('Pendente de dados', 'Pronto para envio');
  update public.vehicle_documentation set configuration_id = p_new_config, config_review_required = true, pendencies = pendencies || to_jsonb('Configuração revisada: avaliar a necessidade de corrigir os dados enviados ao portal.'::text)
  where sales_order_item_id = p_item and status not in ('Pendente de dados', 'Pronto para envio', 'Cancelado');
  get diagnostics v_flagged = row_count;
  perform public.vehicle_doc_log(d.id, 'Configuração revisada', 'Configuração do item revisada: ' || p_reason || '.', jsonb_build_object('from', v_old, 'to', p_new_config), p_user) from public.vehicle_documentation d where d.sales_order_item_id = p_item and d.status <> 'Cancelado';
  perform public.sales_order_log(v_order.id, 'Configuração revisada', 'Item "' || v_item.description || '" revisado: ' || p_reason || '. O valor do pedido NÃO foi alterado automaticamente: confira o preço e o financeiro.', p_user);
  perform public.create_production_from_sale(v_order.id, p_user);
  return jsonb_build_object('configuration_id', p_new_config, 'documentation_flagged', v_flagged, 'price_difference', v_new.price - v_item.unit_price);
end;
$$;

-- A equipe da documentação confirma que avaliou a mudança (corrigiu o que foi enviado, se preciso) e libera a unidade para a liberação da produção.
create or replace function public.vehicle_doc_ack_config_review(p_doc uuid, p_note text, p_user text)
returns void
language plpgsql
as $$
begin
  if length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Registre o que foi avaliado ou corrigido.';
  end if;
  update public.vehicle_documentation set config_review_required = false, pendencies = '[]'::jsonb, updated_at = now() where id = p_doc and system_company_id = public.request_system_company_id() and config_review_required;
  if not found then
    raise exception 'Esta unidade não tem revisão de configuração pendente.';
  end if;
  perform public.vehicle_doc_log(p_doc, 'Revisão avaliada', 'Revisão de configuração avaliada: ' || p_note || '.', null, p_user);
  perform public.sales_order_refresh((select sales_order_id from public.vehicle_documentation where id = p_doc));
end;
$$;

-- ================================================================ 11. Ficha de fabricação (ordem de produção): a configuração vendida, congelada
create or replace function public.production_order_sheet(p_order uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_po public.production_orders%rowtype;
  v_cfg jsonb;
  v_bom public.product_bom_versions%rowtype;
begin
  select * into v_po from public.production_orders where id = p_order and system_company_id = public.request_system_company_id();
  if not found then
    raise exception 'Ordem de produção não encontrada.';
  end if;
  select * into v_bom from public.product_bom_versions where id = v_po.bom_version_id;
  if v_po.configuration_id is not null then
    v_cfg := public.product_configuration_get(v_po.configuration_id);
  end if;
  return jsonb_build_object(
    'order', jsonb_build_object('id', v_po.id, 'code', v_po.code, 'quantity', v_po.quantity, 'status', v_po.status, 'planned_end', v_po.planned_end, 'priority', v_po.priority, 'responsible', v_po.responsible),
    'product', (select jsonb_build_object('id', m.id, 'name', m.name, 'sku', m.internal_code, 'model', m.product_model, 'photo_url', m.photo_url) from public.materials m where m.id = v_po.product_id),
    'sales_order', (select jsonb_build_object('id', so.id, 'order_number', so.order_number, 'client', c.name) from public.sales_orders so join public.clients c on c.id = so.client_id where so.id = v_po.sales_order_id),
    'bom', jsonb_build_object('version', v_bom.version, 'notes', v_bom.notes, 'estimated_days', v_bom.estimated_production_days),
    'configuration', v_cfg,
    'kits', coalesce((select jsonb_agg(jsonb_build_object('name', km.name, 'sku', km.internal_code, 'version', kv.version, 'quantity', k.quantity) order by km.name)
      from public.production_order_kits k join public.materials km on km.id = k.kit_id join public.kit_versions kv on kv.id = k.kit_version_id where k.production_order_id = p_order), '[]'::jsonb),
    'materials', coalesce((select jsonb_agg(jsonb_build_object('name', mm.name, 'sku', mm.internal_code, 'kit', km.name, 'unit', pom.unit, 'required', pom.required_quantity) order by mm.name)
      from public.production_order_materials pom join public.materials mm on mm.id = pom.material_id join public.materials km on km.id = pom.kit_id where pom.production_order_id = p_order), '[]'::jsonb),
    'release', public.production_eligibility(v_po.sales_order_id));
end;
$$;

-- ================================================================ 12. Listas e detalhe do cadastro de engenharia (tela do produto)
create or replace function public.eng_product_overview(p_product uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_current uuid := public.eng_current_revision(p_product);
begin
  if not exists (select 1 from public.materials where id = p_product and item_type = 'Produto') then
    raise exception 'Produto não encontrado.';
  end if;
  return jsonb_build_object(
    'current_revision_id', v_current,
    'revisions', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'revision', r.revision, 'status', r.status, 'bom_version_id', r.bom_version_id, 'bom_version', (select version from public.product_bom_versions where id = r.bom_version_id),
        'brand_model_version_code', r.brand_model_version_code, 'cat_number', r.cat_number, 'cct_number', r.cct_number, 'cct_valid_until', r.cct_valid_until, 'technical_responsible', r.technical_responsible,
        'revised_at', r.revised_at, 'notes', r.notes, 'validated_by', r.validated_by, 'validated_at', r.validated_at, 'created_by', r.created_by, 'created_at', r.created_at,
        'open_issues', (select count(*) from public.product_engineering_issues i where i.revision_id = r.id and i.status = 'Aberta')) order by r.created_at desc)
      from public.product_engineering_revisions r where r.product_id = p_product), '[]'::jsonb),
    'documents', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'revision_id', d.revision_id, 'kind', d.kind, 'name', d.name, 'file_path', d.file_path, 'document_number', d.document_number, 'issuer', d.issuer,
        'issued_at', d.issued_at, 'valid_until', d.valid_until, 'notes', d.notes, 'created_by', d.created_by, 'created_at', d.created_at) order by d.created_at desc)
      from public.product_engineering_documents d where d.product_id = p_product), '[]'::jsonb),
    'parameters', coalesce((select jsonb_agg(jsonb_build_object('id', pp.id, 'revision_id', pp.revision_id, 'key', pp.key, 'label', pp.label, 'unit', pp.unit, 'scope', pp.scope, 'configurable', pp.configurable,
        'integer_only', pp.integer_only, 'step', pp.step, 'default_value', pp.default_value, 'adopted_min', pp.adopted_min, 'adopted_max', pp.adopted_max, 'adopted_fixed', pp.adopted_fixed, 'adoption_note', pp.adoption_note,
        'adopted_by', pp.adopted_by, 'position', pp.position,
        'sources', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'document_id', s.document_id, 'document', d.kind || coalesce(' ' || d.document_number, ''), 'min', s.min_value, 'max', s.max_value, 'fixed', s.fixed_value, 'note', s.note))
          from public.product_parameter_sources s join public.product_engineering_documents d on d.id = s.document_id where s.parameter_id = pp.id), '[]'::jsonb),
        'in_conflict', exists (select 1 from public.eng_revision_conflicts(pp.revision_id) c where c.parameter_key = pp.key)) order by pp.position, pp.key)
      from public.product_parameters pp join public.product_engineering_revisions r on r.id = pp.revision_id where r.product_id = p_product), '[]'::jsonb),
    'issues', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from public.product_engineering_issues i join public.product_engineering_revisions r on r.id = i.revision_id where r.product_id = p_product), '[]'::jsonb),
    'options', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'revision_id', o.revision_id, 'group', o.option_group, 'code', o.code, 'label', o.label, 'price_delta', o.price_delta, 'cost_delta', o.cost_delta,
        'kit_id', o.kit_id, 'kit', (select name from public.materials where id = o.kit_id), 'kit_quantity', o.kit_quantity, 'is_default', o.is_default, 'active', o.active) order by o.option_group, o.label)
      from public.product_options o join public.product_engineering_revisions r on r.id = o.revision_id where r.product_id = p_product), '[]'::jsonb),
    'rules', coalesce((select jsonb_agg(to_jsonb(ru) order by ru.code) from public.product_configuration_rules ru join public.product_engineering_revisions r on r.id = ru.revision_id where r.product_id = p_product), '[]'::jsonb),
    'formulas', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'revision_id', f.revision_id, 'kit_id', f.kit_id, 'kit', (select name from public.materials where id = f.kit_id), 'material_id', f.material_id,
        'material', (select name from public.materials where id = f.material_id), 'label', f.label, 'expr', f.expr, 'expr_text', f.expr_text, 'unit', f.unit, 'loss_percent', f.loss_percent, 'rounding', f.rounding,
        'rounding_step', f.rounding_step, 'cut_rule', f.cut_rule, 'status', f.status, 'version', f.version, 'approved_by', f.approved_by, 'approved_at', f.approved_at) order by f.created_at desc)
      from public.product_formulas f join public.product_engineering_revisions r on r.id = f.revision_id where r.product_id = p_product), '[]'::jsonb),
    'templates', coalesce((select jsonb_agg(to_jsonb(t)) from public.product_drawing_templates t join public.product_engineering_revisions r on r.id = t.revision_id where r.product_id = p_product), '[]'::jsonb),
    'bom_kits', coalesce((select jsonb_agg(jsonb_build_object('kit_id', k.id, 'name', k.name, 'sku', k.internal_code,
        'components', coalesce((select jsonb_agg(jsonb_build_object('material_id', c.component_id, 'name', m.name, 'unit', m.unit, 'quantity', c.quantity, 'comp_unit', c.unit) order by c.position)
          from public.kit_components c join public.materials m on m.id = c.component_id where c.kit_version_id = coalesce(pk.kit_version_id, (select id from public.kit_versions where kit_id = k.id and status = 'Ativa'))), '[]'::jsonb)))
      from public.product_kits pk join public.materials k on k.id = pk.kit_id join public.product_bom_versions bv on bv.id = pk.bom_version_id where bv.product_id = p_product and bv.status = 'Ativa'), '[]'::jsonb));
end;
$$;

-- ================================================================ 13. Acesso: engenharia = catálogo compartilhado; configurações e análises = dados da empresa
do $$
declare
  table_name text;
begin
  foreach table_name in array array['product_engineering_revisions', 'product_engineering_documents', 'product_parameters', 'product_parameter_sources', 'product_engineering_issues', 'product_options',
                                    'product_configuration_rules', 'product_formulas', 'product_drawing_templates'] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists shared_authenticated_access on public.%I', table_name);
    execute format('create policy shared_authenticated_access on public.%I for all to authenticated using (true) with check (true)', table_name);
  end loop;
  foreach table_name in array array['product_configurations', 'product_configuration_reviews'] loop
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

-- ================================================================ 12b. O que o vendedor vê para personalizar (limites efetivos, referências, opções e desenho)
create or replace function public.product_configurator_spec(p_product uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_rev public.product_engineering_revisions%rowtype;
  v_rev_id uuid := public.eng_current_revision(p_product);
  v_product public.materials%rowtype;
begin
  select * into v_product from public.materials where id = p_product and item_type = 'Produto';
  if not found then
    raise exception 'Produto não encontrado.';
  end if;
  if v_rev_id is null then
    return jsonb_build_object('product_id', p_product, 'product_name', v_product.name, 'has_engineering', false, 'homologated', false, 'params', '[]'::jsonb, 'reference', '[]'::jsonb, 'options', '[]'::jsonb);
  end if;
  select * into v_rev from public.product_engineering_revisions where id = v_rev_id;
  return jsonb_build_object('product_id', p_product, 'product_name', v_product.name, 'has_engineering', true, 'revision_id', v_rev.id, 'revision', v_rev.revision, 'revision_status', v_rev.status,
    'homologated', v_rev.status = 'Validada', 'base_price', v_product.sale_price, 'cat_number', v_rev.cat_number, 'cct_number', v_rev.cct_number, 'brand_model_version_code', v_rev.brand_model_version_code,
    'params', coalesce((select jsonb_agg(jsonb_build_object('key', l.key, 'label', l.label, 'unit', l.unit, 'scope', l.scope, 'min', l.min_value, 'max', l.max_value, 'step', l.step, 'default', l.default_value,
        'integer_only', l.integer_only, 'in_conflict', l.in_conflict, 'source', l.source) order by l.sort_pos, l.key) from public.eng_effective_limits(v_rev_id) l where l.configurable), '[]'::jsonb),
    'reference', coalesce((select jsonb_agg(jsonb_build_object('key', l.key, 'label', l.label, 'unit', l.unit, 'scope', l.scope, 'value', coalesce(l.fixed_value, l.default_value), 'min', l.min_value, 'max', l.max_value) order by l.sort_pos, l.key)
        from public.eng_effective_limits(v_rev_id) l where not l.configurable), '[]'::jsonb),
    'options', coalesce((select jsonb_agg(jsonb_build_object('group', o.option_group, 'code', o.code, 'label', o.label, 'price_delta', o.price_delta, 'is_default', o.is_default) order by o.option_group, o.label)
        from public.product_options o where o.revision_id = v_rev_id and o.active), '[]'::jsonb),
    'drawing', (select jsonb_build_object('template_key', t.template_key, 'template_version', t.template_version, 'grade', case when v_rev.status = 'Validada' and t.grade = 'validado' then 'validado' else 'ilustrativo' end, 'geometry', t.geometry)
        from public.product_drawing_templates t where t.revision_id = v_rev_id),
    'open_issues', (select count(*) from public.product_engineering_issues where revision_id = v_rev_id and status = 'Aberta'));
end;
$$;

-- ================================================================ 14. Pedido de venda: leva a configuração e a congela (substitui a função da 223)
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
      if v_item.configuration_id is not null and not exists (select 1 from public.product_configurations c where c.id = v_item.configuration_id and c.product_id = v_item.material_id and c.status in ('Valida', 'Aprovada pela engenharia')) then
        raise exception 'A configuração do item "%" ainda não pode ser vendida: está fora dos limites, inválida ou aguardando análise técnica.', v_item.description;
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
                                        quote_item_id, catalog_price, quoted_bom_version_id, quoted_bom_version_number, lead_time_days, product_sku, notes, configuration_id)
  select v_order, qi.position, qi.line_type, qi.material_id, qi.service_type_id, qi.description, qi.unit, qi.quantity, qi.unit_price, qi.discount_percent, qi.total, qi.unit_cost,
         coalesce(m.make_to_order, false), qi.id, qi.catalog_price, qi.bom_version_id, qi.bom_version_number, qi.lead_time_days, qi.product_sku, qi.notes, qi.configuration_id
  from public.quote_items qi left join public.materials m on m.id = qi.material_id where qi.quote_id = p_quote_id order by qi.position;

  -- a configuração vendida vira snapshot imutável (medidas, opções, versões dos kits, quantidades, custos e preço)
  perform public.product_configuration_freeze(c.configuration_id, 'conversão do orçamento ' || v_quote.quote_number, p_user)
  from (select distinct configuration_id from public.quote_items where quote_id = p_quote_id and configuration_id is not null) c;
  update public.quotes set status = 'Convertido', converted_to = 'Pedido de venda', converted_at = now(), updated_at = now() where id = p_quote_id;
  insert into public.quote_events (quote_id, event, description, author)
  values (p_quote_id, 'Convertido', 'Convertido no pedido de venda ' || v_number || '. Nenhum estoque foi reservado nem consumido; os lançamentos financeiros não foram gerados.', coalesce(p_user, public.request_actor()));
  return jsonb_build_object('sales_order_id', v_order, 'order_number', v_number, 'status', 'Aguardando confirmacao', 'items', v_count, 'duplicate', false);
end;
$$;

-- ================================================================ 15. Produção: ordem de item configurado usa a configuração congelada (substitui a função da 224)
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
  v_cfg public.product_configurations%rowtype;
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
      continue;
    end if;
    if v_item.planned_at is not null then
      update public.sales_order_items set quantity_from_stock = 0, quantity_to_produce = 0 where id = v_item.id;
      delete from public.stock_reservations where sales_order_item_id = v_item.id and status = 'Ativa';
    end if;

    select id into v_bom from public.product_bom_versions where product_id = v_item.material_id and status = 'Ativa';
    v_from_stock := 0;
    if not v_item.make_to_order and v_item.configuration_id is null then   -- item configurado é fabricado sob medida: nunca atendido pelo estoque padrão
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
      if v_item.configuration_id is null then
        insert into public.production_order_kits (production_order_id, kit_id, kit_version_id, quantity, system_company_id)
        select v_po, e.kit_id, e.kit_version_id, max(e.kit_quantity), v_order.system_company_id from public.explode_bom(v_bom, v_to_produce) e group by e.kit_id, e.kit_version_id;
        insert into public.production_order_materials (production_order_id, material_id, kit_id, unit, required_quantity, estimated_unit_cost, system_company_id)
        select v_po, e.material_id, e.kit_id, max(e.unit), sum(e.required_quantity), public.material_unit_cost(e.material_id), v_order.system_company_id
        from public.explode_bom(v_bom, v_to_produce) e group by e.material_id, e.kit_id;
      else
        -- configuração vendida: kits, versões e quantidades calculadas FICAM como foram vendidos (revisão nova do produto não altera a ordem)
        select * into v_cfg from public.product_configurations where id = v_item.configuration_id;
        update public.production_orders set configuration_id = v_cfg.id,
          estimated_materials_cost = round((v_cfg.costs->>'materials')::numeric * v_to_produce, 2),
          estimated_labor_cost = round((v_cfg.costs->>'labor')::numeric * v_to_produce, 2),
          estimated_other_cost = round(((v_cfg.costs->>'overhead')::numeric + (v_cfg.costs->>'other')::numeric + (v_cfg.costs->>'finishing')::numeric) * v_to_produce, 2)
        where id = v_po;
        insert into public.production_order_kits (production_order_id, kit_id, kit_version_id, quantity, system_company_id)
        select v_po, (k->>'kit_id')::uuid, (array_agg((k->>'version_id')::uuid))[1], sum((k->>'quantity')::numeric * v_to_produce), v_order.system_company_id
        from jsonb_array_elements(v_cfg.kits) k group by (k->>'kit_id')::uuid;
        insert into public.production_order_materials (production_order_id, material_id, kit_id, unit, required_quantity, estimated_unit_cost, system_company_id)
        select v_po, (m->>'material_id')::uuid, (m->>'kit_id')::uuid, max(m->>'unit'), sum((m->>'quantity')::numeric * v_to_produce), max((m->>'unit_cost')::numeric), v_order.system_company_id
        from jsonb_array_elements(v_cfg.materials) m where (m->>'quantity')::numeric > 0 group by (m->>'material_id')::uuid, (m->>'kit_id')::uuid;
      end if;
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
  return jsonb_build_object('sales_order_id', p_sales_order_id, 'blocked', false, 'production_orders_created', v_created, 'already_existing', v_reused,
                            'release', public.production_eligibility(p_sales_order_id));
end;
$$;

-- ================================================================ 16. Documentação: o envio leva a configuração vendida (substitui a função da 224)
create or replace function public.vehicle_doc_begin_submit(p_doc uuid, p_key text, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_doc public.vehicle_documentation%rowtype;
  v_existing public.vehicle_documentation_attempts%rowtype;
  v_missing text[];
  v_attempt uuid := gen_random_uuid();
  v_number integer;
  v_kind text;
  v_client public.clients%rowtype;
  v_payload jsonb;
begin
  if coalesce(btrim(p_key), '') = '' then
    raise exception 'Informe a chave de idempotência do envio.';
  end if;
  select * into v_doc from public.vehicle_documentation where id = p_doc for update;
  if not found then
    raise exception 'Documentação não encontrada.';
  end if;
  if v_doc.system_company_id is distinct from public.request_system_company_id() then
    raise exception 'Esta documentação pertence a outra empresa.';
  end if;
  select * into v_existing from public.vehicle_documentation_attempts where documentation_id = p_doc and idempotency_key = p_key;
  if found then
    return jsonb_build_object('attempt_id', v_existing.id, 'duplicate', true, 'outcome', v_existing.outcome, 'protocol', v_existing.protocol);
  end if;
  if v_doc.status in ('Envio em andamento', 'Enviado', 'Aguardando processamento', 'Aprovado para liberacao') then
    raise exception 'Esta unidade já foi enviada (situação: %).', v_doc.status || coalesce(', protocolo ' || v_doc.protocol, '');
  end if;
  if v_doc.status = 'Cancelado' then
    raise exception 'A documentação está cancelada.';
  end if;
  if v_doc.config_review_required then
    raise exception 'A configuração do item foi revisada: avalie a necessidade de corrigir os dados antes de enviar de novo.';
  end if;
  v_missing := public.vehicle_doc_missing(p_doc);
  if array_length(v_missing, 1) is not null then
    raise exception 'Dados incompletos para o envio: %.', array_to_string(v_missing, '; ');
  end if;
  select * into v_client from public.clients where id = v_doc.client_id;
  select count(*) + 1 into v_number from public.vehicle_documentation_attempts where documentation_id = p_doc and kind in ('envio', 'reenvio');
  v_kind := case when v_number > 1 then 'reenvio' else 'envio' end;
  v_payload := jsonb_build_object('vin', upper(btrim(v_doc.vin)), 'cat_number', v_doc.cat_number, 'brand_model_version_code', v_doc.brand_model_version_code,
    'product_model', v_doc.product_model, 'product_name', v_doc.product_name, 'client_name', v_client.name, 'client_document', regexp_replace(v_client.document, '\W', '', 'g'),
    'sales_order', (select order_number from public.sales_orders where id = v_doc.sales_order_id), 'unit_number', v_doc.unit_number, 'documentation_id', v_doc.id,
    'configuration', (select jsonb_build_object('configuration_id', c.id, 'summary', c.summary, 'params', c.params, 'revision', c.revision_label, 'homologated', c.homologated,
                      'cat_number', r.cat_number, 'brand_model_version_code', r.brand_model_version_code, 'cct_number', r.cct_number)
                      from public.product_configurations c left join public.product_engineering_revisions r on r.id = c.revision_id where c.id = v_doc.configuration_id));
  insert into public.vehicle_documentation_attempts (id, documentation_id, attempt_number, kind, channel, idempotency_key, request, actor, system_company_id)
  values (v_attempt, p_doc, v_number, v_kind, v_doc.channel, p_key, v_payload, coalesce(p_user, public.request_actor()), v_doc.system_company_id);
  update public.vehicle_documentation set status = 'Envio em andamento', last_error = null, updated_at = now() where id = p_doc;
  return jsonb_build_object('attempt_id', v_attempt, 'duplicate', false, 'payload', v_payload, 'channel', v_doc.channel);
end;
$$;

-- ================================================================ 17. Liberação: unidade com revisão de configuração pendente não conta como liberada (substitui a função da 224)
create or replace function public.production_eligibility(p_sales_order_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  v_order public.sales_orders%rowtype;
  v_blockers jsonb := '[]'::jsonb;
  v_needs_docs integer;
  v_total integer;
  v_approved integer;
  v_cancelled integer;
  v_waived boolean;
  v_auth boolean;
  v_docs_required boolean := public.sales_setting('documentation')::boolean;
  v_pay_required boolean := public.sales_requires_payment();
  v_auth_required boolean := public.sales_setting('authorization')::boolean;
begin
  select * into v_order from public.sales_orders where id = p_sales_order_id;
  if not found or v_order.system_company_id is distinct from public.request_system_company_id() then
    return jsonb_build_object('eligible', false, 'blockers', jsonb_build_array(jsonb_build_object('code', 'pedido', 'message', 'Pedido de venda não encontrado.', 'waivable', false)));
  end if;
  if v_order.status in ('Rascunho', 'Aguardando confirmacao') then
    v_blockers := v_blockers || jsonb_build_object('code', 'pedido', 'message', 'O pedido ainda não foi confirmado.', 'waivable', false);
  elsif v_order.status = 'Cancelado' then
    v_blockers := v_blockers || jsonb_build_object('code', 'pedido', 'message', 'O pedido está cancelado.', 'waivable', false);
  end if;

  select count(*) into v_needs_docs from public.sales_order_items i join public.materials m on m.id = i.material_id
  where i.sales_order_id = p_sales_order_id and i.line_type = 'Produto' and m.item_type = 'Produto' and m.requires_vehicle_documentation;
  select count(*), count(*) filter (where status = 'Aprovado para liberacao' and not config_review_required), count(*) filter (where status = 'Cancelado')
  into v_total, v_approved, v_cancelled from public.vehicle_documentation where sales_order_id = p_sales_order_id;
  if v_docs_required and v_needs_docs > 0 then
    if v_total = 0 then
      v_blockers := v_blockers || jsonb_build_object('code', 'documentacao', 'message', 'A documentação veicular das unidades ainda não foi iniciada.', 'waivable', false);
    elsif v_approved < v_total then
      v_blockers := v_blockers || jsonb_build_object('code', 'documentacao', 'message',
        'Documentação veicular: ' || v_approved || ' de ' || v_total || ' unidade(s) liberada(s)' || case when v_cancelled > 0 then ' (' || v_cancelled || ' cancelada(s))' else '' end || '.', 'waivable', false);
    end if;
  end if;

  if v_pay_required and v_order.payment_confirmed_at is null then
    select exists (select 1 from public.production_release_exceptions where sales_order_id = p_sales_order_id and component = 'pagamento' and revoked_at is null) into v_waived;
    if not v_waived then
      v_blockers := v_blockers || jsonb_build_object('code', 'pagamento', 'message', 'Aguardando a confirmação do sinal/pagamento.', 'waivable', public.sales_setting('payment_exception')::boolean);
    end if;
  end if;
  if v_auth_required then
    select exists (select 1 from public.production_authorizations where sales_order_id = p_sales_order_id and revoked_at is null) into v_auth;
    if not v_auth then
      v_blockers := v_blockers || jsonb_build_object('code', 'autorizacao', 'message', 'Falta a autorização operacional da produção.', 'waivable', false);
    end if;
  end if;
  return jsonb_build_object('eligible', jsonb_array_length(v_blockers) = 0, 'blockers', v_blockers,
    'documentation', jsonb_build_object('required', v_docs_required and v_needs_docs > 0, 'units', v_total, 'approved', v_approved, 'cancelled', v_cancelled, 'items_requiring', v_needs_docs));
end;
$$;

-- ================================================================ 18. Regras da empresa: margem mínima (substitui as funções da 224)
create or replace function public.sales_settings_get()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'require_payment_before_production', public.sales_requires_payment(),
    'require_documentation_before_production', public.sales_setting('documentation')::boolean,
    'require_operational_authorization', public.sales_setting('authorization')::boolean,
    'allow_payment_exception', public.sales_setting('payment_exception')::boolean,
    'generate_receivables_on_confirmation', public.sales_setting('receivables')::boolean,
    'documentation_channel', public.sales_setting('channel'),
    'documentation_stale_days', public.sales_setting('stale_days')::integer,
'min_margin_percent', coalesce((select min_margin_percent from public.sales_settings where system_company_id = public.request_system_company_id()), 0))
$$;

create or replace function public.sales_settings_update(p jsonb, p_user text default null)
returns jsonb
language plpgsql
as $$
declare
  v_company uuid := public.request_system_company_id();
  v_current jsonb := public.sales_settings_get();
  v_channel text := coalesce(nullif(p->>'documentation_channel', ''), v_current->>'documentation_channel');
begin
  if v_channel not in ('manual', 'serpro_lote', 'simulador') then
    raise exception 'Canal de documentação inválido: %.', v_channel;
  end if;
  insert into public.sales_settings (system_company_id) values (v_company) on conflict (system_company_id) do nothing;
  update public.sales_settings set
    require_payment_before_production = coalesce((p->>'require_payment_before_production')::boolean, (v_current->>'require_payment_before_production')::boolean),
    require_documentation_before_production = coalesce((p->>'require_documentation_before_production')::boolean, (v_current->>'require_documentation_before_production')::boolean),
    require_operational_authorization = coalesce((p->>'require_operational_authorization')::boolean, (v_current->>'require_operational_authorization')::boolean),
    allow_payment_exception = coalesce((p->>'allow_payment_exception')::boolean, (v_current->>'allow_payment_exception')::boolean),
    generate_receivables_on_confirmation = coalesce((p->>'generate_receivables_on_confirmation')::boolean, (v_current->>'generate_receivables_on_confirmation')::boolean),
    documentation_channel = v_channel,
    documentation_stale_days = coalesce(nullif(p->>'documentation_stale_days', '')::integer, (v_current->>'documentation_stale_days')::integer),
min_margin_percent = coalesce(nullif(p->>'min_margin_percent', '')::numeric, (v_current->>'min_margin_percent')::numeric),
    updated_by = coalesce(p_user, public.request_actor()), updated_at = now()
  where system_company_id = v_company;
  perform public.audit_setting_change(v_current, public.sales_settings_get(), p_user);
  return public.sales_settings_get();
end;
$$;


