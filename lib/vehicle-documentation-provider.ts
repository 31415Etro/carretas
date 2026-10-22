// Adaptador do canal de documentação veicular. Nenhuma URL, credencial ou endpoint de órgão público é inventado aqui.
//
// O QUE O SERPRO PUBLICA (Manual "Pré-Cadastro de Veículos por Lote de Registros", v8.0 de 11/03/2026): o pré-cadastro no Sistema RENAVAM é feito
//   (1) on-line, num terminal do Sistema RENAVAM, com Senha-Rede do SERPRO (não é API); ou
//   (2) por lote de arquivo TXT (registros ITP, VF1, VF2 e FTP), transmitido pela ferramenta "Auto SCP" e processado na carga diária; o SERPRO devolve um relatório
//       de aceitação/rejeição por veículo (códigos de retorno). Há ambiente de homologação (HO) e produção (PR).
//   Exige credenciamento da montadora na SENATRAN ("Credencia") e código de cliente. Empresas credenciadas (ex.: ANFIR) pré-cadastram em nome de terceiros.
//   Não foi encontrada API REST oficial de ENVIO do pré-cadastro. (As APIs do catálogo gov.br, como o WSDenatran, são de CONSULTA.)
// Por isso o canal padrão é "manual" (a pessoa opera o portal e registra o protocolo/retorno aqui). O canal "serpro_lote" só será implementado depois que a ND Carretas
// confirmar o credenciamento, o código de cliente e o canal de troca de arquivos; até lá ele recusa o envio com uma mensagem clara. Nada é enviado a órgão público sem isso.
import { simulateConsult, simulateSubmit, type DocumentationChannel } from "./vehicle-documentation.ts"

export type SubmitPayload = { vin: string; documentation_id: string; [key: string]: unknown }
export type SubmitResult = { outcome: "sucesso" | "erro" | "indisponivel" | "rejeitado"; protocol?: string; message?: string; response?: unknown; pendencies?: string[] }
export type ConsultResult = { result: "aprovado" | "rejeitado" | "exigencia" | "processando"; message?: string; response?: unknown; pendencies?: string[] } | { unavailable: string }

export interface DocumentationProvider {
  id: DocumentationChannel
  /** Envio automático. O canal manual não envia: a pessoa registra o protocolo. */
  submit(payload: SubmitPayload, context: { idempotencyKey: string; submitAttempts: number }): Promise<SubmitResult>
  consult(protocol: string, context: { vin: string; consults: number }): Promise<ConsultResult>
}

const manual: DocumentationProvider = {
  id: "manual",
  async submit() { return { outcome: "erro", message: "Canal manual: faça o pré-cadastro no portal e registre o protocolo aqui." } },
  async consult() { return { unavailable: "Canal manual: o resultado é registrado por uma pessoa depois de conferir o portal." } },
}

const serproBatch: DocumentationProvider = {
  id: "serpro_lote",
  async submit() { return { outcome: "erro", message: "Canal de lote SERPRO ainda não configurado: depende do credenciamento na SENATRAN, do código de cliente e do Auto SCP. Use o canal manual." } },
  async consult() { return { unavailable: "O retorno do lote chega em arquivo de relatório; a importação desse arquivo ainda não foi implementada." } },
}

/** O simulador só existe com DOC_SIMULATOR_ENABLED=1 no servidor: aprovação simulada NUNCA pode liberar produção real por engano. */
const simulator: DocumentationProvider = {
  id: "simulador",
  async submit(payload, context) {
    const out = simulateSubmit({ vin: payload.vin, submitAttempts: context.submitAttempts })
    return { ...out, response: { simulated: true } }
  },
  async consult(_protocol, context) {
    const out = simulateConsult({ vin: context.vin, consults: context.consults })
    return { ...out, response: { simulated: true } }
  },
}

export const simulatorEnabled = () => String(process.env.DOC_SIMULATOR_ENABLED || "").trim() === "1"

export function getProvider(channel: string): DocumentationProvider {
  if (channel === "simulador") {
    if (!simulatorEnabled()) throw new Error("O simulador está desligado neste servidor (defina DOC_SIMULATOR_ENABLED=1 somente em ambiente de teste).")
    return simulator
  }
  return channel === "serpro_lote" ? serproBatch : manual
}
