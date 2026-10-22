"""Conciliação POR PARCELA entre as notas recebidas (origin 'Importacao NF') e as saídas/contas a pagar das PLANILHAS.
Regra de repetição (1 para 1): mesma empresa, mesmo valor (±R$ 0,01), nome do fornecedor com palavra em comum, data até 45 dias de diferença
e, se a planilha cita número de nota, é o MESMO número da nota (outro número = outra compra, não é repetição).
  - Entradas e Saídas: remove o lançamento da parcela da nota e marca a linha da planilha com 'Conciliado NF parcela | chave | n/m'.
  - Contas a Pagar: a conta da nota vira 'Cancelada' (não apaga) com observação apontando a conta da planilha.
Sem --aplicar só mostra (não grava). Pode repetir sem risco. Backups em scripts/nfemail/logs."""
import io, json, os, re, sys, datetime, unicodedata, urllib.request, collections

APPLY = "--aplicar" in sys.argv
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
LOGS = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOGS, exist_ok=True)
env = dict(l.strip().split("=", 1) for l in io.open(os.path.join(ROOT, ".env.local"), encoding="utf-8") if "=" in l and not l.startswith("#"))
KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
BASE = env["NEXT_PUBLIC_SUPABASE_URL"] + "/rest/v1/"
NAMES = {"00000000-0000-4000-8000-000000000001": "Fort", "39faf343-bd20-4074-b600-518faf4365ee": "Reboques"}
STAMP = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")


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


def norm(text):
    text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]", " ", text)


STOP = {"ltda", "me", "epp", "sa", "eireli", "comercio", "com", "de", "do", "da", "dos", "das", "industria", "ind", "cia", "servicos", "nfe", "mei", "filial", "matriz", "the"}
GENERIC = {"pecas", "auto", "autopecas", "material", "materiais", "ferro", "ferros", "aco", "metais", "tintas", "transportes", "transporte", "frete", "servico", "distribuidora", "equipamentos", "eletrica", "eletricos", "comercial", "industrial", "brasil", "sul", "norte"}
tokens = lambda text: {t for t in norm(text).split() if len(t) > 2 and t not in STOP}


day = lambda iso: datetime.date.fromisoformat(str(iso)[:10])


def same_supplier(note_name, other_text):
    """Mesmo fornecedor: alguma palavra PRÓPRIA (4+ letras, que não seja genérica como 'peças' ou 'ferro') aparece nos dois nomes. Ex.: 'JAIME RAITZ E CIA' x 'RAITZ'."""
    own = lambda text: {t for t in norm(text).split() if len(t) >= 4 and t not in STOP and t not in GENERIC and not t.isdigit()}
    return bool(own(note_name) & own(other_text))


def cited_numbers(text):
    found = set()
    for m in re.finditer(r"(?:\bnf[- ]?e?\b|nota)[^0-9]{0,6}([0-9][0-9.]*)", str(text or "").lower()):
        digits = re.sub(r"\D", "", m.group(1))
        if digits:
            found.add(int(digits))
    return found


def note_number(description):
    m = re.match(r"NF\s+(\d+)", description or "")
    return int(m.group(1)) if m else 0


def suffix(notes):
    parts = ((notes or "").split("\n")[0]).split("|")
    return (parts[2].strip() if len(parts) > 2 else ""), (parts[1].strip() if len(parts) > 1 else "")


def pair(items, pool, date_of, amount_of, text_of, number_of):
    """Casamento 1 para 1: devolve [(item, candidato)] escolhendo o candidato de data mais próxima; cada candidato é usado uma vez."""
    index = collections.defaultdict(list)
    for c in pool:
        index[(c["system_company_id"], round(float(amount_of(c)), 2))].append(c)
    used, out = set(), []
    for it in sorted(items, key=lambda x: date_of(x) or ""):
        mine_text = text_of(it)
        n = number_of(it)
        best = None
        for c in index.get((it["system_company_id"], round(float(amount_of(it)), 2)), []):
            if c["id"] in used or not date_of(c) or not date_of(it):
                continue
            gap = abs((day(date_of(c)) - day(date_of(it))).days)
            if gap > 45 or not same_supplier(mine_text, text_of(c)):
                continue
            cited = cited_numbers(c.get("description")) | cited_numbers(c.get("document_number"))
            if cited and n and n not in cited:
                continue
            score = (0 if (cited and n in cited) else 1, gap)
            if best is None or score < best[0]:
                best = (score, c)
        if best:
            used.add(best[1]["id"])
            out.append((it, best[1]))
    return out


