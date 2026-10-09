-- Consolidated schema for recreating this application on a fresh Supabase project.
-- Execute in Supabase SQL Editor after creating the new project.
-- This script creates the tables, indexes, triggers, helper functions, and RLS
-- policies used by the current application codebase.

create extension if not exists pgcrypto;

-- ============================================================================
-- Cleanup
-- ============================================================================

drop trigger if exists on_auth_user_created on auth.users;

drop table if exists public.sd_activities cascade;
drop table if exists public.sd_closer_metrics cascade;
drop table if exists public.message_templates cascade;
drop table if exists public.sales_targets cascade;
drop table if exists public.tasks cascade;
drop table if exists public.comments cascade;
drop table if exists public.interactions cascade;
drop table if exists public.leads cascade;
drop table if exists public.projects cascade;
drop table if exists public.companies cascade;
drop table if exists public.franchises cascade;
drop table if exists public.profiles cascade;

drop sequence if exists public.project_number_seq cascade;

drop function if exists public.handle_new_user() cascade;
drop function if exists public.set_updated_at() cascade;
drop function if exists public.calculate_lead_weighted_score() cascade;

-- ============================================================================
-- Generic helpers
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- Profiles
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  phone varchar(20),
  role text not null default 'user',
  page_permissions text[] not null default '{}'::text[],
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  manager_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_check check (
    role = any (
      array[
        'admin'::text,
        'sdr'::text,
        'closer'::text,
        'representative'::text,
        'manager'::text,
        'sd'::text,
        'user'::text
      ]
    )
  )
);

create index idx_profiles_email on public.profiles(email);
create index idx_profiles_role on public.profiles(role);
create index idx_profiles_active on public.profiles(active);
create index idx_profiles_manager_id on public.profiles(manager_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    role,
    page_permissions,
    active,
    created_at,
    updated_at
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'user'),
    coalesce(
      (
        select array_agg(value::text)
        from jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'page_permissions', '[]'::jsonb))
      ),
      '{}'::text[]
    ),
    true,
    now(),
    now()
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

create trigger profiles_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "profiles_select_all_authenticated"
on public.profiles
for select
to authenticated
using (true);

create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "profiles_delete_own"
on public.profiles
for delete
to authenticated
using (auth.uid() = id);

-- ============================================================================
-- Companies and franchises
-- ============================================================================

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name varchar(255) not null,
  cnpj varchar(18) unique,
  email varchar(255),
  phone varchar(20),
  website varchar(255),
  cep varchar(10),
  street varchar(255),
  number varchar(20),
  complement varchar(100),
  neighborhood varchar(100),
  city varchar(100),
  state varchar(2),
  industry varchar(100),
  size varchar(50),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_companies_cnpj on public.companies(cnpj);

create trigger companies_updated_at
before update on public.companies
for each row
execute function public.set_updated_at();

alter table public.companies enable row level security;

create policy "Users can view all companies"
on public.companies
for select
to authenticated
using (true);

create policy "Authenticated users can insert companies"
on public.companies
for insert
to authenticated
with check (auth.uid() is not null);

create policy "Authenticated users can update companies"
on public.companies
for update
to authenticated
using (auth.uid() is not null);

create policy "Admins can delete companies"
on public.companies
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

create table public.franchises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_franchises_name on public.franchises(name);
create index idx_franchises_created_at on public.franchises(created_at);

create trigger franchises_updated_at
before update on public.franchises
for each row
execute function public.set_updated_at();

alter table public.franchises enable row level security;

create policy "franchises_select_all"
on public.franchises
for select
to authenticated
using (true);

create policy "franchises_insert_admin"
on public.franchises
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  )
);

create policy "franchises_update_admin"
on public.franchises
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  )
);

create policy "franchises_delete_admin"
on public.franchises
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  )
);

-- ============================================================================
-- Projects
-- ============================================================================

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'active',
  project_code varchar(50),
  value_goal numeric(12,2) not null default 0,
  total_value numeric(12,2) not null default 0,
  minimum_value numeric(12,2) not null default 0,
  lead_goal integer not null default 0,
  closing_goal integer not null default 0,
  expected_subscriptions integer not null default 0,
  subscription_count integer not null default 0,
  pending_subscriptions integer not null default 0,
  franchise_location text,
  responsible_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  cep text,
  street text,
  number text,
  complement text,
  neighborhood text,
  city text,
  state text,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_status_check check (
    status in ('active', 'completed', 'on_hold', 'cancelled')
  )
);

