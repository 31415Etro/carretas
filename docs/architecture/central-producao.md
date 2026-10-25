# Central de Produção e vínculos Pedido → Ordem → Kits → Matérias-primas

## Cadeia real de vínculos (fonte única da verdade)

Oportunidade (`opportunities` + `opportunity_items`) → proposta aceita (`quotes`, `quote_items`, configuração em `product_configurations`) → pedido (`sales_orders`, `sales_order_items`, `quote_id`) → ordem (`production_orders.sales_order_item_id`) → composição **congelada** da ordem (`production_order_kits` com `kit_version_id` e `production_order_materials` por kit) → tarefas da esteira (`shop_tasks`, uma por unidade e etapa) → materiais da tarefa (`shop_task_materials`, só o kit da etapa via `shop_step_kits`/`kit_match`).

A ordem copia da estrutura ativa do produto (`product_bom_versions` → `product_kits` → `kit_versions`/`kit_components`) no momento de `create_production_from_sale`, ou da configuração vendida quando o item é personalizado. Mudar o kit depois cria uma versão nova e **não** altera ordens nem pedidos já confirmados.

## Auditoria (banco real, só leitura)

- A cadeia **funciona** quando o produto tem estrutura ativa com kits: a ordem OP-2026-00001 (3 carretas) recebeu 1 kit (versão 1, quantidade 3) e a matéria-prima (30 m).
- **Onde os vínculos se perdiam:** 4 dos 5 produtos finais do catálogo ("FZ 1E" duplicados vindos de importação) **não têm estrutura de fabricação**. Vender qualquer um deles nunca alimentaria a produção (a confirmação falhava, e o erro era engolido no pedido gerado automaticamente).
- **Divergência código x banco:** o banco tem os scripts 224 a 228, mas **não** o 229 (sem `shop_settings.require_vin`): por isso as tarefas da ordem existente estão "Bloqueadas — aguardando chassi". Faltam ainda 234 e 235.

## O que foi feito

- `lib/production-links*.ts`: produto sem estrutura ativa, estrutura sem kits ou kit sem versão/matérias-primas **impede fechar a venda** (mensagem com o produto e onde corrigir); o mesmo aviso aparece ao escolher o produto na oportunidade e nas conferências do FECHAR VENDA; o editor de estrutura copia os kits de outro produto.
- Script **235**: snapshot técnico versionado por item do pedido e por ordem, congelado na confirmação a partir da composição **da ordem** (produto, quantidade, medidas, acabamento, acessórios, revisão de engenharia, versão da estrutura, kits com versão/componentes/perdas, matérias-primas consolidadas, referência ao desenho), nunca sobrescrito; `production_link_pendencies()` (ordens sem composição, itens sem estrutura, kits sem etapa) e `production_order_relink()` (reconciliação assistida: só ordem sem composição, usa a versão **registrada na própria ordem**, motivo obrigatório, auditada em `production_events`, só administrador/gerente pela API).
- Script **234**: `shop_unit_advance` (concluir a etapa da carreta com um clique; a última etapa já dá entrada do acabado) e liberação sem exigir sinal/pagamento nem autorização.
- Central de Produção em `/producao`: lista de carretas (busca por pedido, produto, chassi, cliente; filtros; indicadores) e, na carreta escolhida, ORDEM E MATERIAIS (identificação, medidas, acabamento, acessórios, desenho, kits com componentes, materiais com necessário/disponível/reservado/consumido/faltante, solicitação de compra, pendência de vínculo), ESTEIRA (etapas, responsável, início, fim, tempo, próxima tarefa, concluir) e TAREFAS (as mesmas do Modo Tablet). Atualiza sozinha a cada 10 s e ao agir. O Modo Tablet continua em `/producao/tablet` (PWA e tablets compartilhados), com os mesmos registros e funções.

## Ordem de aplicação no Supabase

`229_esteira_sem_impedimentos.sql` → `234_producao_simplificada.sql` → `235_vinculos_pedido_ordem_kits.sql`. Nenhum apaga dados; 235 só acrescenta colunas e funções.
