"""Gera docs/dicionario-de-dados.md a partir das migrações SQL (scripts/base e scripts/2xx_*.sql).

Uso (na raiz do projeto, Python 3.12+):  python scripts/gerar-dicionario-de-dados.py

Para cada tabela lista os campos com tipo, obrigatoriedade, valor padrão e relações/regras (chaves
estrangeiras e checks). Tabelas apagadas pela migração 207 aparecem marcadas como removidas.
"""

import glob
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, "scripts")
OUT = os.path.join(ROOT, "docs", "dicionario-de-dados.md")

CONSTRAINT_STARTS = ("primary key", "unique", "check", "constraint", "foreign key", "exclude", "like")


def split_top_level(body: str):
    parts, depth, current, quote = [], 0, [], False
    for char in body:
        if char == "'":
            quote = not quote
        if not quote:
            if char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
            elif char == "," and depth == 0:
                parts.append("".join(current).strip())
                current = []
                continue
        current.append(char)
    if "".join(current).strip():
        parts.append("".join(current).strip())
    return parts


def strip_comments(sql: str):
    sql = re.sub(r"/\*.*?\*/", "", sql, flags=re.S)
    return re.sub(r"--[^\n]*", "", sql)


def parse_column(definition: str):
    match = re.match(r'"?(\w+)"?\s+(.*)', definition, flags=re.S)
    if not match:
        return None
    name, rest = match.group(1), " ".join(match.group(2).split())
    type_match = re.match(r"(.+?)(?=\s+(not null|null|default|references|check|primary key|unique|generated|constraint)\b|$)", rest, flags=re.I)
    col_type = (type_match.group(1) if type_match else rest).strip()
    required = bool(re.search(r"\bnot null\b|\bprimary key\b", rest, flags=re.I))
    default = re.search(r"\bdefault\s+(.+?)(?=\s+(not null|null|references|check|primary key|unique|constraint)\b|$)", rest, flags=re.I)
    notes = []
    reference = re.search(r"references\s+(?:public\.)?(\w+)\s*\((\w+)\)(?:\s+on delete\s+(\w+(?:\s+\w+)?))?", rest, flags=re.I)
    if reference:
        notes.append(f"→ {reference.group(1)}.{reference.group(2)}" + (f" (on delete {reference.group(3).lower()})" if reference.group(3) else ""))
    check = re.search(r"\bcheck\s*\((.+)\)", rest, flags=re.I)
    if check:
        notes.append("regra: " + check.group(1).strip()[:140])
    if re.search(r"\bprimary key\b", rest, flags=re.I):
        notes.append("chave primária")
    if re.search(r"\bunique\b", rest, flags=re.I):
        notes.append("único")
    return {"name": name, "type": col_type, "required": required, "default": default.group(1).strip() if default else "", "notes": notes}


def main():
    files = sorted(glob.glob(os.path.join(SCRIPTS, "base", "*.sql"))) + sorted(glob.glob(os.path.join(SCRIPTS, "2*_*.sql")))
    tables = {}
    order = []
    dropped = set()

    for path in files:
        origin = os.path.relpath(path, SCRIPTS).replace("\\", "/")
        sql = strip_comments(open(path, encoding="utf-8").read())

        for match in re.finditer(r"create table(?: if not exists)?\s+(?:public\.)?(\w+)\s*\(", sql, flags=re.I):
            name = match.group(1)
            start = match.end()
            depth, index = 1, start
            while index < len(sql) and depth:
                depth += (sql[index] == "(") - (sql[index] == ")")
                index += 1
            body = sql[start:index - 1]
            entry = tables.setdefault(name, {"origin": origin, "columns": {}, "rules": []})
            if name not in order:
                order.append(name)
            for part in split_top_level(body):
                if part.lower().startswith(CONSTRAINT_STARTS):
                    entry["rules"].append(" ".join(part.split())[:200])
                    continue
                column = parse_column(part)
                if column:
                    entry["columns"].setdefault(column["name"], {**column, "origin": origin})

        for match in re.finditer(r"alter table(?: if exists)?(?: only)?\s+(?:public\.)?(\w+)\s+(.*?);", sql, flags=re.I | re.S):
            name, actions = match.group(1), match.group(2)
            entry = tables.get(name)
            if not entry:
                continue
            for action in split_top_level(actions):
                add = re.match(r"add column(?: if not exists)?\s+(.*)", action.strip(), flags=re.I | re.S)
                if add:
                    column = parse_column(add.group(1))
                    if column:
                        entry["columns"].setdefault(column["name"], {**column, "origin": origin})

        for match in re.finditer(r"drop table(?: if exists)?\s+([^;]+);", sql, flags=re.I):
            if origin.startswith("207"):
                for table in re.findall(r"(?:public\.)?(\w+)", match.group(1)):
                    dropped.add(table)

        # criação dinâmica: foreach table_name in array array['a','b'] ... add column / create table dentro de DO
        for block in re.finditer(r"foreach table_name in array array\[(.*?)\]\s*loop(.*?)end loop", sql, flags=re.I | re.S):
            names = re.findall(r"'(\w+)'", block.group(1))
            added = re.findall(r"add column if not exists (\w+) ([^,'\)]+)", block.group(2), flags=re.I)
            for table in names:
                entry = tables.get(table)
                if not entry:
                    continue
                for column_name, column_type in added:
                    entry["columns"].setdefault(column_name, {"name": column_name, "type": column_type.strip(), "required": False, "default": "", "notes": ["adicionada por migração em bloco"], "origin": origin})

    lines = [
        "# Dicionário de dados — ERP Carretas",
        "",
        "Gerado automaticamente por `scripts/gerar-dicionario-de-dados.py` a partir das migrações SQL. **Não edite à mão:** altere a migração e gere de novo.",
        "",
        "Convenções: `uuid` com `gen_random_uuid()` como identificador; datas em `date`/`timestamptz`; valores monetários em `numeric(14,2)`; exclusão lógica por campo de status/ativo (preferida a `delete` quando há histórico financeiro, fiscal ou operacional); tabelas por empresa têm `system_company_id` e RLS por empresa.",
        "",
        f"Total: {len([name for name in order if name not in dropped])} tabelas ativas.",
        "",
    ]
    for name in order:
        entry = tables[name]
        removed = name in dropped
        lines.append(f"## {name}" + (" _(removida pela migração 207)_" if removed else ""))
        lines.append("")
        lines.append(f"Criada em `{entry['origin']}`.")
        lines.append("")
        lines.append("| Campo | Tipo | Obrigatório | Padrão | Relação / regra |")
        lines.append("|---|---|---|---|---|")
        for column in entry["columns"].values():
            notes = "; ".join(column["notes"]).replace("|", "\\|")
            default = column["default"].replace("|", "\\|")
            lines.append(f"| `{column['name']}` | {column['type'].replace('|', '\\|')} | {'sim' if column['required'] else 'não'} | {('`' + default + '`') if default else ''} | {notes} |")
        if entry["rules"]:
            lines.append("")
            lines.append("Regras da tabela: " + "; ".join(f"`{rule}`" for rule in entry["rules"][:6]))
        lines.append("")

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines))
    print(f"{len(order)} tabelas, {sum(len(t['columns']) for t in tables.values())} campos -> {os.path.relpath(OUT, ROOT)}")


if __name__ == "__main__":
    main()
