// Leitura de comprovante de residência (conta de luz, água, telefone, extrato, boleto...) a partir do texto lido (OCR ou camada de texto do PDF).
// Não depende do layout: acha o CEP (o único dado que todo comprovante traz), a linha do logradouro com o número e o que vier rotulado (bairro, cidade/UF).
// O CEP é conferido numa base oficial (ver /api/cadastros/cep) para completar logradouro, bairro, cidade e UF. Funções puras, testáveis.
import { brStates } from "./commercial.ts"

export type ParsedResidence = {
  zipCandidates: string[]   // CEPs achados no texto, do mais provável para o menos (8 dígitos)
  street: string
  number: string
  complement: string
  district: string
  city: string
  state: string
  holder: string            // titular que aparece no comprovante (pode não ser o cliente)
  warnings: string[]
}
export type ZipData = { street?: string; district?: string; city?: string; state?: string }
export type ResidenceFields = { zipCode: string; street: string; number: string; complement: string; district: string; city: string; state: string }

const strip = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
const STREET_WORD = "RUA|R\\.|AV\\.?|AVENIDA|TRAVESSA|TRAV\\.?|TV\\.?|RODOVIA|ROD\\.?|ESTRADA|EST\\.?|ALAMEDA|AL\\.|PRACA|PCA\\.?|LARGO|VIELA|BECO|SERVIDAO|SERV\\.?|LOTEAMENTO|LOT\\.?|LINHA|SITIO|FAZENDA|CAMINHO|PARQUE|VILA|JARDIM"
const STREET = new RegExp(`(^|[^A-Z0-9])((?:${STREET_WORD})\\s+[A-Z0-9][^\\n]*)`)
const COMPLEMENT = /\b(APTO?\.?|APARTAMENTO|AP\.?|BLOCO|BL\.?|CASA|SALA|CJ\.?|CONJ(?:UNTO)?\.?|LOTE|LT\.?|QUADRA|QD\.?|FUNDOS|SOBRADO|ANDAR|LOJA|KM)\s*[A-Z0-9][A-Z0-9\-\/]*/
const NOISE_AFTER_NUMBER = /\s*(?:[-,;]|\bBAIRRO\b|\bCEP\b|\bCIDADE\b|\bMUNIC|\bCOMPL|\bAPTO?\b|\bBLOCO\b|\bCASA\b|\bSALA\b).*$/

const titleCase = (value: string) => value.toLowerCase().replace(/(^|[\s.\-])([a-zà-ÿ])/g, (_, lead, letter) => lead + letter.toUpperCase()).replace(/\b(Da|De|Do|Das|Dos|E)\b/g, (word) => word.toLowerCase())
const clean = (value: string) => value.replace(/\s+/g, " ").replace(/^[\s:;,\-–]+|[\s:;,\-–]+$/g, "").trim()

/** CEPs do texto, do mais para o menos provável (rótulo "CEP" e vizinhança de endereço pesam; sequências longas de dígitos, como código de barras, não valem). */
export function findZipCandidates(text: string) {
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim())
  const scored = new Map<string, number>()
  lines.forEach((line, index) => {
    if ((line.match(/\d/g) || []).length > 30) return
    for (const match of line.matchAll(/(?<![\d.\-\/])(\d{2})\.?(\d{3})-?(\d{3})(?![\d])/g)) {
      const zip = `${match[1]}${match[2]}${match[3]}`
      if (/^0{5}|^(\d)\1{7}$/.test(zip)) continue
      const around = strip([lines[index - 1], line, lines[index + 1]].filter(Boolean).join(" "))
      let score = 1
      if (/CEP/.test(strip(line.slice(Math.max(0, (match.index || 0) - 12), match.index)))) score += 6
      if (new RegExp(`(^|[^A-Z])(${STREET_WORD})\\s`).test(around)) score += 3
      if (/BAIRRO|CIDADE|MUNICIPIO|ENDERECO|LOGRADOURO/.test(around)) score += 2
      scored.set(zip, Math.max(scored.get(zip) || 0, score) + ((scored.get(zip) || 0) ? 0.1 : 0))
    }
  })
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([zip]) => zip).slice(0, 4)
}

