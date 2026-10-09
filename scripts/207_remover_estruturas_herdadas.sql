-- ERP Carretas: remove do banco as estruturas herdadas do sistema anterior
-- (climatização: PMOC, obras, ambientes, equipamentos, kits por metragem, CNO,
-- orçamento por obra, modelos de contrato e o CRM antigo de leads).
--
-- ATENÇÃO: ESTE SCRIPT APAGA TABELAS E DADOS. Rode SOMENTE no banco do ERP de
-- carretas, depois de 200-206 e de conferir que nada dessas tabelas é necessário.
-- Não rode em um banco que ainda guarde dados do sistema anterior.

begin;

-- PMOC
drop table if exists public.pmoc_schedules, public.pmoc_equipment_services, public.pmoc_equipment, public.pmoc_sectors, public.pmoc_plans cascade;

-- Clientes: ambientes e equipamentos climatizados
drop table if exists public.client_equipment, public.client_environments cascade;

-- Obras, estrutura de orçamento por obra e plantas
drop table if exists public.budget_plan_points, public.budget_plans, public.budget_points, public.budget_environments,
  public.budget_service_types, public.budget_floors, public.budget_towers, public.budget_works cascade;
drop table if exists public.point_photos, public.environment_photos, public.work_points, public.work_environments, public.work_floors, public.works cascade;

-- Kits por metragem e OS de estoque
drop table if exists public.stock_service_orders, public.stock_kit_items, public.stock_kits cascade;

-- Prospecção por CNO, funil BANT e pedidos de orçamento por WhatsApp
drop table if exists public.commercial_leads, public.comercial_cno_records, public.whatsapp_budget_request_photos, public.whatsapp_budget_requests cascade;

-- Formulários de campo e configuração do fluxo de OS anterior
drop table if exists public.vehicle_checklists, public.vehicle_usage, public.operational_statuses, public.execution_steps cascade;

-- Contratos e modelos do sistema anterior (o módulo Contratos será recriado com a nova especificação)
drop table if exists public.contract_history, public.contract_templates, public.contracts cascade;

-- CRM antigo de leads/franquias
drop table if exists public.interactions, public.tasks, public.comments, public.sales_targets, public.sd_activities,
  public.sd_closer_metrics, public.leads, public.projects, public.franchises, public.message_templates, public.companies cascade;

-- Colunas de obra/ambiente/ponto/PMOC em tabelas que continuam existindo
alter table if exists public.service_orders
  drop column if exists work_id, drop column if exists floor_id, drop column if exists environment_id, drop column if exists point_id,
  drop column if exists client_environment_id, drop column if exists client_equipment_id, drop column if exists work_structure_id;
alter table if exists public.accounts_payable drop column if exists work_id, drop column if exists environment_id, drop column if exists point_id;
alter table if exists public.accounts_receivable drop column if exists work_id, drop column if exists environment_id, drop column if exists point_id;
alter table if exists public.financial_transactions drop column if exists work_id, drop column if exists environment_id, drop column if exists point_id;
alter table if exists public.credit_card_invoice_items drop column if exists linked_work_id;
alter table if exists public.clients drop column if exists service_contexts, drop column if exists monthly_pmoc_value;
alter table if exists public.service_types
  drop column if exists kit_id, drop column if exists execution_percentage, drop column if exists periodicity_months,
  drop column if exists enabled_contexts, drop column if exists required_photos,
  drop column if exists orientation_video_url, drop column if exists orientation_video_description;
alter table if exists public.materials drop column if exists composes_kit;

-- Empresa padrão do grupo: nome do ERP de carretas
update public.system_companies
  set name = 'Carretas', legal_name = 'Carretas', trade_name = 'Carretas'
  where id = '00000000-0000-4000-8000-000000000001' and name ilike 'M & C%';

commit;
