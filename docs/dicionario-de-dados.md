# Dicionário de dados — ERP Carretas

Gerado automaticamente por `scripts/gerar-dicionario-de-dados.py` a partir das migrações SQL. **Não edite à mão:** altere a migração e gere de novo.

Convenções: `uuid` com `gen_random_uuid()` como identificador; datas em `date`/`timestamptz`; valores monetários em `numeric(14,2)`; exclusão lógica por campo de status/ativo (preferida a `delete` quando há histórico financeiro, fiscal ou operacional); tabelas por empresa têm `system_company_id` e RLS por empresa.

Total: 93 tabelas ativas.

## profiles

Criada em `base/000_initial_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | UUID | sim |  | chave primária |
| `email` | TEXT | sim |  | único |
| `full_name` | TEXT | não |  |  |
| `role` | TEXT | não | `'user'` | regra: role IN ('admin', 'sdr', 'closer', 'user') |
| `page_permissions` | TEXT[] | não | `'{}'` |  |
| `active` | BOOLEAN | não | `TRUE` |  |
| `created_at` | TIMESTAMPTZ | não | `NOW()` |  |
| `created_by` | UUID | não |  | → profiles.id (on delete set null) |
| `updated_at` | TIMESTAMPTZ | não | `NOW()` |  |
| `manager_id` | UUID | não |  | → profiles.id (on delete set null) |
| `phone` | VARCHAR(20) | não |  |  |
| `client_id` | uuid | não |  |  |
| `department` | text | não |  |  |
| `job_title` | text | não |  |  |
| `branch_id` | uuid | não |  | → branches.id (on delete set null) |
| `mfa_required` | boolean | sim | `false` |  |

## leads _(removida pela migração 207)_

Criada em `base/000_initial_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | UUID | sim | `gen_random_uuid()` | chave primária |
| `name` | TEXT | sim |  |  |
| `company` | TEXT | não |  |  |
| `email` | TEXT | não |  |  |
| `phone` | TEXT | não |  |  |
| `cpf_cnpj` | TEXT | não |  |  |
| `location` | TEXT | não |  |  |
| `next_follow_up` | TIMESTAMPTZ | não |  |  |
| `meeting_date` | TIMESTAMPTZ | não |  |  |
| `meeting_link` | TEXT | não |  |  |
| `meeting_attendees` | TEXT[] | não | `'{}'` |  |
| `status` | TEXT | não | `'em_atendimento'` | regra: status IN ( 'em_atendimento', 'follow_up', 'reuniao_agendada', 'reuniao_remarcada', 'nao_realizada', 'sem_atendimento', 'outbound', 'reuniao |
| `assigned_sdr` | UUID | não |  | → profiles.id (on delete set null) |
| `assigned_closer` | UUID | não |  | → profiles.id (on delete set null) |
| `project_id` | UUID | não |  |  |
| `linkedin` | TEXT | não |  |  |
| `instagram` | TEXT | não |  |  |
| `value` | NUMERIC(12, 2) | não |  |  |
| `sale_date` | TIMESTAMPTZ | não |  |  |
| `notes` | TEXT | não |  |  |
| `referred_by` | UUID | não |  | → leads.id (on delete set null) |
| `tasks` | JSONB | não | `'[]'::jsonb` |  |
| `franchise_id` | UUID | não |  |  |
| `created_at` | TIMESTAMPTZ | não | `NOW()` |  |
| `updated_at` | TIMESTAMPTZ | não | `NOW()` |  |
| `sdr_id` | UUID | não |  | → profiles.id (on delete set null) |
| `closer_id` | UUID | não |  | → profiles.id (on delete set null) |
| `linkedin_url` | TEXT | não |  |  |
| `instagram_url` | TEXT | não |  |  |
| `deal_value` | NUMERIC(12, 2) | não |  |  |
| `closed_date` | TIMESTAMPTZ | não |  |  |
| `lead_source` | TEXT | não |  |  |
| `referral_name` | TEXT | não |  |  |
| `referral_commission` | NUMERIC(5,2) | não |  |  |
| `sd_id` | UUID | não |  | → profiles.id |
| `project_code` | VARCHAR(50) | não |  |  |
| `cep` | TEXT | não |  |  |
| `street` | TEXT | não |  |  |
| `number` | TEXT | não |  |  |
| `complement` | TEXT | não |  |  |
| `neighborhood` | TEXT | não |  |  |
| `city` | TEXT | não |  |  |
| `state` | TEXT | não |  |  |
| `sd_sub_status` | TEXT | não |  |  |
| `score_mql` | BOOLEAN | não | `FALSE` |  |
| `score_oportunidade_validada` | BOOLEAN | não | `FALSE` |  |
| `score_proposta_tecnica` | BOOLEAN | não | `FALSE` |  |
| `score_proposta_comercial` | BOOLEAN | não | `FALSE` |  |
| `score_negociacao` | BOOLEAN | não | `FALSE` |  |
| `score_fechado` | BOOLEAN | não | `FALSE` |  |
| `total_score` | INTEGER | não | `0` |  |
| `score_autoridade` | INTEGER | não | `0` | regra: score_autoridade >= 0 AND score_autoridade <= 5 |
| `score_dor_urgencia` | INTEGER | não | `0` | regra: score_dor_urgencia >= 0 AND score_dor_urgencia <= 5 |
| `score_business_case` | INTEGER | não | `0` | regra: score_business_case >= 0 AND score_business_case <= 5 |
| `score_aderencia_tecnica` | INTEGER | não | `0` | regra: score_aderencia_tecnica >= 0 AND score_aderencia_tecnica <= 5 |
| `score_diferenciacao` | INTEGER | não | `0` | regra: score_diferenciacao >= 0 AND score_diferenciacao <= 5 |
| `score_gestao_riscos` | INTEGER | não | `0` | regra: score_gestao_riscos >= 0 AND score_gestao_riscos <= 5 |
| `score_cronograma` | INTEGER | não | `0` | regra: score_cronograma >= 0 AND score_cronograma <= 5 |
| `score_modelo_comercial` | INTEGER | não | `0` | regra: score_modelo_comercial >= 0 AND score_modelo_comercial <= 5 |
| `score_patrocinador` | INTEGER | não | `0` | regra: score_patrocinador >= 0 AND score_patrocinador <= 5 |
| `value_parts` | DECIMAL(15,2) | não | `0` |  |
| `value_services` | DECIMAL(15,2) | não | `0` |  |
| `value_maintenance_contracts` | DECIMAL(15,2) | não | `0` |  |
| `value_equipment_sales` | DECIMAL(15,2) | não | `0` |  |
| `value_projects` | DECIMAL(15,2) | não | `0` |  |

## projects _(removida pela migração 207)_

Criada em `base/001_fix_complete_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | UUID | sim | `gen_random_uuid()` | chave primária |
| `name` | TEXT | sim |  |  |
| `value_goal` | NUMERIC(12, 2) | sim | `0` |  |
| `total_value` | NUMERIC(12, 2) | sim | `0` |  |
| `minimum_value` | NUMERIC(12, 2) | sim | `0` |  |
| `lead_goal` | INTEGER | sim | `0` |  |
| `closing_goal` | INTEGER | sim | `0` |  |
| `responsible_id` | UUID | não |  | → profiles.id (on delete set null) |
| `created_by` | UUID | não |  | → profiles.id (on delete set null) |
| `created_at` | TIMESTAMPTZ | não | `NOW()` |  |
| `updated_at` | TIMESTAMPTZ | não | `NOW()` |  |
| `cep` | TEXT | não |  |  |
| `street` | TEXT | não |  |  |
| `number` | TEXT | não |  |  |
| `complement` | TEXT | não |  |  |
| `neighborhood` | TEXT | não |  |  |
| `city` | TEXT | não |  |  |
| `state` | TEXT | não |  |  |
| `status` | TEXT | não | `'active'` |  |
| `latitude` | DOUBLE PRECISION | não |  |  |
| `longitude` | DOUBLE PRECISION | não |  |  |

## franchises _(removida pela migração 207)_

Criada em `base/001_fix_complete_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | UUID | sim | `gen_random_uuid()` | chave primária |
| `name` | TEXT | sim |  |  |
| `created_by` | UUID | não |  | → profiles.id (on delete set null) |
| `created_at` | TIMESTAMPTZ | não | `NOW()` |  |
| `updated_at` | TIMESTAMPTZ | não | `NOW()` |  |

## interactions _(removida pela migração 207)_

Criada em `base/001_fix_complete_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | UUID | sim | `gen_random_uuid()` | chave primária |
| `lead_id` | UUID | não |  | → leads.id (on delete cascade) |
| `user_id` | UUID | não |  | → profiles.id (on delete set null) |
| `type` | TEXT | sim |  | regra: type IN ('call', 'email', 'meeting', 'note', 'whatsapp', 'other') |
| `description` | TEXT | não |  |  |
| `created_at` | TIMESTAMPTZ | não | `NOW()` |  |

## system_users

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `auth_user_id` | uuid | não |  |  |
| `name` | text | sim |  |  |
| `email` | text | sim |  | único |
| `phone` | text | não |  |  |
| `profile` | text | sim |  | regra: profile in ('Administrador', 'Supervisor', 'Atendimento', 'Tecnico', 'Cliente') |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `permissions` | text[] | sim | `'{}'` |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## clients

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `type` | text | sim |  | regra: type in ('PF', 'PJ') |
| `name` | text | sim |  |  |
| `document` | text | não |  |  |
| `corporate_name` | text | não |  |  |
| `trade_name` | text | não |  |  |
| `state_registration` | text | não |  |  |
| `responsible_name` | text | não |  |  |
| `phone` | text | não |  |  |
| `mobile` | text | não |  |  |
| `email` | text | não |  |  |
| `zip_code` | text | não |  |  |
| `street` | text | não |  |  |
| `number` | text | não |  |  |
| `complement` | text | não |  |  |
| `district` | text | não |  |  |
| `city` | text | não |  |  |
| `state` | text | não |  |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo', 'Prospect') |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `party_id` | uuid | não |  |  |
| `municipal_registration` | text | não |  |  |
| `icms_indicator` | text | sim | `'9'` | regra: icms_indicator in ('1', '2', '9') |
| `contact_role` | text | não |  |  |
| `salesperson_id` | uuid | não |  | → salespeople.id (on delete set null) |
| `credit_limit` | numeric(14,2) | sim | `0` | regra: credit_limit >= 0 |
| `payment_condition_id` | uuid | não |  | → payment_conditions.id (on delete set null) |
| `commercial_notes` | text | não |  |  |

## client_contacts

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `client_id` | uuid | sim |  | → clients.id (on delete cascade) |
| `name` | text | sim |  |  |
| `role` | text | não |  |  |
| `phone` | text | não |  |  |
| `email` | text | não |  |  |
| `main` | boolean | sim | `false` |  |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## works _(removida pela migração 207)_

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `client_id` | uuid | sim |  | → clients.id (on delete restrict) |
| `code` | text | sim |  | único |
| `name` | text | sim |  |  |
| `type` | text | não |  |  |
| `status` | text | sim | `'Ativa'` | regra: status in ('Ativa', 'Em execucao', 'Pausada', 'Finalizada', 'Inativa') |
| `zip_code` | text | não |  |  |
| `street` | text | não |  |  |
| `number` | text | não |  |  |
| `complement` | text | não |  |  |
| `district` | text | não |  |  |
| `city` | text | não |  |  |
| `state` | text | não |  |  |
| `responsible_name` | text | não |  |  |
| `responsible_phone` | text | não |  |  |
| `responsible_email` | text | não |  |  |
| `responsible_role` | text | não |  |  |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## work_floors _(removida pela migração 207)_

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `work_id` | uuid | sim |  | → works.id (on delete cascade) |
| `name` | text | sim |  |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

Regras da tabela: `unique (work_id, name)`

## service_types

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  | único |
| `description` | text | não |  |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `execution_percentage` | numeric(7,3) | sim | `0` |  |
| `enabled_contexts` | text[] | sim | `array['obra']` |  |
| `required_photos` | text[] | sim | `'{}'` |  |
| `orientation_video_url` | text | não |  |  |
| `orientation_video_description` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `code` | text | não |  |  |
| `category` | text | não |  |  |
| `billing_unit` | text | sim | `'Servico'` |  |
| `default_price` | numeric(14,2) | sim | `0` |  |
| `estimated_cost` | numeric(14,2) | sim | `0` |  |
| `estimated_minutes` | integer | sim | `0` |  |
| `nfse_national_code` | text | não |  |  |
| `lc116_item` | text | não |  |  |
| `municipal_tax_code` | text | não |  |  |
| `nbs_code` | text | não |  |  |
| `iss_rate` | numeric(6,3) | sim | `0` |  |
| `iss_retained` | boolean | sim | `false` |  |
| `retentions` | jsonb | sim | `'{}'::jsonb` |  |
| `responsible_provider_id` | uuid | não |  | → providers.id (on delete set null) |
| `warranty_days` | integer | sim | `0` |  |

## work_environments _(removida pela migração 207)_

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `work_id` | uuid | sim |  | → works.id (on delete cascade) |
| `floor_id` | uuid | não |  | → work_floors.id (on delete set null) |
| `floor` | text | não |  |  |
| `final` | text | não |  |  |
| `environment_name` | text | sim |  |  |
| `service_type_id` | uuid | não |  | → service_types.id (on delete set null) |
| `points_quantity` | integer | sim | `1` | regra: points_quantity >= 0 |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## environment_photos _(removida pela migração 207)_

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `environment_id` | uuid | sim |  | → work_environments.id (on delete cascade) |
| `file_url` | text | não |  |  |
| `file_name` | text | não |  |  |
| `photo_type` | text | sim |  | regra: photo_type in ('Antes', 'Referencia', 'Local de instalacao', 'Problema encontrado', 'Outro') |
| `description` | text | não |  |  |
| `uploaded_by` | uuid | não |  | → system_users.id (on delete set null) |
| `created_at` | timestamptz | sim | `now()` |  |

## work_points _(removida pela migração 207)_

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `work_id` | uuid | sim |  | → works.id (on delete cascade) |
| `environment_id` | uuid | sim |  | → work_environments.id (on delete cascade) |
| `point_number` | integer | sim |  | regra: point_number > 0 |
| `point_name` | text | sim |  |  |
| `service_type_id` | uuid | não |  | → service_types.id (on delete set null) |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo', 'Pendente', 'Finalizado') |
| `equipment_expected` | text | não |  |  |
| `btus` | text | não |  |  |
| `brand` | text | não |  |  |
| `model` | text | não |  |  |
| `serial_number` | text | não |  |  |
| `evaporator_location` | text | não |  |  |
| `condenser_location` | text | não |  |  |
| `has_drain` | boolean | não |  |  |
| `has_electric_point` | boolean | não |  |  |
| `has_piping` | boolean | não |  |  |
| `infrastructure_measure` | text | não |  |  |
| `measurement_confirmation` | text | não |  |  |
| `technical_notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

Regras da tabela: `unique (environment_id, point_number)`

## point_photos _(removida pela migração 207)_

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `point_id` | uuid | sim |  | → work_points.id (on delete cascade) |
| `file_url` | text | não |  |  |
| `file_name` | text | não |  |  |
| `photo_type` | text | sim |  | regra: photo_type in ('Antes', 'Referencia', 'Local de instalacao', 'Problema encontrado', 'Outro') |
| `description` | text | não |  |  |
| `uploaded_by` | uuid | não |  | → system_users.id (on delete set null) |
| `created_at` | timestamptz | sim | `now()` |  |

## providers

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `auth_user_id` | uuid | não |  |  |
| `full_name` | text | sim |  |  |
| `cpf` | text | não |  |  |
| `rg` | text | não |  |  |
| `birth_date` | date | não |  |  |
| `phone` | text | não |  |  |
| `email` | text | não |  |  |
| `zip_code` | text | não |  |  |
| `street` | text | não |  |  |
| `number` | text | não |  |  |
| `complement` | text | não |  |  |
| `district` | text | não |  |  |
| `city` | text | não |  |  |
| `state` | text | não |  |  |
| `role` | text | sim |  |  |
| `relationship_type` | text | não |  |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo', 'Em ferias', 'Bloqueado') |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## provider_documents

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `provider_id` | uuid | sim |  | → providers.id (on delete cascade) |
| `type` | text | sim |  |  |
| `file_url` | text | não |  |  |
| `file_name` | text | não |  |  |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |

## vehicles

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `plate` | text | sim |  | único |
| `model` | text | sim |  |  |
| `brand` | text | sim |  |  |
| `year` | text | não |  |  |
| `color` | text | não |  |  |
| `current_km` | numeric(12,2) | sim | `0` |  |
| `front_right_tire` | text | não | `'Novo'` | regra: front_right_tire in ('Novo', '3/4 vida', 'Meia vida', '1/4 vida', 'Solicitar troca') |
| `front_left_tire` | text | não | `'Novo'` | regra: front_left_tire in ('Novo', '3/4 vida', 'Meia vida', '1/4 vida', 'Solicitar troca') |
| `rear_right_tire` | text | não | `'Novo'` | regra: rear_right_tire in ('Novo', '3/4 vida', 'Meia vida', '1/4 vida', 'Solicitar troca') |
| `rear_left_tire` | text | não | `'Novo'` | regra: rear_left_tire in ('Novo', '3/4 vida', 'Meia vida', '1/4 vida', 'Solicitar troca') |
| `last_oil_change_date` | date | não |  |  |
| `last_oil_change_km` | numeric(12,2) | não |  |  |
| `status` | text | sim | `'Disponivel'` | regra: status in ('Disponivel', 'Em uso', 'Em manutencao', 'Inativo') |
| `renavam` | text | não |  |  |
| `licensing_due_date` | date | não |  |  |
| `insurance_info` | text | não |  |  |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `internal_code` | text | sim | `('VEI-' \|\| lpad(nextval('public.vehicle_code_seq')::text, 5, '0'))` |  |
| `vehicle_type` | text | sim | `'Caminhao'` |  |
| `fleet_number` | text | não |  |  |
| `chassis` | text | não |  |  |
| `manufacture_year` | integer | não |  |  |
| `model_year` | integer | não |  |  |
| `owner_name` | text | não |  |  |
| `owner_document` | text | não |  |  |
| `unit_company_id` | uuid | não |  | → system_companies.id (on delete set null) |
| `body_type` | text | não |  |  |
| `load_capacity_kg` | numeric(12,2) | sim | `0` |  |
| `tare_kg` | numeric(12,2) | sim | `0` |  |
| `axles` | integer | sim | `0` |  |
| `current_hours` | numeric(12,1) | sim | `0` |  |
| `driver_id` | uuid | não |  | → fleet_drivers.id (on delete set null) |
| `acquisition_date` | date | não |  |  |
| `acquisition_value` | numeric(14,2) | sim | `0` |  |
| `insurer` | text | não |  |  |
| `policy_number` | text | não |  |  |
| `policy_expiry` | date | não |  |  |
| `coupled_vehicle_id` | uuid | não |  | → vehicles.id (on delete set null) |
| `photo_path` | text | não |  |  |

## materials

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `category` | text | não |  |  |
| `unit` | text | sim |  |  |
| `internal_code` | text | não |  |  |
| `minimum_stock` | numeric(12,3) | sim | `0` |  |
| `current_stock` | numeric(12,3) | sim | `0` |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `barcode` | text | não |  |  |
| `ncm` | text | não |  |  |
| `cest` | text | não |  |  |
| `origin` | text | não |  |  |
| `sped_item_type` | text | não |  |  |
| `maximum_stock` | numeric(12,3) | sim | `0` |  |
| `gross_weight` | numeric(12,3) | sim | `0` |  |
| `net_weight` | numeric(12,3) | sim | `0` |  |
| `height` | numeric(12,3) | sim | `0` |  |
| `width` | numeric(12,3) | sim | `0` |  |
| `length` | numeric(12,3) | sim | `0` |  |
| `location` | text | não |  |  |
| `cost_price` | numeric(14,4) | sim | `0` |  |
| `sale_price` | numeric(14,4) | sim | `0` |  |
| `supplier_id` | uuid | não |  | → suppliers.id (on delete set null) |
| `supplier_code` | text | não |  |  |
| `warehouse_id` | uuid | não |  | → warehouses.id (on delete set null) |
| `reorder_point` | numeric(12,3) | sim | `0` |  |
| `reserved_stock` | numeric(12,3) | sim | `0` |  |
| `average_cost` | numeric(14,4) | sim | `0` |  |
| `last_purchase_cost` | numeric(14,4) | sim | `0` |  |
| `controls_lot` | boolean | sim | `false` |  |
| `controls_serial` | boolean | sim | `false` |  |
| `controls_expiry` | boolean | sim | `false` |  |
| `item_type` | text | sim | `'Produto'` |  |
| `description` | text | não |  |  |
| `subcategory` | text | não |  |  |
| `brand` | text | não |  |  |
| `manufacturer` | text | não |  |  |
| `controls_stock` | boolean | sim | `true` |  |
| `allows_sale` | boolean | sim | `true` |  |
| `warranty_months` | integer | sim | `0` |  |
| `photo_url` | text | não |  |  |
| `technical_sheet_url` | text | não |  |  |

## service_type_checklist_items

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `service_type_id` | uuid | sim |  | → service_types.id (on delete cascade) |
| `task_name` | text | sim |  |  |
| `required` | boolean | sim | `true` |  |
| `requires_photo` | boolean | sim | `false` |  |
| `order_index` | integer | sim | `1` |  |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## service_type_materials

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `service_type_id` | uuid | sim |  | → service_types.id (on delete cascade) |
| `material_id` | uuid | não |  | → materials.id (on delete set null) |
| `quantity` | numeric(12,3) | sim | `0` |  |
| `unit` | text | sim |  |  |
| `required` | boolean | sim | `true` |  |

## service_orders

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `order_number` | text | sim |  | único |
| `order_type` | text | sim | `'obra'` |  |
| `service_category` | text | não |  |  |
| `client_id` | uuid | sim |  | → clients.id (on delete restrict) |
| `work_id` | uuid | sim |  | → works.id (on delete restrict) |
| `floor_id` | uuid | não |  | → work_floors.id (on delete set null) |
| `environment_id` | uuid | não |  | → work_environments.id (on delete set null) |
| `point_id` | uuid | não |  | → work_points.id (on delete set null) |
| `service_type_id` | uuid | não |  | → service_types.id (on delete set null) |
| `simple_service` | boolean | sim | `false` |  |
| `priority` | text | sim | `'Media'` | regra: priority in ('Baixa', 'Media', 'Alta', 'Urgente') |
| `description` | text | não |  |  |
| `scheduled_date` | date | não |  |  |
| `scheduled_start_time` | time | não |  |  |
| `scheduled_end_time` | time | não |  |  |
| `estimated_duration` | text | não |  |  |
| `allow_reschedule` | boolean | sim | `true` |  |
| `schedule_notes` | text | não |  |  |
| `main_provider_id` | uuid | não |  | → providers.id (on delete set null) |
| `helper_provider_id` | uuid | não |  | → providers.id (on delete set null) |
| `supervisor_id` | uuid | não |  | → providers.id (on delete set null) |
| `vehicle_id` | uuid | não |  | → vehicles.id (on delete set null) |
| `initial_km` | numeric(12,2) | não |  |  |
| `final_km` | numeric(12,2) | não |  |  |
| `total_amount` | numeric(12,2) | sim | `0` |  |
| `status` | text | sim | `'Criada'` | regra: status in ('Criada', 'Agendada', 'A caminho', 'Em execucao', 'Pausada', 'Aguardando material', 'Finalizada', 'Finalizada parcialmente', 'Agu |
| `customer_responsible_name` | text | não |  |  |
| `customer_responsible_phone` | text | não |  |  |
| `team_notes` | text | não |  |  |
| `notes` | text | não |  |  |
| `pause_reason` | text | não |  |  |
| `cancellation_reason` | text | não |  |  |
| `partial_reason` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `finished_at` | timestamptz | não |  |  |
| `cancelled_at` | timestamptz | não |  |  |
| `payment_method` | text | sim | `''` |  |
| `payment_type` | text | sim | `''` |  |
| `payment_term` | text | sim | `''` |  |
| `payment_due_date` | date | não |  |  |
| `financial_notes` | text | sim | `''` |  |
| `order_kind` | text | não |  |  |
| `customer_asset_id` | uuid | não |  | → customer_assets.id (on delete set null) |
| `due_date` | date | não |  |  |
| `team_provider_ids` | uuid[] | sim | `'{}'` |  |
| `entry_checklist` | jsonb | sim | `'[]'::jsonb` |  |
| `services_summary` | text | não |  |  |
| `hours_worked` | numeric(10,2) | sim | `0` |  |
| `labor_amount` | numeric(14,2) | sim | `0` |  |
| `materials_amount` | numeric(14,2) | sim | `0` |  |
| `discount_amount` | numeric(14,2) | sim | `0` |  |
| `discount_authorized_by` | text | não |  |  |
| `cost_amount` | numeric(14,2) | sim | `0` |  |
| `warranty_days` | integer | sim | `0` |  |
| `warranty_until` | date | não |  |  |
| `technical_notes` | text | não |  |  |
| `status_reason` | text | não |  |  |
| `suspended_from_status` | text | não |  |  |
| `delivered_at` | timestamptz | não |  |  |
| `opened_by` | text | não |  |  |
| `source_budget_id` | uuid | não |  |  |
| `production_product_id` | uuid | não |  | → materials.id (on delete set null) |
| `production_quantity` | numeric(12,3) | sim | `1` | regra: production_quantity > 0 |
| `production_serial` | text | não |  |  |
| `production_record_id` | uuid | não |  | → production_records.id (on delete set null) |
| `opportunity_id` | uuid | não |  | → opportunities.id (on delete set null) |
| `source_quote_id` | uuid | não |  | → quotes.id (on delete set null) |
| `contract_id` | uuid | não |  | → contracts.id (on delete set null) |

## service_order_events

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `service_order_id` | uuid | sim |  | → service_orders.id (on delete cascade) |
| `step_name` | text | sim |  |  |
| `status` | text | sim |  |  |
| `provider_id` | uuid | não |  | → providers.id (on delete set null) |
| `event_datetime` | timestamptz | sim | `now()` |  |
| `latitude` | numeric(10,7) | não |  |  |
| `longitude` | numeric(10,7) | não |  |  |
| `notes` | text | não |  |  |
| `file_id` | uuid | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |

Regras da tabela: `unique (service_order_id, step_name)`

## service_order_checklist_items

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `service_order_id` | uuid | sim |  | → service_orders.id (on delete cascade) |
| `task_name` | text | sim |  |  |
| `required` | boolean | sim | `true` |  |
| `requires_photo` | boolean | sim | `false` |  |
| `status` | text | sim | `'Pendente'` | regra: status in ('Pendente', 'Em andamento', 'Concluida', 'Nao se aplica') |
| `responsible_provider_id` | uuid | não |  | → providers.id (on delete set null) |
| `notes` | text | não |  |  |
| `completed_at` | timestamptz | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## service_order_materials

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `service_order_id` | uuid | sim |  | → service_orders.id (on delete cascade) |
| `material_id` | uuid | não |  | → materials.id (on delete set null) |
| `item_name` | text | sim |  |  |
| `expected_quantity` | numeric(12,3) | sim | `0` |  |
| `used_quantity` | numeric(12,3) | sim | `0` |  |
| `unit` | text | sim |  |  |
| `status` | text | sim | `'Previsto'` | regra: status in ('Previsto', 'Solicitado', 'Separado', 'Retirado', 'Utilizado', 'Devolvido', 'Pendente') |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `unit_price` | numeric(14,4) | sim | `0` |  |
| `unit_cost` | numeric(14,4) | sim | `0` |  |

## service_order_files

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `service_order_id` | uuid | sim |  | → service_orders.id (on delete cascade) |
| `category` | text | sim |  |  |
| `file_url` | text | não |  |  |
| `file_name` | text | não |  |  |
| `file_type` | text | não |  |  |
| `uploaded_by` | uuid | não |  | → providers.id (on delete set null) |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |

## service_order_signatures

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `service_order_id` | uuid | sim |  | → service_orders.id (on delete cascade) |
| `responsible_name` | text | sim |  |  |
| `responsible_document` | text | não |  |  |
| `signature_url` | text | não |  |  |
| `signature_text` | text | não |  |  |
| `rating` | text | não |  |  |
| `customer_notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |

## vehicle_checklists _(removida pela migração 207)_

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `service_order_id` | uuid | sim |  | → service_orders.id (on delete cascade) |
| `vehicle_id` | uuid | sim |  | → vehicles.id (on delete restrict) |
| `provider_id` | uuid | não |  | → providers.id (on delete set null) |
| `cleanliness_state` | text | sim |  |  |
| `conservation_state` | text | sim |  |  |
| `front_right_tire` | text | sim |  |  |
| `front_left_tire` | text | sim |  |  |
| `rear_right_tire` | text | sim |  |  |
| `rear_left_tire` | text | sim |  |  |
| `mandatory_safety_items` | boolean | sim | `false` |  |
| `oil_level` | text | sim |  |  |
| `brakes_test` | text | sim |  |  |
| `windshield_wipers` | text | sim |  |  |
| `mirrors` | text | sim |  |  |
| `lights` | text | sim |  |  |
| `fuel_level` | text | sim |  |  |
| `notes` | text | não |  |  |
| `accepted_at` | timestamptz | sim | `now()` |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

Regras da tabela: `unique (service_order_id)`

## vehicle_usage _(removida pela migração 207)_

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `vehicle_id` | uuid | sim |  | → vehicles.id (on delete restrict) |
| `provider_id` | uuid | não |  | → providers.id (on delete set null) |
| `service_order_id` | uuid | não |  | → service_orders.id (on delete set null) |
| `date` | date | sim |  |  |
| `initial_km` | numeric(12,2) | sim | `0` |  |
| `final_km` | numeric(12,2) | sim | `0` |  |
| `created_at` | timestamptz | sim | `now()` |  |

## vehicle_maintenance

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `vehicle_id` | uuid | sim |  | → vehicles.id (on delete cascade) |
| `type` | text | sim |  |  |
| `start_date` | date | sim |  |  |
| `end_date` | date | não |  |  |
| `km` | numeric(12,2) | não |  |  |
| `cost` | numeric(12,2) | sim | `0` |  |
| `description` | text | não |  |  |
| `next_maintenance` | date | não |  |  |
| `status` | text | sim | `'Programada'` | regra: status in ('Programada', 'Realizada') |
| `attachment_url` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `maintenance_type` | text | sim | `'Corretiva'` |  |
| `odometer` | numeric(12,2) | não |  |  |
| `hours` | numeric(12,1) | não |  |  |
| `service_description` | text | não |  |  |
| `service_order_id` | uuid | não |  | → service_orders.id (on delete set null) |
| `parts_replaced` | text | não |  |  |
| `workshop` | text | não |  |  |
| `parts_cost` | numeric(14,2) | sim | `0` |  |
| `labor_cost` | numeric(14,2) | sim | `0` |  |
| `next_date` | date | não |  |  |
| `next_km` | numeric(12,2) | não |  |  |
| `next_hours` | numeric(12,1) | não |  |  |
| `stopped_at` | timestamptz | não |  |  |
| `released_at` | timestamptz | não |  |  |
| `downtime_hours` | numeric(10,2) | não |  |  |
| `released_by` | text | não |  |  |

Regras da tabela: `check (end_date is null or end_date >= start_date)`

## operational_statuses _(removida pela migração 207)_

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `color` | text | sim | `'#2563EB'` |  |
| `order_index` | integer | sim | `1` |  |
| `final_status` | boolean | sim | `false` |  |
| `editable` | boolean | sim | `true` |  |
| `requires_reason` | boolean | sim | `false` |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## execution_steps _(removida pela migração 207)_

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `order_index` | integer | sim | `1` |  |
| `requires_photo` | boolean | sim | `false` |  |
| `requires_location` | boolean | sim | `false` |  |
| `requires_notes` | boolean | sim | `false` |  |
| `changes_status_to` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## dre_accounts

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `parent_id` | uuid | não |  | → dre_accounts.id (on delete set null) |
| `type` | text | sim |  | regra: type in ('receita', 'deducao', 'custo', 'despesa', 'resultado') |
| `order_index` | integer | sim | `1` |  |
| `signal` | text | sim | `'positivo'` | regra: signal in ('positivo', 'negativo', 'calculado') |
| `formula` | text | não |  |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## financial_categories

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `type` | text | sim |  | regra: type in ('entrada', 'saida', 'ambos') |
| `dre_account_id` | uuid | não |  | → dre_accounts.id (on delete set null) |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `code` | text | não |  |  |
| `group` | text | não |  |  |

## financial_subcategories

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `category_id` | uuid | sim |  | → financial_categories.id (on delete cascade) |
| `name` | text | sim |  |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

Regras da tabela: `unique (category_id, name)`

## cost_centers

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  | único |
| `description` | text | não |  |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `code` | text | não |  |  |
| `responsible` | text | não |  |  |
| `unit` | text | não |  |  |

## credit_cards

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `bank_name` | text | não |  |  |
| `card_last_digits` | text | não |  |  |
| `holder_name` | text | não |  |  |
| `card_account` | text | não |  |  |
| `closing_day` | integer | não |  | regra: closing_day between 1 and 31 |
| `due_day` | integer | não |  | regra: due_day between 1 and 31 |
| `credit_limit` | numeric(12,2) | sim | `0` |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## accounts_payable

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `supplier_name` | text | não |  |  |
| `description` | text | sim |  |  |
| `category_id` | uuid | não |  | → financial_categories.id (on delete set null) |
| `subcategory_id` | uuid | não |  | → financial_subcategories.id (on delete set null) |
| `cost_center_id` | uuid | não |  | → cost_centers.id (on delete set null) |
| `dre_account_id` | uuid | não |  | → dre_accounts.id (on delete set null) |
| `work_id` | uuid | não |  | → works.id (on delete set null) |
| `environment_id` | uuid | não |  | → work_environments.id (on delete set null) |
| `point_id` | uuid | não |  | → work_points.id (on delete set null) |
| `service_order_id` | uuid | não |  | → service_orders.id (on delete set null) |
| `provider_id` | uuid | não |  | → providers.id (on delete set null) |
| `vehicle_id` | uuid | não |  | → vehicles.id (on delete set null) |
| `competence_date` | date | não |  |  |
| `due_date` | date | sim |  |  |
| `payment_date` | date | não |  |  |
| `expected_amount` | numeric(12,2) | sim | `0` |  |
| `paid_amount` | numeric(12,2) | sim | `0` |  |
| `payment_method` | text | não |  |  |
| `bank_account_id` | uuid | não |  |  |
| `credit_card_id` | uuid | não |  | → credit_cards.id (on delete set null) |
| `credit_card_invoice_id` | uuid | não |  |  |
| `status` | text | sim | `'Aberta'` | regra: status in ('Aberta', 'Paga', 'Vencida', 'Parcialmente paga', 'Cancelada') |
| `origin` | text | sim | `'Manual'` |  |
| `notes` | text | não |  |  |
| `attachment_url` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `asaas_transfer_id` | uuid | não |  | → asaas_transfers.id (on delete set null) |
| `external_reference` | text | não |  |  |
| `supplier_id` | uuid | não |  | → suppliers.id (on delete set null) |
| `asaas_bill_payment_id` | uuid | não |  | → asaas_bill_payments.id (on delete set null) |
| `document_number` | text | não |  | adicionada por migração em bloco |
| `installment_number` | integer | não |  | adicionada por migração em bloco |
| `installment_count` | integer | não |  | adicionada por migração em bloco |
| `installment_group_id` | uuid | não |  | adicionada por migração em bloco |
| `payment_condition_id` | uuid references public.payment_conditions(id | não |  | adicionada por migração em bloco |
| `interest_amount` | numeric(14 | não |  | adicionada por migração em bloco |
| `fine_amount` | numeric(14 | não |  | adicionada por migração em bloco |
| `discount_amount` | numeric(14 | não |  | adicionada por migração em bloco |
| `source_type` | text not null default | não |  | adicionada por migração em bloco |
| `source_reference` | text | não |  | adicionada por migração em bloco |
| `created_by` | text | não |  | adicionada por migração em bloco |
| `updated_by` | text | não |  | adicionada por migração em bloco |

## accounts_receivable

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `client_id` | uuid | não |  | → clients.id (on delete set null) |
| `work_id` | uuid | não |  | → works.id (on delete set null) |
| `environment_id` | uuid | não |  | → work_environments.id (on delete set null) |
| `point_id` | uuid | não |  | → work_points.id (on delete set null) |
| `service_order_id` | uuid | não |  | → service_orders.id (on delete set null) |
| `description` | text | sim |  |  |
| `category_id` | uuid | não |  | → financial_categories.id (on delete set null) |
| `subcategory_id` | uuid | não |  | → financial_subcategories.id (on delete set null) |
| `cost_center_id` | uuid | não |  | → cost_centers.id (on delete set null) |
| `dre_account_id` | uuid | não |  | → dre_accounts.id (on delete set null) |
| `competence_date` | date | não |  |  |
| `due_date` | date | sim |  |  |
| `received_date` | date | não |  |  |
| `expected_amount` | numeric(12,2) | sim | `0` |  |
| `received_amount` | numeric(12,2) | sim | `0` |  |
| `receipt_method` | text | não |  |  |
| `bank_account_id` | uuid | não |  |  |
| `status` | text | sim | `'Aberta'` | regra: status in ('Aberta', 'Recebida', 'Vencida', 'Parcialmente recebida', 'Cancelada') |
| `origin` | text | sim | `'Manual'` |  |
| `notes` | text | não |  |  |
| `attachment_url` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `asaas_payment_id` | uuid | não |  | → asaas_payments.id (on delete set null) |
| `external_reference` | text | não |  |  |
| `document_number` | text | não |  | adicionada por migração em bloco |
| `installment_number` | integer | não |  | adicionada por migração em bloco |
| `installment_count` | integer | não |  | adicionada por migração em bloco |
| `installment_group_id` | uuid | não |  | adicionada por migração em bloco |
| `payment_condition_id` | uuid references public.payment_conditions(id | não |  | adicionada por migração em bloco |
| `interest_amount` | numeric(14 | não |  | adicionada por migração em bloco |
| `fine_amount` | numeric(14 | não |  | adicionada por migração em bloco |
| `discount_amount` | numeric(14 | não |  | adicionada por migração em bloco |
| `source_type` | text not null default | não |  | adicionada por migração em bloco |
| `source_reference` | text | não |  | adicionada por migração em bloco |
| `created_by` | text | não |  | adicionada por migração em bloco |
| `updated_by` | text | não |  | adicionada por migração em bloco |

## credit_card_invoices

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `credit_card_id` | uuid | sim |  | → credit_cards.id (on delete cascade) |
| `reference_month` | integer | sim |  | regra: reference_month between 1 and 12 |
| `reference_year` | integer | sim |  |  |
| `due_date` | date | não |  |  |
| `holder_name` | text | não |  |  |
| `card_account` | text | não |  |  |
| `total_amount` | numeric(12,2) | sim | `0` |  |
| `imported_amount` | numeric(12,2) | sim | `0` |  |
| `difference_amount` | numeric(12,2) | sim | `0` |  |
| `status` | text | sim | `'Importada'` | regra: status in ('Importada', 'Em revisao', 'Conferida', 'Paga', 'Cancelada') |
| `pdf_file_url` | text | não |  |  |
| `pdf_file_name` | text | não |  |  |
| `raw_text` | text | não |  |  |
| `accounts_payable_id` | uuid | não |  | → accounts_payable.id (on delete set null) |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## financial_transactions

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `type` | text | sim |  | regra: type in ('entrada', 'saida') |
| `description` | text | sim |  |  |
| `category_id` | uuid | não |  | → financial_categories.id (on delete set null) |
| `subcategory_id` | uuid | não |  | → financial_subcategories.id (on delete set null) |
| `cost_center_id` | uuid | não |  | → cost_centers.id (on delete set null) |
| `dre_account_id` | uuid | não |  | → dre_accounts.id (on delete set null) |
| `client_id` | uuid | não |  | → clients.id (on delete set null) |
| `work_id` | uuid | não |  | → works.id (on delete set null) |
| `environment_id` | uuid | não |  | → work_environments.id (on delete set null) |
| `point_id` | uuid | não |  | → work_points.id (on delete set null) |
| `service_order_id` | uuid | não |  | → service_orders.id (on delete set null) |
| `provider_id` | uuid | não |  | → providers.id (on delete set null) |
| `vehicle_id` | uuid | não |  | → vehicles.id (on delete set null) |
| `supplier_name` | text | não |  |  |
| `competence_date` | date | não |  |  |
| `due_date` | date | não |  |  |
| `realized_date` | date | não |  |  |
| `expected_amount` | numeric(12,2) | sim | `0` |  |
| `realized_amount` | numeric(12,2) | sim | `0` |  |
| `payment_method` | text | não |  |  |
| `bank_account_id` | uuid | não |  |  |
| `credit_card_id` | uuid | não |  | → credit_cards.id (on delete set null) |
| `credit_card_invoice_id` | uuid | não |  | → credit_card_invoices.id (on delete set null) |
| `accounts_payable_id` | uuid | não |  | → accounts_payable.id (on delete set null) |
| `accounts_receivable_id` | uuid | não |  | → accounts_receivable.id (on delete set null) |
| `status` | text | sim | `'Previsto'` | regra: status in ('Previsto', 'Realizado', 'Vencido', 'Cancelado') |
| `origin` | text | sim | `'Manual'` |  |
| `notes` | text | não |  |  |
| `attachment_url` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `asaas_account_id` | uuid | não |  | → asaas_accounts.id (on delete set null) |
| `asaas_statement_entry_id` | uuid | não |  | → asaas_statement_entries.id (on delete set null) |
| `external_reference` | text | não |  |  |

## category_rules

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `priority` | integer | sim | `100` |  |
| `search_text` | text | sim |  |  |
| `normalized_search_text` | text | sim |  |  |
| `comparison_type` | text | sim |  | regra: comparison_type in ('Contem', 'Comeca com', 'Igual', 'Regex', 'Similaridade') |
| `category_id` | uuid | não |  | → financial_categories.id (on delete set null) |
| `subcategory_id` | uuid | não |  | → financial_subcategories.id (on delete set null) |
| `cost_center_id` | uuid | não |  | → cost_centers.id (on delete set null) |
| `dre_account_id` | uuid | não |  | → dre_accounts.id (on delete set null) |
| `credit_card_id` | uuid | não |  | → credit_cards.id (on delete set null) |
| `card_holder` | text | não |  |  |
| `default_confidence` | text | sim | `'Alta'` | regra: default_confidence in ('Alta', 'Media', 'Baixa') |
| `active` | boolean | sim | `true` |  |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## credit_card_invoice_items

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `invoice_id` | uuid | sim |  | → credit_card_invoices.id (on delete cascade) |
| `purchase_date` | date | não |  |  |
| `original_description` | text | sim |  |  |
| `normalized_description` | text | não |  |  |
| `current_installment` | integer | não |  |  |
| `total_installments` | integer | não |  |  |
| `city` | text | não |  |  |
| `card_holder` | text | não |  |  |
| `card_last_digits` | text | não |  |  |
| `amount` | numeric(12,2) | sim | `0` |  |
| `category_id` | uuid | não |  | → financial_categories.id (on delete set null) |
| `subcategory_id` | uuid | não |  | → financial_subcategories.id (on delete set null) |
| `cost_center_id` | uuid | não |  | → cost_centers.id (on delete set null) |
| `dre_account_id` | uuid | não |  | → dre_accounts.id (on delete set null) |
| `category_rule_id` | uuid | não |  | → category_rules.id (on delete set null) |
| `category_confidence` | text | não |  | regra: category_confidence in ('Alta', 'Media', 'Baixa', 'Sem categoria') |
| `category_status` | text | sim | `'Sem categoria'` | regra: category_status in ('Categorizado automaticamente', 'Categorizado manualmente', 'Sem categoria', 'Baixa confianca') |
| `review_status` | text | sim | `'Pendente'` | regra: review_status in ('Pendente', 'Conferido', 'Ignorado', 'Duplicado') |
| `linked_transaction_id` | uuid | não |  | → financial_transactions.id (on delete set null) |
| `linked_service_order_id` | uuid | não |  | → service_orders.id (on delete set null) |
| `linked_work_id` | uuid | não |  | → works.id (on delete set null) |
| `linked_environment_id` | uuid | não |  | → work_environments.id (on delete set null) |
| `linked_point_id` | uuid | não |  | → work_points.id (on delete set null) |
| `linked_vehicle_id` | uuid | não |  | → vehicles.id (on delete set null) |
| `linked_provider_id` | uuid | não |  | → providers.id (on delete set null) |
| `source_page` | integer | não |  |  |
| `raw_line` | text | não |  |  |
| `extraction_confidence` | numeric(5,2) | não |  |  |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## audit_logs

Criada em `base/100_climatizacao_mvp_schema.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `user_id` | uuid | não |  | → system_users.id (on delete set null) |
| `entity_type` | text | sim |  |  |
| `entity_id` | uuid | não |  |  |
| `action` | text | sim |  |  |
| `description` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |

## suppliers

Criada em `base/108_add_suppliers.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `document` | text | não |  |  |
| `contact_name` | text | não |  |  |
| `phone` | text | não |  |  |
| `email` | text | não |  |  |
| `category` | text | não |  |  |
| `city` | text | não |  |  |
| `state` | text | não |  |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `category_ids` | uuid[] | sim | `'{}'` |  |
| `party_id` | uuid | não |  |  |
| `person_type` | text | sim | `'PJ'` | regra: person_type in ('PF', 'PJ') |
| `trade_name` | text | não |  |  |
| `state_registration` | text | não |  |  |
| `municipal_registration` | text | não |  |  |
| `icms_indicator` | text | sim | `'1'` | regra: icms_indicator in ('1', '2', '9') |
| `zip_code` | text | não |  |  |
| `street` | text | não |  |  |
| `number` | text | não |  |  |
| `complement` | text | não |  |  |
| `district` | text | não |  |  |
| `contact_role` | text | não |  |  |
| `payment_condition_id` | uuid | não |  | → payment_conditions.id (on delete set null) |
| `commercial_notes` | text | não |  |  |

## asaas_accounts

Criada em `base/157_add_asaas_dual_account_integration.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `code` | text | sim |  | regra: code in ('services', 'materials'); único |
| `name` | text | sim |  |  |
| `purpose` | text | sim |  | regra: purpose in ('service_nfse', 'material_nfe') |
| `environment` | text | sim | `'sandbox'` | regra: environment in ('sandbox', 'production') |
| `enabled` | boolean | sim | `true` |  |
| `wallet_id` | text | não |  |  |
| `last_statement_sync_at` | timestamptz | não |  |  |
| `last_webhook_at` | timestamptz | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## asaas_customers

Criada em `base/157_add_asaas_dual_account_integration.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `account_id` | uuid | sim |  | → asaas_accounts.id (on delete cascade) |
| `client_id` | uuid | sim |  | → clients.id (on delete cascade) |
| `asaas_customer_id` | text | sim |  |  |
| `snapshot` | jsonb | sim | `'{}'::jsonb` |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

Regras da tabela: `unique (account_id, client_id)`; `unique (account_id, asaas_customer_id)`

## asaas_payments

Criada em `base/157_add_asaas_dual_account_integration.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `account_id` | uuid | sim |  | → asaas_accounts.id (on delete restrict) |
| `asaas_payment_id` | text | sim |  |  |
| `asaas_customer_id` | text | não |  |  |
| `service_order_id` | uuid | não |  | → service_orders.id (on delete set null) |
| `client_id` | uuid | não |  | → clients.id (on delete set null) |
| `work_id` | uuid | não |  | → works.id (on delete set null) |
| `accounts_receivable_id` | uuid | não |  | → accounts_receivable.id (on delete set null) |
| `external_reference` | text | não |  |  |
| `billing_type` | text | não |  |  |
| `status` | text | sim | `'PENDING'` |  |
| `value` | numeric(14,2) | sim | `0` |  |
| `net_value` | numeric(14,2) | sim | `0` |  |
| `due_date` | date | não |  |  |
| `payment_date` | date | não |  |  |
| `invoice_url` | text | não |  |  |
| `bank_slip_url` | text | não |  |  |
| `pix_payload` | jsonb | sim | `'{}'::jsonb` |  |
| `payload` | jsonb | sim | `'{}'::jsonb` |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `idempotency_key` | text | não |  |  |
| `created_by` | uuid | não |  |  |
| `requester_ip` | inet | não |  |  |

Regras da tabela: `unique (account_id, asaas_payment_id)`

## asaas_transfers

Criada em `base/157_add_asaas_dual_account_integration.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `account_id` | uuid | sim |  | → asaas_accounts.id (on delete restrict) |
| `asaas_transfer_id` | text | sim |  |  |
| `service_order_id` | uuid | não |  | → service_orders.id (on delete set null) |
| `accounts_payable_id` | uuid | não |  | → accounts_payable.id (on delete set null) |
| `external_reference` | text | não |  |  |
| `status` | text | sim | `'PENDING'` |  |
| `value` | numeric(14,2) | sim | `0` |  |
| `effective_date` | date | não |  |  |
| `operation_type` | text | não |  |  |
| `receipt_url` | text | não |  |  |
| `payload` | jsonb | sim | `'{}'::jsonb` |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `supplier_id` | uuid | não |  | → suppliers.id (on delete set null) |
| `idempotency_key` | text | não |  |  |
| `created_by` | uuid | não |  |  |
| `requester_ip` | inet | não |  |  |

Regras da tabela: `unique (account_id, asaas_transfer_id)`

## asaas_statement_entries

Criada em `base/157_add_asaas_dual_account_integration.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `account_id` | uuid | sim |  | → asaas_accounts.id (on delete cascade) |
| `asaas_transaction_id` | text | sim |  |  |
| `transaction_type` | text | sim |  |  |
| `direction` | text | sim |  | regra: direction in ('entrada', 'saida') |
| `value` | numeric(14,2) | sim | `0` |  |
| `transaction_date` | date | sim |  |  |
| `description` | text | não |  |  |
| `external_reference` | text | não |  |  |
| `service_order_id` | uuid | não |  | → service_orders.id (on delete set null) |
| `financial_transaction_id` | uuid | não |  | → financial_transactions.id (on delete set null) |
| `payload` | jsonb | sim | `'{}'::jsonb` |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

Regras da tabela: `unique (account_id, asaas_transaction_id)`

## asaas_fiscal_documents

Criada em `base/157_add_asaas_dual_account_integration.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `account_id` | uuid | sim |  | → asaas_accounts.id (on delete restrict) |
| `service_order_id` | uuid | não |  | → service_orders.id (on delete set null) |
| `payment_id` | uuid | não |  | → asaas_payments.id (on delete set null) |
| `document_kind` | text | sim |  | regra: document_kind in ('service', 'material') |
| `provider` | text | sim |  | regra: provider in ('asaas_nfse', 'base_nfe') |
| `asaas_invoice_id` | text | não |  |  |
| `external_document_id` | text | não |  |  |
| `external_reference` | text | não |  |  |
| `status` | text | sim | `'PENDING'` |  |
| `value` | numeric(14,2) | sim | `0` |  |
| `effective_date` | date | não |  |  |
| `document_number` | text | não |  |  |
| `validation_code` | text | não |  |  |
| `pdf_url` | text | não |  |  |
| `xml_url` | text | não |  |  |
| `payload` | jsonb | sim | `'{}'::jsonb` |  |
| `error_message` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `client_id` | uuid | não |  | → clients.id (on delete set null) |
| `item_code` | text | não |  |  |
| `item_name` | text | não |  |  |
| `created_by` | uuid | não |  |  |
| `requester_ip` | inet | não |  |  |

## asaas_webhook_events

Criada em `base/157_add_asaas_dual_account_integration.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `account_id` | uuid | sim |  | → asaas_accounts.id (on delete cascade) |
| `event_id` | text | sim |  |  |
| `event_type` | text | sim |  |  |
| `resource_type` | text | sim | `'unknown'` |  |
| `resource_id` | text | não |  |  |
| `payload` | jsonb | sim |  |  |
| `received_at` | timestamptz | sim | `now()` |  |
| `processed_at` | timestamptz | não |  |  |
| `processing_error` | text | não |  |  |
| `reprocess_attempts` | integer | sim | `0` |  |

Regras da tabela: `unique (account_id, event_id)`

## asaas_bill_payments

Criada em `base/158_add_asaas_financial_operations.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `account_id` | uuid | sim |  | → asaas_accounts.id (on delete restrict) |
| `supplier_id` | uuid | não |  | → suppliers.id (on delete set null) |
| `accounts_payable_id` | uuid | não |  | → accounts_payable.id (on delete set null) |
| `asaas_bill_id` | text | sim |  |  |
| `idempotency_key` | text | não |  |  |
| `external_reference` | text | não |  |  |
| `status` | text | sim | `'PENDING'` |  |
| `value` | numeric(14,2) | sim | `0` |  |
| `due_date` | date | não |  |  |
| `schedule_date` | date | não |  |  |
| `payment_date` | date | não |  |  |
| `description` | text | não |  |  |
| `receipt_url` | text | não |  |  |
| `payload` | jsonb | sim | `'{}'::jsonb` |  |
| `created_by` | uuid | não |  |  |
| `requester_ip` | inet | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

Regras da tabela: `unique (account_id, asaas_bill_id)`

## asaas_balance_snapshots

Criada em `base/158_add_asaas_financial_operations.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `account_id` | uuid | sim |  | → asaas_accounts.id (on delete cascade) |
| `balance` | numeric(14,2) | sim | `0` |  |
| `payload` | jsonb | sim | `'{}'::jsonb` |  |
| `fetched_at` | timestamptz | sim | `now()` |  |

## system_companies

Criada em `base/159_add_multi_company_tenancy.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `legal_name` | text | sim | `''` |  |
| `trade_name` | text | sim | `''` |  |
| `cnpj` | text | não |  |  |
| `email` | text | não |  |  |
| `phone` | text | não |  |  |
| `address` | text | não |  |  |
| `active` | boolean | sim | `true` |  |
| `is_default` | boolean | sim | `false` |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `logo_path` | text | não |  |  |
| `state_registration` | text | não |  |  |
| `municipal_registration` | text | não |  |  |
| `tax_regime` | text | não |  | regra: tax_regime in ('Simples Nacional', 'MEI', 'Lucro Presumido', 'Lucro Real') |
| `cnae` | text | não |  |  |
| `zip_code` | text | não |  |  |
| `street` | text | não |  |  |
| `number` | text | não |  |  |
| `complement` | text | não |  |  |
| `district` | text | não |  |  |
| `city` | text | não |  |  |
| `state` | text | não |  |  |
| `certificate_path` | text | não |  |  |
| `certificate_name` | text | não |  |  |
| `certificate_expires_at` | date | não |  |  |
| `certificate_password_enc` | text | não |  |  |
| `fiscal_environment` | text | sim | `'Homologação'` | regra: fiscal_environment in ('Homologação', 'Produção') |
| `nfe_series` | text | não |  |  |
| `nfe_next_number` | integer | não |  | regra: nfe_next_number is null or nfe_next_number >= 1 |
| `nfse_series` | text | não |  |  |
| `nfse_next_number` | integer | não |  | regra: nfse_next_number is null or nfse_next_number >= 1 |
| `fiscal_notes` | text | não |  |  |

## bank_accounts

Criada em `201_financeiro_erp.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `bank_name` | text | não |  |  |
| `bank_code` | text | não |  |  |
| `agency` | text | não |  |  |
| `account_number` | text | não |  |  |
| `account_type` | text | sim | `'Corrente'` | regra: account_type in ('Corrente', 'Poupanca', 'Pagamento', 'Caixa', 'Investimento') |
| `holder_name` | text | não |  |  |
| `holder_document` | text | não |  |  |
| `pix_key` | text | não |  |  |
| `initial_balance` | numeric(14,2) | sim | `0` |  |
| `initial_balance_date` | date | não |  |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## payment_conditions

Criada em `201_financeiro_erp.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `installments` | integer | sim | `1` | regra: installments between 1 and 120 |
| `first_due_days` | integer | sim | `0` | regra: first_due_days >= 0 |
| `interval_days` | integer | sim | `30` | regra: interval_days >= 0 |
| `payment_method` | text | não |  |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## warehouses

Criada em `202_estoque_movimentacoes.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `code` | text | não |  |  |
| `name` | text | sim |  |  |
| `address` | text | não |  |  |
| `responsible` | text | não |  |  |
| `is_default` | boolean | sim | `false` |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `branch_id` | uuid | não |  | → branches.id (on delete set null) |

## stock_balances

Criada em `202_estoque_movimentacoes.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `material_id` | uuid | sim |  | → materials.id (on delete cascade) |
| `warehouse_id` | uuid | sim |  | → warehouses.id (on delete restrict) |
| `quantity` | numeric(14,3) | sim | `0` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

Regras da tabela: `primary key (material_id, warehouse_id)`

## stock_movements

Criada em `202_estoque_movimentacoes.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `material_id` | uuid | sim |  | → materials.id (on delete restrict) |
| `movement_type` | text | sim |  | regra: movement_type in ( 'Saldo inicial', 'Entrada por compra', 'Saida por venda', 'Consumo em OS', 'Consumo em kit', 'Transferencia', 'Devolucao' |
| `quantity` | numeric(14,3) | sim |  | regra: quantity > 0 |
| `from_warehouse_id` | uuid | não |  | → warehouses.id (on delete restrict) |
| `to_warehouse_id` | uuid | não |  | → warehouses.id (on delete restrict) |
| `unit_cost` | numeric(14,4) | sim | `0` |  |
| `total_cost` | numeric(14,2) | sim | `0` |  |
| `balance_after` | numeric(14,3) | não |  |  |
| `occurred_at` | timestamptz | sim | `now()` |  |
| `responsible` | text | não |  |  |
| `document_reference` | text | não |  |  |
| `reason` | text | não |  |  |
| `notes` | text | não |  |  |
| `service_order_id` | uuid | não |  |  |
| `reservation_id` | uuid | não |  |  |
| `lot_number` | text | não |  |  |
| `serial_number` | text | não |  |  |
| `expiry_date` | date | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |

## stock_reservations

Criada em `202_estoque_movimentacoes.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `material_id` | uuid | sim |  | → materials.id (on delete cascade) |
| `warehouse_id` | uuid | não |  | → warehouses.id (on delete set null) |
| `service_order_id` | uuid | não |  |  |
| `quantity` | numeric(14,3) | sim |  | regra: quantity > 0 |
| `status` | text | sim | `'Ativa'` | regra: status in ('Ativa', 'Consumida', 'Cancelada') |
| `responsible` | text | não |  |  |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## purchase_orders

Criada em `203_compras.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `order_number` | text | sim | `('PC-' \|\| lpad(nextval('public.purchase_order_number_seq')::text, 6, '0'))` |  |
| `supplier_id` | uuid | sim |  | → suppliers.id (on delete restrict) |
| `supplier_name` | text | sim |  |  |
| `status` | text | sim | `'Rascunho'` | regra: status in ('Rascunho', 'Aprovado', 'Parcialmente recebido', 'Recebido', 'Encerrado', 'Cancelado') |
| `order_date` | date | sim | `current_date` |  |
| `expected_date` | date | não |  |  |
| `warehouse_id` | uuid | não |  | → warehouses.id (on delete set null) |
| `payment_condition_id` | uuid | não |  | → payment_conditions.id (on delete set null) |
| `payment_method` | text | não |  |  |
| `financial_category_id` | uuid | não |  | → financial_categories.id (on delete set null) |
| `cost_center_id` | uuid | não |  | → cost_centers.id (on delete set null) |
| `supplier_reference` | text | não |  |  |
| `items_total` | numeric(14,2) | sim | `0` |  |
| `freight_amount` | numeric(14,2) | sim | `0` |  |
| `other_costs` | numeric(14,2) | sim | `0` |  |
| `discount_amount` | numeric(14,2) | sim | `0` |  |
| `total_amount` | numeric(14,2) | sim | `0` |  |
| `notes` | text | não |  |  |
| `created_by` | text | não |  |  |
| `approved_by` | text | não |  |  |
| `approved_at` | timestamptz | não |  |  |
| `closed_reason` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## purchase_order_items

Criada em `203_compras.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `purchase_order_id` | uuid | sim |  | → purchase_orders.id (on delete cascade) |
| `material_id` | uuid | sim |  | → materials.id (on delete restrict) |
| `description` | text | sim |  |  |
| `unit` | text | sim | `'UN'` |  |
| `quantity` | numeric(14,3) | sim |  | regra: quantity > 0 |
| `unit_cost` | numeric(14,4) | sim | `0` | regra: unit_cost >= 0 |
| `discount_percent` | numeric(6,3) | sim | `0` | regra: discount_percent between 0 and 100 |
| `total` | numeric(14,2) | sim | `0` |  |
| `received_quantity` | numeric(14,3) | sim | `0` | regra: received_quantity >= 0 |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## purchase_receipts

Criada em `203_compras.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `purchase_order_id` | uuid | sim |  | → purchase_orders.id (on delete restrict) |
| `invoice_number` | text | sim |  |  |
| `invoice_date` | date | não |  |  |
| `received_at` | date | sim | `current_date` |  |
| `items_amount` | numeric(14,2) | sim | `0` |  |
| `extra_costs_amount` | numeric(14,2) | sim | `0` |  |
| `total_amount` | numeric(14,2) | sim | `0` |  |
| `payables_generated` | integer | sim | `0` |  |
| `responsible` | text | não |  |  |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## purchase_receipt_items

Criada em `203_compras.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `receipt_id` | uuid | sim |  | → purchase_receipts.id (on delete cascade) |
| `order_item_id` | uuid | sim |  | → purchase_order_items.id (on delete restrict) |
| `material_id` | uuid | sim |  | → materials.id (on delete restrict) |
| `quantity` | numeric(14,3) | sim |  | regra: quantity > 0 |
| `unit_cost` | numeric(14,4) | sim | `0` |  |
| `lot_number` | text | não |  |  |
| `serial_number` | text | não |  |  |
| `expiry_date` | date | não |  |  |
| `stock_movement_id` | uuid | não |  | → stock_movements.id (on delete set null) |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## dashboard_preferences

Criada em `204_dashboard_preferencias.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `user_id` | uuid | sim |  | chave primária |
| `config` | jsonb | sim | `'{}'::jsonb` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## product_fiscal_rules

Criada em `205_catalogo_produtos_servicos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `material_id` | uuid | sim |  | → materials.id (on delete cascade) |
| `operation` | text | sim |  |  |
| `tax_regime` | text | sim | `'Todos'` | regra: tax_regime in ('Todos', 'Simples Nacional', 'Lucro Presumido', 'Lucro Real', 'MEI') |
| `cfop` | text | não |  | regra: cfop is null or cfop ~ '^[1-7][0-9]{3}$' |
| `cst_csosn` | text | não |  |  |
| `ibs_cbs_cst` | text | não |  |  |
| `ibs_cbs_class` | text | não |  |  |
| `valid_from` | date | não |  |  |
| `valid_to` | date | não |  |  |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

Regras da tabela: `check (valid_to is null or valid_from is null or valid_to >= valid_from)`

## product_compositions

Criada em `205_catalogo_produtos_servicos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `product_id` | uuid | sim |  | → materials.id (on delete cascade) |
| `version` | integer | sim |  | regra: version > 0 |
| `status` | text | sim | `'Ativa'` | regra: status in ('Ativa', 'Inativa') |
| `labor_cost` | numeric(14,2) | sim | `0` | regra: labor_cost >= 0 |
| `assembly_minutes` | integer | sim | `0` | regra: assembly_minutes >= 0 |
| `notes` | text | não |  |  |
| `created_by` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |

Regras da tabela: `unique (product_id, version)`

## product_composition_items

Criada em `205_catalogo_produtos_servicos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `composition_id` | uuid | sim |  | → product_compositions.id (on delete cascade) |
| `component_id` | uuid | sim |  | → materials.id (on delete restrict) |
| `quantity` | numeric(14,4) | sim |  | regra: quantity > 0 |
| `unit` | text | sim |  |  |
| `loss_percent` | numeric(6,3) | sim | `0` | regra: loss_percent >= 0 and loss_percent < 100 |
| `notes` | text | não |  |  |

## production_records

Criada em `205_catalogo_produtos_servicos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `composition_id` | uuid | sim |  | → product_compositions.id (on delete restrict) |
| `product_id` | uuid | sim |  | → materials.id (on delete restrict) |
| `quantity` | numeric(14,3) | sim |  | regra: quantity > 0 |
| `materials_cost` | numeric(14,2) | sim | `0` |  |
| `labor_cost` | numeric(14,2) | sim | `0` |  |
| `unit_cost` | numeric(14,4) | sim | `0` |  |
| `from_warehouse_id` | uuid | não |  | → warehouses.id (on delete set null) |
| `to_warehouse_id` | uuid | não |  | → warehouses.id (on delete set null) |
| `document_reference` | text | não |  |  |
| `responsible` | text | não |  |  |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |

## customer_assets

Criada em `206_ordem_servico_erp.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `client_id` | uuid | sim |  | → clients.id (on delete cascade) |
| `asset_type` | text | sim | `'Carreta'` | regra: asset_type in ('Carreta', 'Semirreboque', 'Reboque', 'Caminhão', 'Cavalo mecânico', 'Veículo', 'Equipamento') |
| `identification` | text | sim |  |  |
| `plate` | text | não |  |  |
| `chassis` | text | não |  |  |
| `renavam` | text | não |  |  |
| `brand` | text | não |  |  |
| `model` | text | não |  |  |
| `manufacture_year` | integer | não |  |  |
| `axles` | integer | não |  |  |
| `notes` | text | não |  |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## service_order_services

Criada em `206_ordem_servico_erp.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `service_order_id` | uuid | sim |  | → service_orders.id (on delete cascade) |
| `service_type_id` | uuid | não |  | → service_types.id (on delete set null) |
| `description` | text | sim |  |  |
| `quantity` | numeric(12,3) | sim | `1` | regra: quantity > 0 |
| `unit` | text | sim | `'Servico'` |  |
| `unit_price` | numeric(14,2) | sim | `0` | regra: unit_price >= 0 |
| `executed` | boolean | sim | `false` |  |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## service_order_time_entries

Criada em `206_ordem_servico_erp.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `service_order_id` | uuid | sim |  | → service_orders.id (on delete cascade) |
| `provider_id` | uuid | não |  | → providers.id (on delete set null) |
| `work_date` | date | sim | `current_date` |  |
| `hours` | numeric(8,2) | sim |  | regra: hours > 0 and hours <= 24 |
| `hourly_cost` | numeric(14,2) | sim | `0` | regra: hourly_cost >= 0 |
| `notes` | text | não |  |  |
| `created_by` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## service_order_status_history

Criada em `206_ordem_servico_erp.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `service_order_id` | uuid | sim |  | → service_orders.id (on delete cascade) |
| `from_status` | text | não |  |  |
| `to_status` | text | sim |  |  |
| `reason` | text | não |  |  |
| `changed_by` | text | não |  |  |
| `changed_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## fleet_drivers

Criada em `208_frota_erp.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `cpf` | text | sim |  |  |
| `phone` | text | não |  |  |
| `cnh_number` | text | sim |  |  |
| `cnh_category` | text | sim |  |  |
| `cnh_expiry` | date | sim |  |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## vehicle_documents

Criada em `208_frota_erp.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `vehicle_id` | uuid | sim |  | → vehicles.id (on delete cascade) |
| `doc_type` | text | sim |  |  |
| `description` | text | não |  |  |
| `expiry_date` | date | não |  |  |
| `file_path` | text | não |  |  |
| `file_name` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |

## fuel_entries

Criada em `208_frota_erp.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `vehicle_id` | uuid | sim |  | → vehicles.id (on delete restrict) |
| `driver_id` | uuid | não |  | → fleet_drivers.id (on delete set null) |
| `fuel_date` | date | sim |  |  |
| `station` | text | não |  |  |
| `fuel_type` | text | sim |  |  |
| `liters` | numeric(12,3) | sim |  | regra: liters > 0 |
| `price_per_liter` | numeric(10,4) | sim |  | regra: price_per_liter > 0 |
| `total_amount` | numeric(14,2) | sim | `0` |  |
| `odometer` | numeric(12,2) | não |  |  |
| `receipt_path` | text | não |  |  |
| `receipt_name` | text | não |  |  |
| `notes` | text | não |  |  |
| `created_by` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## vehicle_tires

Criada em `208_frota_erp.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `vehicle_id` | uuid | sim |  | → vehicles.id (on delete cascade) |
| `position` | text | sim |  |  |
| `serial_number` | text | não |  |  |
| `brand` | text | não |  |  |
| `size` | text | não |  |  |
| `fitted_date` | date | não |  |  |
| `fitted_km` | numeric(12,2) | não |  |  |
| `condition` | text | sim | `'Novo'` | regra: condition in ('Novo', '3/4 vida', 'Meia vida', '1/4 vida', 'Solicitar troca') |
| `notes` | text | não |  |  |
| `updated_at` | timestamptz | sim | `now()` |  |

Regras da tabela: `unique (vehicle_id, position)`

## trips

Criada em `208_frota_erp.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `vehicle_id` | uuid | sim |  | → vehicles.id (on delete restrict) |
| `trailer_id` | uuid | não |  | → vehicles.id (on delete set null) |
| `driver_id` | uuid | não |  | → fleet_drivers.id (on delete set null) |
| `client_id` | uuid | não |  | → clients.id (on delete set null) |
| `origin` | text | não |  |  |
| `destination` | text | não |  |  |
| `start_date` | date | sim |  |  |
| `end_date` | date | não |  |  |
| `start_km` | numeric(12,2) | sim | `0` |  |
| `end_km` | numeric(12,2) | não |  |  |
| `freight_amount` | numeric(14,2) | sim | `0` |  |
| `tolls_amount` | numeric(14,2) | sim | `0` |  |
| `allowance_amount` | numeric(14,2) | sim | `0` |  |
| `other_costs` | numeric(14,2) | sim | `0` |  |
| `status` | text | sim | `'Planejada'` | regra: status in ('Planejada', 'Em andamento', 'Concluída', 'Cancelada') |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

Regras da tabela: `check (end_date is null or end_date >= start_date)`

## fleet_settings

Criada em `208_frota_erp.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | boolean | sim | `true` | regra: id; chave primária |
| `road_transport` | boolean | sim | `false` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## salespeople

Criada em `209_comercial.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `email` | text | não |  |  |
| `phone` | text | não |  |  |
| `status` | text | sim | `'Ativo'` | regra: status in ('Ativo', 'Inativo') |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## opportunities

Criada em `209_comercial.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `code` | text | sim | `('OP-' \|\| lpad(nextval('public.opportunity_number_seq')::text, 6, '0'))` |  |
| `title` | text | sim |  |  |
| `client_id` | uuid | sim |  | → clients.id (on delete restrict) |
| `salesperson_id` | uuid | sim |  | → salespeople.id (on delete restrict) |
| `origin` | text | não |  |  |
| `interest` | text | sim |  |  |
| `material_id` | uuid | não |  | → materials.id (on delete set null) |
| `estimated_value` | numeric(14,2) | sim | `0` | regra: estimated_value >= 0 |
| `stage` | text | sim | `'Novo lead'` | regra: stage in ('Novo lead', 'Contato realizado', 'Qualificação', 'Orçamento', 'Negociação', 'Ganho', 'Perdido') |
| `probability` | integer | sim | `10` | regra: probability between 0 and 100 |
| `expected_close_date` | date | não |  |  |
| `next_contact_date` | date | não |  |  |
| `loss_reason` | text | não |  |  |
| `quote_id` | uuid | não |  |  |
| `quote_number` | text | não |  |  |
| `closed_at` | timestamptz | não |  |  |
| `created_by` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## opportunity_interactions

Criada em `209_comercial.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `opportunity_id` | uuid | sim |  | → opportunities.id (on delete cascade) |
| `kind` | text | sim |  |  |
| `description` | text | sim |  |  |
| `interaction_at` | timestamptz | sim | `now()` |  |
| `automatic` | boolean | sim | `false` |  |
| `author` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## quotes

Criada em `210_orcamentos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `quote_number` | text | sim | `('ORC-' \|\| lpad(nextval('public.quote_number_seq')::text, 6, '0'))` |  |
| `version` | integer | sim | `1` | regra: version >= 1 |
| `title` | text | não |  |  |
| `client_id` | uuid | sim |  | → clients.id (on delete restrict) |
| `salesperson_id` | uuid | sim |  | → salespeople.id (on delete restrict) |
| `opportunity_id` | uuid | não |  | → opportunities.id (on delete set null) |
| `issue_date` | date | sim | `current_date` |  |
| `valid_until` | date | sim |  |  |
| `quote_type` | text | sim |  | regra: quote_type in ('Produto', 'Serviço', 'Misto') |
| `status` | text | sim | `'Rascunho'` | regra: status in ('Rascunho', 'Enviado', 'Aprovado', 'Recusado', 'Expirado', 'Convertido', 'Cancelado', 'Substituído') |
| `items_subtotal` | numeric(14,2) | sim | `0` |  |
| `discount_amount` | numeric(14,2) | sim | `0` | regra: discount_amount >= 0 |
| `freight_amount` | numeric(14,2) | sim | `0` | regra: freight_amount >= 0 |
| `expenses_amount` | numeric(14,2) | sim | `0` | regra: expenses_amount >= 0 |
| `tax_percent` | numeric(6,3) | sim | `0` | regra: tax_percent >= 0 and tax_percent <= 100 |
| `taxes_amount` | numeric(14,2) | sim | `0` |  |
| `total_amount` | numeric(14,2) | sim | `0` |  |
| `estimated_cost` | numeric(14,2) | sim | `0` |  |
| `payment_condition_id` | uuid | não |  | → payment_conditions.id (on delete set null) |
| `payment_condition_name` | text | não |  |  |
| `payment_condition_snapshot` | jsonb | não |  |  |
| `delivery_text` | text | não |  |  |
| `warranty_days` | integer | sim | `0` | regra: warranty_days >= 0 |
| `notes` | text | não |  |  |
| `sent_at` | timestamptz | não |  |  |
| `sent_via` | text | não |  |  |
| `sent_to` | text | não |  |  |
| `approved_at` | timestamptz | não |  |  |
| `accepted_by` | text | não |  |  |
| `accept_notes` | text | não |  |  |
| `refusal_reason` | text | não |  |  |
| `converted_at` | timestamptz | não |  |  |
| `converted_to` | text | não |  | regra: converted_to in ('Venda', 'OS') |
| `receivables_generated_at` | timestamptz | não |  |  |
| `created_by` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

Regras da tabela: `check (valid_until >= issue_date)`

## quote_items

Criada em `210_orcamentos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `quote_id` | uuid | sim |  | → quotes.id (on delete cascade) |
| `position` | integer | sim | `0` |  |
| `line_type` | text | sim |  | regra: line_type in ('Produto', 'Serviço') |
| `material_id` | uuid | não |  | → materials.id (on delete set null) |
| `service_type_id` | uuid | não |  | → service_types.id (on delete set null) |
| `description` | text | sim |  |  |
| `unit` | text | sim | `'UN'` |  |
| `quantity` | numeric(14,3) | sim |  | regra: quantity > 0 |
| `unit_price` | numeric(14,4) | sim |  | regra: unit_price >= 0 |
| `catalog_price` | numeric(14,4) | sim | `0` |  |
| `unit_cost` | numeric(14,4) | sim | `0` |  |
| `discount_percent` | numeric(6,3) | sim | `0` | regra: discount_percent between 0 and 100 |
| `total` | numeric(14,2) | sim | `0` |  |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## quote_attachments

Criada em `210_orcamentos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `quote_id` | uuid | sim |  | → quotes.id (on delete cascade) |
| `file_path` | text | sim |  |  |
| `file_name` | text | sim |  |  |
| `created_by` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## quote_events

Criada em `210_orcamentos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `quote_id` | uuid | sim |  | → quotes.id (on delete cascade) |
| `event` | text | sim |  |  |
| `description` | text | sim |  |  |
| `author` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## contracts _(removida pela migração 207)_

Criada em `211_contratos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `contract_number` | text | sim | `('CTR-' \|\| lpad(nextval('public.contract_number_seq')::text, 6, '0'))` |  |
| `contract_type` | text | sim |  | regra: contract_type in ('Prestação de serviços', 'Fornecimento', 'Manutenção recorrente', 'Comercial / venda', 'Outro') |
| `direction` | text | sim | `'Receita'` | regra: direction in ('Receita', 'Despesa') |
| `title` | text | sim |  |  |
| `client_id` | uuid | não |  | → clients.id (on delete restrict) |
| `supplier_id` | uuid | não |  | → suppliers.id (on delete restrict) |
| `quote_id` | uuid | não |  | → quotes.id (on delete set null) |
| `signed_date` | date | não |  |  |
| `start_date` | date | sim |  |  |
| `end_date` | date | não |  |  |
| `indefinite` | boolean | sim | `false` |  |
| `total_value` | numeric(14,2) | sim | `0` | regra: total_value >= 0 |
| `initial_recurring_value` | numeric(14,2) | sim | `0` | regra: initial_recurring_value >= 0 |
| `recurring_value` | numeric(14,2) | sim | `0` | regra: recurring_value >= 0 |
| `billing_periodicity` | text | não |  | regra: billing_periodicity in ('Mensal', 'Bimestral', 'Trimestral', 'Semestral', 'Anual') |
| `due_day` | integer | não |  | regra: due_day between 1 and 31 |
| `billing_start_date` | date | não |  |  |
| `billing_advance_days` | integer | sim | `10` | regra: billing_advance_days between 0 and 90 |
| `payment_method` | text | sim |  |  |
| `adjustment_index` | text | sim | `'Nenhum'` | regra: adjustment_index in ('Nenhum', 'IPCA', 'IGP-M', 'INPC', 'Percentual fixo', 'Outro') |
| `adjustment_percent` | numeric(7,3) | não |  |  |
| `next_adjustment_date` | date | não |  |  |
| `notice_days` | integer | sim | `0` | regra: notice_days >= 0 |
| `auto_renew` | boolean | sim | `false` |  |
| `renewal_months` | integer | não |  | regra: renewal_months > 0 |
| `penalty_terms` | text | não |  |  |
| `scope` | text | sim |  |  |
| `sla` | text | não |  |  |
| `responsible_user_id` | uuid | não |  | → profiles.id (on delete set null) |
| `responsible_name` | text | sim |  |  |
| `status` | text | sim | `'Rascunho'` | regra: status in ('Rascunho', 'Aguardando assinatura', 'Vigente', 'Suspenso', 'Encerrado', 'Rescindido', 'Cancelado') |
| `status_reason` | text | não |  |  |
| `version` | integer | sim | `1` |  |
| `created_by` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

Regras da tabela: `check ((direction = 'Receita' and client_id is not null) or (direction = 'Despesa' and supplier_id is not null))`; `check (end_date is null or end_date >= start_date)`

## contract_billings

Criada em `211_contratos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `contract_id` | uuid | sim |  | → contracts.id (on delete restrict) |
| `competence_date` | date | sim |  |  |
| `period_end` | date | sim |  |  |
| `due_date` | date | sim |  |  |
| `amount` | numeric(14,2) | sim |  |  |
| `receivable_id` | uuid | não |  |  |
| `payable_id` | uuid | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

Regras da tabela: `unique (contract_id, competence_date)`

## contract_amendments

Criada em `211_contratos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `contract_id` | uuid | sim |  | → contracts.id (on delete restrict) |
| `amendment_number` | integer | sim |  |  |
| `kind` | text | sim |  | regra: kind in ('Aditivo de valor', 'Aditivo de prazo', 'Reajuste', 'Renovação', 'Alteração de escopo', 'Outro') |
| `description` | text | sim |  |  |
| `effective_date` | date | sim |  |  |
| `before_snapshot` | jsonb | sim | `'{}'::jsonb` |  |
| `after_snapshot` | jsonb | sim | `'{}'::jsonb` |  |
| `new_recurring_value` | numeric(14,2) | não |  |  |
| `created_by` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

Regras da tabela: `unique (contract_id, amendment_number)`

## contract_documents

Criada em `211_contratos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `contract_id` | uuid | sim |  | → contracts.id (on delete restrict) |
| `amendment_id` | uuid | não |  | → contract_amendments.id (on delete restrict) |
| `kind` | text | sim |  | regra: kind in ('Contrato assinado', 'Aditivo', 'Evidência de aceite', 'Rescisão', 'Outro') |
| `title` | text | sim |  |  |
| `version` | integer | sim | `1` |  |
| `is_original` | boolean | sim | `false` |  |
| `file_path` | text | sim |  |  |
| `file_name` | text | sim |  |  |
| `signed_at` | date | não |  |  |
| `created_by` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## contract_obligations

Criada em `211_contratos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `contract_id` | uuid | sim |  | → contracts.id (on delete cascade) |
| `kind` | text | sim | `'Obrigação'` | regra: kind in ('Obrigação', 'Documento') |
| `title` | text | sim |  |  |
| `description` | text | não |  |  |
| `party` | text | sim | `'Contratada'` | regra: party in ('Contratante', 'Contratada') |
| `responsible_name` | text | não |  |  |
| `due_date` | date | não |  |  |
| `status` | text | sim | `'Pendente'` | regra: status in ('Pendente', 'Cumprida', 'Cancelada') |
| `completed_at` | timestamptz | não |  |  |
| `notes` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## contract_os_plans

Criada em `211_contratos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `contract_id` | uuid | sim |  | → contracts.id (on delete cascade) |
| `title` | text | sim |  |  |
| `periodicity` | text | sim |  | regra: periodicity in ('Semanal', 'Quinzenal', 'Mensal', 'Bimestral', 'Trimestral', 'Semestral', 'Anual') |
| `order_kind` | text | sim | `'Manutenção preventiva'` |  |
| `service_type_id` | uuid | sim |  | → service_types.id (on delete restrict) |
| `technician_id` | uuid | sim |  | → providers.id (on delete restrict) |
| `customer_asset_id` | uuid | não |  | → customer_assets.id (on delete set null) |
| `priority` | text | sim | `'Media'` |  |
| `description` | text | não |  |  |
| `lead_days` | integer | sim | `3` | regra: lead_days between 0 and 60 |
| `next_run_date` | date | sim |  |  |
| `last_run_date` | date | não |  |  |
| `active` | boolean | sim | `true` |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## contract_os_runs

Criada em `211_contratos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `plan_id` | uuid | sim |  | → contract_os_plans.id (on delete cascade) |
| `scheduled_date` | date | sim |  |  |
| `service_order_id` | uuid | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

Regras da tabela: `unique (plan_id, scheduled_date)`

## contract_events

Criada em `211_contratos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `contract_id` | uuid | sim |  | → contracts.id (on delete cascade) |
| `event` | text | sim |  |  |
| `description` | text | sim |  |  |
| `author` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## contract_alert_log

Criada em `211_contratos.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `contract_id` | uuid | sim |  | → contracts.id (on delete cascade) |
| `alert_key` | text | sim |  |  |
| `recipient` | text | não |  |  |
| `notified_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

Regras da tabela: `unique (contract_id, alert_key)`

## saved_reports

Criada em `212_relatorios.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `module` | text | sim |  |  |
| `report_id` | text | sim |  |  |
| `period_kind` | text | sim | `'Mês atual'` |  |
| `start_date` | date | não |  |  |
| `end_date` | date | não |  |  |
| `filters` | jsonb | sim | `'{}'::jsonb` |  |
| `columns` | jsonb | sim | `'[]'::jsonb` |  |
| `group_by` | text | não |  |  |
| `sort_key` | text | não |  |  |
| `sort_dir` | text | não |  | regra: sort_dir in ('asc', 'desc') |
| `show_totals` | boolean | sim | `true` |  |
| `format` | text | sim | `'PDF'` | regra: format in ('PDF', 'Excel', 'CSV') |
| `authorized_user_ids` | uuid[] | sim | `'{}'` |  |
| `frequency` | text | sim | `'Sob demanda'` | regra: frequency in ('Sob demanda', 'Diária', 'Semanal', 'Mensal') |
| `weekday` | integer | não |  | regra: weekday between 0 and 6 |
| `day_of_month` | integer | não |  | regra: day_of_month between 1 and 31 |
| `next_run_date` | date | não |  |  |
| `last_run_at` | timestamptz | não |  |  |
| `active` | boolean | sim | `true` |  |
| `created_by` | uuid | não |  |  |
| `created_by_name` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## report_runs

Criada em `212_relatorios.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `saved_report_id` | uuid | não |  | → saved_reports.id (on delete set null) |
| `report_id` | text | sim |  |  |
| `report_name` | text | sim |  |  |
| `origin` | text | sim |  | regra: origin in ('Manual', 'Exportação', 'Agendado') |
| `format` | text | não |  |  |
| `period_start` | date | não |  |  |
| `period_end` | date | não |  |  |
| `row_count` | integer | sim | `0` |  |
| `user_id` | uuid | não |  |  |
| `user_name` | text | não |  |  |
| `delivered_to` | text[] | sim | `'{}'` |  |
| `status` | text | sim | `'OK'` | regra: status in ('OK', 'Falha') |
| `error` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## audit_events

Criada em `213_auditoria.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `seq` | bigint | sim |  |  |
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `occurred_at` | timestamptz | sim | `clock_timestamp()` |  |
| `system_company_id` | uuid | não |  |  |
| `actor_id` | uuid | não |  |  |
| `actor_email` | text | não |  |  |
| `module` | text | sim |  |  |
| `action` | text | sim |  |  |
| `table_name` | text | não |  |  |
| `record_id` | text | não |  |  |
| `description` | text | sim |  |  |
| `old_values` | jsonb | não |  |  |
| `new_values` | jsonb | não |  |  |
| `changed_fields` | text[] | não |  |  |
| `ip_address` | text | não |  |  |
| `session_id` | text | não |  |  |
| `request_id` | text | não |  |  |
| `result` | text | sim | `'Sucesso'` | regra: result in ('Sucesso', 'Falha', 'Negado') |
| `reason` | text | não |  |  |
| `origin` | text | sim | `'Sistema'` | regra: origin in ('Usuário', 'API', 'Integração', 'Agendador', 'Sistema') |
| `prev_hash` | text | sim |  |  |
| `hash` | text | sim |  |  |

## audit_settings

Criada em `213_auditoria.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `system_company_id` | uuid | sim |  | chave primária |
| `retention_days` | integer | sim | `1825` | regra: retention_days >= 365 |
| `updated_by` | text | não |  |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## branches

Criada em `214_configuracoes.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `company_id` | uuid | sim |  | → system_companies.id (on delete restrict) |
| `code` | text | não |  |  |
| `name` | text | sim |  |  |
| `zip_code` | text | não |  |  |
| `street` | text | não |  |  |
| `number` | text | não |  |  |
| `complement` | text | não |  |  |
| `district` | text | não |  |  |
| `city` | text | não |  |  |
| `state` | text | não |  |  |
| `phone` | text | não |  |  |
| `manager_name` | text | não |  |  |
| `active` | boolean | sim | `true` |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |

## profile_companies

Criada em `214_configuracoes.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `profile_id` | uuid | sim |  | → profiles.id (on delete cascade) |
| `company_id` | uuid | sim |  | → system_companies.id (on delete cascade) |
| `created_at` | timestamptz | sim | `now()` |  |

Regras da tabela: `primary key (profile_id, company_id)`

## app_settings

Criada em `214_configuracoes.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `system_company_id` | uuid | sim | `'00000000-0000-4000-8000-000000000001'::uuid` | → system_companies.id (on delete cascade) |
| `key` | text | sim |  |  |
| `value` | jsonb | sim | `'{}'::jsonb` |  |
| `updated_by` | text | não |  |  |
| `updated_at` | timestamptz | sim | `now()` |  |

Regras da tabela: `primary key (system_company_id, key)`

## fiscal_operation_natures

Criada em `214_configuracoes.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `kind` | text | sim | `'Venda'` | regra: kind in ('Venda', 'Serviço', 'Remessa', 'Devolução', 'Outra') |
| `default_cfop` | text | não |  | regra: default_cfop is null or default_cfop ~ '^[1-7][0-9]{3}$' |
| `notes` | text | não |  |  |
| `active` | boolean | sim | `true` |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## price_tables

Criada em `214_configuracoes.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `client_id` | uuid | não |  | → clients.id (on delete set null) |
| `valid_from` | date | sim | `current_date` |  |
| `valid_until` | date | não |  |  |
| `notes` | text | não |  |  |
| `active` | boolean | sim | `true` |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

Regras da tabela: `check (valid_until is null or valid_until >= valid_from)`

## price_table_items

Criada em `214_configuracoes.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `price_table_id` | uuid | sim |  | → price_tables.id (on delete cascade) |
| `material_id` | uuid | não |  | → materials.id (on delete cascade) |
| `service_type_id` | uuid | não |  | → service_types.id (on delete cascade) |
| `price` | numeric(14,4) | sim |  | regra: price >= 0 |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

Regras da tabela: `check ((material_id is not null)::int + (service_type_id is not null)::int = 1)`

## quote_templates

Criada em `214_configuracoes.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `name` | text | sim |  |  |
| `quote_type` | text | não |  | regra: quote_type in ('Produto', 'Serviço', 'Misto') |
| `validity_days` | integer | sim | `15` | regra: validity_days between 1 and 365 |
| `payment_condition_id` | uuid | não |  | → payment_conditions.id (on delete set null) |
| `delivery_text` | text | não |  |  |
| `warranty_days` | integer | sim | `0` | regra: warranty_days >= 0 |
| `notes` | text | não |  |  |
| `active` | boolean | sim | `true` |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `updated_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |

## documents

Criada em `214_configuracoes.sql`.

| Campo | Tipo | Obrigatório | Padrão | Relação / regra |
|---|---|---|---|---|
| `id` | uuid | sim | `gen_random_uuid()` | chave primária |
| `doc_type` | text | sim |  |  |
| `title` | text | sim |  |  |
| `entity_type` | text | não |  |  |
| `entity_ref` | text | não |  |  |
| `version` | integer | sim | `1` |  |
| `file_path` | text | sim |  |  |
| `file_name` | text | sim |  |  |
| `visibility` | text | sim | `'Todos'` | regra: visibility in ('Todos', 'Administradores', 'Responsável') |
| `responsible_id` | uuid | não |  |  |
| `responsible_name` | text | não |  |  |
| `doc_date` | date | sim | `current_date` |  |
| `notes` | text | não |  |  |
| `created_by` | text | não |  |  |
| `created_at` | timestamptz | sim | `now()` |  |
| `system_company_id` | uuid not null default %L::uuid references public.system_companies(id | não |  | adicionada por migração em bloco |
