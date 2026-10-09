# Integracao Asaas

## Escopo

O financeiro usa duas contas independentes:

| Conta | Finalidade | Documento fiscal |
| --- | --- | --- |
| `services` | Cobrancas e recebimentos de servicos por OS | NFS-e pelo Asaas |
| `materials` | Cobrancas e recebimentos de materiais por OS | NF-e pelo Base by Asaas |

As chaves nunca sao armazenadas no Supabase nem enviadas ao navegador. O banco guarda apenas IDs externos, estados, valores, URLs de documentos e payloads de auditoria.

## Preparacao

1. Execute `scripts/157_add_asaas_dual_account_integration.sql` no SQL Editor do Supabase.
2. Cadastre as variaveis descritas em `.env.example` na Vercel.
3. Comece com `ASAAS_ENVIRONMENT=sandbox` e chaves das duas contas de Sandbox.
4. Gere dois tokens aleatorios com pelo menos 32 caracteres para os webhooks.
5. Abra Financeiro > Integracao Asaas e clique em `Registrar webhooks`.

## Endpoints internos

- `GET /api/integrations/asaas/status`: diagnostico sem expor segredos.
- `POST /api/integrations/asaas/setup-webhooks`: registra os webhooks nas duas contas.
- `POST /api/integrations/asaas/payments`: cria cobranca e lancamento previsto vinculado a OS.
- `POST /api/integrations/asaas/invoices`: agenda NFS-e ou coloca NF-e de material na fila Base.
- `POST /api/integrations/asaas/sync`: concilia o extrato da conta no DRE.
- `POST /api/integrations/asaas/webhooks/services`: recebe eventos da conta de servicos.
- `POST /api/integrations/asaas/webhooks/materials`: recebe eventos da conta de materiais.

Os dois webhooks aceitam e auditam todos os grupos habilitados no Asaas: cobrancas, notas fiscais, transferencias, Pague Contas, antecipacoes, recargas, situacao da conta, assinaturas, checkouts, Pix Automatico, creditos Pix, bloqueios de saldo, movimentacoes internas e chaves de API. Eventos criticos aparecem em `Financeiro > Visao Geral` e em `Financeiro > Integracao Asaas`, sempre identificando a conta de origem.

Somente os dois endpoints de webhook sao publicos. Eles exigem o header `asaas-access-token` e processam cada `event.id` uma unica vez.

## Criar cobranca de uma OS

```json
{
  "account": "services",
  "serviceOrderId": "UUID_DA_OS",
  "billingType": "PIX",
  "dueDate": "2026-09-10",
  "value": 1500,
  "description": "Manutencao preventiva"
}
```

Para materiais, altere `account` para `materials`. Uma OS nao pode receber duas cobrancas ativas na mesma conta, mas pode possuir uma cobranca de servico e outra de material.

## Emitir documento fiscal

NFS-e de servico:

```json
{
  "kind": "service",
  "serviceOrderId": "UUID_DA_OS",
  "paymentId": "pay_000000000000",
  "effectiveDate": "2026-09-10",
  "value": 1200,
  "description": "Servicos de climatizacao",
  "municipalServiceId": "ID_DO_SERVICO_MUNICIPAL"
}
```

NF-e de material:

```json
{
  "kind": "material",
  "serviceOrderId": "UUID_DA_OS",
  "effectiveDate": "2026-09-10",
  "value": 300,
  "items": [
    { "materialId": "UUID", "quantity": 2, "unitValue": 150, "ncm": "00000000", "unit": "UN" }
  ]
}
```

A NF-e fica com status `AWAITING_BASE_CONFIGURATION` ate a chave, endpoint, cadastro fiscal, NCM e grupo tributario dos produtos estarem configurados no Base ERP.

## Tempo real e conciliacao

Webhooks atualizam cobrancas, transferencias e notas assim que o Asaas notifica o sistema. A sincronizacao do extrato e a camada de reconciliacao: importa entradas, tarifas, estornos e saidas que possam nao ter uma OS diretamente relacionada. Cada movimento usa um UUID deterministico e um indice unico, portanto repetir a sincronizacao nao duplica o DRE.
