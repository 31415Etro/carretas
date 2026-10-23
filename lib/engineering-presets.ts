// Modelo piloto FZ 1E: dados TRANSCRITOS dos dois documentos fornecidos pela ND Carretas (CCT nº A0.051.856 e desenho 8102.12.170-1).
// Nada aqui é "homologado": o preset cria uma revisão em RASCUNHO, com as fontes documentais de cada limite, e a divergência entre os documentos
// (largura e altura) vira pendência de engenharia. Quem decide qual valor vale é a engenharia, no cadastro.
// Não foram informados valores padrão, passo de variação, regras de compatibilidade, fórmulas nem opções: ficam para a engenharia cadastrar.

export type PresetDocument = { key: string; kind: "CCT" | "CAT" | "Desenho tecnico"; name: string; document_number: string; issuer: string; issued_at?: string; valid_until?: string; notes?: string }
export type PresetParameter = { key: string; label: string; unit: string; scope: "referencia" | "nao_declarada"; configurable: boolean; sources: Array<{ doc: string; min?: number; max?: number; fixed?: number; note?: string }> }

export const FZ1E_PRESET = {
  name: "FZ 1E",
  revision: { revision: "R1", brand_model_version_code: "R/ND CARRETAS FZ 1E", cat_number: "1143/2019", cct_number: "A0.051.856", cct_valid_until: "2027-05-19", revised_at: "2025-05-19",
    technical_responsible: "Igor Vigorito (CREA 2608328377), conforme o campo \"Responsável técnico\" do CCT",
    notes: "Dados transcritos do CCT A0.051.856 (CIVA, inspeção de 19/05/2025, emissão 23/05/2025, validade até 19/05/2027) e do desenho 8102.12.170-1 (VIP Engenharia, 24/05). Conferir a transcrição contra os originais antes de validar. O CCT não declara se as dimensões são externas ou úteis." },
  documents: [
    { key: "cct", kind: "CCT", name: "CCT — Certificado de Capacitação Técnica (FZ 1E)", document_number: "A0.051.856", issuer: "CIVA — Centro de Inspeção Veicular Avançado (OIA-SV 1014)", issued_at: "2025-05-23", valid_until: "2027-05-19",
      notes: "Fornecedor: ND Carretas Fort Ltda, CNPJ 31.690.385/0001-90. Carga/reboque/carroceria aberta. Anexar o PDF original." },
    { key: "cat", kind: "CAT", name: "CAT nº 1143/2019 (citada no CCT)", document_number: "1143/2019", issuer: "SENATRAN/INMETRO (conforme citada no CCT)", notes: "Só o número consta no CCT; anexar a CAT quando disponível." },
    { key: "desenho", kind: "Desenho tecnico", name: "Desenho técnico — R/ND Carretas FZ 1E (Protótipo)", document_number: "8102.12.170-1", issuer: "VIP Engenharia (desenho: Beatriz Magaroti; engenheiro: Igor Vigorito)", issued_at: "2025-05-24",
      notes: "Escala 1:25, folha A4. Cita \"Consultar Memorial Descritivo\" (não fornecido). Máximos indicados no desenho: comprimento 6000 mm, largura 2300 mm, altura 2200 mm." },
  ] as PresetDocument[],
  parameters: [
    { key: "comprimento", label: "Comprimento", unit: "mm", scope: "nao_declarada", configurable: true, sources: [{ doc: "cct", min: 2000, max: 6000 }, { doc: "desenho", max: 6000, note: "COMPRIMENTO MÁXIMO (A)" }] },
    { key: "largura", label: "Largura", unit: "mm", scope: "nao_declarada", configurable: true, sources: [{ doc: "cct", min: 1000, max: 2000 }, { doc: "desenho", max: 2300, note: "LARGURA MÁXIMA (B)" }] },
    { key: "altura", label: "Altura", unit: "mm", scope: "nao_declarada", configurable: true, sources: [{ doc: "cct", min: 500, max: 2500 }, { doc: "desenho", max: 2200, note: "ALTURA MÁXIMA (C)" }] },
    { key: "pbt", label: "PBT", unit: "kg", scope: "referencia", configurable: false, sources: [{ doc: "cct", fixed: 750 }] },
    { key: "tara", label: "Tara de referência", unit: "kg", scope: "referencia", configurable: false, sources: [{ doc: "cct", fixed: 200 }] },
    { key: "lotacao", label: "Lotação de referência", unit: "kg", scope: "referencia", configurable: false, sources: [{ doc: "cct", fixed: 550 }] },
    { key: "eixos", label: "Número de eixos", unit: "un", scope: "referencia", configurable: false, sources: [{ doc: "cct", fixed: 1 }] },
    { key: "balanco_traseiro", label: "Balanço traseiro", unit: "mm", scope: "nao_declarada", configurable: false, sources: [{ doc: "cct", min: 500, max: 2500 }] },
    { key: "balanco_dianteiro", label: "Balanço dianteiro", unit: "mm", scope: "nao_declarada", configurable: false, sources: [{ doc: "cct", min: 1500, max: 3500 }] },
  ] as PresetParameter[],
  template: { template_key: "reboque_aberto_1_eixo", grade: "ilustrativo" as const, notes: "Esquema 2D gerado pelas medidas; não reproduz o desenho 8102.12.170-1. Aguarda modelagem técnica." },
  /** Itens que o CCT/desenho NÃO informam e que a engenharia precisa cadastrar. */
  missing: ["Entre eixos (CCT: \"Não aplicável\")", "Memorial descritivo", "Arquivos CAD", "Valores padrão e passo de variação das medidas", "Regras de compatibilidade", "Fórmulas de quantidade dos kits", "Acabamentos e acessórios", "Escopo das dimensões (externas ou úteis)"],
}
