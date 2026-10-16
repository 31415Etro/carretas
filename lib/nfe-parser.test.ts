import assert from "node:assert/strict"
import test from "node:test"
import { counterpartOf, dedupeKey, findAccessKey, invoiceTitles, isValidAccessKey, parseInvoicePdfText, parseInvoiceXml, roleWarnings } from "./nfe-parser.ts"

const key = "42251011222333000181550010000012341123456780"
const nfe = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${key}" versao="4.00">
<ide><cUF>42</cUF><natOp>VENDA DE PRODUCAO</natOp><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2025-10-05T10:00:00-03:00</dhEmi></ide>
<emit><CNPJ>11222333000181</CNPJ><xNome>FORNECEDOR &amp; CIA LTDA</xNome><xFant>FORN</xFant>
<enderEmit><xLgr>RUA DAS FLORES</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><cMun>4202404</cMun><xMun>BLUMENAU</xMun><UF>SC</UF><CEP>89010000</CEP><fone>4733334444</fone></enderEmit><IE>255123456</IE></emit>
<dest><CNPJ>00000000000191</CNPJ><xNome>CARRETAS INDUSTRIA LTDA</xNome>
<enderDest><xLgr>AV BRASIL</xLgr><nro>500</nro><xCpl>SALA 2</xCpl><xBairro>BOM RETIRO</xBairro><xMun>CHAPECO</xMun><UF>SC</UF><CEP>89800000</CEP></enderDest><indIEDest>1</indIEDest><IE>254999999</IE><email>COMPRAS@CARRETAS.COM</email></dest>
<det nItem="1"><prod><cProd>A1</cProd><xProd>EIXO</xProd><NCM>87169090</NCM><CFOP>5101</CFOP><uCom>UN</uCom><qCom>2.0000</qCom><vUnCom>150.50</vUnCom><vProd>301.00</vProd></prod></det>
<total><ICMSTot><vProd>301.00</vProd><vNF>301.00</vNF></ICMSTot></total>
<cobr><dup><nDup>001</nDup><dVenc>2025-11-05</dVenc><vDup>150.50</vDup></dup><dup><nDup>002</nDup><dVenc>2025-12-05</dVenc><vDup>150.50</vDup></dup></cobr>
</infNFe></NFe><protNFe><infProt><chNFe>${key}</chNFe></infProt></protNFe></nfeProc>`

test("lê NF-e: partes, itens, duplicatas e chave", () => {
  const invoice = parseInvoiceXml(nfe)
  assert.equal(invoice.kind, "NF-e")
  assert.equal(invoice.accessKey, key)
  assert.equal(invoice.number, "1234")
  assert.equal(invoice.total, 301)
  assert.equal(invoice.issuer?.document, "11.222.333/0001-81")
  assert.equal(invoice.issuer?.name, "FORNECEDOR & CIA LTDA")
  assert.equal(invoice.issuer?.phone, "(47) 3333-4444")
  assert.equal(invoice.issuer?.zipCode, "89010-000")
  assert.equal(invoice.recipient?.email, "compras@carretas.com")
  assert.equal(invoice.recipient?.icmsIndicator, "1")
  assert.equal(invoice.items.length, 1)
  assert.equal(invoice.items[0].quantity, 2)
  assert.deepEqual(invoice.installments.map((item) => item.amount), [150.5, 150.5])
})

test("parte contrária: remetente → destinatário; destinatário → emitente", () => {
  const invoice = parseInvoiceXml(nfe)
  assert.equal(counterpartOf(invoice, "remetente")?.document, "00.000.000/0001-91")
  assert.equal(counterpartOf(invoice, "destinatario")?.document, "11.222.333/0001-81")
})

test("avisa quando o papel escolhido não bate com o CNPJ da empresa", () => {
  const invoice = parseInvoiceXml(nfe)
  assert.deepEqual(roleWarnings(invoice, "destinatario", "00.000.000/0001-91"), [])
  assert.match(roleWarnings(invoice, "remetente", "00.000.000/0001-91")[0], /destinatário desta nota é a sua empresa/)
  assert.deepEqual(roleWarnings(invoice, "remetente", ""), [])
  assert.equal(dedupeKey(invoice), key)
})

test("lê NFS-e ABRASF", () => {
  const xml = `<CompNfse><Nfse><InfNfse><Numero>77</Numero><DataEmissao>2025-10-02T08:00:00</DataEmissao>
  <Servico><Valores><ValorServicos>1000.00</ValorServicos></Valores><Discriminacao>Manutencao</Discriminacao></Servico>
  <PrestadorServico><IdentificacaoPrestador><CpfCnpj><Cnpj>11222333000181</Cnpj></CpfCnpj></IdentificacaoPrestador><RazaoSocial>PRESTADOR LTDA</RazaoSocial></PrestadorServico>
  <TomadorServico><IdentificacaoTomador><CpfCnpj><Cnpj>00000000000191</Cnpj></CpfCnpj></IdentificacaoTomador><RazaoSocial>TOMADOR SA</RazaoSocial><Endereco><Endereco>RUA X</Endereco><Numero>5</Numero><Bairro>CENTRO</Bairro><Uf>SC</Uf><Cep>89800000</Cep></Endereco></TomadorServico>
  </InfNfse></Nfse></CompNfse>`
  const invoice = parseInvoiceXml(xml)
  assert.equal(invoice.kind, "NFS-e")
  assert.equal(invoice.total, 1000)
  assert.equal(invoice.issuer?.name, "PRESTADOR LTDA")
  assert.equal(invoice.recipient?.document, "00.000.000/0001-91")
  assert.equal(invoice.recipient?.street, "RUA X")
})

test("PDF: chave de acesso dá o emitente e o outro CNPJ é o destinatário", () => {
  const spaced = key.replace(/(\d{4})/g, "$1 ").trim()
  const invoice = parseInvoicePdfText(`DANFE Chave de acesso ${spaced} Destinatário CNPJ 00.000.000/0001-91 outro`)
  assert.equal(invoice.accessKey, key)
  assert.equal(invoice.issuer?.document, "11.222.333/0001-81")
  assert.equal(invoice.recipient?.document, "00.000.000/0001-91")
  assert.equal(invoice.number, "1234")
})

test("rejeita XML que não é nota e CT-e", () => {
  assert.throws(() => parseInvoiceXml("<a><b>1</b></a>"), /Não reconheci/)
  assert.throws(() => parseInvoiceXml("<cteProc><CTe><infCte/></CTe></cteProc>"), /CT-e/)
})

test("parcelas a lançar: duplicatas da nota ou uma parcela com o total", () => {
  const invoice = parseInvoiceXml(nfe)
  assert.deepEqual(invoiceTitles(invoice).map((item) => [item.number, item.count, item.dueDate, item.amount]), [[1, 2, "2025-11-05", 150.5], [2, 2, "2025-12-05", 150.5]])
  assert.deepEqual(invoiceTitles({ installments: [], total: 99.9, issuedAt: "2025-10-05T10:00:00-03:00" }), [{ number: 1, count: 1, dueDate: "2025-10-05", amount: 99.9 }])
  assert.deepEqual(invoiceTitles({ installments: [], total: 0, issuedAt: "2025-10-05" }), [])
})

// Trecho real de OCR de uma foto de DANFE (com os erros típicos do OCR: "TATURA", dígitos trocados, colunas misturadas)
const ocrDanfe = `| FTAJAI-SC 0- ENTRADA
| FONE: 4712649242 CEP: RRJ0$-130 1- SAÍDA 4226 1029 4519 1700 0194 5500 1000 0023 4710 0004 6859
| N: 000.002.347 FINALIDADE EMISSÃO: |-NF-E NORMAL
NATUREZA DA OPERAÇÃO PROTOCOLO Nh AUTORIZAÇÃO DF USO =
VENDA A PRAZO 242260481941111 09/10/2026 10:28:13-03:00
INSCRIÇÃO ESTADUAL , INSCR, ESTADUAL DO BUAST, TRIBUT, Ê CNPS
258559381 29.451.917/0001-94
OESTINATARIO/ REMETENTE SE Do A ego E ee
NOMPIRAZÃO SOCIAL CNPICTF DATA DA MISSÃO
ND CARRETAS FORT-LTDA 31.690.385/0001-90 09/10/2026
TATURA o p= Ê o O
| 001 05/11/2026 1.555,00 002 21/11/2026 1.555,00
CALCULO DO IMPOSTO
WASE DE CALCULO DO ICMS VALOR DO ICMS | BASE CÁLCULO ICMS ST VALOR ICMS SUDSTITUIÇÃO VALOR DO IPI DEVOL VALOR TOTAL DOS PRODUTOS
0,00 0.00 0,00 0,00 0,00 3.110,00
COI THINNER MAXUIBLT 38140090 | D101) 5102] UN 4,0000 290,00) 1160.00 0.00 0.00! 0.00] 0.00] 0,00
| SANA TOSK 60050 KI PU AMARELO SEGURANCA 3,6L 32081010] 0101] 5102 | UN 30000 190,00 [170,00 0.00 | UUO] 0,00] 0,00] 0,00`

test("foto de DANFE (OCR): chave validada, número, data, total e parcelas", () => {
  const invoice = parseInvoicePdfText(ocrDanfe, { ocr: true })
  assert.equal(invoice.accessKey, "42261029451917000194550010000023471000046859")
  assert.equal(invoice.number, "2347")
  assert.equal(invoice.series, "1")
  assert.equal(invoice.issuedAt, "2026-10-09")
  assert.equal(invoice.total, 3110)
  assert.equal(invoice.nature, "VENDA A PRAZO")
  assert.equal(invoice.issuer?.document, "29.451.917/0001-94")
  assert.equal(invoice.recipient?.document, "31.690.385/0001-90")
  assert.deepEqual(invoice.installments.map((item) => [item.dueDate, item.amount]), [["2026-11-05", 1555], ["2026-11-21", 1555]])
  // linha de item com dígito errado no OCR não é listada; a boa é
  assert.equal(invoice.items.length, 1)
  assert.match(invoice.warnings.join(" "), /OCR/)
})

test("chave com um dígito errado no OCR é corrigida pelo dígito verificador", () => {
  const wrong = "42261029451917000194550010000023471000046859".replace("0023471", "0023411")
  const found = findAccessKey(`N: 000.002.347 emissao 09/10/2026
chave ${wrong.replace(/(\d{4})/g, "$1 ")}`)
  assert.equal(found?.key, "42261029451917000194550010000023471000046859")
  assert.equal(found?.repaired, true)
  assert.equal(isValidAccessKey("42261029451917000194550010000023471000046858"), false)
})
