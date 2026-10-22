# Documentação veicular (pré-cadastro) antes da produção

Script: `scripts/224_documentacao_veicular.sql` (aditivo e idempotente; requer 217 a 223). Telas: `/documentacao`, seção em `/vendas/[id]`, aviso em `/producao/[id]`, andamento na oportunidade (Comercial).

## 1. Auditoria do que já existia (antes desta etapa)
- **Chassi/VIN:** só na Frota (veículos próprios): `lib/fleet.ts` valida VIN (17 caracteres, sem I, O, Q) e impede chassi repetido na frota. Não havia vínculo com produto vendido.
- **Pré-cadastro, SERPRO, SENATRAN, CAT, CRLV de produto novo:** nenhum código, tabela, variável de ambiente (`.env.example`) ou integração. O único "CRLV" no sistema é o anexo de documento da frota.
- **Integrações existentes:** Asaas (cobrança), NotaAS/Base by Asaas (notas fiscais) e NFeMail (importação de notas). Nenhuma é de documentação veicular.
- **Conclusão:** o portal que a ND Carretas usa **não está registrado no código**. Isso precisa ser confirmado por vocês (ver seção 5).

## 2. O que o SERPRO publica sobre o pré-cadastro (fontes oficiais)
Manual "Sistema RENAVAM — Pré-Cadastro de Veículos por Lote de Registros — Instruções", versão 8.0 (11/03/2026), e página [Pré Cadastro Veicular — Central de Ajuda do Serpro](https://centraldeajuda.serpro.gov.br/precadastroveicular/):

| Tema | Informação |
|---|---|
| O que é | Registro na BIN/RENAVAM da fabricação de cada unidade (acabada ou não), **anterior** ao primeiro CRV (placa). |
| Quem pode | Empresa com CNAE compatível, **credenciada na SENATRAN** (sistema "Credencia") e com contratação do SERPRO. |
| Modos | (1) **on-line**, num terminal do Sistema RENAVAM, com **Senha-Rede** do SERPRO (não é API); (2) **lote de arquivo TXT**, enviado pela ferramenta **Auto SCP**, processado na carga diária; o SERPRO devolve relatório de aceitação/rejeição por veículo. |
| Layout do lote | Registros `ITP` (identificação), `VF1` e `VF2` (dados do veículo; VIN, tipo, espécie, carroceria, cor, eixos etc.), `FTP` (encerramento). Código de atualização 1 inclusão, 2 alteração, 3 exclusão. |
| Ambientes | Homologação (`HO`) e produção (`PR`). Arquivos fora do padrão voltam como `.ERRO1`/`.ERRO3`. |
| Identificação | CNPJ da montadora, código da montadora e **código cliente**, fornecidos pela SENATRAN; lote rejeitado com código 40 se a montadora não estiver credenciada. |
| Retorno | Relatório com códigos de retorno (ex.: 34 restrição ativa; 40 montadora não credenciada; 41 ano incompatível com o VIN). |
| Terceiros | Empresas credenciadas pela SENATRAN fazem o pré-cadastro on-line para outras (o manual cita ANFIR, ANGIS, AUTOTEC, INFORT, SECON e SIMEFRE). |
| Custos/limites | Não constam no manual; a contratação é com o SERPRO (menu "Como Contratar" da central de ajuda). O módulo Auto SCP cliente é sem ônus, segundo o manual. |

**Não foi encontrada API REST oficial para ENVIAR o pré-cadastro.** As APIs do catálogo gov.br (por exemplo o WSDenatran) são de **consulta** de veículos. Por isso nenhuma URL, endpoint ou credencial foi inventada e **nenhuma chamada a órgão público é feita pelo sistema**.

## 3. Arquitetura implementada
**Banco (script 224):**
- `vehicle_documentation`: **uma linha por unidade vendida** (pedido, item, nº da unidade, cliente, produto, modelo, versão da estrutura, chassi/VIN, CAT, código marca/modelo/versão, portal, canal, protocolo, situação, estágio final, pendências, datas, responsável). Índices únicos: **chassi** (global, qualquer empresa, ignora documentação cancelada) e **protocolo por portal**.
- `vehicle_documentation_attempts`: **todas as tentativas** (envio, reenvio, consulta, retorno manual), com requisição, resposta, resultado e **chave de idempotência**. `vehicle_documentation_events`: histórico. `vehicle_documentation_files`: comprovantes. Tentativas e eventos não podem ser apagados.
- Situações: Pendente de dados → Pronto para envio → Envio em andamento → Enviado → Aguardando processamento → Em exigência / Rejeitado → Aprovado para liberação (ou Cancelado). **Estágio final** (CRLV, ATPV-e, emplacamento) é um campo separado e **não** altera a liberação.
- Envio em duas fases (`vehicle_doc_begin_submit` / `vehicle_doc_finish_submit`): repetir o clique devolve a mesma tentativa; uma unidade já enviada não é enviada de novo; serviço indisponível devolve a unidade para "Pronto para envio" com o erro registrado.
- Retorno (`vehicle_doc_apply_result`): idempotente por chave; retorno tardio de rejeição depois da aprovação é **ignorado e registrado**.
- **Liberação calculada** (`production_eligibility`): pedido confirmado + documentação aprovada em **todas** as unidades + (sinal, se a empresa exigir) + autorização operacional registrada. Não existe campo "liberado" editável: o resultado vem do estado dos processos. Gatilhos no banco bloqueiam **iniciar, consumir material e concluir unidades** enquanto houver bloqueio. Demanda e planejamento/reserva de materiais **continuam** liberados.
- **Exceção formal:** só da exigência comercial (sinal), só se a empresa ligou a regra, só por administrador/gerente, com justificativa de no mínimo 10 caracteres e evento de auditoria. **Documentação nunca é dispensável** (requisito legal).
- **Financeiro:** ao confirmar o pedido, se a empresa ligar a regra, gera os títulos a receber previstos pela condição de pagamento (entrada = primeira parcela com vencimento imediato), uma única vez. **Desligado por padrão** para não criar lançamentos reais em testes.
- Regras por empresa (`sales_settings`): documentação obrigatória, autorização obrigatória, sinal, exceção, títulos previstos, canal, dias para alerta. Toda mudança é registrada em `sales_settings_log`.

**Aplicação (TypeScript):**
- `lib/vehicle-documentation-provider.ts`: adaptador de canal. `manual` (a pessoa opera o portal e registra protocolo/retorno aqui), `serpro_lote` (**não implementado**, recusa com mensagem clara) e `simulador` (somente testes; só existe com `DOC_SIMULATOR_ENABLED=1` no servidor, porque uma aprovação simulada nunca pode liberar produção real).
- `lib/vehicle-documentation-server.ts`: envio, registro manual, consulta e **monitoramento** (`runDocumentationMonitor`).
- **Monitoramento no backend:** `GET /api/documentacao/cron` (agendado no `vercel.json`, protegido por `CRON_SECRET`) consulta os protocolos vencidos, atualiza as unidades, relata mudanças, sinaliza atrasos e não duplica. Falha de um protocolo não interrompe os outros. Agendado **1 vez por dia**; frequência maior depende do plano da hospedagem.
- Aprovação/retorno manual e cancelamento: **somente administrador ou gerente** (a aprovação libera a produção).

## 4. O que está testado
- `scripts/tests-sql/etapa7.test.mjs` (11 testes): uma carreta, várias carretas, uma documentação por unidade, dados incompletos, envio duplicado, retorno aprovado, rejeitado, exigência, serviço indisponível, consulta repetida, bloqueio da produção, liberação após aprovação, revogação, exceção formal, isolamento entre empresas, rastreabilidade do chassi (único, inclusive entre empresas), financeiro.
- Verificação adicional local da orquestração real do servidor com o simulador (envio, consulta, exigência, rejeição, monitor, canais).
- `lib/vehicle-documentation.test.ts`: ações por perfil, simulador e VIN.

## 5. O que precisa ser confirmado pela ND Carretas (para ligar um canal real)
1. **Qual caminho a ND Carretas usa hoje:** terminal do Sistema RENAVAM (Senha-Rede), lote por Auto SCP, ou uma empresa credenciada que faz o pré-cadastro em nome dela?
2. Se for lote: **credenciamento na SENATRAN**, **código cliente da montadora**, CNPJ transmissor, acesso ao Auto SCP e ambiente de homologação.
3. Quais campos o portal pede além de chassi, modelo e cliente (por exemplo CAT e código marca/modelo/versão, tipo de veículo, espécie, carroceria, eixos, cor, ano) e **onde esses dados vivem hoje**; o cadastro de produto ainda não tem todos.
4. Custos de contratação e limites no SERPRO.

Com essas respostas dá para implementar o gerador do arquivo de lote (layout do manual), a importação do relatório de retorno e a homologação no ambiente `HO` antes de qualquer envio em produção. Até lá, o canal **manual** funciona de ponta a ponta.
