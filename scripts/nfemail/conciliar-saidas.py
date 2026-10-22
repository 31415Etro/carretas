"""Cruza as saídas das PLANILHAS (lançamentos 'Conta a pagar'/'Importacao planilha') com as notas recebidas lançadas como saída (origin 'Importacao NF').
Sem --aplicar só analisa (não grava). Com --aplicar: remove o lançamento DA NOTA quando a planilha já tem o mesmo documento, fornecedor e valor,
e deixa 'Conciliado NF | <chave>' na linha da planilha (a rotina de lançar saídas não recria). Backup completo antes de remover.
Uso:  python scripts/nfemail/conciliar-saidas.py [--aplicar]   (lê .env.local; pode repetir sem risco)"""
import io, json, sys, re, os, datetime, unicodedata, urllib.request, collections

APPLY = "--aplicar" in sys.argv
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOGS = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOGS, exist_ok=True)
env = dict(l.strip().split("=", 1) for l in io.open(os.path.join(ROOT, ".env.local"), encoding="utf-8") if "=" in l and not l.startswith("#"))
KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
BASE = env["NEXT_PUBLIC_SUPABASE_URL"] + "/rest/v1/"
NAMES = {"00000000-0000-4000-8000-000000000001": "Fort", "39faf343-bd20-4074-b600-518faf4365ee": "Reboques"}


def call(method, path, body=None, company=None, extra=None):
    headers = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json", "x-audit-origin": "Sistema", **(extra or {})}
    if company:
        headers["x-system-company-id"] = company
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except Exception:
            if attempt == 4:
                raise


def rows(path):
    out, offset = [], 0
    while True:
        chunk = call("GET", path, extra={"Range": f"{offset}-{offset + 999}"})
        out += chunk
        if len(chunk) < 1000:
            return out
        offset += 1000


def norm(text):
    text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]", " ", text)


STOP = {"ltda", "me", "epp", "sa", "eireli", "comercio", "com", "de", "do", "da", "dos", "das", "industria", "ind", "cia", "servicos", "nfe", "mei", "the"}


def tokens(text):
    return {t for t in norm(text).split() if len(t) > 2 and t not in STOP}


def nf_numbers(text):
    """Números de nota citados na descrição ('NF 38075', 'NF-e 1.234', 'NFe: 52898/1')."""
    found = set()
    for m in re.finditer(r"(?:\bnf[- ]?e?\b|nota)[^0-9]{0,6}([0-9][0-9.]*)", str(text or "").lower()):
        digits = re.sub(r"\D", "", m.group(1))
        if digits:
            found.add(int(digits))
    return found


def close(a, b):
    return abs(a - b) <= max(1.0, 0.005 * max(abs(a), abs(b)))


tx = rows("financial_transactions?select=*&type=eq.saida")
nf_tx = [x for x in tx if x["origin"] == "Importacao NF"]
sheet = [x for x in tx if x["origin"] != "Importacao NF" and "Conciliado NF" not in (x.get("notes") or "")]
marked = sum(1 for x in tx if x["origin"] != "Importacao NF" and "Conciliado NF" in (x.get("notes") or ""))

groups = collections.defaultdict(list)
for x in nf_tx:
    notes = x.get("notes") or ""
    key = notes.split("\n")[0].split("|")[1].strip() if "|" in notes else ""
    groups[(x["system_company_id"], key)].append(x)
invoices = {i["dedupe_key"]: i for i in rows("imported_invoices?select=dedupe_key,number,total_amount,counterpart_name,issuer_name,system_company_id&my_role=eq.Destinat%C3%A1rio")}

by_number = collections.defaultdict(list)
for x in sheet:
    for number in nf_numbers(x["description"]):
        by_number[(x["system_company_id"], number)].append(x)

