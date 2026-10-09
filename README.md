# ERP Carretas

Sistema de gestão (ERP) para uma empresa que **fabrica carretas**: financeiro, estoque, compras, produtos e serviços, ordens de serviço, frota, clientes e fornecedores, dashboard e configurações. Comercial, Orçamentos, Contratos e Relatórios estão no menu aguardando especificação.

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
| Frota | `/frota` | Veículos e manutenções |
| Clientes e Fornecedores | `/clientes` | Cadastros com consulta de CNPJ |
| Configurações | `/configuracoes` | Usuários e permissões, equipe técnica, empresas (CNPJs) |

## Banco de dados

Os scripts em `scripts/` são executados no SQL Editor do Supabase, em ordem numérica. As migrações do ERP começam em `200_`:

`200` produtos · `201` financeiro · `202` estoque · `203` compras · `204` dashboard · `205` catálogo · `206` ordem de serviço · `207` remoção das estruturas herdadas do sistema anterior.

## Configuração

Copie `.env.example` para `.env.local` e preencha as variáveis (Supabase, alertas por e-mail, Asaas, NotaAS).

## Desenvolvimento

```bash
npm install
npm run dev
npm test
```
