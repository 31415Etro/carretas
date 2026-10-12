# ERP Carretas

Sistema de gestão (ERP) para uma empresa que **fabrica carretas**: financeiro, estoque, compras, produtos e serviços, ordens de serviço, frota, comercial (clientes, fornecedores, vendedores e funil), orçamentos, contratos, relatórios, dashboard e configurações.

Next.js 16 (App Router) + Supabase + Tailwind.

## Módulos

| Módulo | Rota | Observações |
| --- | --- | --- |
| Dashboard | `/dashboard` | Indicadores de financeiro, estoque, OS, frota e comercial, com detalhamento dos registros |
| Financeiro | `/financeiro` | Contas a pagar/receber com parcelas, contas bancárias, DRE, cartões, Asaas e NotaAS |
| Estoque | `/estoque` | Saldo por depósito, movimentações, reservas, inventário, sugestão de compra |
| Compras | `/compras` | Pedido, aprovação, recebimento com entrada no estoque e contas a pagar |
| Produtos / Serviços | `/servicos` | Catálogo único: produto, matéria-prima, kit/composição (versionada) e serviço |
| Ordens de Serviço | `/ordens-servico` | Fluxo de 9 etapas, peças reservadas/baixadas, horas, margem, aceite, fabricação |
| Frota | `/frota` | Veículos e implementos, motoristas (CNH), manutenção, abastecimento, documentos, alertas de vencimento e, se a empresa faz transporte rodoviário, pneus por posição e viagens |
| Comercial | `/comercial` | Cadastro único de clientes e fornecedores (CPF/CNPJ sem duplicidade, dados fiscais, consulta de CNPJ), vendedores e funil de oportunidades com histórico (`/clientes` redireciona para cá) |
| Orçamentos | `/orcamento` | Orçamentos com itens do catálogo, preço negociado preservado, margem, versões, PDF com logotipo, envio por e-mail/WhatsApp, aceite e conversão em venda ou OS com títulos a receber |
| Contratos | `/contratos` | Contratos de receita e despesa, cobrança recorrente automática sem duplicar, OS periódicas de manutenção, aditivos e documentos com versões, obrigações e alertas de vencimento (agendador em `/api/contratos/cron`, exige `CRON_SECRET`) |
| Relatórios | `/relatorios` | 31 relatórios de financeiro, estoque, produtos, OS, frota, comercial, orçamentos e contratos, com filtros, colunas, agrupamento, ordenação, totais, exportação em PDF/Excel/CSV respeitando permissões, relatórios salvos com usuários autorizados e envio agendado por e-mail (`/api/relatorios/cron`) |
| Log do Sistema | `/logs-sistema` | Trilha de auditoria (quem, quando, o quê, valores antes/depois, IP, sessão, resultado e origem) protegida contra alteração com cadeia de hash, retenção configurável, exportação e verificação de integridade; mais as falhas técnicas do sistema. Somente administradores |
| Configurações | `/configuracoes` | Empresas (fiscal, endereço, certificado, logotipo), filiais, usuários (empresas autorizadas, filial, departamento, cargo, MFA), equipe técnica, parâmetros financeiros/estoque/operacionais/comerciais/notificações, naturezas de operação, tabelas de preço, modelos de orçamento, integrações (status, histórico, reprocessamento) e documentos |

## Banco de dados

Os scripts em `scripts/` são executados no SQL Editor do Supabase, em ordem numérica. As migrações do ERP começam em `200_`:

`200` produtos · `201` financeiro · `202` estoque · `203` compras · `204` dashboard · `205` catálogo · `206` ordem de serviço · `207` remoção das estruturas herdadas do sistema anterior · `208` frota (rode depois do 206; o 207 só em banco sem dados do sistema anterior) · `209` comercial · `210` orçamentos · `211` contratos · `212` relatórios · `213` auditoria · `214` configurações.

## Configuração

Copie `.env.example` para `.env.local` e preencha as variáveis (Supabase, alertas por e-mail, Asaas, NotaAS).

## Desenvolvimento

```bash
npm install
npm run dev
npm test
```

## Documentação

- `docs/dicionario-de-dados.md`: dicionário de dados gerado das migrações (`python scripts/gerar-dicionario-de-dados.py`).
- `docs/lgpd.md`: práticas técnicas de proteção de dados pessoais.
