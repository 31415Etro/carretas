# Jornada comercial única

Página `/comercial/jornada/[opportunityId]` (`novo` cria uma oportunidade): oportunidade → proposta → fechamento → pedido → acompanhamento, sem trocar de página.

- **Oportunidade**: cliente (com cadastro rápido por CNPJ ou foto de RG/CNH), vendedor, produtos do cadastro com quantidade (valor = soma), observações. Depois de salvar aparece CRIAR PROPOSTA.
- **Proposta**: o próprio editor de orçamentos (`QuotesPage` com a propriedade `opportunityId`), já com os produtos da oportunidade; configurador, fotos, desenho e PDF continuam os de sempre.
- **Fechamento**: conferências (`closingChecks` em `lib/journey.ts`) e FECHAR VENDA = salvar a oportunidade como Ganho, que aprova a proposta e gera o pedido pelo serviço existente (`convertQuoteToSalesOrder`). Não cria pedido duplicado (índice único por orçamento).
- **Pedido**: `SalesDetailPage` com `embedded`: confirmação, PDF e versões. Sem sinal/pagamento nem exceção financeira.
- **Acompanhamento**: produção na esteira (etapa, responsável, chassi), documentação veicular e entregas, só consulta (`/api/comercial/jornada/[id]`, `lib/journey-server.ts`).

O estado vem sempre do banco; a etapa aberta fica em `?etapa=`, então atualizar a página não perde o progresso. O Financeiro não faz parte da Jornada: as integrações de backend entre pedido e Financeiro e as regras de liberação da produção continuam como estavam, só não aparecem nem são operadas aqui. O Kanban abre a Jornada; as páginas antigas de orçamentos e pedidos seguem disponíveis para consulta administrativa.
