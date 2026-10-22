"""Auditoria (SÓ LEITURA) das notas importadas: duplicidade de notas, parcelas e cruzamento com a planilha por nome + valor.
Uso: python scripts/nfemail/auditar-notas.py        (gera scripts/nfemail/logs/auditoria-*.json)"""
import io, json, os, re, sys, datetime, unicodedata, urllib.request, collections

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOGS = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOGS, exist_ok=True)
env = dict(l.strip().split("=", 1) for l in io.open(os.path.join(ROOT, ".env.local"), encoding="utf-8") if "=" in l and not l.startswith("#"))
KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
BASE = env["NEXT_PUBLIC_SUPABASE_URL"] + "/rest/v1/"
NAMES = {"00000000-0000-4000-8000-000000000001": "Fort", "39faf343-bd20-4074-b600-518faf4365ee": "Reboques"}


def rows(path):
    out, offset = [], 0
    while True:
        req = urllib.request.Request(BASE + path, headers={"apikey": KEY, "Authorization": "Bearer " + KEY, "Range": f"{offset}-{offset + 999}"})
        for attempt in range(4):
            try:
                chunk = json.load(urllib.request.urlopen(req, timeout=120))
                break
            except Exception:
                if attempt == 3:
                    raise
        out += chunk
        if len(chunk) < 1000:
            return out
        offset += 1000


def norm(text):
    text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]", " ", text)


STOP = {"ltda", "me", "epp", "sa", "eireli", "comercio", "com", "de", "do", "da", "dos", "das", "industria", "ind", "cia", "servicos", "nfe", "mei", "filial", "matriz", "the", "the"}
tokens = lambda text: {t for t in norm(text).split() if len(t) > 2 and t not in STOP}
day = lambda iso: datetime.date.fromisoformat(iso[:10])

out = {}
inv = rows("imported_invoices?select=id,system_company_id,dedupe_key,access_key,number,series,issued_at,total_amount,my_role,issuer_document,issuer_name,recipient_name,counterpart_name,installments,kind")
tx = rows("financial_transactions?select=id,system_company_id,type,description,supplier_name,due_date,realized_date,expected_amount,realized_amount,origin,status,notes")
ap = rows("accounts_payable?select=id,system_company_id,description,supplier_name,due_date,expected_amount,paid_amount,status,origin,document_number,notes")
print(f"notas importadas: {len(inv)} | lançamentos: {len(tx)} | contas a pagar: {len(ap)}")

# A) notas duplicadas: mesmo emitente + número + série, ou mesmo nome + valor + emissão
dup_a = collections.defaultdict(list)
dup_b = collections.defaultdict(list)
for i in inv:
    dup_a[(i["system_company_id"], i["my_role"], re.sub(r"\D", "", i["issuer_document"] or ""), str(i["number"] or "").lstrip("0"), str(i["series"] or ""))].append(i)
    dup_b[(i["system_company_id"], i["my_role"], norm(i["issuer_name"]).strip(), round(float(i["total_amount"] or 0), 2), (i["issued_at"] or "")[:10])].append(i)
da = {k: v for k, v in dup_a.items() if len(v) > 1 and k[3]}
db = {k: v for k, v in dup_b.items() if len(v) > 1 and k[2]}
print(f"\nA) NOTAS DUPLICADAS\n  mesmo emitente+número+série: {len(da)} grupos | mesmo nome+valor+emissão: {len(db)} grupos")
for k, v in list(db.items())[:6]:
    print("   ", NAMES.get(k[0]), k[2][:40], k[3], k[4], "| números:", [x["number"] for x in v])
out["notas_duplicadas"] = {"numero": [[x["id"] for x in v] for v in da.values()], "nome_valor": [[x["id"] for x in v] for v in db.values()]}

# B) parcelas: soma dos lançamentos de cada nota recebida x valor da nota/duplicatas
nf_out = [x for x in tx if x["origin"] == "Importacao NF" and x["type"] == "saida"]
by_key = collections.defaultdict(list)
for x in nf_out:
    parts = (x["notes"] or "").split("\n")[0].split("|")
    by_key[(x["system_company_id"], parts[1].strip() if len(parts) > 1 else "")].append(x)
conc = set()
for x in tx:
    if x["origin"] != "Importacao NF":
        conc.update(re.findall(r"Conciliado NF \|\s*([^\s|]+)", x["notes"] or ""))
received = [i for i in inv if i["my_role"] == "Destinatário"]
no_launch, wrong_sum, multi = [], [], 0
for i in received:
    launches = by_key.get((i["system_company_id"], i["dedupe_key"]), [])
    inst = [float(p["amount"]) for p in (i["installments"] or []) if float(p["amount"] or 0) > 0]
    expected = round(sum(inst) if inst else float(i["total_amount"] or 0), 2)
    if not launches:
        if i["dedupe_key"] not in conc and expected > 0:
            no_launch.append(i)
        continue
    if len(launches) > 1:
        multi += 1
    got = round(sum(float(x["expected_amount"]) for x in launches), 2)
    if abs(got - expected) > 0.05:
        wrong_sum.append((i, got, expected))
