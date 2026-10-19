# Baseline de performance (Fase 0)

> Medição **somente leitura**, em 19/10/2026. Nenhum dado real foi alterado; nenhum `EXPLAIN` foi executado; nenhuma gravação foi feita.
> Os números abaixo são **o que foi observado**, com as limitações descritas na seção "O que esta medição NÃO prova". Não são metas nem benchmarks de produção.

## 1. Condições da medição

| Item | Valor |
|---|---|
| Servidor da aplicação | `next dev` (Turbopack) local, Windows 11, um único usuário |
| Banco | Supabase remoto (Postgres via PostgREST), acesso pela chave de serviço |
| Empresa | ND Carretas Fort |
| Amostras | 5 chamadas sequenciais por rota (1ª = "fria", demais = "quentes") |
| Estatística | mediana e pior caso das 5. **Não é p95/p99** (amostra pequena demais) |
| Rotas | todas as `GET` sem parâmetros obrigatórios (51 rotas) + 5 variações |
| Script | `baseline.py` (login com variável de ambiente; senha não é gravada) |

## 2. Piso de latência (rede até o Supabase)

Uma consulta mínima (1 linha de `clients`) direto no PostgREST: **mediana 718 ms** (mín 412 ms, máx 3.336 ms).

Consequência: o ambiente de medição tem ~0,4–0,7 s de latência de rede por ida e volta ao banco. **Qualquer rota que faça N consultas sequenciais paga N × esse piso.** Isso explica por que rotas "vazias" (sem dados) ainda levam ~1 s: o custo vem do número de idas e voltas, não do volume de dados. Em produção (Vercel e Supabase na mesma região) esse piso tende a ser menor, mas **isso não foi medido**.

## 3. Volume de dados (contagens exatas)

| Tabela | Linhas |
|---|--:|
| `audit_events` | 41.755 |
| `accounts_payable` | 3.622 (Fort: 2.465) |
| `financial_transactions` | 3.620 (Fort: 2.465) |
| `suppliers` | 119 |
| `clients` | 95 |
| `financial_categories` | 87 (Fort: 44) |
| `dre_accounts` | 40 |
| `cost_centers` | 8 |
| `payment_conditions` | 8 |
| `profiles` | 5 |
| `system_companies` | 3 |
| `imported_invoices` | 1 |
| demais tabelas medidas (`materials`, `service_orders`, `stock_movements`, `purchase_orders`, `quotes`, `contracts`, `vehicles`, `accounts_receivable`…) | 0 ou não populadas |

O banco é **pequeno**. Os tempos abaixo são dominados por arquitetura (idas e voltas, cargas completas, agregação em JavaScript), não por volume. O risco é crescer: o padrão atual "ler tudo e filtrar no servidor/navegador" piora linearmente com os dados.

## 4. Resultados por rota (ordenado pela mediana)

Rotas ≥ 1 s de mediana e/ou ≥ 100 KB. A tabela completa (todas as rotas) está em [endpoint-inventory.md](endpoint-inventory.md).

| Rota | 1ª (ms) | Mediana (ms) | Pior (ms) | Resposta (KB) |
|---|--:|--:|--:|--:|
| `/api/auditoria/export` | 55.428 | 48.952 | 55.428 | 5.288 |
| `/api/dashboard/erp` (com período) | 3.632 | 3.453 | 3.632 | 9,8 |
| `/api/dashboard/erp` | 4.445 | 3.397 | 4.445 | 6,8 |
| `/api/financial-state?refresh=1` | 3.765 | 2.419 | 3.765 | 5.162 |
| `/api/orcamentos/options` | 2.444 | 2.058 | 2.444 | 14,9 |
| `/api/contratos` | 1.982 | 1.865 | 1.982 | 0 |
| `/api/contratos/options` | 1.831 | 1.828 | 1.879 | 21,9 |
| `/api/auditoria` | 2.972 | 1.821 | 3.332 | 54,7 |
| `/api/relatorios/saved` | 1.754 | 1.792 | 1.930 | 0 |
| `/api/financeiro/nf` | 3.147 | 1.709 | 3.147 | 0 |
| `/api/relatorios/meta` | 2.967 | 1.656 | 2.967 | 1,5 |
| `/api/relatorios/runs` | 2.147 | 1.642 | 2.147 | 0 |
| `/api/cadastros/opcoes` | 1.468 | 1.468 | 2.977 | 0,3 |
| `/api/os/options` | 1.456 | 1.391 | 1.617 | 10,2 |
| `/api/operational-state` | 1.720 | 1.344 | 1.720 | 93,2 |
| `/api/comercial/parties` | 1.307 | 1.296 | 1.345 | 154,2 |
| `/api/cadastros/clientes` | 1.329 | 1.127 | 1.329 | 101,2 |
| `/api/cadastros/fornecedores` | 1.191 | 1.013 | 1.191 | 135,4 |
| `/api/financial-state` (sem `refresh`) | 2.549 | 475 | 2.549 | 5.162 |

As demais rotas ficaram entre ~0,8 e ~1,3 s (a maioria com resposta < 5 KB), isto é, **próximas do piso de rede**.

