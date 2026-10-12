-- Orçamentos ERP Carretas: orçamentos com versões, itens do catálogo com preço negociado
-- (congelado no orçamento), anexos, histórico, aceite e conversão em venda/OS com títulos a receber.
-- Rode no SQL Editor do Supabase depois de 209_comercial.sql.

create sequence if not exists public.quote_number_seq;

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  quote_number text not null default ('ORC-' || lpad(nextval('public.quote_number_seq')::text, 6, '0')),
  version integer not null default 1 check (version >= 1),
  title text,
  client_id uuid not null references public.clients(id) on delete restrict,
  salesperson_id uuid not null references public.salespeople(id) on delete restrict,
  opportunity_id uuid references public.opportunities(id) on delete set null,
  issue_date date not null default current_date,
  valid_until date not null,
  quote_type text not null check (quote_type in ('Produto', 'Serviço', 'Misto')),
  status text not null default 'Rascunho' check (status in ('Rascunho', 'Enviado', 'Aprovado', 'Recusado', 'Expirado', 'Convertido', 'Cancelado', 'Substituído')),
  items_subtotal numeric(14,2) not null default 0,
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  freight_amount numeric(14,2) not null default 0 check (freight_amount >= 0),
  expenses_amount numeric(14,2) not null default 0 check (expenses_amount >= 0),
  tax_percent numeric(6,3) not null default 0 check (tax_percent >= 0 and tax_percent <= 100),
  taxes_amount numeric(14,2) not null default 0,
  total_amount numeric(14,2) not null default 0,
  estimated_cost numeric(14,2) not null default 0,
  payment_condition_id uuid references public.payment_conditions(id) on delete set null,
  payment_condition_name text,
  payment_condition_snapshot jsonb,
  delivery_text text,
  warranty_days integer not null default 0 check (warranty_days >= 0),
  notes text,
  sent_at timestamptz,
  sent_via text,
  sent_to text,
  approved_at timestamptz,
  accepted_by text,
  accept_notes text,
  refusal_reason text,
  converted_at timestamptz,
  converted_to text check (converted_to in ('Venda', 'OS')),
  receivables_generated_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until >= issue_date)
);
create unique index if not exists quotes_number_version_uidx on public.quotes (quote_number, version);
create index if not exists quotes_status_idx on public.quotes (status, valid_until);
create index if not exists quotes_client_idx on public.quotes (client_id);
create index if not exists quotes_opportunity_idx on public.quotes (opportunity_id) where opportunity_id is not null;

-- Itens: o preço unitário e o custo ficam congelados no orçamento (não seguem o cadastro).
create table if not exists public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  position integer not null default 0,
  line_type text not null check (line_type in ('Produto', 'Serviço')),
  material_id uuid references public.materials(id) on delete set null,
  service_type_id uuid references public.service_types(id) on delete set null,
  description text not null,
  unit text not null default 'UN',
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  catalog_price numeric(14,4) not null default 0,
  unit_cost numeric(14,4) not null default 0,
  discount_percent numeric(6,3) not null default 0 check (discount_percent between 0 and 100),
  total numeric(14,2) not null default 0,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists quote_items_quote_idx on public.quote_items (quote_id, position);

create table if not exists public.quote_attachments (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  file_path text not null,
  file_name text not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists quote_attachments_quote_idx on public.quote_attachments (quote_id);

-- Histórico: criação, alterações, envio, aceite, versões e conversão.
create table if not exists public.quote_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  event text not null,
  description text not null,
  author text,
  created_at timestamptz not null default now()
);
create index if not exists quote_events_quote_idx on public.quote_events (quote_id, created_at desc);

-- Vínculos com OS e logotipo da empresa (usado no PDF)
alter table public.service_orders add column if not exists source_quote_id uuid references public.quotes(id) on delete set null;
create index if not exists service_orders_source_quote_idx on public.service_orders (source_quote_id) where source_quote_id is not null;
alter table public.system_companies add column if not exists logo_path text;

insert into storage.buckets (id, name, public) values ('quote-files', 'quote-files', false) on conflict (id) do nothing;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['quotes', 'quote_items', 'quote_attachments', 'quote_events'] loop
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
  execute 'drop trigger if exists trg_quotes_updated_at on public.quotes';
  execute 'create trigger trg_quotes_updated_at before update on public.quotes for each row execute function public.set_updated_at()';
end;
$$;
