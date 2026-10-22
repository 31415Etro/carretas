"""SÓ LEITURA. Lista saídas da planilha e saídas de notas com MESMO VALOR e datas próximas, mesmo quando o nome é genérico ('Peças') ou diferente.
Gera scripts/nfemail/logs/possiveis-repetidas-*.csv (abre no Excel) para conferência. Nada é alterado.
Uso: python scripts/nfemail/possiveis-repetidas.py"""
import csv, io, json, os, re, datetime, unicodedata, urllib.request, collections

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
        for attempt in range(5):
            try:
                chunk = json.load(urllib.request.urlopen(req, timeout=120))
                break
            except Exception:
                if attempt == 4:
                    raise
        out += chunk
        if len(chunk) < 1000:
            return out
        offset += 1000


def norm(text):
    text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]", " ", text)


GENERIC = {"ltda", "eireli", "comercio", "industria", "ind", "com", "cia", "servicos", "mei", "epp", "filial", "matriz", "pecas", "auto", "autopecas", "material", "materiais", "ferro", "ferros", "aco", "metais", "tintas", "transportes", "transporte", "frete", "distribuidora", "equipamentos", "eletrica", "comercial", "industrial", "brasil", "sul", "norte", "produtos", "nfe"}
words = lambda text: {t for t in norm(text).split() if len(t) >= 4 and t not in GENERIC and not t.isdigit()}


def cited(text):
    return {int(re.sub(r"\D", "", m.group(1))) for m in re.finditer(r"(?:nf[- ]?e?|nota)[^0-9]{0,6}([0-9][0-9.]*)", str(text or "").lower()) if re.sub(r"\D", "", m.group(1))}


day = lambda iso: datetime.date.fromisoformat(str(iso)[:10])
tx = rows("financial_transactions?select=id,system_company_id,description,supplier_name,due_date,realized_date,expected_amount,realized_amount,origin,notes,category_id&type=eq.saida")
cats = {c["id"]: c["name"] for c in rows("financial_categories?select=id,name")}
nf = [x for x in tx if x["origin"] == "Importacao NF"]
sheet = [x for x in tx if x["origin"] != "Importacao NF"]
amt = lambda x: round(float(x["realized_amount"] or x["expected_amount"] or 0), 2)
idx = collections.defaultdict(list)
for s in sheet:
    idx[(s["system_company_id"], amt(s))].append(s)
conciliated = sum(1 for s in sheet if "Conciliado NF" in (s.get("notes") or ""))

found = []
for n in nf:
    n_amount = round(float(n["expected_amount"]), 2)
    n_date = n["due_date"]
    for s in idx.get((n["system_company_id"], n_amount), []):
        if "Conciliado NF" in (s.get("notes") or ""):
            continue
        d = s["realized_date"] or s["due_date"]
        gap = abs((day(d) - day(n_date)).days)
        if gap > 31:
            continue
        n_no = re.match(r"NF\s+(\d+)", n["description"] or "")
        other_note = bool(cited(s["description"])) and bool(n_no) and int(n_no.group(1)) not in cited(s["description"])
        same_name = bool(words(n["supplier_name"] or n["description"]) & words((s.get("supplier_name") or "") + " " + s["description"]))
        found.append({"classe": "REPETIDA (mesmo fornecedor)" if same_name and not other_note else ("OUTRA NOTA (planilha cita outro nº)" if other_note else ("CONFERIR (valor e data iguais, nome diferente)" if gap <= 3 else "provável coincidência")), "empresa": NAMES.get(n["system_company_id"]), "valor": n_amount, "dias_de_diferenca": gap, "nota": n["description"], "planilha": s["description"], "categoria_planilha": cats.get(s.get("category_id"), ""),
                      "data_nota": n_date, "data_planilha": d, "id_nota": n["id"], "id_planilha": s["id"]})

found.sort(key=lambda r: (r["classe"], r["dias_de_diferenca"], -r["valor"]))
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
path = os.path.join(LOGS, f"possiveis-repetidas-{stamp}.csv")
with io.open(path, "w", encoding="utf-8-sig", newline="") as fh:
    writer = csv.DictWriter(fh, fieldnames=list(found[0].keys()) if found else ["vazio"], delimiter=";")
    writer.writeheader()
    writer.writerows(found)
print(f"saídas de nota: {len(nf)} | saídas de planilha: {len(sheet)} (já conciliadas: {conciliated})")
print(f"mesmo valor e datas até 31 dias: {len(found)} pares -> R$ {round(sum(r['valor'] for r in found), 2)} | por empresa: {dict(collections.Counter(r['empresa'] for r in found))}")
print("por classe:", {k: (v, round(sum(r["valor"] for r in found if r["classe"] == k), 2)) for k, v in collections.Counter(r["classe"] for r in found).items()})
print("por distância de data:", {k: v for k, v in sorted(collections.Counter(("mesmo dia" if r['dias_de_diferenca'] == 0 else "até 3 dias" if r['dias_de_diferenca'] <= 3 else "até 10 dias" if r['dias_de_diferenca'] <= 10 else "até 31 dias") for r in found).items())})
for r in found[:12]:
    print(f"  {r['empresa']:8} R$ {r['valor']:>10,.2f} | nota: {r['nota'][:34]:34} | planilha: {r['planilha'][:28]:28} | {r['dias_de_diferenca']}d")
print("lista completa:", path)