/** Logradouro, número e complemento da linha de endereço (a mais próxima do CEP). */
function findStreet(lines: string[], zip: string) {
  const zipLine = lines.findIndex((line) => line.replace(/\D/g, "").includes(zip) && (line.match(/\d/g) || []).length <= 30)
  const order = lines.map((_, index) => index).sort((a, b) => Math.abs(a - (zipLine < 0 ? 0 : zipLine)) - Math.abs(b - (zipLine < 0 ? 0 : zipLine)))
  for (const index of order) {
    const upper = strip(lines[index])
    if ((upper.match(/\d/g) || []).length > 30) continue
    const found = STREET.exec(upper)
    if (!found) continue
    // volta ao texto original (com acentos) pela posição na versão sem acento (mesmo tamanho)
    const start = (found.index || 0) + found[1].length
    let rest = lines[index].slice(start)
    const complement = COMPLEMENT.exec(strip(rest))
    const complementText = complement ? clean(rest.slice(complement.index, complement.index + complement[0].length)) : ""
    let number = ""
    const withComma = /^(.*?),\s*(?:N[º°O.]*\s*)?(\d{1,6}[A-Z]?|S\/?N)\b/i.exec(rest)
    const withDash = /^(.*?)\s+(?:N[º°O.]*\s*)?(\d{1,6})(?=\s*(?:[-,;]|$|\b(?:APTO?|BLOCO|CASA|SALA|BAIRRO|CEP)\b))/i.exec(strip(rest))
    let name = ""
    if (withComma) { name = withComma[1]; number = withComma[2].toUpperCase() }
    else if (withDash && !/\b(DE|DO|DA)$/.test(withDash[1])) { name = rest.slice(0, withDash[1].length); number = withDash[2] }
    else { name = rest.replace(NOISE_AFTER_NUMBER, ""); const sn = /\bS\/?N\b/i.exec(rest); if (sn) number = "S/N" }
    name = clean(name.replace(NOISE_AFTER_NUMBER, ""))
    if (name.length < 5) continue
    return { street: name, number: number === "S/N" || number === "SN" ? "S/N" : number, complement: complementText }
  }
  return { street: "", number: "", complement: "" }
}

const UF = new RegExp(`\\b(${brStates.join("|")})\\b`)

export function parseResidenceProof(rawText: string): ParsedResidence {
  const warnings: string[] = []
  const lines = rawText.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean)
  const zipCandidates = findZipCandidates(rawText)
  if (!zipCandidates.length) warnings.push("Não achei o CEP no comprovante: confira o endereço à mão.")
  const { street, number, complement } = findStreet(lines, zipCandidates[0] || "")
  if (street && !number) warnings.push("Não achei o número do imóvel: digite à mão.")

  let district = ""
  for (const line of lines) {
    const found = /\bBAIRRO\b\s*[:\-]?\s*([A-ZÀ-Ü][A-ZÀ-Ü0-9 .'\-]{2,40}?)(?=\s{2,}|\s+(?:CEP|CIDADE|MUNIC|UF|CNPJ|CPF)\b|$)/i.exec(strip(line).length === line.length ? line : line)
    if (found) { district = clean(found[1]); break }
  }

  let city = "", state = ""
  const cityLabel = lines.map((line) => /(?:MUNIC[IÍ]PIO|CIDADE)\s*[:\-]?\s*([A-ZÀ-Ü][A-ZÀ-Ü ']{2,40}?)\s*(?:[-\/,]\s*([A-Z]{2}))?(?=\s{2,}|\s+(?:CEP|UF|BAIRRO)\b|$)/i.exec(line)).find(Boolean)
  if (cityLabel) { city = clean(cityLabel[1]); if (cityLabel[2] && brStates.includes(cityLabel[2].toUpperCase())) state = cityLabel[2].toUpperCase() }
  if (!city) {
    const near = lines.find((line) => /\d{2}\.?\d{3}-?\d{3}/.test(line) && /[A-ZÀ-Ü]{3,}\s*[-\/]\s*[A-Z]{2}\b/.test(strip(line)))
    const match = near ? /([A-ZÀ-Ü][A-ZÀ-Ü ']{2,40}?)\s*[-\/]\s*([A-Z]{2})\b/.exec(near) : null
    if (match && brStates.includes(match[2])) { city = clean(match[1]); state = match[2] }
  }
  if (!state) { const found = UF.exec(strip(lines.find((line) => /\bUF\b|ESTADO/.test(strip(line))) || "")); if (found) state = found[1] }

  const holderLine = lines.map((line) => /(?:NOME|CLIENTE|TITULAR|CONSUMIDOR|PAGADOR|SACADO|DESTINAT[AÁ]RIO)\s*[:\-]?\s*([A-ZÀ-Ü][A-ZÀ-Ü ]{5,60})/i.exec(line)).find(Boolean)
  return { zipCandidates, street, number, complement, district, city, state, holder: holderLine ? clean(holderLine[1]) : "", warnings }
}

/** Junta o que o texto trouxe com o que a base de CEP confirmou: a base manda em logradouro/bairro/cidade/UF; número e complemento só existem no comprovante. */
export function mergeResidence(parsed: ParsedResidence, zip: string, zipData: ZipData | null): ResidenceFields {
  const official = zipData || {}
  return {
    zipCode: zip ? `${zip.slice(0, 5)}-${zip.slice(5)}` : "",
    street: titleCase(official.street || parsed.street),
    number: parsed.number,
    complement: parsed.complement ? titleCase(parsed.complement) : "",
    district: titleCase(official.district || parsed.district),
    city: titleCase(official.city || parsed.city),
    state: (official.state || parsed.state || "").toUpperCase(),
  }
}

export const residenceNote = (parsed: ParsedResidence, fields: ResidenceFields) =>
  `Endereço lido do comprovante de residência${parsed.holder ? ` (titular: ${titleCase(parsed.holder)})` : ""}${fields.zipCode ? `, CEP ${fields.zipCode}` : ""}.`
