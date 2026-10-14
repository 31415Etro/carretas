"""Regras de-para da planilha de despesas da ND Carretas: nome na coluna "Fornecedor" -> fornecedor padronizado,
se vira cadastro em Fornecedores e quais categorias recebe (categoria financeira/DRE e categoria de fornecimento).

Ajuste as regras aqui (ordem importa: vale a primeira que casar) e rode o importador de novo.
"""
import re
import unicodedata


def norm(value):
    text = unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z0-9&@/.\- ()]", " ", text.upper())).strip()


# categoria financeira -> conta do DRE (nomes sem acento, como as categorias padrao do sistema)
CUSTOS = "Custos dos Servicos Prestados"
FIN_CATEGORIES = {
    "Materia-prima - Aco e metais": CUSTOS, "Materia-prima - Madeira": CUSTOS, "Pecas - Pneus, rodas e cubos": CUSTOS,
    "Pecas - Molas, eixos e suspensao": CUSTOS, "Pecas - Eletrica e iluminacao": CUSTOS, "Pecas - Acessorios e componentes": CUSTOS,
    "Tintas e acabamento": CUSTOS, "Parafusos e fixacao": CUSTOS, "Gases e consumiveis": CUSTOS, "Ferramentas e EPIs": CUSTOS,
    "Fretes e transportes": "Outras Despesas", "Custos - Outros fornecedores": CUSTOS, "Custos - Folha de pagamento": CUSTOS,
    "Impostos e encargos": "Impostos", "Multas e penalidades": "Outras Despesas", "Emprestimos e financiamentos": "Despesas Financeiras",
    "Despesas bancarias": "Despesas Financeiras", "Retiradas de socios": "Outras Despesas", "Alugueis": "Administrativo",
    "Energia, agua e telecomunicacoes": "Administrativo", "Frota e combustivel": "Veiculos", "Pessoal e beneficios": "Pessoal",
    "Honorarios e servicos profissionais": "Administrativo", "Taxas, licencas e cartorio": "Administrativo", "Marketing e comercial": "Marketing e Comercial",
    "TI e sistemas": "TI e Sistemas", "Manutencao e conservacao": "Administrativo", "Material de escritorio": "Administrativo",
    "Devolucoes de venda": "Deducoes", "Despesas diversas": "Outras Despesas", "Despesas - Outros fornecedores": "Administrativo",
    "Despesas - Folha de pagamento": "Pessoal", "Sem classificacao": "Sem classificacao",
}

# categoria de fornecimento (campo do cadastro de fornecedor)
MP, PECAS, SERV, INS, EQUIP, TRANSP, COMB, OUT = "Matéria-prima", "Peças e componentes", "Serviços", "Insumos", "Equipamentos", "Transporte", "Combustível", "Outros"

