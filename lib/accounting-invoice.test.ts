import assert from "node:assert/strict"
import test from "node:test"
import { aggregateMaterials, parseAccountingXml } from "./accounting-invoice.ts"

const base = "3526070000000100019955001000001234100000012"
const digit = (() => { const weights = [2, 3, 4, 5, 6, 7, 8, 9]; let sum = 0; for (let i = 0; i < 43; i++) sum += Number(base[42 - i]) * weights[i % 8]; const r = sum % 11; return r < 2 ? 0 : 11 - r })()
const key = `${base}${digit}`

export const XML = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${key}" versao="4.00">
<ide><cUF>35</cUF><natOp>VENDA DE MERCADORIA</natOp><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-07-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF><idDest>2</idDest><tpAmb>1</tpAmb><finNFe>1</finNFe><indFinal>0</indFinal><indPres>1</indPres></ide>
<emit><CNPJ>00000001000199</CNPJ><xNome>ACO FORTE LTDA</xNome><enderEmit><xLgr>Rua A</xLgr><nro>10</nro><xBairro>Centro</xBairro><cMun>3550308</cMun><xMun>Sao Paulo</xMun><UF>SP</UF><CEP>01001000</CEP></enderEmit><IE>111222333</IE><CRT>3</CRT></emit>
<dest><CNPJ>11222333000181</CNPJ><xNome>ND CARRETAS</xNome><enderDest><xMun>Itajai</xMun><UF>SC</UF></enderDest><indIEDest>1</indIEDest></dest>
<det nItem="1"><prod><cProd>A1</cProd><cEAN>SEM GTIN</cEAN><xProd>CHAPA DE ACO 3MM</xProd><NCM>72085100</NCM><CFOP>6101</CFOP><uCom>KG</uCom><qCom>100.0000</qCom><vUnCom>10.0000</vUnCom><vProd>1000.00</vProd></prod>
<imposto><vTotTrib>230.00</vTotTrib><ICMS><ICMS00><orig>0</orig><CST>00</CST><modBC>3</modBC><vBC>1000.00</vBC><pICMS>12.00</pICMS><vICMS>120.00</vICMS></ICMS00></ICMS>
<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>1000.00</vBC><pIPI>5.00</pIPI><vIPI>50.00</vIPI></IPITrib></IPI>
<PIS><PISAliq><CST>01</CST><vBC>1000.00</vBC><pPIS>1.65</pPIS><vPIS>16.50</vPIS></PISAliq></PIS>
<COFINS><COFINSAliq><CST>01</CST><vBC>1000.00</vBC><pCOFINS>7.60</pCOFINS><vCOFINS>76.00</vCOFINS></COFINSAliq></COFINS></imposto></det>
<det nItem="2"><prod><cProd>B2</cProd><xProd>PARAFUSO</xProd><NCM>73181500</NCM><CFOP>6101</CFOP><uCom>UN</uCom><qCom>10.0000</qCom><vUnCom>2.0000</vUnCom><vProd>20.00</vProd></prod>
<imposto><ICMS><ICMSSN101><orig>0</orig><CSOSN>101</CSOSN></ICMSSN101></ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS></imposto></det>
<total><ICMSTot><vBC>1000.00</vBC><vICMS>120.00</vICMS><vICMSDeson>0.00</vICMSDeson><vST>0.00</vST><vProd>1020.00</vProd><vFrete>30.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>50.00</vIPI><vPIS>16.50</vPIS><vCOFINS>76.00</vCOFINS><vOutro>0.00</vOutro><vNF>1100.00</vNF><vTotTrib>230.00</vTotTrib></ICMSTot></total>
<transp><modFrete>0</modFrete><transporta><xNome>TRANSP X</xNome><CNPJ>99999999000191</CNPJ></transporta><veicTransp><placa>ABC1D23</placa></veicTransp><vol><qVol>2</qVol><pesoB>110.5</pesoB></vol></transp>
<cobr><dup><nDup>001</nDup><dVenc>2026-08-10</dVenc><vDup>550.00</vDup></dup><dup><nDup>002</nDup><dVenc>2026-09-10</dVenc><vDup>550.00</vDup></dup></cobr>
<pag><detPag><tPag>15</tPag><vPag>1100.00</vPag></detPag></pag>
<infAdic><infCpl>Pedido 77</infCpl></infAdic></infNFe></NFe><protNFe><infProt><nProt>135260000000001</nProt><chNFe>${key}</chNFe><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>`

test("nota completa: totais, impostos por item, transporte, cobrança e todos os campos", () => {
  const nf = parseAccountingXml(XML)
  assert.equal(nf.kind, "NF-e")
  assert.equal(nf.number, "1234")
  assert.equal(nf.totals.invoice, 1100)
  assert.equal(nf.totals.icms, 120)
  assert.equal(nf.totals.ipi, 50)
  assert.equal(nf.totals.pis, 16.5)
  assert.equal(nf.totals.cofins, 76)
  assert.equal(nf.totals.freight, 30)
  assert.equal(nf.totals.totalTaxes, 230)
  assert.equal(nf.items.length, 2)
  const [first, second] = nf.items
  assert.equal(first.icms.cst, "00"); assert.equal(first.icms.rate, 12); assert.equal(first.icms.amount, 120)
  assert.equal(first.ipi.amount, 50); assert.equal(first.pis.rate, 1.65); assert.equal(first.cofins.amount, 76)
  assert.equal(second.icms.cst, "101"); assert.equal(second.pis.cst, "07"); assert.equal(second.ipi.amount, 0)
  assert.equal(first.ean, "")
  assert.equal(nf.issuer.name, "ACO FORTE LTDA"); assert.equal(nf.issuer.state, "SP"); assert.equal(nf.issuer.taxRegime, "3")
  assert.equal(nf.recipient.state, "SC")
  assert.equal(nf.protocol, "135260000000001"); assert.equal(nf.protocolStatus, "100")
  assert.equal(nf.transport.carrierName, "TRANSP X"); assert.equal(nf.transport.plate, "ABC1D23")
  assert.equal(nf.installments.length, 2); assert.equal(nf.payments[0].amount, 1100)
  assert.equal(nf.additionalInfo, "Pedido 77")
  assert.ok(nf.fields.some(([path, value]) => path.includes("det[1]/prod/xProd") && value === "CHAPA DE ACO 3MM"))
  assert.ok(nf.fields.some(([path]) => path.includes("det[2]/imposto/ICMS/ICMSSN101/CSOSN")))
})

test("materiais comprados: soma por produto entre notas", () => {
  const nf = parseAccountingXml(XML)
  const rows = aggregateMaterials([{ number: "1", issuedAt: "", issuerName: "A", items: nf.items }, { number: "2", issuedAt: "", issuerName: "B", items: nf.items }])
  const plate = rows.find((row) => row.code === "A1")!
  assert.equal(plate.quantity, 200); assert.equal(plate.total, 2000); assert.equal(plate.notes, 2); assert.equal(plate.averagePrice, 10); assert.equal(plate.icms, 240); assert.deepEqual(plate.suppliers, ["A", "B"])
})
