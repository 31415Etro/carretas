"""LIMPEZA DE CADASTROS DE TESTE do catálogo/estoque/compras. Idempotente. NÃO RODA SOZINHA e NÃO decide o que apagar:
só remove os itens cujos IDs você listar em docs/architecture/limpeza-ids-aprovados.txt (um UUID de `materials` por linha) depois de conferir
docs/architecture/limpeza-catalogo-conferencia.md. Sem --aplicar apenas mostra o que seria removido (e se há dependência que impeça).
Passos com --aplicar: backup JSON completo -> remove dependências diretas dos itens (composições, movimentos, saldos, itens de pedido de compra
sem recebimento) -> remove os itens. Nunca toca clientes, fornecedores, financeiro, usuários, empresas, configurações, logs ou dados fiscais.
Uso: python scripts/limpeza-catalogo-teste.py [--aplicar]"""
import io, json, os, sys, datetime, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
APPLY = "--aplicar" in sys.argv
IDS_FILE = os.path.join(ROOT, "docs", "architecture", "limpeza-ids-aprovados.txt")
LOGS = os.path.join(ROOT, "scripts", "nfemail", "logs")
os.makedirs(LOGS, exist_ok=True)
env = dict(l.strip().split("=", 1) for l in io.open(os.path.join(ROOT, ".env.local"), encoding="utf-8") if "=" in l and not l.startswith("#"))
KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
BASE = env["NEXT_PUBLIC_SUPABASE_URL"] + "/rest/v1/"


def call(method, path, body=None):
    headers = {"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json", "Prefer": "return=minimal", "x-audit-origin": "Sistema"}
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
        return json.loads(raw) if raw and method == "GET" else None


if not os.path.exists(IDS_FILE):
    sys.exit(f"Crie {IDS_FILE} com os IDs aprovados (um por linha). Nada foi feito.")
ids = [l.strip() for l in io.open(IDS_FILE, encoding="utf-8") if l.strip() and not l.startswith("#")]
if not ids:
    sys.exit("Arquivo de IDs vazio. Nada foi feito.")
in_list = "in.(" + ",".join(ids) + ")"
items = call("GET", f"materials?select=*&id={in_list}") or []
print(f"itens aprovados encontrados: {len(items)} de {len(ids)}")
for m in items:
    print("  ", m["id"], m["internal_code"], m["name"], m["item_type"])

# dependências que BLOQUEIAM (têm efeito real): orçamento, ordem de serviço, recebimento de compra, produção, reserva ativa
blockers = {}
for table, col in [("quote_items", "material_id"), ("service_order_materials", "material_id"), ("production_records", "product_id"), ("stock_reservations", "material_id"),
                   ("sales_order_items", "material_id"), ("production_orders", "product_id")]:
    try:
        rows = call("GET", f"{table}?select=id&{col}={in_list}") or []
        if rows:
            blockers[table] = len(rows)
    except Exception:
        pass
receipts = call("GET", f"purchase_receipt_items?select=id&material_id={in_list}") or []
if receipts:
    blockers["purchase_receipt_items"] = len(receipts)
if blockers:
    sys.exit(f"Há registros que impedem a limpeza: {blockers}. Resolva antes (nada foi apagado).")

direct = {t: call("GET", f"{t}?select=*&{c}={in_list}") or [] for t, c in [("stock_movements", "material_id"), ("stock_balances", "material_id"), ("product_composition_items", "component_id"),
                                                                           ("product_fiscal_rules", "material_id"), ("service_type_materials", "material_id"), ("purchase_order_items", "material_id")]}
comps = call("GET", f"product_compositions?select=*&product_id={in_list}") or []
print("dependências diretas a remover:", {k: len(v) for k, v in direct.items()}, "| composições:", len(comps))
if not APPLY:
    print("simulação: nada foi apagado (use --aplicar)")
    sys.exit(0)

stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
backup = os.path.join(LOGS, f"backup-limpeza-catalogo-{stamp}.json")
io.open(backup, "w", encoding="utf-8").write(json.dumps({"materials": items, "product_compositions": comps, **direct}, ensure_ascii=False))
print("backup:", backup)
for table, col in [("purchase_order_items", "material_id"), ("stock_movements", "material_id"), ("stock_balances", "material_id"), ("product_composition_items", "component_id"),
                   ("product_fiscal_rules", "material_id"), ("service_type_materials", "material_id")]:
    call("DELETE", f"{table}?{col}={in_list}")
for c in comps:
    call("DELETE", f"product_composition_items?composition_id=eq.{c['id']}")
    call("DELETE", f"product_compositions?id=eq.{c['id']}")
call("DELETE", f"materials?id={in_list}")
print("limpeza concluída. Repetir o comando é seguro.")
