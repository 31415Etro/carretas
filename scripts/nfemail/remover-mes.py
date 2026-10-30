"""Remove da empresa as notas importadas de um mês (e tudo que nasceu delas): Entradas e Saídas, Contas a Pagar, Contas a Receber e o registro da nota importada.
A unidade é a NOTA: entram as notas EMITIDAS no mês e as que têm alguma parcela lançada no mês. Tudo com origem 'Importacao NF'; o que veio de planilha ou foi digitado nunca é tocado.
Apagar também o registro da nota (imported_invoices) é o que impede a rotina das 08h/14h de recriar os lançamentos. Para trazer de volta: importe a nota de novo.
Sem --aplicar só mostra. Backup completo em scripts/nfemail/logs antes de apagar. Pode repetir sem risco.
Com --descricao-nf, remove TAMBÉM, no mês, os lançamentos e contas a pagar de QUALQUER origem (inclusive planilha) cuja descrição cita "NF" (ex.: "KIFERRO - NF 71187").
Uso: python scripts/nfemail/remover-mes.py --empresa 72295744000191 --mes 2026-09 [--descricao-nf] [--aplicar]"""
import io, json, os, sys, re, datetime, collections, urllib.request

ARGS = sys.argv[1:]
APPLY = "--aplicar" in ARGS
BY_DESCRIPTION = "--descricao-nf" in ARGS
opt = lambda name: ARGS[ARGS.index(f"--{name}") + 1] if f"--{name}" in ARGS else ""
CNPJ = re.sub(r"\D", "", opt("empresa"))
MONTH = opt("mes")
if len(CNPJ) != 14 or not re.fullmatch(r"\d{4}-\d{2}", MONTH):
    sys.exit("Uso: python scripts/nfemail/remover-mes.py --empresa <cnpj> --mes AAAA-MM [--aplicar]")

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOGS = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOGS, exist_ok=True)
env = dict(l.strip().split("=", 1) for l in io.open(os.path.join(ROOT, ".env.local"), encoding="utf-8") if "=" in l and not l.startswith("#"))
KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
BASE = env["NEXT_PUBLIC_SUPABASE_URL"] + "/rest/v1/"


def call(method, path, company=None, extra=None):
    headers = {"apikey": KEY, "Authorization": "Bearer " + KEY, "x-audit-origin": "Sistema", **(extra or {})}
    if company:
        headers["x-system-company-id"] = company
    req = urllib.request.Request(BASE + path, method=method, headers=headers)
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read()
                return json.loads(raw) if raw else None
        except Exception:
            if attempt == 5:
                raise


def rows(path):
    out, offset = [], 0
    while True:
        chunk = call("GET", path, extra={"Range": f"{offset}-{offset + 999}"})
        out += chunk
        if len(chunk) < 1000:
            return out
        offset += 1000


companies = [c for c in rows("system_companies?select=id,name,cnpj") if re.sub(r"\D", "", c["cnpj"] or "") == CNPJ]
if not companies:
    sys.exit("CNPJ não cadastrado.")
company = companies[0]
CID = company["id"]
key_of = lambda notes: ((notes or "").split("\n")[0].split("|") + ["", ""])[1].strip()

invoices = rows(f"imported_invoices?select=*&system_company_id=eq.{CID}")
transactions = rows(f"financial_transactions?select=*&system_company_id=eq.{CID}&origin=eq.Importacao%20NF")
payables = rows(f"accounts_payable?select=*&system_company_id=eq.{CID}&origin=eq.Importacao%20NF")
receivables = rows(f"accounts_receivable?select=*&system_company_id=eq.{CID}&origin=eq.Importacao%20NF")