create index idx_projects_name on public.projects(name);
create index idx_projects_created_at on public.projects(created_at);
create index idx_projects_responsible_id on public.projects(responsible_id);
create index idx_projects_status on public.projects(status);
create index idx_projects_city on public.projects(city);
create index idx_projects_state on public.projects(state);
create index idx_projects_cep on public.projects(cep);
create index idx_projects_location on public.projects(city, state);
create index idx_projects_coordinates on public.projects(latitude, longitude);

create trigger projects_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

alter table public.projects enable row level security;

create policy "projects_select_authenticated"
on public.projects
for select
to authenticated
using (true);

create policy "projects_insert_authenticated"
on public.projects
for insert
to authenticated
with check (true);

create policy "projects_update_authenticated"
on public.projects
for update
to authenticated
using (true);

create policy "projects_delete_authenticated"
on public.projects
for delete
to authenticated
using (true);

create sequence public.project_number_seq start 10001;

-- ============================================================================
-- Leads
-- ============================================================================

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  company_id uuid references public.companies(id) on delete set null,
  email text,
  phone text,
  cpf_cnpj text,
  proposal_name text,
  location text,
  follow_up_date timestamptz,
  meeting_date timestamptz,
  meeting_link text,
  meeting_attendees text[] not null default '{}'::text[],
  status text not null default 'em_atendimento',
  sd_sub_status text,
  sdr_id uuid references public.profiles(id) on delete set null,
  closer_id uuid references public.profiles(id) on delete set null,
  sd_id uuid references public.profiles(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  project_code varchar(50),
  linkedin_url text,
  instagram_url text,
  deal_value numeric(12,2),
  closed_date timestamptz,
  notes text,
  referred_by uuid references public.leads(id) on delete set null,
  franchise_id uuid references public.franchises(id) on delete set null,
  lead_source text,
  referral_name text,
  referral_commission numeric(5,2),
  value numeric(12,2),
  sale_date timestamptz,
  cep text,
  street text,
  number text,
  complement text,
  neighborhood text,
  city text,
  state text,
  score_mql boolean not null default false,
  score_oportunidade_validada boolean not null default false,
  score_proposta_tecnica boolean not null default false,
  score_proposta_comercial boolean not null default false,
  score_negociacao boolean not null default false,
  score_fechado boolean not null default false,
  score_autoridade integer not null default 0,
  score_dor_urgencia integer not null default 0,
  score_business_case integer not null default 0,
  score_aderencia_tecnica integer not null default 0,
  score_diferenciacao integer not null default 0,
  score_gestao_riscos integer not null default 0,
  score_cronograma integer not null default 0,
  score_modelo_comercial integer not null default 0,
  score_patrocinador integer not null default 0,
  total_score integer not null default 0,
  value_parts numeric(15,2) not null default 0,
  value_services numeric(15,2) not null default 0,
  value_maintenance_contracts numeric(15,2) not null default 0,
  value_equipment_sales numeric(15,2) not null default 0,
  value_projects numeric(15,2) not null default 0,
  tasks jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_status_check check (
    status = any (
      array[
        'em_atendimento'::text,
        'follow_up'::text,
        'reuniao_agendada'::text,
        'reuniao_remarcada'::text,
        'nao_realizada'::text,
        'sem_atendimento'::text,
        'outbound'::text,
        'reuniao_realizada'::text,
        'em_negociacao'::text,
        'fechado'::text,
        'perdido'::text,
        'reuniao_marcada'::text,
        'no_show'::text,
        'visita'::text,
        'dados_cliente'::text,
        'projeto_orcamento'::text,
        'revisao'::text,
        'kickoff'::text,
        'fila_espera'::text,
        'programacao_time'::text,
        'aguardando_informacoes'::text,
        'sem_pendencias'::text,
        'projetos_ganhos'::text,
        'perdidos_cancelados'::text,
        'cliente'::text,
        'desenvolvimento_proposta'::text,
        'negociacao'::text,
        'ganho'::text,
        'perdido_cliente'::text,
        'hold'::text
      ]
    )
  ),
  constraint leads_sd_sub_status_check check (
    sd_sub_status is null or sd_sub_status in (
      'analise_dados',
      'elaboracao_layout',
      'preparando_pc_fpv',
      'elaborando_proposta'
    )
  ),
  constraint leads_source_check check (
    lead_source is null or lead_source in (
      'linkedin',
      'whatsapp',
      'indicacao',
      'feira',
      'trafego_pago'
    )
  ),
  constraint leads_commission_check check (
    referral_commission is null or (referral_commission >= 0 and referral_commission <= 100)
  ),
  constraint leads_score_autoridade_check check (score_autoridade between 0 and 5),
  constraint leads_score_dor_urgencia_check check (score_dor_urgencia between 0 and 5),
  constraint leads_score_business_case_check check (score_business_case between 0 and 5),
  constraint leads_score_aderencia_tecnica_check check (score_aderencia_tecnica between 0 and 5),
  constraint leads_score_diferenciacao_check check (score_diferenciacao between 0 and 5),
  constraint leads_score_gestao_riscos_check check (score_gestao_riscos between 0 and 5),
  constraint leads_score_cronograma_check check (score_cronograma between 0 and 5),
  constraint leads_score_modelo_comercial_check check (score_modelo_comercial between 0 and 5),
  constraint leads_score_patrocinador_check check (score_patrocinador between 0 and 5)
);

