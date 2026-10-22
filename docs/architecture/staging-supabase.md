# Ambiente de staging (Supabase separado) e como validar a reestruturação

Objetivo: rodar as migrações 217–219 e o cenário completo **fora do banco de produção**, sem dados pessoais nem financeiros reais.

## 1. Criar o projeto de staging

1. Em supabase.com, **New project** (plano gratuito basta). Nome sugerido: `nd-carretas-staging`. Região igual à de produção.
2. Anote a **URL**, a **anon key** e a **service_role key** do projeto novo (Settings > API). Elas **não** entram no Git.
3. Crie um arquivo `.env.staging.local` (já ignorado pelo Git, padrão `.env*`) com:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://SEU-STAGING.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```
   Para apontar o ERP local para o staging, copie esse arquivo por cima do `.env.local` (guarde o de produção antes) ou use outra pasta de execução.

## 2. Instalar o banco do ERP no staging (projeto vazio)

No **SQL Editor** do staging, na ordem, copie e rode cada arquivo de `scripts/supabase/`:

| # | Arquivo |
|---|---|
| 1 | `01_base_sistema_e_perfis.sql` |
| 2 | `02_base_financeiro_asaas_multiempresa.sql` |
| 3 | `03_erp_200_a_206.sql` |
| 4 | `04_erp_207_a_211.sql` |
| 5 | `05_erp_212_a_215_e_buckets.sql` |
| 6 | `06_erp_216_importacao_nf.sql` |
| 7 | `scripts/217_itens_estrutura.sql` |
| 8 | `scripts/218_kits_e_estrutura_de_produto.sql` |
| 9 | `scripts/219_vendas_producao_mrp.sql` |
| 10 | `scripts/220_materia_prima_consultas.sql` |
| 11 | `scripts/221_kits_consultas_e_conversao.sql` |
| 12 | `scripts/222_produtos_finais.sql` |
| 13 | `scripts/223_pedido_producao_integracao.sql` |

Cada script é **idempotente**: se rodar duas vezes, não duplica nada.

Crie o usuário de teste em Authentication > Users e rode `scripts/supabase/` (arquivo de admin do LEIA-ME) para dar o perfil de administrador.

## 3. Dados de teste

- **Nunca** copie clientes, fornecedores, financeiro ou notas do banco real para o staging.
- Se precisar de volume, gere dados **sintéticos** (nomes e CNPJs fictícios). Se for indispensável usar a estrutura real, anonimize: nome, documento, e-mail, telefone, endereço e valores.
- Empresas de teste: crie "Empresa Teste A" e "Empresa Teste B" para validar o isolamento.

## 4. Testes automatizados

### 4.1 Sem staging, em Postgres local descartável (já funciona hoje)
```
npm install
npm run test:sql      # 61 testes de SQL em Postgres local (PGlite): carrega o schema inteiro + 217–223
npm run test:rpc      # confere se cada chamada RPC do código usa funções e parâmetros que existem no banco
npm test              # testes das bibliotecas (inclui o NCM)
```
O teste sobe um Postgres em memória, aplica todo o schema do projeto e as migrações novas, e executa o fluxo completo (matéria-prima → kit → produto → pedido → ordem → MRP → compra → consumo → conclusão), concorrência por estoque, duplicidade de ordens, cancelamento, isolamento entre empresas, idempotência dos scripts e o comportamento em banco com SKU repetido.

### 4.2 No staging
Rodar os mesmos cenários pela interface depois das etapas de tela (Etapas 3 a 9). Para a verificação de isolamento no staging, entre com um usuário de cada empresa e confirme que pedidos e ordens de uma não aparecem na outra.

## 5. Levar para produção (somente com a sua aprovação específica)

1. Backup do banco de produção (Supabase > Database > Backups, ou exportação).
2. Rodar `217` a `223` no SQL Editor de produção (o `223` só depois de aprovado e testado no staging; ele corrige `product_quote_snapshot`, muda funções da 219 e amplia as situações de orçamento e pedido). Todos são aditivos: não removem nem alteram dados existentes.
3. O `217` **não cria** o índice de SKU enquanto houver SKU repetido (hoje há 3 "FZ 1E" com o mesmo SKU); ele avisa na saída e você roda de novo depois da limpeza aprovada.
4. Limpeza dos cadastros de teste: `python scripts/limpeza-catalogo-teste.py` (simulação) e depois `--aplicar`, só com os IDs que você aprovar em `docs/architecture/limpeza-ids-aprovados.txt`.
