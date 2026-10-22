# Máquinas e Equipamentos

## Decisões de arquitetura
- Mesmo padrão da Frota: migration SQL numerada (`scripts/218_maquinas.sql`), API em rotas Next com service role, escopo por `system_company_id` (tabelas em `tenantScopedTables`, RLS restritiva), auditoria por gatilho (módulo `maquinas`), bucket privado `machine-files`.
- Permissões novas: `maquinas` (ver e reportar problema), `maquinas_manutencao` (manutentor: status, ordens, planos, horímetro, QR), `maquinas_patrimonio` (dados patrimoniais e financeiros). Admin tem tudo.
- Status operacional (Em operação / Em manutenção / Parada / Sem status) é separado do administrativo (Ativo / Inativo / Baixado). Só muda pela função `machine_change_status` (trava a linha, versão otimista, bloqueio de segurança, ordem que impede o uso, histórico imutável).
- Códigos (ND-MAQ-000001, OM-2026-000001) vêm de contadores com upsert atômico; nunca reutilizados.
- QR: token opaco revogável; abre `/maquinas/q/<token>` (exige login e empresa). Reimpressão e reemissão não mudam o código patrimonial.
- Estoque: peça da OM baixa uma vez ao concluir (`Consumo em OS`), com reivindicação `pendente → postando → baixado`. Histórico anterior não baixa (só admin pode autorizar).
- Sincronização entre usuários: leitura a cada 30 s e ao voltar o foco; não há sensores/IoT.

## Pendências
- Financeiro (conta a pagar) e Compras (pedido): a ordem tem `payable_id`/`purchase_order_id`, mas a criação automática não foi ligada.
- Produção: o ERP não tem o módulo; nada integrado.
- Aviso por e-mail de manutenções vencidas: não incluído (só a abertura automática de ordens em `/api/maquinas/cron`, 08:15).
- Ilustração por IA: não implementada (exigiria autorização de custo).
- Planta da fábrica: `machine_sectors.map_layout` reservado; hoje só grade por setor.

## Homologação
1. Rode `scripts/218_maquinas.sql` e depois `scripts/218_maquinas_verificacao.sql` (termina em ROLLBACK; deve imprimir OK 1 a 8).
2. Dê as permissões aos usuários; em Configurações de máquinas crie setores, categorias e a URL base do QR.
3. Cadastre uma máquina; confira código, etiqueta PDF e QR no celular.
4. Altere o status em dois navegadores ao mesmo tempo: o segundo recebe "alterado por outra pessoa".
5. Abra uma OM com peça do estoque, conclua e confirme a liberação; a baixa ocorre uma vez.
