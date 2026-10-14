# ERP Carretas - Instalação do banco no Supabase (projeto vazio)

Estes arquivos recriam o banco completo em um projeto Supabase **sem nenhuma tabela**.
A cadeia inteira foi testada em um Postgres real (PGlite) com um stub de `auth`, `storage` e roles do Supabase: **zero erros**, 94 tabelas em `public`, e todas as tabelas e funções (`.from()` / `.rpc()`) usadas pelo código do app existem.

## Como executar

No Supabase: **SQL Editor > New query**. Para cada arquivo abaixo, **na ordem**: abra o arquivo, copie todo o conteúdo, cole e clique em **Run**. Espere terminar antes de passar para o próximo.

| # | Arquivo | O que contém |
|---|---------|--------------|
| 1 | `01_base_sistema_e_perfis.sql` | `base/100` (tabelas-base: clients, providers, vehicles, materials, service_types, service_orders, financeiro, audit_logs...) e `base/101` (tabela `profiles`, perfis/roles, trigger `on_auth_user_created`, RLS) |
| 2 | `02_base_financeiro_asaas_multiempresa.sql` | `base/102` e `103` (financeiro, DRE), `106`/`110`/`117`/`118`/`119`/`133` (ajustes de OS, fornecedores, escopo de cliente), `157`/`158` (Asaas), **patch_159_pre**, `159` (multiempresa/`system_companies`, RLS por empresa), `160` x2 e `161` (cadastros compartilhados) |
| 3 | `03_erp_200_a_206.sql` | Migrações ERP 200 a 206: produtos, financeiro ERP, estoque, compras, dashboard, catálogo (bucket `catalog-files`), ordem de serviço |
| 4 | `04_erp_207_a_211.sql` | 207 (remove estruturas herdadas do sistema anterior), 208 frota (bucket `fleet-files`), 209 comercial, 210 orçamentos (bucket `quote-files`), 211 contratos (bucket `contract-files`) |
| 5 | `05_erp_212_a_215_e_buckets.sql` | 212 relatórios, 213 auditoria, 214 configurações (bucket `company-files`), 215 clientes/fornecedores, **patch_bucket_service_order_files** (bucket `service-order-files`) |

Ordem sequencial completa (cada item é um script original, na mesma ordem dos arquivos acima):

1. base/100_climatizacao_mvp_schema
2. base/101_auth_profiles_setup
3. base/102_financeiro_complete_schema
4. base/103_financeiro_minimo_dre_entradas_saidas
5. base/106_single_final_photo_service_orders
6. base/108_add_suppliers
7. base/110_allow_point_photos_service_orders
8. base/117_add_service_order_total_amount
9. base/118_fix_service_types_supabase_fields
10. base/119_add_service_order_category
11. base/133_add_client_user_scope
12. base/157_add_asaas_dual_account_integration
13. base/158_add_asaas_financial_operations
14. supabase/patch_159_pre (novo)
15. base/159_add_multi_company_tenancy
16. base/160_add_supplier_financial_categories
17. base/160_share_master_registries
18. base/161_share_operational_master_registries
19. 200_add_material_erp_fields
20. 201_financeiro_erp
21. 202_estoque_movimentacoes
22. 203_compras
23. 204_dashboard_preferencias
24. 205_catalogo_produtos_servicos
25. 206_ordem_servico_erp
26. 207_remover_estruturas_herdadas
27. 208_frota_erp
28. 209_comercial
29. 210_orcamentos
30. 211_contratos
31. 212_relatorios
32. 213_auditoria
33. 214_configuracoes
34. 215_clientes_fornecedores
35. supabase/patch_bucket_service_order_files (novo)

## Avisos importantes

- **Rode cada arquivo uma única vez, em banco vazio.** Depois do arquivo 4 (script 207) as tabelas legadas (`works` etc.) deixam de existir; reexecutar os arquivos 1 a 3 falharia com `column "work_id" does not exist`. Os arquivos 4 e 5 podem ser reexecutados.
- O Supabase pode mostrar um aviso de "operação destrutiva" ao colar o arquivo 4 (contém `drop table ... cascade` do 207). Em banco vazio é seguro: confirme.
- Se um arquivo falhar no meio, o SQL Editor interrompe naquele ponto. Se acontecer, apague o schema (`drop schema public cascade; create schema public;` + regrante dos privilégios padrão do Supabase) ou recrie o projeto, e recomece do arquivo 1.

