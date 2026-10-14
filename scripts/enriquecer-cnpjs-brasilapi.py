#!/usr/bin/env python3
"""Completa, aos poucos, os cadastros de clientes e fornecedores que têm CNPJ com os dados da BrasilAPI (Receita Federal).

Só mexe em quem ainda não foi lido pela BrasilAPI (cnpj_source sem "BrasilAPI"). Atualiza sempre os campos da Receita
(situação, abertura, CNAEs, natureza, porte, matriz/filial, sócios) e só preenche o que está vazio nos demais
(telefone, e-mail, endereço, nome fantasia, contato), sem sobrescrever o que alguém digitou.
Se a BrasilAPI estiver fora do ar, espera e tenta de novo (--intervalo minutos, até --max-horas).

Uso:  python enriquecer-cnpjs-brasilapi.py [--intervalo 15] [--max-horas 12] [--env C:\\carretinhas-dev\\.env.local]
"""
import argparse, datetime, json, re, time, urllib.error, urllib.request

CLIENT_FIELDS = "id,name,corporate_name,trade_name,document,phone,email,zip_code,street,number,complement,district,city,state,responsible_name,contact_role,cnpj_source"
SUPPLIER_FIELDS = "id,name,trade_name,document,phone,email,zip_code,street,number,complement,district,city,state,contact_name,contact_role,cnpj_source"


def digits(v):
    return re.sub(r"\D", "", str(v or ""))


def fmt_phone(v):
    p = digits(v)
    return f"({p[:2]}) {p[2:6]}-{p[6:]}" if len(p) == 10 else f"({p[:2]}) {p[2:7]}-{p[7:]}" if len(p) == 11 else p


def fmt_zip(v):
    z = digits(v)
    return f"{z[:5]}-{z[5:]}" if len(z) == 8 else z


class Db:
    def __init__(self, env_path):
        env = dict(l.strip().split("=", 1) for l in open(env_path, encoding="utf-8") if "=" in l and not l.startswith("#"))
        self.url, key = env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"]
        self.headers = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"}

    def call(self, path, method="GET", body=None):
        req = urllib.request.Request(f"{self.url}/rest/v1/{path}", method=method, data=json.dumps(body).encode() if body is not None else None, headers=self.headers)
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or "null")


def brasil(cnpj):
    """-> (dados, motivo). dados=None quando a BrasilAPI não respondeu."""
    req = urllib.request.Request(f"https://brasilapi.com.br/api/cnpj/v1/{cnpj}", headers={"Accept": "application/json", "User-Agent": "ND-Carretas/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read().decode("utf-8")), "ok"
    except urllib.error.HTTPError as err:
        return None, "nao encontrado" if err.code == 404 else f"HTTP {err.code}"
    except Exception as err:  # rede, timeout
        return None, type(err).__name__


def receita_fields(d):
    return dict(
        cnpj_status=d.get("descricao_situacao_cadastral") or None, cnpj_status_date=d.get("data_situacao_cadastral") or None, opened_at=d.get("data_inicio_atividade") or None,
        cnae_main=f"{d.get('cnae_fiscal', '')} - {d.get('cnae_fiscal_descricao', '')}".strip(" -") or None,
        cnae_secondary="\n".join(f"{c.get('codigo')} - {c.get('descricao')}" for c in d.get("cnaes_secundarios") or []) or None,
        legal_nature=d.get("natureza_juridica") or None, company_size=d.get("descricao_porte") or d.get("porte") or None,
        branch_type="Filial" if d.get("identificador_matriz_filial") == 2 else "Matriz" if d.get("identificador_matriz_filial") == 1 else None,
        cnpj_partners=[{"name": q.get("nome_socio"), "role": q.get("qualificacao_socio")} for q in d.get("qsa") or []] or None,
    )


def fill_gaps(row, d, contact_col, role_col):
    """só o que está vazio no cadastro."""
    street_type = d.get("descricao_tipo_de_logradouro") or ""
    street = d.get("logradouro") or ""
    if street_type and not street.upper().startswith(street_type.upper()):
        street = f"{street_type} {street}".strip()
    wanted = dict(phone=fmt_phone(d.get("ddd_telefone_1")), email=(d.get("email") or "").lower(), zip_code=fmt_zip(d.get("cep")), street=street, number=d.get("numero"), complement=d.get("complemento"),
                  district=d.get("bairro"), city=d.get("municipio"), state=d.get("uf"), trade_name=(d.get("nome_fantasia") or "").strip())
    admin = next((q for q in d.get("qsa") or [] if re.search("administrador", q.get("qualificacao_socio") or "", re.I)), None)
    if admin:
        wanted[contact_col], wanted[role_col] = admin.get("nome_socio"), admin.get("qualificacao_socio")
    return {k: v for k, v in wanted.items() if v and not row.get(k)}


def pending(db):
    out = []
    for table, fields in (("clients", CLIENT_FIELDS), ("suppliers", SUPPLIER_FIELDS)):
        for row in db.call(f"{table}?select={fields}&document=neq.&limit=1000"):
            if len(digits(row["document"])) == 14 and "BrasilAPI" not in (row.get("cnpj_source") or ""):
                out.append((table, row))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--intervalo", type=int, default=15, help="minutos entre tentativas quando a BrasilAPI está fora do ar")
    ap.add_argument("--max-horas", type=float, default=12)
    ap.add_argument("--env", default=r"C:\carretinhas-dev\.env.local")
    args = ap.parse_args()
    db = Db(args.env)
    deadline = time.time() + args.max_horas * 3600
    done = 0
    while True:
        todo = pending(db)
        if not todo:
            print(f"Concluido: {done} cadastro(s) completados pela BrasilAPI; nada mais pendente.", flush=True)
            return
        progressed = False
        for table, row in todo:
            data, why = brasil(digits(row["document"]))
            if not data:
                print(f"{datetime.datetime.now():%H:%M} {row['document']}: BrasilAPI indisponivel ({why})", flush=True)
                if why == "nao encontrado":
                    db.call(f"{table}?id=eq.{row['id']}", "PATCH", {"cnpj_source": "BrasilAPI: CNPJ nao encontrado"})
                    continue
                break  # fora do ar: espera e recomeça
            update = receita_fields(data)
            contact, role = ("responsible_name", "contact_role") if table == "clients" else ("contact_name", "contact_role")
            update.update(fill_gaps(row, data, contact, role))
            if table == "clients" and data.get("razao_social"):
                update["name"] = update["corporate_name"] = data["razao_social"]
            if table == "suppliers" and data.get("razao_social"):
                update["name"] = data["razao_social"]
            previous = row.get("cnpj_source") or ""
            update["cnpj_source"] = "BrasilAPI + cnpj.ws (Receita Federal)" if "cnpj.ws" in previous else "BrasilAPI (Receita Federal)"
            update["cnpj_consulted_at"] = datetime.datetime.utcnow().isoformat() + "Z"
            db.call(f"{table}?id=eq.{row['id']}", "PATCH", update)
            done += 1
            progressed = True
            print(f"{datetime.datetime.now():%H:%M} {table[:-1]:8} {row['document']} {data.get('razao_social', '')[:40]}: atualizado ({len(update)} campos)", flush=True)
            time.sleep(4)  # aos poucos
        if not pending(db):
            continue
        if time.time() > deadline:
            print(f"Tempo maximo atingido; completados {done}; restam {len(pending(db))}.", flush=True)
            return
        if not progressed:
            print(f"aguardando {args.intervalo} min para tentar de novo ({len(pending(db))} pendente(s))...", flush=True)
            time.sleep(args.intervalo * 60)


if __name__ == "__main__":
    main()