create index idx_leads_company_id on public.leads(company_id);
create index idx_leads_sdr_id on public.leads(sdr_id);
create index idx_leads_closer_id on public.leads(closer_id);
create index idx_leads_sd_id on public.leads(sd_id);
create index idx_leads_status on public.leads(status);
create index idx_leads_location on public.leads(location);
create index idx_leads_referred_by on public.leads(referred_by);
create index idx_leads_project_id on public.leads(project_id);
create index idx_leads_project_code on public.leads(project_code);
create index idx_leads_franchise_id on public.leads(franchise_id);
create index idx_leads_created_at on public.leads(created_at);
create index idx_leads_closed_date on public.leads(closed_date);
create index idx_leads_tasks on public.leads using gin (tasks);

create or replace function public.calculate_lead_weighted_score()
returns trigger
language plpgsql
as $$
begin
  new.total_score := round((
    (coalesce(new.score_autoridade, 0) * 20) +
    (coalesce(new.score_dor_urgencia, 0) * 15) +
    (coalesce(new.score_business_case, 0) * 15) +
    (coalesce(new.score_aderencia_tecnica, 0) * 10) +
    (coalesce(new.score_diferenciacao, 0) * 10) +
    (coalesce(new.score_gestao_riscos, 0) * 10) +
    (coalesce(new.score_cronograma, 0) * 8) +
    (coalesce(new.score_modelo_comercial, 0) * 7) +
    (coalesce(new.score_patrocinador, 0) * 5)
  )::numeric / 5);

  return new;
end;
$$;

create trigger leads_updated_at
before update on public.leads
for each row
execute function public.set_updated_at();

create trigger trigger_calculate_lead_weighted_score
before insert or update on public.leads
for each row
execute function public.calculate_lead_weighted_score();

alter table public.leads enable row level security;

create policy "leads_select_all"
on public.leads
for select
to authenticated
using (true);

create policy "leads_insert_all"
on public.leads
for insert
to authenticated
with check (true);

create policy "leads_update_all"
on public.leads
for update
to authenticated
using (true);

create policy "leads_delete_admin"
on public.leads
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  )
);

-- ============================================================================
-- Comments
-- ============================================================================

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_comments_lead_id on public.comments(lead_id);
create index idx_comments_user_id on public.comments(user_id);
create index idx_comments_created_at on public.comments(created_at desc);

create trigger comments_updated_at
before update on public.comments
for each row
execute function public.set_updated_at();

alter table public.comments enable row level security;

create policy comments_select_policy
on public.comments
for select
to authenticated
using (true);

create policy comments_insert_policy
on public.comments
for insert
to authenticated
with check (auth.uid() = user_id);

