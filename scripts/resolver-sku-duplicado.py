"""Resolve SKUs repetidos em `materials` RENOMEANDO (nunca apaga). O item mais antigo de cada grupo mantém o SKU; os demais recebem um código novo
do tipo certo (MP-/KIT-/PRD-, sequência livre). Sem --aplicar só mostra a proposta. Requer o 217 apenas para criar o índice único depois.
Uso: python scripts/resolver-sku-duplicado.py [--aplicar]"""
import io, json, os, re, sys, collections, urllib.error, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APPLY = "--aplicar" in sys.argv
env = dict(l.strip().split("=", 1) for l in io.open(os.path.join(ROOT, ".env.local"), encoding="utf-8") if "=" in l and not l.startswith("#"))
KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
BASE = env["NEXT_PUBLIC_SUPABASE_URL"] + "/rest/v1/"
PREFIX = {"Materia-prima": "MP", "Kit": "KIT", "Produto": "PRD"}


def call(method, path, body=None):
    headers = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json", "Prefer": "return=minimal", "x-audit-origin": "Sistema"}
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        return json.loads(raw) if raw and method == "GET" else None


items = call("GET", "materials?select=id,internal_code,name,item_type,created_at&order=created_at") or []
groups = collections.defaultdict(list)
for item in items:
    code = (item.get("internal_code") or "").strip().lower()
    if code:
        groups[code].append(item)
duplicated = {code: rows for code, rows in groups.items() if len(rows) > 1}
used = {(i.get("internal_code") or "").strip().lower() for i in items}
counters = {prefix: max([int(m.group(1)) for code in used if (m := re.fullmatch(prefix.lower() + r"-(\d{6})", code))] or [0]) for prefix in PREFIX.values()}


def next_code(item_type):
    prefix = PREFIX.get(item_type, "PRD")
    while True:
        counters[prefix] += 1
        code = f"{prefix}-{counters[prefix]:06d}"
        if code.lower() not in used:
            used.add(code.lower())
            return code


plan = []
for code, rows in duplicated.items():
    for extra in rows[1:]:
        plan.append((extra, rows[0], next_code(extra["item_type"])))
print(f"SKUs repetidos: {len(duplicated)} | itens a renomear: {len(plan)} (nenhum será apagado)")
for item, keeper, new in plan:
    print(f"  {item['internal_code']}  mantido: {keeper['id'][:8]} ({keeper['name']})  |  renomear {item['id'][:8]} '{item['name']}' ({item['created_at'][:16]}) -> {new}")
if not APPLY:
    print("simulação: nada foi alterado (use --aplicar, só com a sua aprovação)")
    sys.exit(0)
for item, _, new in plan:
    try:  # com o 217 instalado, item com história só troca de SKU pela troca controlada (fica no histórico)
        call("POST", "rpc/change_item_sku", {"p_material_id": item["id"], "p_new_sku": new, "p_reason": "Resolução de SKU duplicado", "p_user": "Manutenção"})
    except urllib.error.HTTPError as error:
        if error.code not in (404, 400):
            raise
        call("PATCH", f"materials?id=eq.{item['id']}", {"internal_code": new})
print("renomeados:", len(plan), "- agora rode o scripts/217_itens_estrutura.sql de novo para criar o índice único de SKU.")
