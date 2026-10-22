"""SÓ LEITURA. Lista os cadastros de catálogo/estoque/compras candidatos à limpeza (IDs, nomes, relações e dependências) para conferência. Não exclui nada."""
import io, json, os, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
env = dict(l.strip().split("=", 1) for l in io.open(os.path.join(ROOT, ".env.local"), encoding="utf-8") if "=" in l and not l.startswith("#"))
KEY = env["SUPABASE_SERVICE_ROLE_KEY"]
BASE = env["NEXT_PUBLIC_SUPABASE_URL"] + "/rest/v1/"
H = {"apikey": KEY, "Authorization": "Bearer " + KEY}


def get(path):
    return json.load(urllib.request.urlopen(urllib.request.Request(BASE + path, headers=H), timeout=60))


out = []
p = out.append
p("# Conferência da limpeza: catálogo, estoque e compras\n")
p("Somente leitura. Nada foi excluído. Marque o que **não** é teste antes de aprovar.\n")
materials = get("materials?select=id,internal_code,name,item_type,unit,current_stock,sale_price,cost_price,created_at&order=created_at")
p("## Itens (`materials`)\n")
p("| ID | SKU | Nome | Tipo | Un. | Estoque | Custo | Venda | Criado em |\n|---|---|---|---|---|--:|--:|--:|---|")
for m in materials:
    p(f"| {m['id']} | {m['internal_code']} | {m['name']} | {m['item_type']} | {m['unit']} | {m['current_stock']} | {m['cost_price']} | {m['sale_price']} | {m['created_at'][:16]} |")
deps = [("product_compositions", "product_id"), ("product_composition_items", "component_id"), ("stock_movements", "material_id"), ("stock_balances", "material_id"),
        ("stock_reservations", "material_id"), ("purchase_order_items", "material_id"), ("quote_items", "material_id"), ("service_order_materials", "material_id"),
        ("product_fiscal_rules", "material_id"), ("service_type_materials", "material_id"), ("production_records", "product_id")]
p("\n## Dependências por item (quantos registros apontam para ele)\n")
p("| Item | " + " | ".join(t for t, _ in deps) + " |\n|---|" + "---|" * len(deps))
for m in materials:
    cells = []
    for table, col in deps:
        try:
            cells.append(str(len(get(f"{table}?select=*&{col}=eq.{m['id']}"))))
        except Exception:
            cells.append("n/d")
    p(f"| {m['name']} ({m['internal_code']}) | " + " | ".join(cells) + " |")
for title, path in [("Composições (`product_compositions`)", "product_compositions?select=id,product_id,version,status,labor_cost,created_at"),
                    ("Itens de composição", "product_composition_items?select=id,composition_id,component_id,quantity,unit,loss_percent"),
                    ("Movimentações de estoque (`stock_movements`)", "stock_movements?select=id,material_id,movement_type,quantity,unit_cost,occurred_at,document_reference,responsible"),
                    ("Saldos por depósito (`stock_balances`)", "stock_balances?select=material_id,warehouse_id,quantity"),
                    ("Pedidos de compra (`purchase_orders`)", "purchase_orders?select=id,order_number,supplier_name,status,total_amount,created_at"),
                    ("Itens de pedido de compra", "purchase_order_items?select=id,purchase_order_id,material_id,quantity,unit_cost,received_quantity"),
                    ("Depósitos (`warehouses`): configuração, preservar", "warehouses?select=id,code,name,is_default,status")]:
    rows = get(path)
    p(f"\n## {title}: {len(rows)}\n")
    if rows:
        keys = list(rows[0].keys())
        p("| " + " | ".join(keys) + " |\n|" + "---|" * len(keys))
        for r in rows:
            p("| " + " | ".join(str(r.get(k, ""))[:40] for k in keys) + " |")
p("\n## Fora da limpeza (preservados integralmente)\nClientes, fornecedores, financeiro (contas, lançamentos, DRE), notas importadas, usuários, permissões, empresas, configurações, logs/auditoria, integrações e dados fiscais.\n")
path = os.path.join(ROOT, "docs", "architecture", "limpeza-catalogo-conferencia.md")
io.open(path, "w", encoding="utf-8", newline="\n").write("\n".join(out) + "\n")
print("relatório:", path)
