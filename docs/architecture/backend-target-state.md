# Backend: arquitetura-alvo recomendada (Fase 0)

> **Recomendação, não decisão.** Nada aqui foi implementado. Princípio: evoluir o que já existe (Next.js + Supabase/Postgres), sem adicionar tecnologia sem necessidade provada. Cada item aponta o gargalo que resolve ([estado atual](backend-current-state.md), G1–G10).

## 1. Princípios

1. **Manter Next.js + Supabase.** O volume atual (≈ 42 mil eventos de auditoria, ≈ 3,6 mil lançamentos) não justifica trocar de plataforma.
2. **Sem Redis, filas, microsserviços ou serviços pagos** enquanto as medições não mostrarem necessidade. Cache de curta duração em memória/`unstable_cache` e funções SQL cobrem os casos atuais.
3. **Mover trabalho para onde ele é barato:** agregação e filtragem em SQL (Postgres), não em JavaScript nem no navegador.
4. **Menos idas e voltas por requisição**, antes de otimizar consultas individuais.
5. **Mudanças aditivas e reversíveis:** novas rotas/funções convivem com as antigas; a tela só troca de rota depois de validada; migrações nunca destrutivas.
6. **Não alterar cálculos financeiros, regras de negócio, credenciais ou política de segurança** sem autorização específica.

## 2. Alvo por camada

### 2.1 Contexto de requisição (resolve G2)
- Resolver usuário/papel/empresa **uma vez por requisição**: o proxy já valida; passar o resultado verificado às rotas por cabeçalho assinado/interno (já há `x-audit-*`) ou cachear o perfil por poucos segundos por usuário no servidor, em vez de repetir `getUser` + `profiles` na rota.
- Avaliar `getClaims()`/verificação local do JWT (sem ida ao Auth) onde o Supabase suportar, mantendo revalidação periódica para desativação de usuário.
- Meta qualitativa: rotas vazias saírem do ~1 s para perto de uma única ida ao banco. **Meta numérica só depois de medir (M1–M3).**

### 2.2 Leitura de dados (resolve G1, G3, G6)
- **Dashboard:** funções SQL (`rpc`) que devolvem os totais/séries já agregados por empresa e período; resposta com cache curto (ex.: 30–60 s por empresa/período) invalidado em escrita.
- **Financeiro:** substituir a carga única de 5 MB por **leituras paginadas e filtradas por aba/período** (lista com cursor/`range`, totais por consulta agregada). Manter `GET /api/financial-state` funcionando até todas as telas migrarem.
- **Cadastros/comercial/estoque:** paginação, busca e ordenação no servidor; `select` com colunas explícitas.

### 2.3 Escrita (resolve G1, G5, G9)
- Trocar o `PUT` de estado completo por **operações por entidade** (criar/editar/excluir um lançamento), idealmente como funções SQL/RPC transacionais, no padrão que já existe (`apply_stock_movement`, `receive_purchase_order`…).
- Concorrência otimista (`updated_at`/versão) para evitar sobrescrita entre usuários.
- Exclusões passam a ser persistidas de forma explícita (soft delete onde houver exigência de histórico).
- Gatilho de auditoria continua, mas escritas em lote passam a ser **em lote controlado** (menos linhas tocadas = menos eventos).

### 2.4 Auditoria e tarefas longas (resolve G4)
- Exportação em **streaming** (resposta em pedaços) ou gerada em segundo plano com arquivo no Supabase Storage e link de download (usa o que já existe; **sem fila externa**).
- Manter a listagem por cursor.

### 2.5 Banco de dados (resolve G7)
- Após M4: índices compostos `(system_company_id, <data|status>)` nas tabelas de crescimento, índices em chaves estrangeiras usadas em *joins*, revisão das políticas RLS (custo e a permissiva `using (true)`).
- Migrações versionadas (`supabase/migrations` ou scripts numerados com registro de aplicação), sempre aditivas (`create index concurrently`, colunas novas anuláveis).

### 2.6 Segurança e qualidade (resolve G8, G10)
- Defesa em profundidade: checagem de papel também dentro das 14 rotas que hoje só dependem do proxy.
- Webhook do Asaas liberado no proxy **com** validação do token na rota (após confirmar o problema).
- Validação de entrada com `zod` (já instalado) nas rotas de escrita, começando pelas financeiras.
- Testes de API/integração contra um projeto Supabase de **staging**; remover `ignoreBuildErrors` de forma gradual (corrigir erros de tipo por módulo).

### 2.7 Observabilidade (habilita tudo)
- Medir por rota: duração, nº de consultas, tamanho da resposta (log estruturado em desenvolvimento/staging; em produção apenas amostragem). Sem serviço pago.

## 3. O que NÃO está no alvo (e por quê)

| Item | Motivo |
|---|---|
| Redis / cache distribuído | Cache em memória por instância + `Cache-Control`/`unstable_cache` bastam para o volume; reavaliar só com evidência de gargalo |
| Fila de mensagens / workers | Os crons da Vercel e o Storage cobrem as tarefas longas atuais |
| Microsserviços / API separada | Aumenta custo operacional sem ganho medido |
| Troca de ORM/banco | O gargalo não é a tecnologia de acesso |
| Reescrita das telas | O redesign recém-aprovado permanece; só a fonte de dados muda |

## 4. Critérios de sucesso (a definir após o baseline de produção)

- Nenhuma rota de listagem devolve tabela inteira.
- Nenhuma gravação regrava dados que o usuário não alterou.
- Nenhuma requisição ultrapassa o limite de tempo da função em produção.
- Todas as mudanças com teste automatizado e sem alteração nos totais financeiros (comparação antes/depois em dados de staging).
