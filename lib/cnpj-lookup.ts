export type CnpjCompany = {
  document: string
  legalName: string
  tradeName: string
  phone: string
  email: string
  zipCode: string
  street: string
  number: string
  complement: string
  district: string
  city: string
  state: string
  address: string
  registrationStatus: string
  openedAt: string
  primaryActivity: string
  legalNature: string
  size: string
}

export function cleanCpfCnpj(value: unknown) {
  return String(value || "").toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 14)
}

export const cleanCnpj = cleanCpfCnpj

export function formatCpfCnpjDocument(value: unknown) {
  const clean = cleanCpfCnpj(value)
  if (/^\d{11}$/.test(clean)) return clean.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")
  if (!/^\d{14}$/.test(clean)) return clean
  return clean.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")
}

export const formatCnpjDocument = formatCpfCnpjDocument

export function formatCnpjZipCode(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 8)
  return digits.length === 8 ? digits.replace(/^(\d{5})(\d{3})$/, "$1-$2") : digits
}

function text(value: unknown) {
  return String(value || "").trim()
}

export function mapBrasilApiCnpj(data: Record<string, unknown>): CnpjCompany {
  const streetType = text(data.descricao_tipo_de_logradouro || data.descricao_tipo_logradouro)
  const streetName = text(data.logradouro)
  const street = streetType && !streetName.toLocaleUpperCase("pt-BR").startsWith(streetType.toLocaleUpperCase("pt-BR"))
    ? `${streetType} ${streetName}`.trim()
    : streetName
  const phone = text(data.ddd_telefone_1 || data.ddd_telefone_2)
  const zipCode = formatCnpjZipCode(data.cep)
  const number = text(data.numero)
  const complement = text(data.complemento)
  const district = text(data.bairro)
  const city = text(data.municipio)
  const state = text(data.uf)
  const address = [street, number, complement, district, [city, state].filter(Boolean).join("/") || "", zipCode].filter(Boolean).join(", ")

  return {
    document: formatCnpjDocument(data.cnpj),
    legalName: text(data.razao_social),
    tradeName: text(data.nome_fantasia) || text(data.razao_social),
    phone,
    email: text(data.email).toLowerCase(),
    zipCode,
    street,
    number,
    complement,
    district,
    city,
    state,
    address,
    registrationStatus: text(data.descricao_situacao_cadastral),
    openedAt: text(data.data_inicio_atividade),
    primaryActivity: text(data.cnae_fiscal_descricao),
    legalNature: text(data.natureza_juridica || data.descricao_natureza_juridica),
    size: text(data.descricao_porte || data.porte),
  }
}

export function cnpjRegistrationNotes(company: CnpjCompany) {
  return [
    company.address ? `Endereco cadastral: ${company.address}` : "",
    company.registrationStatus ? `Situacao cadastral: ${company.registrationStatus}` : "",
    company.openedAt ? `Inicio da atividade: ${company.openedAt}` : "",
    company.primaryActivity ? `Atividade principal: ${company.primaryActivity}` : "",
    company.legalNature ? `Natureza juridica: ${company.legalNature}` : "",
    company.size ? `Porte: ${company.size}` : "",
  ].filter(Boolean).join("\n")
}
