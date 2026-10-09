const fs = require("node:fs")
const PizZip = require("pizzip")

const templatePath = "public/contract-templates/termo-aditivo.docx"
const zip = new PizZip(fs.readFileSync(templatePath))
let xml = zip.file("word/document.xml").asText()

if (!xml.includes("{technicalInfoBlock}")) {
  const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((match) => match[0])
  const clientQualification = paragraphs.find((paragraph) => paragraph.includes("{razaoSocial}") && paragraph.includes("CONTRATANTE"))
  if (!clientQualification) throw new Error("Qualificação da contratante não encontrada.")
  const technicalParagraph = '<w:p><w:pPr><w:spacing w:before="120" w:after="120"/><w:jc w:val="left"/><w:rPr><w:rFonts w:ascii="Arial Narrow" w:eastAsia="Arial Narrow" w:hAnsi="Arial Narrow" w:cs="Arial Narrow"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial Narrow" w:eastAsia="Arial Narrow" w:hAnsi="Arial Narrow" w:cs="Arial Narrow"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr><w:t>{technicalInfoBlock}</w:t></w:r></w:p>'
  xml = xml.replace(clientQualification, `${clientQualification}${technicalParagraph}`)
}

zip.file("word/document.xml", xml)
fs.writeFileSync(templatePath, zip.generate({ type: "nodebuffer", compression: "DEFLATE" }))