print(f"\nB) PARCELAS E LANÇAMENTOS (notas recebidas: {len(received)})\n  notas com várias parcelas lançadas: {multi}\n  sem lançamento e sem conciliação com planilha: {len(no_launch)}\n  soma dos lançamentos ≠ valor da nota/duplicatas: {len(wrong_sum)}")
for i, got, exp in wrong_sum[:5]:
    print("   ", NAMES.get(i["system_company_id"]), i["number"], (i["issuer_name"] or "")[:30], "lançado", got, "esperado", exp)
dup_launch = collections.Counter((x["system_company_id"], (x["notes"] or "").split("\n")[0]) for x in nf_out)
dups = {k: c for k, c in dup_launch.items() if c > 1}
print(f"  lançamentos repetidos (mesma nota/parcela 2x): {len(dups)}")
no_inv = [k for k in by_key if k[1] and not any(i["dedupe_key"] == k[1] for i in received)]
print(f"  lançamentos de nota sem a nota importada: {len(no_inv)}")
out["parcelas"] = {"sem_lancamento": [i["id"] for i in no_launch], "soma_diferente": [[i["id"], g, e] for i, g, e in wrong_sum], "lancamentos_repetidos": len(dups)}

# C) planilha x notas por NOME + VALOR (sem depender do número): mesma empresa, valor igual (±0,01), nome com palavra em comum e data até 45 dias
sheet = [x for x in tx if x["type"] == "saida" and x["origin"] != "Importacao NF" and "Conciliado NF" not in (x["notes"] or "")]
sheet_idx = collections.defaultdict(list)
for x in sheet:
    sheet_idx[(x["system_company_id"], round(float(x["realized_amount"] or x["expected_amount"] or 0), 2))].append(x)
pairs = []
for x in nf_out:
    amt = round(float(x["expected_amount"]), 2)
    mine = tokens(x["supplier_name"] or x["description"])
    for cand in sheet_idx.get((x["system_company_id"], amt), []):
        ref = cand["realized_date"] or cand["due_date"]
        if not ref or not x["due_date"] or abs((day(ref) - day(x["due_date"])).days) > 45:
            continue
        if mine & tokens((cand["supplier_name"] or "") + " " + cand["description"]):
            pairs.append((x, cand))
            break
print(f"\nC) PLANILHA x NOTA por nome + valor (±45 dias): {len(pairs)} lançamentos de nota têm planilha igual -> R$ {round(sum(float(p[0]['expected_amount']) for p in pairs), 2)}")
print("   por empresa:", dict(collections.Counter(NAMES.get(p[0]["system_company_id"]) for p in pairs)))
for n, c in pairs[:6]:
    print("   ", NAMES.get(n["system_company_id"]), "|", n["description"][:38], "|", c["description"][:38], "|", n["expected_amount"], n["due_date"], c["realized_date"] or c["due_date"])
out["planilha_igual_nome_valor"] = [[n["id"], c["id"]] for n, c in pairs]

# D) contas a pagar: nota aberta x conta paga da planilha (mesmo valor e nome)
ap_nf = [a for a in ap if a["origin"] == "Importacao NF"]
ap_sheet = collections.defaultdict(list)
for a in ap:
    if a["origin"] != "Importacao NF" and a["status"] != "Cancelada":
        ap_sheet[(a["system_company_id"], round(float(a["expected_amount"] or 0), 2))].append(a)
ap_dup = []
for a in ap_nf:
    mine = tokens(a["supplier_name"] or a["description"])
    for c in ap_sheet.get((a["system_company_id"], round(float(a["expected_amount"] or 0), 2)), []):
        if mine & tokens((c["supplier_name"] or "") + " " + (c["description"] or "")) and a["due_date"] and c["due_date"] and abs((day(a["due_date"]) - day(c["due_date"])).days) <= 45:
            ap_dup.append((a, c))
            break
print(f"\nD) CONTAS A PAGAR: {len(ap_nf)} vindas de nota | {len(ap_dup)} têm conta da planilha com mesmo nome/valor (±45 dias) -> R$ {round(sum(float(p[0]['expected_amount']) for p in ap_dup), 2)}")
print("   status das da nota repetidas:", dict(collections.Counter(p[0]["status"] for p in ap_dup)), "| status das da planilha:", dict(collections.Counter(p[1]["status"] for p in ap_dup)))
out["contas_a_pagar_repetidas"] = [[a["id"], c["id"]] for a, c in ap_dup]