# (regex sobre o nome normalizado, nome padronizado ou None, vira fornecedor?, categoria de fornecimento, categoria financeira)
S, N = True, False
RULES = [
    # --- multas, impostos e encargos (rótulos, não fornecedores)
    (r"MULTA", None, N, None, "Multas e penalidades"),
    (r"^(IMPOSTO|IMPOSTOS|DARF|DAS|FGTS|ESOCIAL|RECEITA FEDERAL|GUIA CONSIGNAVEL|CONSIGNAVEL)\b|^ALVARA|^TAXA DE LIXO|^IPTU", None, N, None, "Impostos e encargos"),
    (r"^IMPOSTO", None, N, None, "Impostos e encargos"),
    (r"^(EMPRESTIMO|EMPRESTIMO)", None, N, None, "Emprestimos e financiamentos"),
    (r"^(BANCO|DESCONTOS BANCO)$", None, N, None, "Despesas bancarias"),
    (r"^(RETIRADA|ELLEN)", None, N, None, "Retiradas de socios"),
    (r"^DEVOLUCAO DE VENDA", None, N, None, "Devolucoes de venda"),
    (r"^DIVERSOS$", None, N, None, "Despesas diversas"),
    # --- aluguéis, utilidades
    (r"^(ALUGUEL|BARRACAO|EMPILHADEIRA RIOITA|GUINCHO EMPILHADEIRA)", None, N, None, "Alugueis"),
    (r"^RIOITA", "RIOITA COM. PEÇAS EMPILHADEIRAS", S, PECAS, "Alugueis"),
    (r"^CELESC", "CELESC", S, SERV, "Energia, agua e telecomunicacoes"),
    (r"^ENERGIA SOLAR|^TELEFONE", None, N, None, "Energia, agua e telecomunicacoes"),
    (r"^SEMASA", "SEMASA", S, SERV, "Energia, agua e telecomunicacoes"),
    (r"^TIM$", "TIM", S, SERV, "Energia, agua e telecomunicacoes"),
    (r"^UNIFIQUE", "UNIFIQUE", S, SERV, "Energia, agua e telecomunicacoes"),
    # --- frota
    (r"^COMBUSTIVEL|^FROTA$|^PEDAGIO|^RASTRE|^UBER", None, N, None, "Frota e combustivel"),
    (r"^SEM PARAR", "SEM PARAR", S, SERV, "Frota e combustivel"),
    (r"^PLACAS MENDES", "PLACAS MENDES", S, SERV, "Frota e combustivel"),
    (r"^PLACAS$", None, N, None, "Frota e combustivel"),
    (r"^MANUTENCAO$", None, N, None, "Manutencao e conservacao"),
    (r"^(CANAVERAL|CANAVERAL LIMPEZA)$", "CANAVERAL", S, SERV, "Manutencao e conservacao"),
    (r"^(DEDETIZACAO|DESINSETIZACAO)", None, N, None, "Manutencao e conservacao"),
    # --- pessoal e benefícios
    (r"ALIMENTACAO|^CESTA BASICA|^SODEXO|SEGURO FUNC", None, N, None, "Pessoal e beneficios"),
    (r"^ALLIANZ", "ALLIANZ SEGUROS", S, SERV, "Pessoal e beneficios"),
    (r"UNIFORME|^UC UNIFORMES", "UC UNIFORMES", S, OUT, "Pessoal e beneficios"),
    (r"^RODNEY", "RODNEY - BOTINAS", S, OUT, "Pessoal e beneficios"),
    (r"^CLIOMED", "CLIOMED", S, SERV, "Pessoal e beneficios"),
    (r"MEDICO PERITO|PERICIA MEDICA", None, N, None, "Pessoal e beneficios"),
    # --- honorários, taxas e serviços profissionais
    (r"^(ACONPAR|AGNALDO)", "ACONPAR - AGNALDO (CONTABILIDADE)", S, SERV, "Honorarios e servicos profissionais"),
    (r"^ADVOGADOS NEVES", "ADVOGADOS NEVES", S, SERV, "Honorarios e servicos profissionais"),
    (r"^ADVOGADOS", "ADVOGADOS", S, SERV, "Honorarios e servicos profissionais"),
    (r"^ENGENHEIRO", "ENGENHEIRO MARCELO S. FARIAS", S, SERV, "Honorarios e servicos profissionais"),
    (r"^(DESPACHANTE|PROCESSO)", None, N, None, "Honorarios e servicos profissionais"),
    (r"^JUSBRASIL", "JUSBRASIL", S, SERV, "Honorarios e servicos profissionais"),
    (r"^SERPRO", "SERPRO", S, SERV, "TI e sistemas"),
    (r"^(REGISTRO DA MARCA|CARTORIO|AUTENTICACAO|CADASTRO|CNPJ - MUDANCA|RENOVACAO CERTIFICADO|GUIA B\.O|CREA$|RENAVE|HOMOLOGACAO)", None, N, None, "Taxas, licencas e cartorio"),
    (r"^CORREIO", None, N, None, "Despesas diversas"),
    (r"^(PAPEIS|PAPELARIA)", "PAPEIS E PAPEIS", S, OUT, "Material de escritorio"),
    # --- marketing e TI
    (r"^(OUTDOOR|PATROCINIO|EVENTO|ANUNCIO)", None, N, None, "Marketing e comercial"),
    (r"^MARCIO MVC", "MARCIO MVC GRAFICA", S, SERV, "Marketing e comercial"),
    (r"^(SOFTEN|MANIFESTO)", "SOFTEN", S, SERV, "TI e sistemas"),
    (r"^(NF@MAIL|NFEMAIL|NFMAIL)", "NFMAIL", S, SERV, "TI e sistemas"),
    (r"^(SIGA SUL|SIGASUL)", "SIGASUL", S, SERV, "TI e sistemas"),
    (r"^(LUIZ TI|T\.I\. LUIZ|TI$|LUIZ RAMAIS)", "LUIZ (TI)", S, SERV, "TI e sistemas"),
    (r"^TIX \/ CANAVERAL|^TIX\/ CANAVERAL|^CANAVERAL\/TIX", "TIX / CANAVERAL", S, SERV, "TI e sistemas"),
    (r"^TIX", "TIX", S, SERV, "TI e sistemas"),
    # --- fretes
    (r"^EXPRESSO", "EXPRESSO SÃO MIGUEL", S, TRANSP, "Fretes e transportes"),
    (r"^(TRANSPORTADORA|FRETE|TRANSPORTE|ENTREGA)", None, N, None, "Fretes e transportes"),
    (r"^RODONAVES", "RODONAVES", S, TRANSP, "Fretes e transportes"),
    (r"^TRANSPORT\. CUBO", "LOGBG", S, TRANSP, "Fretes e transportes"),
    (r"^TRANS\. MADEIRA", "TRANS. MADEIRA", S, TRANSP, "Fretes e transportes"),
    # --- matéria-prima: aço e metais
    (r"^FORT$", "FORT COM. DE FERRO E AÇO", S, MP, "Materia-prima - Aco e metais"),
    (r"^KIFERRO", "KIFERRO", S, MP, "Materia-prima - Aco e metais"),
    (r"^ACOS? MOURA", "AÇOS MOURA", S, MP, "Materia-prima - Aco e metais"),
    (r"^(BRAMBIFER|BRAMBILA)", None, S, MP, "Materia-prima - Aco e metais"),
    (r"^ANDRACO", "ANDRAÇO", S, MP, "Materia-prima - Aco e metais"),
    (r"^MEGA[CS]?O?$|^MEGACO|^MEGAC", "MEGAÇO", S, MP, "Materia-prima - Aco e metais"),
    (r"^VIGA", "VIGA COMÉRCIO DE ALUMÍNIO", S, MP, "Materia-prima - Aco e metais"),
    (r"^METALSATI|^STEELCORTE|^METAL PARTS|^BONDMANN", None, S, MP, "Materia-prima - Aco e metais"),
    # --- madeira
    (r"^CHEQUES? (DE )?MADEIRA|^CHAPA DE COMPENSADO|^MADEIRA$", None, N, None, "Materia-prima - Madeira"),
    (r"^GK MADEIRAS", "GK MADEIRAS", S, MP, "Materia-prima - Madeira"),
    (r"^MADEIREIRA", "MADEIREIRA SANTA ISABEL", S, MP, "Materia-prima - Madeira"),
    (r"^SERRARIA", "SERRARIA SANTA ISABEL", S, MP, "Materia-prima - Madeira"),
    (r"^BIANCA", "BIANCA MADEIRAS", S, MP, "Materia-prima - Madeira"),
    # --- peças
    (r"^W\.? ?GARBOS", "W. GARBOS", S, PECAS, "Pecas - Pneus, rodas e cubos"),
    (r"^IMPPAR", "IMPPAR PNEUS", S, PECAS, "Pecas - Pneus, rodas e cubos"),
    (r"^JS PNEUS", "JS PNEUS", S, PECAS, "Pecas - Pneus, rodas e cubos"),
    (r"^ARO$", "ARO", S, PECAS, "Pecas - Pneus, rodas e cubos"),
    (r"^(GIRANDO|MF CUBOS)", "GIRANDO", S, PECAS, "Pecas - Pneus, rodas e cubos"),
    (r"^BLACK COIL", "BLACK COIL", S, PECAS, "Pecas - Molas, eixos e suspensao"),
    (r"^SRC PRIME", "SRC PRIME", S, PECAS, "Pecas - Molas, eixos e suspensao"),
    (r"AMORTECEDORES", "GARAGEM DOS AMORTECEDORES", S, PECAS, "Pecas - Molas, eixos e suspensao"),
    (r"^ICARO", "ÍCARO", S, PECAS, "Pecas - Molas, eixos e suspensao"),
    (r"^CLOUDWALK", "CLOUDWALK", S, PECAS, "Pecas - Molas, eixos e suspensao"),
    (r"MOLAS", None, S, PECAS, "Pecas - Molas, eixos e suspensao"),
    (r"^(CONDVOLT|DANI|GASPARZINHO|XARDRAX)", None, S, PECAS, "Pecas - Eletrica e iluminacao"),
    (r"^MACEDO PINCAS", "MACEDO PINÇAS", S, PECAS, "Pecas - Acessorios e componentes"),
    (r"^MACEDO", "MACEDO AUTO PARTS", S, PECAS, "Pecas - Acessorios e componentes"),
    (r"^AUTO ?AMERICA", "AUTOAMERICA", S, PECAS, "Pecas - Acessorios e componentes"),
    (r"^FAVI", "FAVI", S, PECAS, "Pecas - Acessorios e componentes"),
    (r"^(CENTERROL|PECAS$)", None, S, PECAS, "Pecas - Acessorios e componentes"),
    # --- insumos
    (r"^JG|\/ ?JG$", "JG COM. TINTAS", S, INS, "Tintas e acabamento"),
    (r"^MIX TINTAS", "MIX TINTAS", S, INS, "Tintas e acabamento"),
    (r"^QUIMICO", "QUIMICOLA", S, INS, "Tintas e acabamento"),
    (r"TINTOMETRI", "TINTOMETRIA", S, INS, "Tintas e acabamento"),
    (r"TINTA", None, S, INS, "Tintas e acabamento"),
    (r"^(TITAN|INDUSTRIA TITAN|ITAOX)", "TITAN", S, INS, "Parafusos e fixacao"),
    (r"^(OXIGENIO|DURAGAS)", None, S, INS, "Gases e consumiveis"),
    (r"^(ESTOPA|VW ESTOPA|EPIS|FERRAMENTAS|CASA DO TORNEIRO)", None, S, EQUIP, "Ferramentas e EPIs"),
]

