# Conferência da limpeza: catálogo, estoque e compras

Somente leitura. Nada foi excluído. Marque o que **não** é teste antes de aprovar.

## Itens (`materials`)

| ID | SKU | Nome | Tipo | Un. | Estoque | Custo | Venda | Criado em |
|---|---|---|---|---|--:|--:|--:|---|
| 54a42ee1-24a5-44f9-aceb-4fe4a5a501e6 | REB-FAZ-200-PT | CARRETA FZ 1E | Produto | UN | 10.0 | 0.0 | 3380.0 | 2026-10-21T18:46 |
| 1d4bbd5f-6cc2-425e-bb7e-fe633ade8490 | REB-E1-0750-001 | FZ 1E | Produto | UN | 0.0 | 0.0 | 3380.0 | 2026-10-21T18:51 |
| fb87d43d-6d93-40d6-b45a-a6a45aecc39f | REB-E1-0750-001 | FZ 1E | Produto | UN | 0.0 | 0.0 | 3380.0 | 2026-10-21T18:52 |
| 2f393a1d-f0ad-48c7-9a5e-4f27b7db4f99 | REB-E1-0750-001 | FZ 1E | Produto | UN | 5.0 | 0.0 | 3380.0 | 2026-10-21T18:53 |
| 6a93b1c9-d684-493a-a899-52cf08d0304a | 89347825 | Barra de aço U 6mm | Materia-prima | M | 100.0 | 0.0 | 0.0 | 2026-10-22T15:59 |
| aca709d8-7b1a-4cb4-9f5d-a13dba48e7ec | CARFZ1CAR | FZ1E | Kit | UN | 2.0 | 0.0 | 0.0 | 2026-10-22T16:08 |

## Dependências por item (quantos registros apontam para ele)

| Item | product_compositions | product_composition_items | stock_movements | stock_balances | stock_reservations | purchase_order_items | quote_items | service_order_materials | product_fiscal_rules | service_type_materials | production_records |
|---|---|---|---|---|---|---|---|---|---|---|---|
| CARRETA FZ 1E (REB-FAZ-200-PT) | 0 | 0 | 1 | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 0 |
| FZ 1E (REB-E1-0750-001) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| FZ 1E (REB-E1-0750-001) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| FZ 1E (REB-E1-0750-001) | 0 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Barra de aço U 6mm (89347825) | 0 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| FZ1E (CARFZ1CAR) | 1 | 0 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## Composições (`product_compositions`): 1

| id | product_id | version | status | labor_cost | created_at |
|---|---|---|---|---|---|
| 9b586706-5e68-49b7-8353-62933e0f8f4b | aca709d8-7b1a-4cb4-9f5d-a13dba48e7ec | 1 | Ativa | 0.0 | 2026-10-22T16:10:07.599322+00:00 |

## Itens de composição: 1

| id | composition_id | component_id | quantity | unit | loss_percent |
|---|---|---|---|---|---|
| 84cc7742-6c45-4167-bb2f-8e09f2d5570d | 9b586706-5e68-49b7-8353-62933e0f8f4b | 6a93b1c9-d684-493a-a899-52cf08d0304a | 10.0 | M | 0.0 |

## Movimentações de estoque (`stock_movements`): 4

| id | material_id | movement_type | quantity | unit_cost | occurred_at | document_reference | responsible |
|---|---|---|---|---|---|---|---|
| 53e17d12-5996-4f53-9db8-8820d5c240be | 2f393a1d-f0ad-48c7-9a5e-4f27b7db4f99 | Saldo inicial | 5.0 | 0.0 | 2026-10-21T18:53:06.437671+00:00 |  | Vitor |
| 5a4d0813-b003-4a1e-b693-48902c14a163 | 54a42ee1-24a5-44f9-aceb-4fe4a5a501e6 | Entrada por compra | 10.0 | 0.0 | 2026-10-21T20:00:11.088871+00:00 |  | Vitor |
| c6347bed-27fd-4b71-bc4b-320d7489f306 | 6a93b1c9-d684-493a-a899-52cf08d0304a | Saldo inicial | 100.0 | 0.0 | 2026-10-22T15:59:18.691079+00:00 |  | Pietro Malvesi |
| e2fc163c-44fc-4bed-8754-cbddd29c7e13 | aca709d8-7b1a-4cb4-9f5d-a13dba48e7ec | Saldo inicial | 2.0 | 0.0 | 2026-10-22T16:08:27.750295+00:00 |  | Pietro Malvesi |

## Saldos por depósito (`stock_balances`): 4

| material_id | warehouse_id | quantity |
|---|---|---|
| 2f393a1d-f0ad-48c7-9a5e-4f27b7db4f99 | 00000000-0000-4000-8000-0000000000d1 | 5.0 |
| 54a42ee1-24a5-44f9-aceb-4fe4a5a501e6 | 00000000-0000-4000-8000-0000000000d1 | 10.0 |
| 6a93b1c9-d684-493a-a899-52cf08d0304a | 00000000-0000-4000-8000-0000000000d1 | 100.0 |
| aca709d8-7b1a-4cb4-9f5d-a13dba48e7ec | 00000000-0000-4000-8000-0000000000d1 | 2.0 |

## Pedidos de compra (`purchase_orders`): 1

| id | order_number | supplier_name | status | total_amount | created_at |
|---|---|---|---|---|---|
| 0fafada2-4da4-496c-8e85-96c5223ce61f | PC-000001 | ACOS MOURA PRODUTOS SIDERURGICOS LTDA | Cancelado | 0.0 | 2026-10-21T19:57:40.740421+00:00 |

## Itens de pedido de compra: 1

| id | purchase_order_id | material_id | quantity | unit_cost | received_quantity |
|---|---|---|---|---|---|
| 5f971c64-4108-4523-9e2e-b53b187c883b | 0fafada2-4da4-496c-8e85-96c5223ce61f | 54a42ee1-24a5-44f9-aceb-4fe4a5a501e6 | 999.0 | 0.0 | 0.0 |

## Depósitos (`warehouses`): configuração, preservar: 1

| id | code | name | is_default | status |
|---|---|---|---|---|
| 00000000-0000-4000-8000-0000000000d1 | DEP-01 | Depósito principal | True | Ativo |

## Fora da limpeza (preservados integralmente)
Clientes, fornecedores, financeiro (contas, lançamentos, DRE), notas importadas, usuários, permissões, empresas, configurações, logs/auditoria, integrações e dados fiscais.

