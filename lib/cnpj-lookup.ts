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
  statusDate: string
  branchType: string
  cnaeCode: string
  secondaryActivities: string[]
  partners: Array<{ name: string; role: string }>
  /** Inscrição estadual ativa na UF do endereço (a BrasilAPI não informa; vem de fonte complementar). */
  stateRegistration: string
  /** Sócio-administrador, usado como contato principal. */
  administrator: { name: string; role: string } | null
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
    statusDate: text(data.data_situacao_cadastral),
    branchType: Number(data.identificador_matriz_filial) === 2 ? "Filial" : Number(data.identificador_matriz_filial) === 1 ? "Matriz" : "",
    cnaeCode: text(data.cnae_fiscal),
    secondaryActivities: (Array.isArray(data.cnaes_secundarios) ? data.cnaes_secundarios as Array<Record<string, unknown>> : [])
      .map((item) => [text(item.codigo), text(item.descricao)].filter(Boolean).join(" - "))
      .filter(Boolean),
    partners: (Array.isArray(data.qsa) ? data.qsa as Array<Record<string, unknown>> : [])
      .map((item) => ({ name: text(item.nome_socio), role: text(item.qualificacao_socio) }))
      .filter((item) => item.name),
    stateRegistration: "",
    administrator: pickAdministrator((Array.isArray(data.qsa) ? data.qsa as Array<Record<string, unknown>> : []).map((item) => ({ name: text(item.nome_socio), role: text(item.qualificacao_socio) }))),
  }
}

export function pickAdministrator(partners: Array<{ name: string; role: string }>) {
  return partners.find((item) => item.name && /administrador/i.test(item.role)) || null
}

const digitsOnly = (value: unknown) => String(value || "").replace(/\D/g, "")

/** Resposta do cnpj.ws (publica.cnpj.ws): fonte complementar (inscrição estadual) e reserva quando a BrasilAPI falha. */
export function mapCnpjWs(data: Record<string, any>): CnpjCompany {
  const est = (data.estabelecimento || {}) as Record<string, any>
  const state = text(est.estado?.sigla).toUpperCase()
  const streetType = text(est.tipo_logradouro)
  const streetName = text(est.logradouro)
  const street = streetType && !streetName.toLocaleUpperCase("pt-BR").startsWith(streetType.toLocaleUpperCase("pt-BR")) ? `${streetType} ${streetName}`.trim() : streetName
  const zipCode = formatCnpjZipCode(est.cep)
  const phone = `${digitsOnly(est.ddd1)}${digitsOnly(est.telefone1)}`
  const partners = (Array.isArray(data.socios) ? data.socios as Array<Record<string, any>> : []).map((item) => ({ name: text(item.nome), role: text(item.qualificacao_socio?.descricao) })).filter((item) => item.name)
  const ies = (Array.isArray(est.inscricoes_estaduais) ? est.inscricoes_estaduais as Array<Record<string, any>> : []).filter((item) => item.ativo !== false && text(item.inscricao_estadual))
  const ie = ies.find((item) => text(item.estado?.sigla).toUpperCase() === state) || ies[0]
  const number = text(est.numero)
  const complement = text(est.complemento)
  const district = text(est.bairro)
  const city = text(est.cidade?.nome)
  return {
    document: formatCnpjDocument(est.cnpj),
    legalName: text(data.razao_social),
    tradeName: text(est.nome_fantasia),
    phone,
    email: text(est.email).toLowerCase(),
    zipCode, street, number, complement, district, city, state,
    address: [street, number, complement, district, [city, state].filter(Boolean).join("/"), zipCode].filter(Boolean).join(", "),
    registrationStatus: text(est.situacao_cadastral),
    openedAt: text(est.data_inicio_atividade),
    primaryActivity: text(est.atividade_principal?.descricao),
    legalNature: text(data.natureza_juridica?.descricao),
    size: text(data.porte?.descricao),
    statusDate: text(est.data_situacao_cadastral),
    branchType: /filial/i.test(text(est.tipo)) ? "Filial" : /matriz/i.test(text(est.tipo)) ? "Matriz" : "",
    cnaeCode: digitsOnly(est.atividade_principal?.id),
    secondaryActivities: (Array.isArray(est.atividades_secundarias) ? est.atividades_secundarias as Array<Record<string, any>> : []).map((item) => [digitsOnly(item.id), text(item.descricao)].filter(Boolean).join(" - ")).filter(Boolean),
    partners,
    stateRegistration: text(ie?.inscricao_estadual),
    administrator: pickAdministrator(partners),
  }
}

/** Junta duas leituras do mesmo CNPJ: a primária manda; a complementar só preenche o que faltou. */
export function mergeCnpjCompanies(primary: CnpjCompany, extra: CnpjCompany | null): CnpjCompany {
  if (!extra) return primary
  const merged = { ...primary } as Record<string, any>
  for (const [key, value] of Object.entries(extra)) {
    const current = merged[key]
    const empty = current === "" || current === null || current === undefined || (Array.isArray(current) && !current.length)
    if (empty && value) merged[key] = value
  }
  return merged as CnpjCompany
}

/** Texto com caractere de substituição (U+FFFD) veio quebrado do provedor. */
export const isGarbled = (value: string) => value.includes(String.fromCharCode(0xfffd))

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
