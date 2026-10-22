"""Contas a Pagar só com as notas do mês corrente em diante (como em Contas a Receber).
As contas vindas de nota (origin 'Importacao NF') com vencimento ANTES do 1º dia do mês corrente, ainda Abertas e sem pagamento, saem de Contas a Pagar:
as saídas dessas notas já estão em Entradas e Saídas. Backup completo antes de remover. Sem --aplicar só mostra.
Uso: python scripts/nfemail/ajustar-contas-a-pagar.py [--aplicar]   (pode repetir sem risco)"""
import io, json, os, sys, datetime, urllib.request, collections

APPLY = "--aplicar" in sys.argv
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOGS = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOGS, exist_ok=True)
env = dict(l.strip().split("=", 1) for l in io.open(os.path.join(ROOT, ".env.local"), encoding="utf-8") if "=" in l and not l.startswith("#"))
KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
BASE = env["NEXT_PUBLIC_SUPABASE_URL"] + "/rest/v1/"
NAMES = {"00000000-0000-4000-8000-000000000001": "Fort", "39faf343-bd20-4074-b600-518faf4365ee": "Reboques"}
CUT = datetime.date.today().replace(day=1).isoformat()


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


todo = [a for a in rows(f"accounts_payable?select=*&origin=eq.Importacao%20NF&due_date=lt.{CUT}&status=eq.Aberta") if float(a.get("paid_amount") or 0) == 0]
print(f"corte: {CUT} | contas a pagar de nota anteriores ao mês corrente: {len(todo)} -> R$ {round(sum(float(a['expected_amount']) for a in todo), 2)}")
print("por empresa:", {k: (c, round(v, 2)) for k, (c, v) in ((n, (sum(1 for a in todo if NAMES.get(a['system_company_id']) == n), sum(float(a['expected_amount']) for a in todo if NAMES.get(a['system_company_id']) == n))) for n in ("Fort", "Reboques"))})
if not APPLY:
    print("simulação: nada gravado (use --aplicar)")
    sys.exit(0)
stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
io.open(os.path.join(LOGS, f"backup-contas-a-pagar-{stamp}.json"), "w", encoding="utf-8").write(json.dumps(todo, ensure_ascii=False))
by_company = collections.defaultdict(list)
for a in todo:
    by_company[a["system_company_id"]].append(a["id"])
done = 0
for company, ids in by_company.items():
    for i in range(0, len(ids), 25):
        call("DELETE", "accounts_payable?id=in.(" + ",".join(ids[i:i + 25]) + ")", company=company, extra={"Prefer": "return=minimal"})
        done += len(ids[i:i + 25])
        print(f"  removidas {done}/{len(todo)}", flush=True)
print("concluído (backup salvo). Repetir o comando é seguro.")
