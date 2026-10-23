#!/usr/bin/env python3
"""Leva as SAIDAS das planilhas de despesas (uma por CNPJ) para Entradas e Saidas de cada empresa, ate uma data de corte.

Diferente de importar-planilha-despesas.py, NAO cria contas a pagar: o que ja foi pago e so lancamento realizado.
Contas a pagar fica apenas para o que ainda vai ser pago (lancado la a mao).

  python importar-saidas-planilha.py --ate 2026-09-30            simulacao (nao grava)
  python importar-saidas-planilha.py --ate 2026-09-30 --apply    grava (idempotente: ids fixos; rodar de novo nao duplica)
"""
import argparse, collections, datetime, glob, importlib.util, os, re, sys, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
spec = importlib.util.spec_from_file_location("planilha", os.path.join(HERE, "importar-planilha-despesas.py"))
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
nd = base.nd
MARK = "Saidas planilha ND"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--ate", required=True, help="data de corte inclusiva (yyyy-mm-dd)")
    parser.add_argument("--dir", default=os.path.join(HERE, ".."))
    parser.add_argument("--env", default=os.path.join(HERE, "..", ".env.local"))
    args = parser.parse_args()
    cutoff = datetime.date.fromisoformat(args.ate)
    files = sorted(glob.glob(os.path.join(args.dir, "Planilha_ND*.xlsx")))
    env = dict(l.strip().split("=", 1) for l in open(args.env, encoding="utf-8") if "=" in l and not l.startswith("#"))
    companies = {re.sub(r"\D", "", c["cnpj"] or "")[:8]: c for c in base.rest(env, "system_companies?select=id,name,cnpj")}

    plans = []
    for path in files:
        root = base.FILE_RE.search(os.path.basename(path)).group(1)
        company = companies[root]
        payments, _ = base.read_workbook(path)
        kept = [p for p in payments if p["date"] <= cutoff]
        plans.append((path, company, kept, len(payments) - len(kept)))
    base.NAMES.update(base.build_names([p for _, _, kept, _ in plans for p in kept]))

    for path, company, kept, dropped in plans:
        total = sum(p["amount"] for p in kept)
        first, last = min(p["date"] for p in kept), max(p["date"] for p in kept)
        print(f"{company['name']} ({company['cnpj']}): {len(kept)} saidas, R$ {total:,.2f}, de {first} a {last}; {dropped} parcela(s) depois de {cutoff} ficaram de fora")
        by_month = collections.OrderedDict()
        for p in sorted(kept, key=lambda p: p["date"]):
            by_month[p["date"].strftime("%Y-%m")] = by_month.get(p["date"].strftime("%Y-%m"), 0) + p["amount"]
        print("   por mes:", ", ".join(f"{m}: {v:,.2f}" for m, v in by_month.items()))
    if not args.apply:
        print("\n(simulacao: nada foi gravado; use --apply)")
        return

    now = datetime.datetime.utcnow().isoformat() + "Z"
    for path, company, kept, _ in plans:
        cid = company["id"]
        q = lambda table, cols: base.rest(env, f"{table}?select={cols}&system_company_id=eq.{cid}&limit=5000")
        dre = {d["name"]: d["id"] for d in q("dre_accounts", "id,name")}
        cc = {c["name"]: c["id"] for c in q("cost_centers", "id,name")}
        cats = {c["name"]: c["id"] for c in q("financial_categories", "id,name")}
        used = {base.classify(p, base.NAMES)["category"] for p in kept}
        for name in sorted(used - set(cats)):
            new_id = base.uid("cat", cid, name)
            base.rest(env, "financial_categories?on_conflict=id", "POST", [dict(id=new_id, name=name, type="saida", group="Importacao planilha", dre_account_id=dre.get(nd.FIN_CATEGORIES[name]), status="Ativo", system_company_id=cid)],
                      prefer="resolution=ignore-duplicates,return=minimal")
            base.rest(env, f"financial_categories?id=eq.{new_id}", "PATCH", {"system_company_id": cid}, prefer="return=minimal")
            cats[name] = new_id
            print(f"  categoria criada em {company['name']}: {name}")
        rows = []
        for p in kept:
            info = base.classify(p, base.NAMES)
            party = info["canonical"] if info["supplier"] and p["is_title"] else p["party"]
            title = p["is_title"]
            description = (f"{party} - NF {p['nf']}" if p["nf"] else party) if title else f"Folha - {p['party']}{' (' + p['role'] + ')' if p['role'] else ''}"
            notes = "\n".join(filter(None, [f"{MARK} | {p['sheet']} | linha {p['row']}",
                                            f"Emissao: {p['issue'].strftime('%d/%m/%Y')} | Valor do titulo: R$ {p['total']:,.2f} | Boleto: {p['boleto'] or '-'}" if title else f"Funcao: {p['role'] or '-'}",
                                            f"Classe na planilha: {p['klass'] or 'nao informada'}" + (f" | Nome na planilha: {p['party']}" if title and party != p["party"] else "")]))
            competence = min(p["issue"], p["date"]) if title and p["issue"] else p["date"]
            rows.append(dict(id=base.uid("saida", cid, p["sheet"], p["row"], p["col"]), type="saida", description=description, category_id=cats[info["category"]], cost_center_id=cc.get(info["cc"]) or None,
                             dre_account_id=dre.get(info["dre"]), supplier_name=party, competence_date=competence.isoformat(), due_date=p["date"].isoformat(), realized_date=p["date"].isoformat(),
                             expected_amount=p["amount"], realized_amount=p["amount"], payment_method=base.method(p["boleto"]), status="Realizado", origin="Importacao planilha", notes=notes,
                             attachment_url=None, system_company_id=cid))
        for i in range(0, len(rows), 100):
            base.rest(env, "financial_transactions?on_conflict=id", "POST", rows[i:i + 100], prefer="resolution=ignore-duplicates,return=minimal")
            # o banco atribui a empresa no INSERT (gatilho); corrige para a empresa da planilha
            base.rest(env, f"financial_transactions?id=in.({','.join(r['id'] for r in rows[i:i + 100])})", "PATCH", {"system_company_id": cid}, prefer="return=minimal")
            print(f"  {company['name']}: {min(i + 100, len(rows))}/{len(rows)}", flush=True)
        print(f"{company['name']}: {len(rows)} lancamentos de saida (Realizado) gravados.")


if __name__ == "__main__":
    main()
