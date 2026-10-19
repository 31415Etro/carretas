# Plano de migração e roadmap (Fase 0)

> **Proposta para aprovação.** Nada abaixo foi executado. Cada fase só começa com autorização explícita. Esforço em dias úteis de desenvolvimento, estimativa grosseira (±50%).

## 1. Roadmap priorizado

Prioridade = (impacto × confiança) ÷ (risco × esforço).

| Prio | Fase | Entrega | Resolve | Risco | Esforço |
|:-:|---|---|---|:-:|:-:|
| 0 | **Medição** | Instrumentação opcional (duração, nº de consultas), medição em build de produção/staging, `EXPLAIN` somente leitura | Base para tudo (G7) | Baixo | 2–3 |
| 1 | **Contexto de requisição** | Eliminar a repetição de `getUser`/`profiles` entre proxy e rota | G2 | Médio (segurança) | 2–3 |
| 2 | **Dashboard em SQL + cache curto** | RPC de agregação por empresa/período | G3 | Baixo | 3–4 |
| 3 | **Financeiro por partes** | Listagem paginada/filtrada + totais agregados; telas migradas aba a aba | G1, G6 | Alto (módulo crítico) | 8–12 |
| 4 | **Escrita por entidade** | CRUD de lançamentos via RPC transacional + concorrência otimista; exclusão persistente | G1, G5, G9 | Alto | 6–8 |
| 5 | **Exportação de auditoria** | Streaming ou geração em Storage | G4 | Baixo | 2–3 |
| 6 | **Banco: índices/RLS** | Índices compostos e revisão de políticas (após `EXPLAIN`) | G7 | Médio | 2–4 |
| 7 | **Segurança/qualidade** | Webhook Asaas, checagem própria nas 14 rotas, `zod` nas escritas, testes de API, tirar `ignoreBuildErrors` | G8, G10 | Médio | 5–8 |

O item G8 (webhook do Asaas) deve ser **confirmado logo no início**, independentemente da ordem, por poder estar perdendo eventos hoje.

## 2. Estratégia de migração (sem interromper o sistema)

1. **Aditivo primeiro:** criar novas rotas/funções SQL ao lado das atuais; nada é removido.
2. **Feature flag por tela** (variável de ambiente ou configuração por empresa): a tela usa a rota nova só quando ligada; desligar volta ao comportamento atual.
3. **Comparação antes/depois:** para o dashboard e os totais financeiros, comparar a saída antiga e a nova nos mesmos dados (staging/cópia) e exigir igualdade ao centavo antes de ligar.
4. **Migrações SQL não destrutivas:** `create index concurrently`, colunas anuláveis, funções novas. Nenhum `drop`/`alter type`/`truncate` sem aprovação separada. Cada script com reversão documentada.
5. **Retirada das rotas antigas** só depois de um ciclo estável em produção e com aprovação.
6. **Ambiente:** testes em projeto Supabase de staging (gratuito) com dados sintéticos; produção só recebe o que já passou em staging.

## 3. Riscos técnicos

| Risco | Probabilidade | Impacto | Mitigação |
|---|:-:|:-:|---|
| Divergência em totais financeiros ao migrar para SQL | Média | Alto | Comparação ao centavo; flag por tela; sem mexer na fórmula, apenas no local de cálculo |
| Atalho de autenticação (contexto em cabeçalho/cache) abrir brecha ou manter usuário desativado ativo | Baixa-média | Alto | Cabeçalho só interno e removido da entrada externa; cache de poucos segundos; teste de usuário inativo |
| Vazamento entre empresas em rotas novas (service role sem wrapper) | Média | Alto | Funções SQL recebem `system_company_id` obrigatório; testes de isolamento com 2 empresas |
| Mudança de paginação quebrar telas que filtram no navegador | Alta | Médio | Migrar tela a tela; manter rota antiga; testes de interface |
| Índice novo travar tabela | Baixa | Médio | `create index concurrently`, fora do horário de uso |
| Gatilho de auditoria encarecer escritas por entidade | Baixa | Baixo | Medir em staging (M3/M4) |
| Estimativas erradas por falta de baseline de produção | Alta | Médio | Fase 0 de medição antes de comprometer prazos |
| Limite de tempo da função (Vercel) em tarefas longas | Média | Médio | Streaming/Storage (fase 5); revisar `maxDuration` |
| Perda de dados no conserto de exclusões não persistidas | Baixa | Alto | Soft delete; backup antes; nenhuma remoção real sem aprovação |

## 4. Os três primeiros incrementos sugeridos

### Incremento 1: Medição + contexto de requisição (menor risco, maior alavanca)
- **Entrega:** (a) log opcional de duração e nº de consultas por rota (desligado por padrão); (b) p50/p95 em build de produção; (c) remover a segunda checagem `getUser`+`profiles` na rota, reaproveitando o resultado do proxy.
- **Resultado esperado:** menos 2 idas ao Supabase por requisição **em todas as 104 rotas**; confirmação numérica de G2.
- **Verificação:** testes de usuário inativo, troca de empresa, rota sem login; comparação de latência antes/depois.
- **Reversão:** retornar ao helper atual (alteração em poucos arquivos).

### Incremento 2: Dashboard em SQL com cache curto
- **Entrega:** função SQL de agregação por empresa e período; `lib/dashboard-erp-server.ts` chama a RPC; cache de 30–60 s por chave (empresa, período).
- **Resultado esperado:** de ~3,4 s para o patamar de uma ou duas consultas (valor a medir).
- **Verificação:** os indicadores e gráficos devem ser **idênticos** aos atuais nos mesmos dados (teste automatizado de comparação).
- **Reversão:** flag volta ao cálculo em JavaScript (mantido).

### Incremento 3: Financeiro: leitura paginada e filtrada (primeira aba: Contas a Pagar)
- **Entrega:** rota de leitura paginada com filtros (período, status, fornecedor, texto) e totais agregados; a aba Contas a Pagar usa a rota nova; o `PUT` do estado completo continua como está nesta etapa.
- **Resultado esperado:** payload de MBs para dezenas de KB por tela; tempo até exibir a aba cai; sem mudança nas regras.
- **Verificação:** totais e linhas idênticos aos atuais; teste de empresa A vs. B.
- **Reversão:** flag por tela.
- **Alternativa de menor risco para o 3º slot:** exportação de auditoria em streaming (G4), 2–3 dias, sem tocar no módulo financeiro.

## 5. O que preciso de você para avançar

1. **Autorização** da fase/incremento a iniciar (sugestão: Incremento 1).
2. String de conexão do Postgres (leitura) ou acesso ao SQL Editor para consultar índices/estatísticas (M4).
3. Confirmar se existe projeto Supabase de **staging** ou se posso orientar a criação de um (gratuito).
4. Verificar no painel do Asaas se as entregas de webhook estão falhando (G8).
5. Região do Supabase e da Vercel; volume esperado em 12 meses.