create policy comments_update_policy
on public.comments
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy comments_delete_policy
on public.comments
for delete
to authenticated
using (auth.uid() = user_id);

-- ============================================================================
-- Tasks
-- ============================================================================

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  description text not null,
  due_date timestamptz not null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_tasks_lead_id on public.tasks(lead_id);
create index idx_tasks_due_date on public.tasks(due_date);
create index idx_tasks_completed on public.tasks(completed);

create trigger tasks_updated_at
before update on public.tasks
for each row
execute function public.set_updated_at();

alter table public.tasks enable row level security;

create policy "tasks_select_all"
on public.tasks
for select
to authenticated
using (true);

create policy "tasks_insert_all"
on public.tasks
for insert
to authenticated
with check (true);

create policy "tasks_update_all"
on public.tasks
for update
to authenticated
using (true);

create policy "tasks_delete_all"
on public.tasks
for delete
to authenticated
using (true);

grant all on public.tasks to authenticated;
grant all on public.tasks to service_role;

-- ============================================================================
-- Sales targets
-- ============================================================================

create table public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  year integer not null,
  revenue_jan numeric default 0,
  revenue_feb numeric default 0,
  revenue_mar numeric default 0,
  revenue_apr numeric default 0,
  revenue_may numeric default 0,
  revenue_jun numeric default 0,
  revenue_jul numeric default 0,
  revenue_aug numeric default 0,
  revenue_sep numeric default 0,
  revenue_oct numeric default 0,
  revenue_nov numeric default 0,
  revenue_dec numeric default 0,
  leads_jan integer default 0,
  leads_feb integer default 0,
  leads_mar integer default 0,
  leads_apr integer default 0,
  leads_may integer default 0,
  leads_jun integer default 0,
  leads_jul integer default 0,
  leads_aug integer default 0,
  leads_sep integer default 0,
  leads_oct integer default 0,
  leads_nov integer default 0,
  leads_dec integer default 0,
  deals_jan integer default 0,
  deals_feb integer default 0,
  deals_mar integer default 0,
  deals_apr integer default 0,
  deals_may integer default 0,
  deals_jun integer default 0,
  deals_jul integer default 0,
  deals_aug integer default 0,
  deals_sep integer default 0,
  deals_oct integer default 0,
  deals_nov integer default 0,
  deals_dec integer default 0,
  revenue_target numeric(12,2) default 0,
  leads_target integer default 0,
  closed_deals_target integer default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, year)
);

create index idx_sales_targets_user_id on public.sales_targets(user_id);
create index idx_sales_targets_year on public.sales_targets(year);
create index idx_sales_targets_user_year on public.sales_targets(user_id, year);

create trigger sales_targets_updated_at
before update on public.sales_targets
for each row
execute function public.set_updated_at();

alter table public.sales_targets enable row level security;

create policy "sales_targets_select_all"
on public.sales_targets
for select
to authenticated
using (true);

create policy "sales_targets_insert_admin"
on public.sales_targets
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  )
);

create policy "sales_targets_update_admin"
on public.sales_targets
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  )
);

create policy "sales_targets_delete_admin"
on public.sales_targets
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
  )
);

-- ============================================================================
-- Message templates
-- ============================================================================

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content text not null,
  category text not null,
  variables text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_templates_category_check check (
    category in ('whatsapp', 'instagram', 'email', 'other')
  )
);

create index idx_message_templates_user_id on public.message_templates(user_id);

create trigger message_templates_updated_at
before update on public.message_templates
for each row
execute function public.set_updated_at();

alter table public.message_templates enable row level security;

create policy "Users can view own message templates"
on public.message_templates
for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert own message templates"
on public.message_templates
for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can update own message templates"
on public.message_templates
for update
to authenticated
using (auth.uid() = user_id);

create policy "Users can delete own message templates"
on public.message_templates
for delete
to authenticated
using (auth.uid() = user_id);

-- ============================================================================
-- Interactions
-- ============================================================================

