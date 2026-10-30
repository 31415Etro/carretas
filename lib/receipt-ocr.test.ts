import assert from "node:assert/strict"
import test from "node:test"
import { categorizeReceipt, parseReceiptText, pickReceiptText } from "./receipt-ocr.ts"

test("lê valor total, data e estabelecimento de um cupom de posto", () => {
  const text = "POSTO IPIRANGA LTDA\nCNPJ 12.345.678/0001-90\nRUA DAS FLORES 100\nDATA 05/03/2026\nGASOLINA COMUM 10,000 L\nVALOR TOTAL\n150,00"
  const result = parseReceiptText(text)
  assert.equal(result.amount, 150)
  assert.equal(result.occurredAt, "2026-03-05")
  assert.equal(result.category, "Combustivel")
  assert.match(result.establishment, /POSTO IPIRANGA/i)
})

test("sem rótulo de total: usa o maior valor e avisa", () => {
  const result = parseReceiptText("RESTAURANTE BOM SABOR\n10/01/2026\nAGUA 5,00\nPRATO FEITO 35,00")
  assert.equal(result.amount, 35)
  assert.ok(result.warnings.some((warning) => /total/i.test(warning)))
})

test("categoriza por palavra-chave", () => {
  assert.equal(categorizeReceipt("HOTEL CENTRAL - DIARIA"), "Hospedagem")
  assert.equal(categorizeReceipt("UBER VIAGEM SP"), "Transporte")
  assert.equal(categorizeReceipt("ESTACIONAMENTO ESTAPAR"), "Estacionamento")
  assert.equal(categorizeReceipt("PRACA DE PEDAGIO SEM PARAR"), "Pedagio")
  assert.equal(categorizeReceipt("LOJA DE ROUPAS XYZ"), "Outros")
})

test("sem data legível: usa hoje e avisa", () => {
  const result = parseReceiptText("MERCADO BOM PRECO\nTOTAL\n42,90")
  assert.equal(result.occurredAt, new Date().toISOString().slice(0, 10))
  assert.ok(result.warnings.some((warning) => /data/i.test(warning)))
  assert.equal(result.category, "Alimentacao")
})

test("categoria: nome do estabelecimento pesa e números soltos não enganam", () => {
  assert.equal(categorizeReceipt("RESTAURANTE SABOR CASEIRO\nCNPJ 12.345.678/0001-95\nPRATO FEITO 29,99\nTOTAL 29,99"), "Alimentacao")
  assert.equal(categorizeReceipt("AUTO POSTO BR 101\nDIESEL S10 45,3 LITROS\nTOTAL 299,99"), "Combustivel")
  assert.equal(categorizeReceipt("SUPERMERCADO BOM PRECO\nARROZ 28,90\nCAFE 22,30\nTOTAL 68,45"), "Alimentacao")
  assert.equal(categorizeReceipt("HOTEL PALACE\nDIARIA 1 NOITE 99,00\nTOTAL 99,00"), "Hospedagem")
  assert.equal(categorizeReceipt("CCR AUTOPISTA LITORAL SUL\nPRACA DE PEDAGIO P3\nTOTAL 12,90"), "Pedagio")
  assert.equal(categorizeReceipt("PREDIAL SERVICOS\nTOTAL 99,90"), "Outros")
})

test("DANFE simplificado de posto (valor em coluna separada do rótulo): total pago - troco", () => {
  const text = "CNPJ: 09.273.885/0021-10 VIA MAIS REDE DE POSTOS S.A. - F\nROD. BR 101, 285 - VILA NOVA - ICARA - SC\nDocumento Auxiliar de Nota Fiscal Eletrônica\nDANFE Simplificado\nCODIGO DESCRICAO QTDE UN VL UNIT VL TOTAL\n2966 OLEO DIESEL S10 85.521 L X 6.940 593,52\nQTDE. TOTAL DE ITENS\nVALOR TOTAL R$\nFORMA DE PAGAMENTO\nDinheiro\nTroco\n001\n593,51\nVALOR PAGO R$\n600,00\n6,49\nNF-e n 000011652 Serie 001 29/10/2026 09:00\nTrib aprox R$147,19"
  const result = parseReceiptText(text)
  assert.equal(result.amount, 593.51)
  assert.equal(result.occurredAt, "2026-10-29")
  assert.equal(result.category, "Combustivel")
  assert.match(result.establishment, /VIA MAIS REDE DE POSTOS/i)
})