# nomes que a regra acima marca como fornecedor mas são só rótulos (não criam cadastro)
LABELS_NOT_SUPPLIER = {"MOLAS", "PECAS", "TINTAS", "OXIGENIO", "ESTOPA", "ESTOPAS VW", "VW ESTOPAS", "FERRAMENTAS", "FERRAMENTAS GERAIS", "EPIS", "TINTAS E TINNER", "MADEIRA"}

PAYROLL = {"CUSTO": "Custos - Folha de pagamento", "DESPESA": "Despesas - Folha de pagamento"}


def classify_party(raw_name, klass, accent_names):
    """-> dict(canonical, supplier, supply, category). `accent_names` guarda a grafia com acento mais completa de cada nome."""
    key = norm(raw_name)
    if not key:
        return dict(canonical="(sem nome)", supplier=False, supply=None, category="Sem classificacao", rule="(vazio)")
    for pattern, canonical, supplier, supply, category in RULES:
        if re.search(pattern, key):
            name = canonical or accent_names.get(key) or str(raw_name).strip()
            if key in LABELS_NOT_SUPPLIER:
                supplier = False
            return dict(canonical=name, supplier=supplier, supply=supply, category=category, rule=pattern)
    # sem regra: trata como fornecedor, com a categoria genérica da classe da planilha
    if klass == "CUSTO":
        return dict(canonical=accent_names.get(key) or str(raw_name).strip(), supplier=True, supply=OUT, category="Custos - Outros fornecedores", rule="(sem regra)")
    if klass == "DESPESA":
        return dict(canonical=accent_names.get(key) or str(raw_name).strip(), supplier=True, supply=SERV, category="Despesas - Outros fornecedores", rule="(sem regra)")
    return dict(canonical=accent_names.get(key) or str(raw_name).strip(), supplier=True, supply=OUT, category="Sem classificacao", rule="(sem regra, sem classe)")
