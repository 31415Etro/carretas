# Inventário de endpoints e páginas

> Gerado por análise estática do repositório (`app/api/**/route.ts` e bibliotecas em `lib/`) em 19/10/2026, mais as medições do [baseline de performance](performance-baseline.md).
> **Como ler:** "Tabelas" junta as tabelas acessadas no próprio arquivo e nas bibliotecas importadas (análise estática, pode incluir tabelas usadas só em alguns ramos). "Carrega tudo" = usa `readAllPages` (lê a tabela inteira em páginas de 1.000 linhas). "select(*)" = há `select("*")` no arquivo ou nas bibliotecas dele. A medição vem da empresa ND Carretas Fort, 5 chamadas sequenciais, servidor `next dev` local.

## Resumo

- **104 rotas** e **137 handlers** HTTP (GET/POST/PUT/PATCH/DELETE).
- **37 rotas** leem tabelas inteiras (`readAllPages`), direta ou indiretamente.
- **74 rotas** usam `select(*)` (colunas não restritas).
- **24 rotas** têm algum limite/intervalo de linhas no próprio arquivo.
- **14 rotas** não têm marca de autenticação no próprio arquivo (`/api/auditoria`, `/api/auditoria/[id]`, `/api/auditoria/export`, `/api/auditoria/settings`, `/api/auditoria/summary`, `/api/auditoria/verify`, `/api/configuracoes/[entity]`, `/api/configuracoes/documento`, `/api/configuracoes/upload`, `/api/dashboard/erp`, `/api/dashboard/erp/preferences`, `/api/financeiro/parse-invoice`, `/api/financeiro/parse-statement`, `/api/integrations/asaas/webhooks/[account]`). Elas são protegidas de forma central pelo `proxy.ts`/`updateSession` (amostras sem login retornaram 401), exceto as rotas listadas como públicas (login, cron).
- **A verificar:** o webhook do Asaas (`/api/integrations/asaas/webhooks/services`) não está na lista de caminhos públicos do proxy; uma chamada POST sem sessão respondeu `Nao autenticado` antes de a rota validar o token próprio. Se confirmado em produção, os webhooks do Asaas não chegam à rota.

## Endpoints