tx = rows("financial_transactions?select=*&type=eq.saida")
nf_tx = [x for x in tx if x["origin"] == "Importacao NF"]
sheet_tx = [x for x in tx if x["origin"] != "Importacao NF" and "Conciliado NF" not in (x.get("notes") or "")]
ap = rows("accounts_payable?select=*")
ap_nf = [a for a in ap if a["origin"] == "Importacao NF" and a["status"] not in ("Cancelada",)]
ap_sheet = [a for a in ap if a["origin"] != "Importacao NF" and a["status"] != "Cancelada"]

# o valor da nota é o esperado; o da planilha é o realizado (ou o esperado, se ainda previsto)
tx_pairs = pair(nf_tx, sheet_tx, lambda x: x["realized_date"] or x["due_date"], lambda x: (x["realized_amount"] if x["origin"] != "Importacao NF" else x["expected_amount"]) or x["expected_amount"] or 0,
                lambda x: (x.get("supplier_name") or "") + " " + (x.get("description") or ""), lambda x: note_number(x["description"]))
ap_pairs = pair(ap_nf, ap_sheet, lambda x: x["due_date"], lambda x: x["expected_amount"] or 0,
                lambda x: (x.get("supplier_name") or "") + " " + (x.get("description") or ""), lambda x: int(re.sub(r"\D", "", str(x.get("document_number") or "")) or 0) or note_number(x["description"]))

print("ENTRADAS E SAÍDAS: parcelas de nota que já existem na planilha:", len(tx_pairs), "-> R$", round(sum(float(a["expected_amount"]) for a, _ in tx_pairs), 2), dict(collections.Counter(NAMES.get(a["system_company_id"]) for a, _ in tx_pairs)))
print("CONTAS A PAGAR: contas de nota que já existem na planilha:", len(ap_pairs), "-> R$", round(sum(float(a["expected_amount"]) for a, _ in ap_pairs), 2), dict(collections.Counter(NAMES.get(a["system_company_id"]) for a, _ in ap_pairs)))
print("  status da conta da planilha:", dict(collections.Counter(c["status"] for _, c in ap_pairs)))
for a, c in tx_pairs[:5]:
    print("   ex.:", NAMES.get(a["system_company_id"]), "|", a["description"][:36], "|", c["description"][:36], "|", a["expected_amount"])

io.open(os.path.join(LOGS, f"conciliar-parcelas-{STAMP}.json"), "w", encoding="utf-8").write(json.dumps({
    "lancamentos": [[a["id"], c["id"], a["description"], c["description"], a["expected_amount"]] for a, c in tx_pairs],
    "contas_a_pagar": [[a["id"], c["id"], a["description"], c["description"], a["expected_amount"]] for a, c in ap_pairs]}, ensure_ascii=False, indent=1))
if not APPLY:
    print("simulação: nada gravado (use --aplicar)")
    sys.exit(0)

io.open(os.path.join(LOGS, f"backup-parcelas-{STAMP}.json"), "w", encoding="utf-8").write(json.dumps({"lancamentos": [a for a, _ in tx_pairs], "contas_a_pagar": [a for a, _ in ap_pairs]}, ensure_ascii=False))
done = 0
for a, c in tx_pairs:
    sfx, key = suffix(a["notes"])
    marker = f"Conciliado NF parcela | {key} | {sfx or '1/1'}"
    call("DELETE", f"financial_transactions?id=eq.{a['id']}", company=a["system_company_id"], extra={"Prefer": "return=minimal"})
    call("PATCH", f"financial_transactions?id=eq.{c['id']}", {"notes": ((c.get("notes") or "") + "\n" + marker).strip()}, company=c["system_company_id"], extra={"Prefer": "return=minimal"})
    done += 1
    if done % 25 == 0 or done == len(tx_pairs):
        print(f"  lançamentos conciliados {done}/{len(tx_pairs)}", flush=True)
done = 0
for a, c in ap_pairs:
    note = ((a.get("notes") or "") + f"\nConciliada com a conta da planilha {c['id']} (mesmo fornecedor e valor): cancelada para não repetir.").strip()
    call("PATCH", f"accounts_payable?id=eq.{a['id']}", {"status": "Cancelada", "notes": note}, company=a["system_company_id"], extra={"Prefer": "return=minimal"})
    done += 1
    if done % 50 == 0 or done == len(ap_pairs):
        print(f"  contas a pagar conciliadas {done}/{len(ap_pairs)}", flush=True)
print("concluído. Repetir o comando é seguro.")
