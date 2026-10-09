import { readFile } from "node:fs/promises"
import path from "node:path"
import Docxtemplater from "docxtemplater"
import PizZip from "pizzip"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type TemplateField = {
  key: string
  label: string
  placeholders: string[]
  source?: "name" | "document" | "address" | "zipCode" | "phone" | "cityState" | "currentDate"
  input?: "text" | "textarea"
  defaultValue?: string
  required?: boolean
}

type TemplateDefinition = {
  id: string
  name: string
  description: string
  fileName: string
  outputPrefix: string
  fields: TemplateField[]
}

const templates: TemplateDefinition[] = [
  {
    id: "sistema-climatizacao",
    name: "Contrato de sistema de climatização",
    description: "Contrato principal para prestação de serviços e PMOC em sistemas de climatização.",
    fileName: "contrato-sistema-climatizacao.docx",
    outputPrefix: "contrato-sistema-climatizacao",
    fields: [
      { key: "razaoSocial", label: "Razão social", placeholders: ["Nome da Razão Social", "Nome da Razão social"], source: "name" },
      { key: "cnpj", label: "CNPJ", placeholders: ["Cnpj", "cnpj"], source: "document" },
      { key: "endereco", label: "Endereço", placeholders: ["Endereço", "entedereço"], source: "address", input: "textarea" },
      { key: "cep", label: "CEP", placeholders: ["CEP", "Cep"], source: "zipCode" },
      { key: "telefone", label: "Telefone", placeholders: ["Telefone"], source: "phone" },
      { key: "cidadeEstado", label: "Cidade/Estado", placeholders: ["Cidade/ Estado", "Cidade/estado"], source: "cityState" },
      { key: "dataAtual", label: "Data do contrato por extenso", placeholders: ["Data atual – DD Mês AAAA"], source: "currentDate" },
      { key: "nomeEmpresa", label: "Nome da empresa para assinatura", placeholders: ["Nome da Empresa"], source: "name" },
      { key: "edificioEntidade", label: "Edifício/Entidade", placeholders: ["Edifício/Entidade"], source: "name" },
      { key: "valorContrato", label: "Valor mensal do contrato", placeholders: ["Valor do Contrato"] },
      { key: "valorContratoExtenso", label: "Valor do contrato por extenso", placeholders: ["Valor do Contrato Por escrito"] },
      { key: "valorArt", label: "Valor da ART", placeholders: ["Valor da ART"] },
      { key: "technicalName", label: "Responsável técnico", placeholders: ["Responsável técnico"], defaultValue: "OSNI RICARDO DE ALMEIDA SERAFIM" },
      { key: "technicalTitle", label: "Formação/Cargo técnico", placeholders: ["Formação/Cargo técnico"], defaultValue: "ENGENHEIRO MECÂNICO / ENGENHEIRO DE SEGURANÇA DO TRABALHO" },
      { key: "technicalRegistration", label: "Registro profissional", placeholders: ["Registro profissional"], defaultValue: "CREA/SC 034926-8" },
      { key: "technicalPhone", label: "Telefone do responsável técnico", placeholders: ["Telefone do responsável técnico"], defaultValue: "(47) 98448-8160" },
      { key: "technicalEmail", label: "E-mail do responsável técnico", placeholders: ["E-mail do responsável técnico"], defaultValue: "osniserafim@gmail.com" },
    ],
  },
  {
    id: "termo-aditivo",
    name: "Termo aditivo",
    description: "Termo aditivo para inclusão de empresas no contrato de PMOC.",
    fileName: "termo-aditivo.docx",
    outputPrefix: "termo-aditivo",
    fields: [
      { key: "razaoSocial", label: "Razão social", placeholders: ["Razão social"], source: "name" },
      { key: "cnpj", label: "CNPJ", placeholders: ["Cnpj"], source: "document" },
      { key: "endereco", label: "Endereço", placeholders: ["Endereço"], source: "address", input: "textarea" },
      { key: "cep", label: "CEP", placeholders: ["CEP"], source: "zipCode" },
      { key: "cidadeEstado", label: "Cidade/Estado", placeholders: ["Cidade/Estado", "Cidade/ Estado"], source: "cityState" },
      { key: "dataAtual", label: "Data do termo por extenso", placeholders: ["DD Mês AAAA"], source: "currentDate" },
      { key: "empresa", label: "Empresa para assinatura", placeholders: ["Empresa"], source: "name" },
      { key: "aditivoCodigo", label: "Código do aditivo", placeholders: ["Código do aditivo"] },
      { key: "clause1", label: "Cláusula 1", placeholders: ["Cláusula 1"], input: "textarea", defaultValue: "O presente instrumento tem como objeto a inclusão das empresas selecionadas no polo ativo do contrato, pertencentes ao mesmo grupo econômico e já qualificadas neste instrumento." },
      { key: "clause2", label: "Cláusula 2", placeholders: ["Cláusula 2"], input: "textarea", defaultValue: "Ficam mantidas e ratificadas as demais cláusulas e condições estabelecidas no Contrato Original, que não foram alteradas pelo presente Termo Aditivo.", required: false },
      { key: "clause3", label: "Cláusula 3", placeholders: ["Cláusula 3"], input: "textarea", defaultValue: "As partes e as testemunhas que subscrevem o presente instrumento concordam expressamente que este poderá ser assinado eletronicamente através da plataforma que melhor lhes aprouver, nos termos do art. 10, § 2º da MP 2200-2/2001 c/c do art. 6º do Decreto nº 10.278/2020.", required: false },
      { key: "clause4", label: "Cláusula 4", placeholders: ["Cláusula 4"], input: "textarea", required: false },
      { key: "clause5", label: "Cláusula 5", placeholders: ["Cláusula 5"], input: "textarea", required: false },
    ],
  },
]

function publicDefinition(template: TemplateDefinition) {
  const { fileName: _fileName, outputPrefix: _outputPrefix, ...definition } = template
  return definition
}

function safeFilePart(value: unknown) {
  return String(value || "documento")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80) || "documento"
}

export async function GET() {
  return NextResponse.json({ templates: templates.map(publicDefinition) })
}

export async function POST(request: Request) {
  try {
    const payload = await request.json()
    const template = templates.find((item) => item.id === payload.templateId)
    if (!template) return NextResponse.json({ error: "Tipo de contrato inválido." }, { status: 400 })

    const values = payload.values && typeof payload.values === "object" ? payload.values as Record<string, unknown> : {}
    const missing = template.fields.filter((field) => field.required !== false && !String(values[field.key] || "").trim())
    if (missing.length) {
      return NextResponse.json({ error: `Preencha os campos: ${missing.map((field) => field.label).join(", ")}.` }, { status: 400 })
    }

    const templatePath = path.join(process.cwd(), "public", "contract-templates", template.fileName)
    const content = await readFile(templatePath)
    const document = new Docxtemplater(new PizZip(content), {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter(part) {
        return `{${part.value}}`
      },
    })

    const replacements: Record<string, string> = {}
    for (const field of template.fields) {
      const value = String(values[field.key] || "").trim()
      replacements[field.key] = value
    }
    for (const [key, value] of Object.entries(values)) {
      if (!(key in replacements)) replacements[key] = String(value || "").trim()
    }
    document.render(replacements)

    const output = document.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" })
    const responseBody = Uint8Array.from(output).buffer
    const clientPart = safeFilePart(payload.clientName)
    const fileName = `${template.outputPrefix}-${clientPart}.docx`

    return new Response(responseBody, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("[contract-documents]", error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "Erro ao gerar o contrato." }, { status: 500 })
  }
}