| Rota | Métodos | Tabelas | Carrega tudo | Limite | select(*) | Mediana (ms) | Resposta (KB) |
|---|---|---|:-:|:-:|:-:|--:|--:|
| `/api/auditoria` | GET | audit_events, audit_settings, profiles, system_companies | — | — | sim | 1821 | 54.7 |
| `/api/auditoria/[id]` | GET | audit_events, audit_settings, profiles, system_companies | — | — | sim | — | — |
| `/api/auditoria/cron` | GET | — | — | — | — | — | — |
| `/api/auditoria/export` | GET | audit_events, audit_settings, profiles, system_companies | — | — | sim | 48952 | 5288.1 |
| `/api/auditoria/settings` | GET/PUT | audit_events, audit_settings, profiles, system_companies | — | — | sim | 1119 | 0.1 |
| `/api/auditoria/summary` | GET | audit_events, audit_settings, profiles, system_companies | — | — | sim | 1151 | 0.0 |
| `/api/auditoria/verify` | POST | audit_events, audit_settings, profiles, system_companies | — | — | sim | — | — |
| `/api/auth/companies` | GET/POST | profile_companies, profiles, system_companies | — | — | sim | 1252 | 1.1 |
| `/api/auth/login` | POST | profiles, audit_events, profile_companies, system_companies | — | — | sim | — | — |
| `/api/auth/logout` | POST | audit_events | — | — | — | — | — |
| `/api/auth/user` | GET | profiles, profile_companies, system_companies | — | — | sim | 1032 | 1.6 |
| `/api/cadastros/clientes` | GET/POST | clients, suppliers | sim | — | sim | 1127 | 101.2 |
| `/api/cadastros/cnpj/[cnpj]` | GET | — | — | — | — | — | — |
| `/api/cadastros/fornecedores` | GET/POST | clients, suppliers | sim | — | sim | 1013 | 135.4 |
| `/api/cadastros/opcoes` | GET | payment_conditions, price_tables, salespeople, clients, suppliers | sim | — | sim | 1468 | 0.3 |
| `/api/cadastros/verificar` | GET | clients, suppliers | sim | — | sim | 792 | 0.0 |
| `/api/catalog/compositions` | GET/POST | materials, product_composition_items, product_compositions, production_records | — | sim | sim | erro | — |
| `/api/catalog/compositions/produce` | POST | — | — | — | — | — | — |
| `/api/catalog/fiscal-rules` | GET/POST | product_fiscal_rules | — | — | sim | erro | — |
| `/api/catalog/services` | GET/POST | providers, service_type_checklist_items, service_type_materials, service_types | — | — | sim | 1047 | 0.0 |
| `/api/catalog/upload` | POST | — | — | — | — | — | — |
| `/api/clients` | POST | clients, profiles | — | — | sim | — | — |
| `/api/cnpj/[cnpj]` | GET | profiles | — | — | — | — | — |
| `/api/comercial/opportunities` | GET/POST | accounts_receivable, clients, opportunities, opportunity_interactions, purchase_orders, salespeople (+2) | sim | — | sim | 1262 | 0.0 |
| `/api/comercial/opportunities/[id]` | GET/POST | accounts_receivable, clients, opportunities, opportunity_interactions, purchase_orders, salespeople (+2) | sim | — | sim | — | — |
| `/api/comercial/options` | GET | materials, payment_conditions, accounts_receivable, clients, opportunities, opportunity_interactions (+4) | sim | sim | sim | 1078 | 0.3 |
| `/api/comercial/parties` | GET/POST | accounts_receivable, clients, opportunities, opportunity_interactions, purchase_orders, salespeople (+2) | sim | — | sim | 1296 | 154.2 |
| `/api/comercial/parties/history` | GET | accounts_receivable, clients, opportunities, opportunity_interactions, purchase_orders, salespeople (+2) | sim | — | sim | 839 | 0.1 |
| `/api/comercial/salespeople` | GET/POST | accounts_receivable, clients, opportunities, opportunity_interactions, purchase_orders, salespeople (+2) | sim | — | sim | 1062 | 0.0 |
| `/api/compras/from-suggestion` | POST | materials, suppliers, purchase_order_items, purchase_orders, purchase_receipts | — | — | sim | — | — |
| `/api/compras/options` | GET | cost_centers, financial_categories, payment_conditions | — | — | — | 1070 | 4.0 |
| `/api/compras/orders` | GET/POST | purchase_order_items, purchase_orders, purchase_receipts | sim | sim | sim | 1064 | 0.0 |
| `/api/compras/orders/[id]` | GET/POST | purchase_orders, profiles, purchase_order_items, purchase_receipts | — | — | sim | — | — |
| `/api/compras/orders/[id]/receive` | POST | purchase_order_items, purchase_orders, purchase_receipts | — | — | sim | — | — |
| `/api/configuracoes/[entity]` | GET/POST | accounts_payable, accounts_receivable, app_settings, asaas_accounts, asaas_bill_payments, asaas_customers (+20) | sim | — | sim | — | — |
| `/api/configuracoes/documento` | GET | accounts_receivable, app_settings, asaas_accounts, asaas_webhook_events, audit_events, branches (+12) | sim | — | sim | erro | — |
| `/api/configuracoes/upload` | POST | accounts_receivable, app_settings, asaas_accounts, asaas_webhook_events, audit_events, branches (+12) | sim | — | sim | — | — |
| `/api/contratos` | GET/POST | accounts_payable, accounts_receivable, clients, contract_alert_log, contract_amendments, contract_billings (+12) | sim | — | sim | 1865 | 0.0 |
| `/api/contratos/[id]` | GET/POST | accounts_payable, accounts_receivable, clients, contract_alert_log, contract_amendments, contract_billings (+12) | sim | — | sim | — | — |
| `/api/contratos/alertas` | GET | accounts_payable, accounts_receivable, clients, contract_alert_log, contract_amendments, contract_billings (+12) | sim | — | sim | 1083 | 0.0 |
| `/api/contratos/automacao` | POST | accounts_payable, accounts_receivable, clients, contract_alert_log, contract_amendments, contract_billings (+12) | sim | — | sim | — | — |
| `/api/contratos/cron` | GET | accounts_payable, accounts_receivable, clients, contract_alert_log, contract_amendments, contract_billings (+14) | sim | — | sim | — | — |
| `/api/contratos/file` | GET/POST | — | — | — | — | — | — |
| `/api/contratos/options` | GET | customer_assets, profiles, providers, service_types, accounts_payable, accounts_receivable (+24) | sim | sim | sim | 1828 | 21.9 |
| `/api/dashboard/erp` | GET | cost_centers, providers, clients, profiles, salespeople, service_order_events | sim | — | sim | 3397 | 6.8 |
| `/api/dashboard/erp/preferences` | GET/PUT | dashboard_preferences, clients, profiles, providers, salespeople, service_order_events | sim | — | sim | 990 | 0.0 |
| `/api/estoque/balances` | GET | stock_balances | sim | sim | — | 1031 | 0.0 |
| `/api/estoque/inventory` | POST | stock_balances, service_order_materials, service_orders, stock_movements, stock_reservations | sim | — | — | — | — |
| `/api/estoque/materials` | GET/POST | materials, profiles, service_order_materials, service_orders, stock_movements, stock_reservations | sim | sim | sim | 1020 | 0.0 |
| `/api/estoque/movements` | GET/POST | materials, stock_movements, accounts_receivable, app_settings, asaas_accounts, asaas_webhook_events (+16) | sim | sim | sim | 948 | 0.0 |
| `/api/estoque/reservations` | GET/POST | materials, service_orders, stock_reservations | sim | sim | — | 1014 | 0.0 |
| `/api/estoque/warehouses` | GET/POST | stock_balances, warehouses, service_order_materials, service_orders, stock_movements, stock_reservations | sim | sim | sim | 970 | 0.2 |
| `/api/financeiro/conciliacao` | POST | accounts_payable, financial_transactions | — | sim | sim | — | — |
| `/api/financeiro/nf` | GET/POST | imported_invoices, clients, suppliers, system_companies | sim | sim | sim | 1709 | 0.0 |
| `/api/financeiro/parse-invoice` | POST | — | — | — | — | — | — |
| `/api/financeiro/parse-statement` | POST | — | — | — | — | — | — |
| `/api/financial-categories/options` | GET | financial_categories, profiles | — | — | — | 985 | 3.1 |
| `/api/financial-state` | DELETE/GET/PUT | — | — | sim | — | 475 | 5161.6 |
| `/api/financial-state/account` | DELETE | financial_transactions, profiles | — | — | sim | — | — |
| `/api/frota/[entity]` | DELETE/GET/POST | fleet_drivers, fuel_entries, trips, vehicle_maintenance, vehicle_tires, vehicles | — | — | sim | — | — |
| `/api/frota/file` | GET/POST | — | — | — | — | — | — |
| `/api/frota/settings` | GET/PUT | fleet_settings, service_orders, system_companies, fleet_drivers, fuel_entries, profiles (+4) | — | sim | sim | 1287 | 0.4 |
| `/api/integrations/asaas/balances` | GET | asaas_balance_snapshots, accounts_payable, accounts_receivable, asaas_accounts, asaas_bill_payments, asaas_customers (+7) | — | — | sim | 871 | 0.3 |
| `/api/integrations/asaas/bill-payments` | — | asaas_bill_payments, suppliers, accounts_payable, accounts_receivable, asaas_accounts, asaas_customers (+8) | — | — | sim | — | — |
| `/api/integrations/asaas/fiscal-services` | GET | materials, profiles | — | sim | — | erro | — |
| `/api/integrations/asaas/invoices` | — | asaas_fiscal_documents, clients, service_orders, accounts_payable, accounts_receivable, asaas_accounts (+9) | — | — | sim | — | — |
| `/api/integrations/asaas/payments` | GET | asaas_payments, clients, service_orders, accounts_payable, accounts_receivable, asaas_accounts (+9) | — | sim | sim | erro | — |
| `/api/integrations/asaas/setup-webhooks` | — | audit_events, profiles | — | — | — | — | — |
| `/api/integrations/asaas/status` | GET | asaas_accounts, asaas_fiscal_documents, asaas_webhook_events, profiles | — | sim | — | 1327 | 0.8 |
| `/api/integrations/asaas/sync` | — | accounts_payable, accounts_receivable, asaas_accounts, asaas_bill_payments, asaas_customers, asaas_fiscal_documents (+7) | — | — | sim | — | — |
| `/api/integrations/asaas/test-connection` | GET | profiles | — | — | — | — | — |
| `/api/integrations/asaas/transfers` | — | asaas_transfers, suppliers, accounts_payable, accounts_receivable, asaas_accounts, asaas_bill_payments (+8) | — | — | sim | — | — |
| `/api/integrations/asaas/webhooks/[account]` | — | accounts_payable, accounts_receivable, asaas_accounts, asaas_bill_payments, asaas_customers, asaas_fiscal_documents (+6) | — | — | sim | — | — |
| `/api/integrations/notaas/documents/[id]/[format]` | — | asaas_fiscal_documents, audit_events, profiles | — | — | — | — | — |
| `/api/integrations/notaas/invoices` | — | asaas_fiscal_documents, clients, service_orders, accounts_payable, accounts_receivable, asaas_accounts (+9) | — | — | sim | — | — |
| `/api/integrations/notaas/status` | GET | asaas_fiscal_documents, profiles | — | sim | — | 1054 | 0.1 |
| `/api/integrations/notaas/test-connection` | GET | profiles | — | — | — | — | — |
| `/api/notificacoes/cron` | GET | accounts_receivable, app_settings, asaas_accounts, asaas_webhook_events, audit_events, branches (+12) | sim | — | sim | — | — |
| `/api/operational-files/upload` | GET/POST | profiles, service_order_files, service_orders | — | sim | sim | — | — |
| `/api/operational-state` | GET/PUT | profiles | sim | sim | — | 1344 | 93.2 |
| `/api/orcamentos` | GET/POST | accounts_receivable, clients, materials, opportunities, opportunity_interactions, payment_conditions (+8) | sim | — | sim | 1060 | 0.0 |
| `/api/orcamentos/[id]` | GET/POST | accounts_receivable, clients, materials, opportunities, opportunity_interactions, payment_conditions (+9) | sim | — | sim | — | — |
| `/api/orcamentos/file` | GET/POST | system_companies, profile_companies, profiles | — | — | sim | — | — |
| `/api/orcamentos/logo` | GET | system_companies, profile_companies | — | — | sim | erro | — |
| `/api/orcamentos/options` | GET | clients, materials, opportunities, payment_conditions, salespeople, service_types (+21) | sim | sim | sim | 2058 | 14.9 |
| `/api/os` | GET/POST | service_orders, accounts_receivable, materials, product_compositions, production_records, service_order_files (+6) | sim | sim | sim | 995 | 0.0 |
| `/api/os/[id]` | GET | accounts_receivable, materials, product_compositions, production_records, service_order_files, service_order_materials (+6) | — | — | sim | — | — |
| `/api/os/[id]/acceptance` | POST | service_order_signatures, service_orders | — | — | — | — | — |
| `/api/os/[id]/status` | POST | accounts_receivable, materials, product_compositions, production_records, service_order_files, service_order_materials (+6) | — | — | sim | — | — |
| `/api/os/[id]/time` | DELETE/POST | service_order_time_entries, service_orders, accounts_receivable, materials, product_compositions, production_records (+6) | — | — | sim | — | — |
| `/api/os/assets` | GET/POST | customer_assets, accounts_receivable, materials, product_compositions, production_records, service_order_files (+7) | — | — | sim | 974 | 0.0 |
| `/api/os/options` | GET | clients, materials, providers, service_types, vehicles, accounts_receivable (+14) | sim | sim | sim | 1391 | 10.2 |
| `/api/relatorios/cron` | GET | profile_companies, profiles, report_runs, saved_reports, system_companies | — | — | sim | — | — |
| `/api/relatorios/meta` | GET | profiles, report_runs, saved_reports | — | — | sim | 1656 | 1.5 |
| `/api/relatorios/run` | POST | profile_companies, profiles, report_runs, saved_reports, system_companies | — | — | sim | — | — |
| `/api/relatorios/runs` | GET | profiles, report_runs, saved_reports | — | — | sim | 1642 | 0.0 |
| `/api/relatorios/saved` | DELETE/GET/POST | profiles, report_runs, saved_reports | — | — | sim | 1792 | 0.0 |
| `/api/relatorios/saved/[id]` | POST | profile_companies, profiles, report_runs, saved_reports, system_companies | — | — | sim | — | — |
| `/api/setup-admin` | POST | profiles | — | — | — | — | — |
| `/api/suppliers` | GET/POST | suppliers, profiles | sim | sim | sim | 1032 | 11.6 |
| `/api/system-logs` | GET/POST | audit_logs, profiles | — | sim | — | 1016 | 6.0 |
| `/api/users` | GET | profiles | — | — | — | 1066 | 2.1 |
| `/api/users/[id]` | PUT | clients, profiles | — | — | — | — | — |
| `/api/users/create` | POST | clients, profiles | — | — | — | — | — |