Rotas que responderam 400/404 sem parâmetros (não medidas): `/api/catalog/compositions`, `/api/catalog/fiscal-rules`, `/api/configuracoes/documento`, `/api/integrations/asaas/fiscal-services`, `/api/integrations/asaas/payments`, `/api/orcamentos/logo`.

## 5. Leitura dos resultados (evidência → hipótese)

| # | Observação medida | Hipótese (a confirmar) |
|---|---|---|
| 1 | Rota "vazia" já custa ~1 s (ex.: `/api/estoque/materials` 1.020 ms, resposta 0 KB) | Custo fixo por requisição: o `proxy.ts` faz `getUser` + `getSession` + `profiles` + `profile_companies`, e a rota repete `getUser` + `profiles` (`stockContext`/`currentUserRole`). Estimativa: 4–6 idas e voltas ao Supabase antes de qualquer consulta de negócio |
| 2 | `/api/financial-state` entrega **5,1 MB** por chamada; 2,4–2,5 s com cache invalidado | Carrega as tabelas financeiras inteiras (`readAllPages`, 1.000 linhas por página) e devolve tudo ao navegador; o estado inteiro é regravado em cada `PUT` |
| 3 | `/api/dashboard/erp` ≈ 3,4 s para 9,8 KB de resposta | Lê tabelas inteiras e agrega em JavaScript (`lib/dashboard-erp-server.ts`); o resultado final é minúsculo, ou seja, o trabalho poderia ser feito em SQL |
| 4 | `/api/auditoria/export` ≈ 49–55 s, 5,3 MB, dentro de uma única requisição | Laço de lotes de 500 linhas, sequencial. Em produção (Vercel) isso tende a estourar o limite de tempo da função |
| 5 | `/api/contratos`, `/relatorios/*`, `/contratos/options` ≈ 1,6–2,1 s sem dados | Várias consultas sequenciais por rota + custo fixo do item 1 |
| 6 | Listas de cadastros (`/cadastros/*`, `/comercial/parties`) enviam 100–154 KB | Listas completas, filtradas no navegador (sem paginação no servidor) |

## 6. O que esta medição NÃO prova

1. **`next dev` não é produção.** Compilação sob demanda e ausência de otimizações inflam as primeiras chamadas. Precisa repetir em `next build` + `next start` ou em preview da Vercel.
2. **Cliente único.** Não mede concorrência, filas no pool de conexões do PostgREST nem contenção de locks.
3. **5 amostras ≠ p95/p99.** Para percentis é preciso ≥ 20–30 amostras por rota (idealmente 100) e janelas em horários diferentes.
4. **Sem instrumentação por consulta.** Não sabemos quantas consultas SQL cada rota dispara nem quanto cada uma custa. Os itens "idas e voltas" são inferência a partir do código e do piso de rede.
5. **Sem `EXPLAIN`.** Não há string de conexão direta com o Postgres (só PostgREST). Não foi possível confirmar uso de índices, *seq scans*, custo do trigger de auditoria nem a eficiência das políticas RLS.
6. **Gravações não medidas** (por regra: sem alterar dados reais). Custo de `PUT /api/financial-state`, importação de planilha e importação de NF é desconhecido.
7. **Rede do Supabase vs. rede do Vercel.** O piso de ~718 ms vem de um notebook, não da região de produção.
8. **Não foi medido o lado do navegador** (hidratação, tamanho de bundle, tempo até interativo, custo do `JSON.parse` de 5 MB).

## 7. Plano de medição (a executar somente após autorização)

| Passo | O que fazer | Custo / risco |
|---|---|---|
| M1 | Medir em build de produção local (`next build && next start`) e, se possível, em preview da Vercel contra um projeto Supabase de **staging** (sem dados reais) | Sem custo de serviço novo; precisa de projeto staging (plano gratuito) |
| M2 | Repetir as rotas com ≥ 30 amostras e calcular p50/p95/p99 | Só leitura |
| M3 | Instrumentar o `companyAwareFetch`/cliente Supabase para contar consultas e medir tempo por rota (log em modo de desenvolvimento, atrás de variável de ambiente) | Alteração mínima, desligada por padrão. **Requer autorização** |
| M4 | Com a string de conexão do Postgres (fornecida pelo usuário), rodar `EXPLAIN` (sem `ANALYZE`) nas consultas de leitura mais pesadas, `pg_stat_statements` (se habilitado) e `pg_indexes`/`pg_stat_user_tables` para ver índices e *seq scans* | Somente leitura. **Nunca** `EXPLAIN ANALYZE` em escrita ou consulta cara em produção |
| M5 | Medir o tamanho do bundle (`next build` + análise) e Web Vitals das páginas principais no navegador | Só leitura |
| M6 | Teste de carga leve (ex.: 5–10 usuários simultâneos) **apenas em staging** | Nunca em produção |
| M7 | Definir SLOs depois de M1–M4 (ex.: p95 por categoria de rota). **Nenhuma meta é proposta agora**, pois não há base medida | — |

## 8. Itens que dependem de informação do usuário

- String de conexão direta do Postgres (staging ou leitura em produção) para M4.
- Região do projeto Supabase e do deploy na Vercel (para interpretar o piso de latência).
- Se existe projeto Supabase de staging, ou se pode ser criado (plano gratuito).
- Volume esperado em 12 meses (nº de lançamentos/mês, nº de usuários simultâneos) para dimensionar.