report = {"duplicada": [], "valor_diferente": [], "sem_correspondencia": 0}
for (company, key), parcels in groups.items():
    inv = invoices.get(key)
    if not inv:
        report["sem_correspondencia"] += 1
        continue
    try:
        number = int(re.sub(r"\D", "", str(inv["number"] or "")) or 0)
    except ValueError:
        number = 0
    supplier = tokens(inv["counterpart_name"] or inv["issuer_name"])
    candidates = [c for c in by_number.get((company, number), []) if supplier & tokens(c["description"] + " " + str(c.get("supplier_name") or ""))]
    if not candidates:
        report["sem_correspondencia"] += 1
        continue
    total_nf = sum(float(p["expected_amount"]) for p in parcels)
    total_sheet = sum(float(c["realized_amount"] or c["expected_amount"] or 0) for c in candidates)
    item = {"empresa": NAMES.get(company), "nota": inv["number"], "fornecedor": inv["counterpart_name"], "valor_nota": round(total_nf, 2), "valor_planilha": round(total_sheet, 2),
            "parcelas_nota": [p["id"] for p in parcels], "linhas_planilha": [c["id"] for c in candidates], "chave": key}
    (report["duplicada"] if close(total_nf, total_sheet) else report["valor_diferente"]).append(item)

# lançamentos de nota recriados depois da conciliação (a chave já está marcada em alguma linha da planilha): devem sair de novo
conciliated_keys = set()
for x in tx:
    if x["origin"] != "Importacao NF":
        conciliated_keys.update(re.findall(r"Conciliado NF \|\s*([^\s|]+)", x.get("notes") or ""))
recreated = [x for x in nf_tx if ((x.get("notes") or "").split("\n")[0].split("|") + ["", ""])[1].strip() in conciliated_keys]
print("lançamentos de nota recriados após a conciliação:", len(recreated), "-> R$", round(sum(float(x["expected_amount"]) for x in recreated), 2))
recreated_ids = {x["id"] for x in recreated}
nf_tx = [x for x in nf_tx if x["id"] not in recreated_ids]
print("linhas de planilha já marcadas 'Conciliado NF':", marked)
print("notas recebidas ainda lançadas como saída:", len(groups))
print("  repetidas com a planilha (mesmo nº, fornecedor e valor):", len(report["duplicada"]), "-> R$", round(sum(i["valor_nota"] for i in report["duplicada"]), 2))
print("  mesmo nº e fornecedor mas valor diferente (revisar):", len(report["valor_diferente"]), "-> R$", round(sum(i["valor_nota"] for i in report["valor_diferente"]), 2))
print("  sem correspondência na planilha:", report["sem_correspondencia"])
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
io.open(os.path.join(LOGS, f"conciliacao-{stamp}.json"), "w", encoding="utf-8").write(json.dumps(report, ensure_ascii=False, indent=1))
if not APPLY:
    print("simulação: nada gravado (use --aplicar)")
    sys.exit(0)

by_id = {x["id"]: x for x in nf_tx}
if recreated:
    io.open(os.path.join(LOGS, f"backup-saidas-recriadas-{stamp}.json"), "w", encoding="utf-8").write(json.dumps(recreated, ensure_ascii=False))
    by_company = collections.defaultdict(list)
    for x in recreated:
        by_company[x["system_company_id"]].append(x["id"])
    done = 0
    for company, ids in by_company.items():
        for i in range(0, len(ids), 25):  # em lotes: bem mais rápido e aguenta melhor oscilação de conexão
            call("DELETE", "financial_transactions?id=in.(" + ",".join(ids[i:i + 25]) + ")", company=company, extra={"Prefer": "return=minimal"})
            done += len(ids[i:i + 25])
            print(f"  removidos {done}/{len(recreated)}", flush=True)
    print("removidos", len(recreated), "lançamentos de nota recriados (backup salvo).")
backup = [by_id[pid] for item in report["duplicada"] for pid in item["parcelas_nota"] if pid in by_id]
io.open(os.path.join(LOGS, f"backup-saidas-nf-{stamp}.json"), "w", encoding="utf-8").write(json.dumps(backup, ensure_ascii=False))
sheet_by_id = {c["id"]: c for c in sheet}
for item in report["duplicada"]:
    first = sheet_by_id[item["linhas_planilha"][0]]
    # apaga primeiro as parcelas da nota e só então marca a planilha: se a conexão cair no meio, repetir o comando termina o serviço
    for pid in item["parcelas_nota"]:
        call("DELETE", f"financial_transactions?id=eq.{pid}", company=first["system_company_id"], extra={"Prefer": "return=minimal"})
    note = ((first.get("notes") or "") + f"\nConciliado NF | {item['chave']}").strip()
    call("PATCH", f"financial_transactions?id=eq.{first['id']}", {"notes": note}, company=first["system_company_id"], extra={"Prefer": "return=minimal"})
print("aplicado: removidos", len(backup), "lançamentos de nota repetidos; backup salvo.")