`—` em "Mediana" = rota não medida (exige parâmetros, é gravação, upload ou cron). `erro` = respondeu 4xx sem parâmetros.

## Páginas e os endpoints que chamam

Mapeado por busca de `fetch`/helpers de API nos componentes de cada página (análise estática). Toda página ainda executa, no carregamento do layout, `/api/auth/user` (contexto de autenticação).

| Página | Linhas de código | Endpoints distintos | Chamadas no código | Endpoints |
|---|--:|--:|--:|---|
| `/dashboard` | 291 | 2 | 4 | `/api/dashboard/erp`, `/api/dashboard/erp/preferences` |
| `/financeiro` | 4068 | 20 | 28 | `(useFinancialStore -> /api/financial-state)`, `(useOperationalStore -> /api/operational-state)`, `/api/cnpj/`, `/api/financeiro/conciliacao`, `/api/financeiro/parse-invoice`, `/api/financeiro/parse-statement`, `/api/financial-state`, `/api/financial-state/account`, `/api/integrations/asaas/balances`, `/api/integrations/asaas/fiscal-services`, `/api/integrations/asaas/invoices`, `/api/integrations/asaas/payments`, `/api/integrations/asaas/setup-webhooks`, `/api/integrations/asaas/status`, `/api/integrations/asaas/sync`, `/api/integrations/asaas/test-connection`, `/api/integrations/notaas/invoices`, `/api/integrations/notaas/status`, `/api/integrations/notaas/test-connection`, `/api/suppliers` |
| `/financeiro/importar-nf` | 219 | 1 | 3 | `/api/financeiro/nf` |
| `/financeiro/conciliacao` | 210 | 2 | 2 | `/api/financeiro/conciliacao`, `/api/financial-state` |
| `/estoque` | 524 | 6 | 11 | `/api/estoque/inventory`, `/api/estoque/materials`, `/api/estoque/movements`, `/api/estoque/reservations`, `/api/estoque/warehouses`, `/api/suppliers` |
| `/compras` | 377 | 5 | 7 | `/api/compras/options`, `/api/compras/orders`, `/api/compras/orders/`, `/api/estoque/materials`, `/api/suppliers` |
| `/servicos` | 196 | 2 | 3 | `/api/estoque/materials`, `/api/suppliers` |
| `/ordens-servico` | 100 | 1 | 1 | `/api/os` |
| `/ordens-servico/[id]` | 475 | 5 | 10 | `/api/operational-files/upload`, `/api/os`, `/api/os/`, `/api/os/assets`, `/api/os/options` |
| `/frota` | 514 | 3 | 5 | `/api/frota/`, `/api/frota/file`, `/api/frota/settings` |
| `/clientes` | 335 | 4 | 5 | `/api/cadastros/clientes`, `/api/cadastros/fornecedores`, `/api/cadastros/opcoes`, `/api/cadastros/verificar` |
| `/comercial` | 482 | 7 | 13 | `/api/cnpj/`, `/api/comercial/opportunities`, `/api/comercial/opportunities/`, `/api/comercial/options`, `/api/comercial/parties`, `/api/comercial/parties/history`, `/api/comercial/salespeople` |
| `/orcamento` | 526 | 4 | 8 | `/api/orcamentos`, `/api/orcamentos/`, `/api/orcamentos/file`, `/api/orcamentos/options` |
| `/contratos` | 488 | 7 | 9 | `/api/contratos`, `/api/contratos/`, `/api/contratos/alertas`, `/api/contratos/automacao`, `/api/contratos/file`, `/api/contratos/options`, `/api/orcamentos/` |
| `/relatorios` | 327 | 5 | 10 | `/api/relatorios/meta`, `/api/relatorios/run`, `/api/relatorios/runs`, `/api/relatorios/saved`, `/api/relatorios/saved/` |
| `/logs-sistema` | 312 | 5 | 7 | `/api/auditoria`, `/api/auditoria/`, `/api/auditoria/settings`, `/api/auditoria/summary`, `/api/system-logs` |
| `/configuracoes` | 52 | 0 | 0 | — (painéis em `components/settings/` não varridos) |

### Observações por página (evidência)

- **`/financeiro`** é um único arquivo de ~3.100 linhas (`app/financeiro/page.tsx`) mais componentes. Carrega o estado financeiro inteiro (`/api/financial-state`, ~5 MB) e o estado operacional (`/api/operational-state`, ~93 KB) antes de mostrar qualquer aba, e regrava o estado inteiro a cada alteração.
- **`/dashboard`** faz uma chamada, mas o servidor lê tabelas inteiras e agrega em JavaScript (`lib/dashboard-erp-server.ts` + `lib/dashboard-erp.ts`).
- **`/clientes`**, **`/comercial`** e **`/estoque`** dependem de listas completas (`readAllPages`) enviadas ao navegador, que filtra localmente.
- **`/logs-sistema`** já usa paginação por cursor (`before` = `seq`) na listagem; a exportação CSV percorre a trilha em lotes de 500 de forma sequencial dentro da requisição.
