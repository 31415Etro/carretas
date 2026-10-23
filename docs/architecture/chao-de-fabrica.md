# Chão de fábrica digital (tablets, tarefas e esteira)

Script: `scripts/227_chao_de_fabrica.sql` (aditivo e idempotente; requer 217 a 224; a configuração dimensional congelada vem do 225, quando instalado). Testes: `scripts/tests-sql/etapa10.test.mjs` (16 testes).

## Auditoria que orientou o desenho
- **Ordens de produção** (219/223): já têm kits e materiais CONGELADOS por ordem (`production_order_kits`, `production_order_materials`), consumo transacional idempotente (`record_production_consumption`) e entrada de acabado (`complete_production`). O módulo reutiliza tudo isso; não recria nada.
- **Colaboradores**: não existia cadastro de colaboradores de fábrica. Existem `profiles` (login do ERP, com `page_permissions`) e `system_users` (técnicos de OS). Criei `shop_workers` com ligação opcional a `profiles`; ninguém é duplicado e quem já tem login pode entrar sem PIN.
- **Apontamentos/tarefas**: só havia `service_order_time_entries` (ordens de serviço) e `production_records` (legado). Não servem para esteira por unidade com vários colaboradores; por isso há tabelas novas (`shop_*`). Nada existente foi alterado.
- **Permissões**: nova permissão `chao_fabrica` (rota `/producao/tablet`, antes de `/producao` no controle de rotas). A esteira do gestor usa a permissão de Estoque e exige admin/gerente nas ações.
- **Scripts 224 e 225**: não consigo consultar o banco real daqui. Pelo histórico, nenhum dos dois foi aplicado (o 225 foi dito como não aplicado e o 224 não teve confirmação). **Confirme antes de rodar o 227**: ele depende do 224 e usa a configuração do 225 se existir.

## Decisão sobre a documentação veicular (substitui a regra do 224)
O 224 exigia a documentação aprovada para iniciar/consumir/concluir a produção. O 227 **remove essa dependência**: `production_eligibility` passa a depender só de pedido confirmado, sinal/pagamento (ou exceção formal) e autorização operacional. A documentação segue em paralelo e passa a ser exigida na **expedição** (`expedition_eligibility`; gatilho em `sales_order_deliveries`). Quem aplicar 224 + 227 fica com este comportamento; os testes das etapas 6/7, que carregam só até o 224/225, continuam descrevendo o comportamento antigo.

## Modelo
- `shop_workers` (matrícula, setores, turno, valor da hora, inspetor/supervisor, PIN em bcrypt), `shop_sessions` (token individual por colaborador e dispositivo; só o hash fica no banco; expira por inatividade e em 14 h).
- `shop_steps` (8 etapas oficiais por empresa, com dependências, setor, vários colaboradores, checklist, medidas, kits por categoria) + `shop_checklist_items` (cadastrados pelo gestor; **nenhum item foi inventado**).
- `shop_tasks`: uma tarefa por unidade e etapa. Estados: Aguardando, Pronta, Em execução, Pausada, Bloqueada, Concluída, Com pendência, Cancelada. O recálculo (`shop_task_refresh`) libera a etapa seguinte quando as dependências são cumpridas e bloqueia por liberação financeira ou falta de chassi.
- `shop_time_entries`: um trecho por colaborador; um colaborador só pode ter um trecho aberto (sem dupla contagem). Tempo cronológico = união dos trechos; mão de obra = soma por colaborador; pausas = lacunas.
- `shop_task_events` (log imutável, com chave de idempotência e o horário do tablet só como informação), `shop_task_consumptions`, `shop_task_checks`, `shop_task_measures`, `shop_occurrences`, `shop_task_external`, `shop_unit_tokens` (QR opaco).

## Regras importantes
- **Horário oficial = servidor** (`clock_timestamp`). O horário do tablet é gravado como `client_at` apenas para auditoria.
- **Idempotência**: toda ação leva `requestKey`; repetir devolve `duplicate` sem duplicar início, pausa, conclusão, consumo ou conferência.
- **Consumo** é operação própria (`shop_task_consume`), só com materiais da composição congelada da etapa; finalizar a tarefa nunca baixa estoque. Não há baixa automática por conclusão.
- **Checklist**: itens obrigatórios sem resposta impedem finalizar; item obrigatório não conforme abre ocorrência e deixa a tarefa "Com pendência" (a esteira não avança) até decisão do gestor/inspetor (refazer ou aceitar com justificativa).
- **Medidas**: comparadas com a configuração VENDIDA congelada; divergência abre ocorrência e pendência.
- **Etapa terceirizada**: envio e retorno pelo gestor (prestador, tipo de acabamento, previsão, custo); não gera horas de colaborador.
- **Despachante** (etapa administrativa) só é criada para produto que exige documentação veicular e não entra na mão de obra de fabricação.
- **Entrada do acabado**: `shop_unit_receive` chama `complete_production` por unidade (idempotente), só depois de todas as etapas de fabricação da unidade; a ordem só conclui quando todas as unidades entram (fabricação parcial).

## Telas
- `/producao/tablet` (PWA com manifesto; sem menus administrativos): identificação por matrícula + PIN, cartões grandes, iniciar/pausar/finalizar, materiais, desenho com zoom, checklist, medidas, ocorrência com foto, aviso de falta de conexão e reenvio com a mesma chave. Sessão encerra por inatividade.
- `/producao/esteira` (gestor): Kanban por etapa, colaboradores em atividade, paradas, atrasos, ocorrências com decisão, colaboradores e PIN, etapas e checklists, terceirizados, indicadores, reatribuição/bloqueio/cancelamento com justificativa e QR da carreta.
- `/producao/tablet/unidade/<token>`: destino do QR (exige login; sem dados do cliente).

## Limitações conhecidas
- **Sem fila offline**: se não houver conexão, a operação fica marcada como PENDENTE na tela e só vale quando o servidor confirmar (reenvio com a mesma chave). Não há registro local de eventos com horário do tablet.
- O PWA tem manifesto, mas não há service worker (a tela não abre sem conexão).
- Custo de mão de obra é gerencial (horas × valor da hora): não lança nada no financeiro nem altera custos reais da ordem.
- Os itens de checklist e os tempos previstos por etapa precisam ser cadastrados pelo gestor; a associação de kits às etapas usa a categoria do kit (ex.: "Chassi") ou seleção manual.
- Quantidades por unidade vêm do total da ordem dividido pelo número de unidades.
- Troca rápida de colaborador usa PIN (sem crachá/QR do colaborador).
