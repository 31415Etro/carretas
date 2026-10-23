// Leitura de RG / CIN / CNH a partir do texto do OCR (feito no navegador). Funções puras, testáveis.
import { isValidCpf } from "./commercial.ts"

export type ParsedIdDocument = {
  kind: "RG" | "CNH" | "Documento"
  name: string
  cpf: string // 11 dígitos
  birthDate: string // yyyy-mm-dd
  rg: string
  cnh: string
  motherName: string
  fatherName: string
  warnings: string[]
}

const NOT_A_NAME = /REPUBLICA|FEDERATIVA|BRASIL|CARTEIRA|NACIONAL|HABILITACAO|IDENTIDADE|MINISTERIO|SECRETARIA|DETRAN|DEPARTAMENTO|ESTADO|VALIDA|TERRITORIO|ASSINATURA|REGISTRO|NASCIMENTO|FILIACAO|CATEGORIA|OBSERVACOES|LOCAL|DATA|EMISSAO|ORGAO|EMISSOR|DOCUMENTO|ORIGEM|NATURALIDADE|CPF|PERMISSAO|ACC|TRANSITO|SEGURANCA|PUBLICA|INSTITUTO|CIVIL|GERAL|NOME|PAI|MAE|FOTO|IMPRESSAO|DIGITAL|HOMEM|MULHER|SEXO|NACIONALIDADE|ASSINADO|DIGITALMENTE|CONTRAN|ASSINATURA/
const strip = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()

const looksLikeName = (line: string) => {
  const flat = strip(line).replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim()
  const words = flat.split(" ").filter((word) => word.length >= 2)
  return words.length >= 2 && words.length <= 8 && flat.length >= 6 && !NOT_A_NAME.test(flat) && !/\d/.test(line)
}
const cleanName = (line: string) => strip(line).replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter((word, index, all) => word.length > 1 || (index > 0 && index < all.length - 1)).join(" ")

/** Valor de um rótulo: o que vem depois dele na mesma linha ou, se vazio/curto, a próxima linha com conteúdo. */
function afterLabel(lines: string[], label: RegExp, accept: (value: string) => boolean, skip?: RegExp): string {
  for (let index = 0; index < lines.length; index++) {
    const flat = strip(lines[index])
    if (!label.test(flat) || (skip && skip.test(flat))) continue
    const same = lines[index].replace(/^.*?(?:NOME|NAME)\s*[:\-]?\s*/i, "")
    if (same !== lines[index] && accept(same)) return same
    for (let next = index + 1; next < Math.min(lines.length, index + 3); next++) if (accept(lines[next])) return lines[next]
  }
  return ""
}

export function parseIdDocument(rawText: string): ParsedIdDocument {
  const warnings: string[] = []
  const lines = rawText.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean)
  const upper = strip(rawText)
  const kind: ParsedIdDocument["kind"] = /HABILITACAO|CNH|PERMISSAO PARA DIRIGIR/.test(upper) ? "CNH" : /REGISTRO GERAL|CARTEIRA DE IDENTIDADE|CEDULA DE IDENTIDADE|\bCIN\b/.test(upper) ? "RG" : "Documento"

  let cpf = ""
  for (const match of rawText.matchAll(/(?<!\d)(\d{3})[.\s]?(\d{3})[.\s]?(\d{3})[-\s.]?(\d{2})(?!\d)/g)) {
    const digits = match.slice(1, 5).join("")
    if (isValidCpf(digits)) { cpf = digits; break }
  }
  if (!cpf) warnings.push("Não consegui ler o CPF: digite à mão.")

  let birthDate = ""
  const dates = Array.from(rawText.matchAll(/(?<!\d)(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})(?!\d)/g), (match) => ({ iso: `${match[3]}-${match[2]}-${match[1]}`, year: Number(match[3]), index: match.index || 0 })).filter((item) => item.year >= 1920 && item.year <= new Date().getFullYear() - 14 && Number(item.iso.slice(5, 7)) >= 1 && Number(item.iso.slice(5, 7)) <= 12)
  const birthLabel = upper.search(/NASC/)
  if (dates.length) {
    // prefere a data logo depois do rótulo "nascimento"; senão a mais antiga (validade e emissão são sempre mais novas)
    const afterNasc = birthLabel >= 0 ? dates.filter((item) => item.index >= rawText.length * 0 && strip(rawText.slice(0, item.index)).lastIndexOf("NASC") >= 0 && item.index - strip(rawText.slice(0, item.index)).lastIndexOf("NASC") < 80)[0] : undefined
    birthDate = (afterNasc || [...dates].sort((a, b) => a.year - b.year)[0]).iso
  } else warnings.push("Não consegui ler a data de nascimento.")

  let name = afterLabel(lines, /(^|\s)NOME(?!\s*(SOCIAL|DO PAI|DA MAE))/, looksLikeName, /NOME\s*(SOCIAL|DO PAI|DA MAE)/)
  if (!name) name = lines.find(looksLikeName) || ""
  name = name ? cleanName(name) : ""
  if (!name) warnings.push("Não consegui ler o nome: digite à mão.")

  const rgMatch = upper.match(/(?:REGISTRO GERAL|DOC\.? ?IDENTIDADE|IDENTIDADE|\bRG\b)[^0-9A-Z]{0,12}([0-9][0-9.\-]{5,12}[0-9X]?)/)
  const rg = rgMatch ? rgMatch[1].replace(/[^0-9X.\-]/g, "") : ""
  const cnhMatch = kind === "CNH" ? upper.match(/REGISTRO[^0-9]{0,15}(\d{11})(?!\d)/) : null
  const cnh = cnhMatch ? cnhMatch[1] : ""

  let fatherName = "", motherName = ""
  const filiation = lines.findIndex((line) => /FILIA/.test(strip(line)))
  if (filiation >= 0) {
    const candidates = lines.slice(filiation, filiation + 6).map((line) => line.replace(/^.*?FILIA[CÇ][AÃ]O\s*/i, "")).filter(looksLikeName).map(cleanName)
    ;[fatherName, motherName] = candidates.length >= 2 ? [candidates[0], candidates[1]] : ["", candidates[0] || ""]
  }
  return { kind, name, cpf, birthDate, rg, cnh, motherName, fatherName, warnings }
}

/** Observações para o cadastro com o que não tem campo próprio (RG, nascimento, filiação, CNH). */
export function idDocumentNotes(parsed: ParsedIdDocument) {
  const born = parsed.birthDate ? parsed.birthDate.split("-").reverse().join("/") : ""
  return [
    `Dados lidos do ${parsed.kind === "CNH" ? "CNH" : "RG/CIN"} por foto:`,
    parsed.rg ? `RG: ${parsed.rg}` : "", parsed.cnh ? `CNH: ${parsed.cnh}` : "", born ? `Nascimento: ${born}` : "",
    parsed.motherName ? `Mãe: ${parsed.motherName}` : "", parsed.fatherName ? `Pai: ${parsed.fatherName}` : "",
  ].filter(Boolean).join(" | ")
}