test("DANFE simplificado com três itens: valor total, não o dinheiro entregue", () => {
  const text = "CNPJ: 09.273.885/0021-10 VIA MAIS REDE DE POSTOS S.A.\nDANFE Simplificado\n14741 ENERG RED BULL SE 1.000 UN X 14.990 14,99\n14468 BAURU 1.000 UN X 10.990 10,99\n4063 CHICLE MENTOS PUR 1.000 UN X 3.990 3,99\nQTDE. TOTAL DE ITENS 003\nVALOR TOTAL R$ 29,97\nFORMA DE PAGAMENTO VALOR PAGO R$\nDinheiro 100,00\nTroco 70,03\n29/10/2026 09:17"
  const result = parseReceiptText(text)
  assert.equal(result.amount, 29.97)
  assert.equal(result.occurredAt, "2026-10-29")
})

test("OCR com vírgula separada e letra O no lugar do zero", () => {
  assert.equal(parseReceiptText("MERCADO BOM\nTOTAL R$ 1O5 , 90").amount, 105.9)
  assert.equal(parseReceiptText("PADARIA SOL\nVL TOTAL 45 , 90\nPIX").amount, 45.9)
})

test("OCR trocou um dígito do total (593,91 em vez de 593,51): pago - troco corrige", () => {
  const text = "VIA MAIS REDE DE POSTOS S.A.\n2966 OLEO DIESEL S10 85.521 L X 6.940 593,92\nQTDE - TOTAL DE ITENS 001\nVALOR TOTAL R$ 593,91\nFORMA DE PAGAMENTO VALOR PAGO R$\npinheiro 600,00\nTroco 6,49\n29/10/2026"
  const result = parseReceiptText(text)
  assert.equal(result.amount, 593.51)
  assert.equal(result.verified, true)
})

test("sem troco (cartão): é segura quando o total e o pagamento concordam; se discordam, só com mais leituras", () => {
  const a = "POSTO SOL\nTOTAL R$ 120,40\nCARTAO 120,40\n12/10/2026"
  const b = "POSTO SOL\nTOTAL R$ 120,90\nCARTAO 120,40\n12/10/2026"
  assert.equal(pickReceiptText([a]).sure, true) // duas linhas independentes com o mesmo valor
  assert.equal(pickReceiptText([b]).sure, false) // o total e o pagamento discordam: não dá para saber qual está certo
  const both = pickReceiptText([b, a, b])
  assert.equal(both.sure, true)
  assert.equal(parseReceiptText(both.text).amount, 120.4)
})

test("consenso: o OCR errou o dígito do total, mas pago - troco fecha o valor certo", () => {
  const read = "VIA MAIS REDE DE POSTOS\nVALOR TOTAL R$ 43,91\nVALOR PAGO R$\nDinheiro 600,00\nTroco 6,49\n29/10/2026"
  const picked = pickReceiptText([read])
  assert.equal(parseReceiptText(picked.text).amount, 593.51)
  assert.equal(picked.sure, false) // um único rótulo discorda da conta: pede conferência
  const twice = pickReceiptText([read, "VALOR TOTAL R$ 593,51\nDinheiro 600,00\nTroco 6,49"])
  assert.equal(twice.sure, true)
  assert.equal(parseReceiptText(twice.text).amount, 593.51)
})

test("consenso: cupom com a coluna de valores deslocada em relação aos rótulos (rótulo ao lado do valor errado)", () => {
  // impresso assim: 31,45 / Subtotal 2,49 / Desconto 28,96 / Valor Total 100,00 / Forma de Pagamento DINHEIRO 71,04 / Troco
  const read = "GOMA DE MASCAR 3,99\nAGUA FONT 9,99\n31,45\nSubtotal R$ 2,49\nDesconto R$ 28,96\nValor Total R$ 100,00\nForma de Pagamento: DINHEIRO 71,04\nTroco R$"
  const picked = pickReceiptText([read])
  assert.equal(parseReceiptText(picked.text).amount, 28.96) // 31,45 - 2,49 e 100,00 - 71,04 dão o mesmo resultado
})

test("consenso: a conta não pega o troco como se fosse o total", () => {
  const read = "VALOR TOTAL R$ 28,96\nDinheiro 100,00\nTroco 71,04"
  const picked = pickReceiptText([read, "Valor Total R$ 3,99\nDinheiro 100,00\nTroco 71,04"])
  assert.equal(parseReceiptText(picked.text).amount, 28.96)
})
