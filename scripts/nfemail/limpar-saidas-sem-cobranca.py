"""Tira de Entradas e Saídas os lançamentos de notas recebidas que NÃO são compra a pagar: remessa/retorno/demonstração/conserto/transferência/devolução
(CFOP de operação sem cobrança, ex.: 6913 'retorno de mercadoria recebida para demonstração') e sem duplicatas. Mesma regra da importação (lib/nf-sync.ts).
Sem --aplicar só mostra. Com --aplicar: backup completo e remoção. Pode repetir sem risco.
Uso: python scripts/nfemail/limpar-saidas-sem-cobranca.py [--aplicar]"""
import io, json, os, sys, datetime, urllib.request, collections

APPLY = "--aplicar" in sys.argv
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOGS = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOGS, exist_ok=True)
env = dict(l.strip().split("=", 1) for l in io.open(os.path.join(ROOT, ".env.local"), encoding="utf-8") if "=" in l and not l.startswith("#"))
KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
BASE = env["NEXT_PUBLIC_SUPABASE_URL"] + "/rest/v1/"
NAMES = {"00000000-0000-4000-8000-000000000001": "Fort", "39faf343-bd20-4074-b600-518faf4365ee": "Reboques"}
NON_FINANCIAL = {str(n) for n in range(901, 926)} | {"949", "201", "202", "208", "209", "410", "411", "412", "413", "503", "553", "556"} | {str(n) for n in range(151, 160)}


def call(method, path, body=None, company=None, extra=None):
    headers = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json", "x-audit-origin": "Sistema", **(extra or {})}
    if company:
        headers["x-system-company-id"] = company
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=headers)
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


def without_billing(invoice):
    if [p for p in (invoice.get("installments") or []) if float(p.get("amount") or 0) > 0]:
        return False
    cfops = [str(i.get("cfop") or "")[-3:] for i in (invoice.get("items") or []) if i.get("cfop")]
    return bool(cfops) and all(c in NON_FINANCIAL for c in cfops)


skip = {(i["system_company_id"], i["dedupe_key"]): i for i in rows("imported_invoices?select=system_company_id,dedupe_key,items,installments,number,total_amount,nature,issuer_name&my_role=eq.Destinat%C3%A1rio") if without_billing(i)}
launches = [x for x in rows("financial_transactions?select=*&origin=eq.Importacao%20NF&type=eq.saida")
            if (x["system_company_id"], ((x.get("notes") or "").split("\n")[0].split("|") + ["", ""])[1].strip()) in skip]
total = {n: (sum(1 for x in launches if NAMES.get(x["system_company_id"]) == n), sum(float(x["expected_amount"]) for x in launches if NAMES.get(x["system_company_id"]) == n)) for n in ("Fort", "Reboques")}
print(f"notas recebidas sem cobrança (remessa/retorno/demonstração/etc.): {len(skip)} | lançamentos de saída a remover: {len(launches)} -> R$ {round(sum(float(x['expected_amount']) for x in launches), 2)}")
print({k: (c, round(v, 2)) for k, (c, v) in total.items()})
by_nature = collections.defaultdict(float)
for x in launches:
    by_nature[(skip[(x["system_company_id"], ((x.get("notes") or "").split("\n")[0].split("|") + ["", ""])[1].strip())].get("nature") or "?")[:45]] += float(x["expected_amount"])
for k, v in sorted(by_nature.items(), key=lambda kv: -kv[1])[:8]:
    print(f"   R$ {round(v):>9,}  {k}".replace(",", "."))
if not APPLY:
    print("simulação: nada gravado (use --aplicar)")
    sys.exit(0)
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
io.open(os.path.join(LOGS, f"backup-saidas-sem-cobranca-{stamp}.json"), "w", encoding="utf-8").write(json.dumps(launches, ensure_ascii=False))
by_company = collections.defaultdict(list)
for x in launches:
    by_company[x["system_company_id"]].append(x["id"])
done = 0
for company, ids in by_company.items():
    for i in range(0, len(ids), 25):
        call("DELETE", "financial_transactions?id=in.(" + ",".join(ids[i:i + 25]) + ")", company=company, extra={"Prefer": "return=minimal"})
        done += len(ids[i:i + 25])
        print(f"  removidos {done}/{len(launches)}", flush=True)
print("concluído (backup salvo). Repetir o comando é seguro.")
