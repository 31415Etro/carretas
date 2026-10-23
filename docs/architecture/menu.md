# Navegação do ERP (menu lateral)

Definição única em `lib/navigation.ts` (testada em `lib/navigation.test.ts`); o componente `components/shell/app-sidebar.tsx` só desenha.

- **Estoque interno** (expansível): Matérias-primas, Kits e composições, Produtos finais.
- **Produção** (expansível): Produção e MRP, Esteira da fábrica, Tablet da fábrica. As três usam as mesmas ordens, tarefas, eventos e apontamentos.
- Saíram do menu: Estoque (página), Serviços e Ordens de Serviço. As rotas, tabelas e históricos continuam (links antigos funcionam).
- Operações que só existiam na página de Estoque (movimentações, transferências, inventário, depósitos) continuam em `/estoque?aba=...`, com acesso por **Matérias-primas** ("Movimentos, inventário e depósitos") e por **Produção e MRP** ("Movimentos e inventário"). O saldo e a movimentação por item também estão na aba "Estoque e movimentações" da matéria-prima.
- Fabricação só por Ordem de Produção: o orçamento aprovado não oferece mais "Abrir OS" nem "Venda direta" (a API antiga permanece; nenhuma OS nasce da confirmação do pedido), e a oportunidade ganha leva aos Pedidos de venda.
- Permissões: cada item mantém a permissão de antes; um menu expansível só aparece se algum subitem for permitido. O tablet exige `chao_fabrica`.