in_month = lambda value: (value or "")[:7] == MONTH
issued_keys = {i["dedupe_key"] for i in invoices if in_month(i["issued_at"])}
parcel_keys = {key_of(x["notes"]) for x in transactions if in_month(x["realized_date"] or x["due_date"])}
parcel_keys |= {key_of(x["notes"]) for x in payables if in_month(x["due_date"])}
parcel_keys |= {key_of(x["notes"]) for x in receivables if in_month(x["due_date"])}
keys = {k for k in (issued_keys | parcel_keys) if k}

pick = lambda items: [x for x in items if key_of(x["notes"]) in keys]
t_del, p_del, r_del = pick(transactions), pick(payables), pick(receivables)
extra_t, extra_p = [], []
if BY_DESCRIPTION:
    cites_nf = lambda x: re.search(r"NF", x.get("description") or "", re.I) is not None
    taken_t, taken_p = {x["id"] for x in t_del}, {x["id"] for x in p_del}
    all_t = rows(f"financial_transactions?select=*&system_company_id=eq.{CID}")
    all_p = rows(f"accounts_payable?select=*&system_company_id=eq.{CID}")
    extra_t = [x for x in all_t if x["id"] not in taken_t and cites_nf(x) and in_month(x["realized_date"] or x["due_date"])]
    extra_p = [x for x in all_p if x["id"] not in taken_p and cites_nf(x) and in_month(x["due_date"])]
    t_del, p_del = t_del + extra_t, p_del + extra_p
i_del = [i for i in invoices if i["dedupe_key"] in keys]
amount = lambda x: float(x.get("realized_amount") or x.get("expected_amount") or 0)

print(f"{company['name']} ({company['cnpj']}) | mês {MONTH}")
print(f"notas importadas a remover: {len(i_del)} ({len(issued_keys)} emitidas no mês + {len(parcel_keys - issued_keys)} emitidas em outro mês com parcela no mês)")
for kind in ("entrada", "saida"):
    sel = [x for x in t_del if x["type"] == kind]
    inside = [x for x in sel if in_month(x["realized_date"] or x["due_date"])]
    print(f"  Entradas e Saídas ({kind}): {len(sel)} lançamentos, R$ {round(sum(map(amount, sel)), 2)} (dentro do mês: {len(inside)}, parcelas de outros meses dessas notas: {len(sel) - len(inside)})")
print(f"  Contas a Pagar: {len(p_del)}, R$ {round(sum(float(x['expected_amount']) for x in p_del), 2)}")
print(f"  Contas a Receber: {len(r_del)}, R$ {round(sum(float(x['expected_amount']) for x in r_del), 2)}")
if BY_DESCRIPTION:
    print(f"  + por descrição \"NF\" (planilha e outras origens): {len(extra_t)} lançamentos (R$ {round(sum(map(amount, extra_t)), 2)}) e {len(extra_p)} contas a pagar (R$ {round(sum(float(x['expected_amount']) for x in extra_p), 2)})")
    print("    por origem:", dict(collections.Counter(x["origin"] for x in extra_t + extra_p)))
if not APPLY:
    print("simulação: nada gravado (use --aplicar)")
    sys.exit(0)

stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
io.open(os.path.join(LOGS, f"backup-remover-{MONTH}-{CNPJ[-6:]}-{stamp}.json"), "w", encoding="utf-8").write(json.dumps({"imported_invoices": i_del, "financial_transactions": t_del, "accounts_payable": p_del, "accounts_receivable": r_del}, ensure_ascii=False))
total = len(t_del) + len(p_del) + len(r_del) + len(i_del)
done = 0
for table, items in (("financial_transactions", t_del), ("accounts_payable", p_del), ("accounts_receivable", r_del), ("imported_invoices", i_del)):
    ids = [x["id"] for x in items]
    for i in range(0, len(ids), 25):
        call("DELETE", f"{table}?id=in.(" + ",".join(ids[i:i + 25]) + ")", company=CID, extra={"Prefer": "return=minimal"})
        done += len(ids[i:i + 25])
        print(f"  removidos {done}/{total}", flush=True)
print("concluído (backup salvo). Repetir o comando é seguro.")