## Scripts de `scripts/base` deliberadamente NÃO incluídos

- `000_initial_schema`, `001_*` (4 variações de RLS de profiles), `002_create_profile_trigger`, `003_create_admin_user` (usuário fixo), `004`-`031`: legado do app de franquias/leads (projects, leads, metas, franchises). Substituídos por `base/101` e não usados pelo ERP (nenhuma dessas tabelas é consultada pelo código).
- `base/124_add_os_financial_instructions`: altera `pmoc_plans`, tabela que não existe mais (PMOC removido) e falha em banco vazio. As colunas `payment_*`/`financial_notes` de `service_orders` não são usadas pelo app.
- Peso morto dentro de `base/100` e `159`: tabelas de obras/ambientes/pontos (works, work_*, point_photos...), vehicle_checklists/usage, operational_statuses, execution_steps. O 207 remove a maioria; foi mantido porque `service_orders`, `clients`, `materials`, `vehicles`, `providers`, financeiro e `audit_logs` nascem ali e o 159 cria `system_companies`.

## Patches novos (únicas adições; nenhum script original foi alterado)

- `patch_159_pre.sql`: o `159` cria índices únicos `(system_company_id, name/plate)` em `service_types` e `vehicles`, mas não adiciona a coluna nessas tabelas (no sistema antigo ela já existia). Sem o patch o 159 falha em banco vazio.
- `patch_bucket_service_order_files.sql`: o app usa o bucket `service-order-files` (upload de fotos/arquivos da OS) e nenhuma migração o criava.

## Primeiro usuário administrador

O app decide admin por `profiles.role = 'admin'` (e `active = true`), via `lib/server-authorization.ts`. Um trigger em `auth.users` cria o `profiles` automaticamente com `role = 'user'`.

1. Supabase > **Authentication > Users > Add user** (marque *Auto Confirm User*), informando e-mail e senha. (Ou cadastre-se pela tela de login do app, se o signup estiver habilitado.)
2. No SQL Editor, promova:

```sql
update public.profiles
set role = 'admin', active = true
where email = 'seu-email@empresa.com.br';
```

3. Opcional: para o admin ver tudo, deixe `profile_companies` sem vínculos (perfil sem vínculo tem acesso a todas as empresas). A empresa padrão criada é "Carretas" (`system_companies`, id `00000000-0000-4000-8000-000000000001`); ajuste razão social/CNPJ em Configurações do app.

Demais usuários podem ser criados pelo próprio app (tela de Configurações/Usuários) depois que houver um admin.

## Passos manuais fora do SQL

- **Storage buckets**: todos criados pelos scripts (`catalog-files` público; `fleet-files`, `quote-files`, `contract-files`, `company-files`, `service-order-files` privados). Nada a fazer; confira em Storage.
- **Variáveis de ambiente do app** (Vercel/.env): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (obrigatórias); `CONFIG_ENCRYPTION_KEY`, `CRON_SECRET`, `RESEND_API_KEY`, `SYSTEM_ALERT_EMAIL`, `SYSTEM_ALERT_FROM_EMAIL`, `REPORT_FROM_EMAIL`, `CONTRACT_FROM_EMAIL`, chaves Asaas/NotaAS conforme `.env.example`.
- **Crons**: não usam `pg_cron` nem `pg_net`. São rotas HTTP agendadas pela Vercel (`vercel.json`: contratos, relatórios, auditoria, notificações) protegidas por `CRON_SECRET`; nada a configurar no Supabase.
- **Auth settings**: ajuste URL do site/redirects em Authentication > URL Configuration; habilite ou desabilite signup público conforme desejar; se usar MFA (campo `profiles.mfa_required`), habilite MFA em Authentication.
- **Extensões**: apenas `pgcrypto` (já disponível no Supabase; `create extension if not exists` está nos scripts).