create table public.interactions (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.leads(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  type text not null,
  description text,
  created_at timestamptz not null default now(),
  constraint interactions_type_check check (
    type in ('call', 'email', 'meeting', 'note', 'whatsapp', 'other')
  )
);

create index idx_interactions_lead_id on public.interactions(lead_id);
create index idx_interactions_user_id on public.interactions(user_id);
create index idx_interactions_created_at on public.interactions(created_at);

alter table public.interactions enable row level security;

create policy "interactions_select_all"
on public.interactions
for select
to authenticated
using (true);

create policy "interactions_insert_all"
on public.interactions
for insert
to authenticated
with check (true);

create policy "interactions_update_own"
on public.interactions
for update
to authenticated
using (user_id = auth.uid());

create policy "interactions_delete_own"
on public.interactions
for delete
to authenticated
using (user_id = auth.uid());

-- ============================================================================
-- SD metrics
-- ============================================================================

create table public.sd_closer_metrics (
  id uuid primary key default gen_random_uuid(),
  closer_id uuid not null references public.profiles(id) on delete cascade,
  month integer not null,
  year integer not null,
  hours_cost numeric default 0,
  travel_cost numeric default 0,
  hours_worked numeric default 0,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (closer_id, month, year)
);

create index idx_sd_closer_metrics_closer_id on public.sd_closer_metrics(closer_id);
create index idx_sd_closer_metrics_year_month on public.sd_closer_metrics(year, month);

create trigger sd_closer_metrics_updated_at
before update on public.sd_closer_metrics
for each row
execute function public.set_updated_at();

alter table public.sd_closer_metrics enable row level security;

create policy "sd_closer_metrics_select_all"
on public.sd_closer_metrics
for select
to authenticated
using (true);

create policy "sd_closer_metrics_insert_all"
on public.sd_closer_metrics
for insert
to authenticated
with check (true);

create policy "sd_closer_metrics_update_all"
on public.sd_closer_metrics
for update
to authenticated
using (true);

create policy "sd_closer_metrics_delete_admin"
on public.sd_closer_metrics
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = 'admin'
  )
);

-- ============================================================================
-- SD activities
-- ============================================================================

create table public.sd_activities (
  id uuid primary key default gen_random_uuid(),
  activity_date date not null default current_date,
  project_code varchar(50),
  lead_id uuid references public.leads(id) on delete set null,
  revision_count integer not null default 0,
  client_name varchar(255),
  seller_id uuid references public.profiles(id) on delete set null,
  resource_name varchar(255),
  activity_type varchar(100),
  hours_spent decimal(10,2) not null default 0,
  is_priority boolean not null default false,
  delay_notes text,
  is_reallocated boolean not null default false,
  sd_cost decimal(15,2) not null default 0,
  travel_cost decimal(15,2) not null default 0,
  sale_value decimal(15,2) not null default 0,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sd_activities_activity_type_check check (
    activity_type is null or activity_type in (
      'interna',
      'reuniao',
      'analise_dados',
      'layout',
      'precificacao',
      'layout_3d',
      'proposta',
      'visita'
    )
  )
);

create index idx_sd_activities_date on public.sd_activities(activity_date);
create index idx_sd_activities_seller on public.sd_activities(seller_id);
create index idx_sd_activities_project_code on public.sd_activities(project_code);
create index idx_sd_activities_activity_type on public.sd_activities(activity_type);

create trigger sd_activities_updated_at
before update on public.sd_activities
for each row
execute function public.set_updated_at();

alter table public.sd_activities enable row level security;

create policy "Enable read access for authenticated users"
on public.sd_activities
for select
to authenticated
using (true);

create policy "Enable insert for authenticated users"
on public.sd_activities
for insert
to authenticated
with check (true);

create policy "Enable update for authenticated users"
on public.sd_activities
for update
to authenticated
using (true);

create policy "Enable delete for authenticated users"
on public.sd_activities
for delete
to authenticated
using (true);

-- ============================================================================
-- Notes
-- ============================================================================

comment on table public.profiles is 'User profiles used by auth, permissions, managers and assignments.';
comment on table public.leads is 'Main CRM table: lead pipeline, client workflow, scoring and financial breakdown.';
comment on table public.projects is 'Project records used for company delivery tracking and map/geolocation.';
comment on table public.sd_activities is 'Operational SD activity logs by project, seller and date.';
