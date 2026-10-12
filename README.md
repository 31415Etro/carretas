# ERP Carretas

Sistema de gestão (ERP) para uma empresa que **fabrica carretas**: financeiro, estoque, compras, produtos e serviços, ordens de serviço, frota, comercial (clientes, fornecedores, vendedores e funil), dashboard e configurações. Orçamentos, Contratos e Relatórios estão no menu aguardando especificação.

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
| Configurações | `/configuracoes` | Usuários e permissões, equipe técnica, empresas (CNPJs) |

## Banco de dados

Os scripts em `scripts/` são executados no SQL Editor do Supabase, em ordem numérica. As migrações do ERP começam em `200_`:

`200` produtos · `201` financeiro · `202` estoque · `203` compras · `204` dashboard · `205` catálogo · `206` ordem de serviço · `207` remoção das estruturas herdadas do sistema anterior · `208` frota (rode depois do 206; o 207 só em banco sem dados do sistema anterior) · `209` comercial.

## Configuração

Copie `.env.example` para `.env.local` e preencha as variáveis (Supabase, alertas por e-mail, Asaas, NotaAS).

## Desenvolvimento

```bash
npm install
npm run dev
npm test
```