# E-M) verificações de regra, empresa, operação, categoria e grupo
CUT = datetime.date.today().replace(day=1).isoformat()
NON_FIN = {str(n) for n in range(901, 926)} | {"949", "201", "202", "208", "209", "410", "411", "412", "413", "503", "553", "556"} | {str(n) for n in range(151, 160)}
GROUP = {"31690385000190", "72295744000191", "21161569000109"}
cfops = lambda i: [str(x.get("cfop") or "")[-3:] for x in (i.get("items") or []) if x.get("cfop")]
nonfin = lambda i: (not [p for p in (i.get("installments") or []) if float(p.get("amount") or 0) > 0]) and bool(cfops(i)) and all(c in NON_FIN for c in cfops(i))
inv_by_key = {(i["system_company_id"], i["dedupe_key"]): i for i in inv}
key_of = lambda x: ((x.get("notes") or "").split("\n")[0].split("|") + ["", ""])[1].strip()
amt = lambda x: float(x["expected_amount"] or 0)
print("\nE) OPERAÇÃO SEM COBRANÇA lançada como saída (remessa/retorno/demonstração/devolução):", sum(1 for x in nf_out if nonfin(inv_by_key.get((x["system_company_id"], key_of(x)), {}))), "lançamentos")
print("F) CONTAS A PAGAR de nota abertas com vencimento antes do mês corrente:", sum(1 for a in ap_nf if a["status"] == "Aberta" and a["due_date"] < CUT), "-> R$", round(sum(float(a["expected_amount"]) for a in ap_nf if a["status"] == "Aberta" and a["due_date"] < CUT), 2))
ar = rows("accounts_receivable?select=id,system_company_id,due_date,expected_amount,status,origin&origin=eq.Importacao%20NF")
print("G) CONTAS A RECEBER de nota fora do mês corrente:", sum(1 for a in ar if not a["due_date"].startswith(CUT[:7])), "| no mês corrente:", sum(1 for a in ar if a["due_date"].startswith(CUT[:7])))
wrong_company = [x for x in nf_out if (x["system_company_id"], key_of(x)) not in inv_by_key]
entr = [x for x in tx if x["origin"] == "Importacao NF" and x["type"] == "entrada"]
print("H) lançamentos de saída de nota em empresa diferente da nota:", len(wrong_company))
cats = {c["id"]: c for c in rows("financial_categories?select=id,name,system_company_id,dre_account_id")}
dres = {d["id"]: d for d in rows("dre_accounts?select=id,system_company_id")}
ent_full = rows("financial_transactions?select=id,system_company_id,category_id,dre_account_id,notes,expected_amount,realized_amount,description&origin=eq.Importacao%20NF&type=eq.entrada")
bad_cat = [x for x in ent_full if not x["category_id"] or cats.get(x["category_id"], {}).get("system_company_id") != x["system_company_id"] or dres.get(x["dre_account_id"], {}).get("system_company_id") != x["system_company_id"]]
print("I) ENTRADAS sem categoria/DRE ou com categoria/DRE de outra empresa:", len(bad_cat), "de", len(ent_full))
ent_wrong_co = [x for x in ent_full if (x["system_company_id"], key_of(x)) not in inv_by_key]
print("   entradas em empresa diferente da nota:", len(ent_wrong_co))
big = sorted(nf_out + [x for x in tx if x["origin"] == "Importacao NF" and x["type"] == "entrada"], key=lambda x: -amt(x))[:6]
print("J) MAIORES lançamentos de nota (conferir se são reais):")
for x in big:
    print("   ", NAMES.get(x["system_company_id"]), x["type"], round(amt(x)), x["description"][:55], (inv_by_key.get((x["system_company_id"], key_of(x)), {}).get("nature") or "")[:30])
emitted = [i for i in inv if i["my_role"] == "Remetente"]
bad_ent = [x for x in ent_full if nonfin(inv_by_key.get((x["system_company_id"], key_of(x)), {}))]
print("K) ENTRADAS de nota emitida sem cobrança (remessa/retorno):", len(bad_ent), "-> R$", round(sum(float(x["realized_amount"] or 0) for x in bad_ent), 2))
inter_in = sum(float(x["total_amount"] or 0) for i in received for x in [i] if re.sub(r"\D", "", i["issuer_document"] or "") in GROUP)
inter_out = sum(float(i["total_amount"] or 0) for i in emitted if re.sub(r"\D", "", (i.get("recipient_document") or "")) in GROUP) if emitted and "recipient_document" in emitted[0] else None
print("L) NOTAS ENTRE EMPRESAS DO GRUPO (Fort/Reboques/Fort Ferro e Aço):")
for co in NAMES.values():
    pass
grp_recv = collections.defaultdict(float)
for i in received:
    if re.sub(r"\D", "", i["issuer_document"] or "") in GROUP:
        grp_recv[NAMES.get(i["system_company_id"])] += float(i["total_amount"] or 0)
print("   notas RECEBIDAS de outra empresa do grupo:", {k: round(v, 2) for k, v in grp_recv.items()})

stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
io.open(os.path.join(LOGS, f"auditoria-{stamp}.json"), "w", encoding="utf-8").write(json.dumps(out, ensure_ascii=False, indent=1))
print("\nrelatório salvo em scripts/nfemail/logs/auditoria-%s.json" % stamp)
