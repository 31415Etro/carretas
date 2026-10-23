# Fotografias persistentes e Pedido de Venda em PDF

Script: `scripts/226_fotografias_e_pedido_pdf.sql` (aditivo e idempotente; não depende do 225). Testes: `scripts/tests-sql/etapa9.test.mjs` (SQL) e o teste do código de servidor contra o banco local.

## Causa provável das fotos quebradas (auditoria do código)
- O envio gravava em `materials.photo_url` a **URL pública completa** (inclui o endereço do projeto Supabase) de um bucket público criado "na hora". Não havia registro do caminho do arquivo, nem conferência de que o arquivo existia, nem como saber qual foto estava quebrada.
- Qualquer mudança de projeto/endereço, bucket que não existia no ambiente, arquivo apagado ou referência `blob:`/local deixa a imagem quebrada sem que o sistema perceba.
- **Não foi possível confirmar a causa exata nos dados de produção** (não acessei o banco real). A auditoria abaixo mostra, foto a foto, o que existe e o que sumiu.

## Como ficou
- Tabela `product_photos`: caminho definitivo (`bucket` + `path`) em bucket **privado** `product-photos`, finalidade (comercial, detalhe, configuração), legenda, principal, ordem e situação (Disponível, Indisponível, A conferir, Removida). Nada é apagado.
- A tela e as listas usam a URL estável `/api/produtos/foto/<id>`: a rota lê o arquivo pelo registro (exige login). `materials.photo_url` aponta sempre para a foto principal disponível (gatilho), então listas e orçamento continuam funcionando.
- Envio: valida tamanho e **tipo real** (bytes), corrige orientação, reduz para no máximo 2400 px, envia, **confirma que o arquivo existe** e só então grava o caminho; se o cadastro falhar, o arquivo enviado é removido.
- Galeria na aba **Fotografias** do produto: enviar várias, principal, mover, ampliar, remover com motivo (só admin/gerente; o registro e o arquivo ficam guardados). O formulário do produto não envia mais foto (evita sobrescrever a principal).
- Fotografias comerciais ficam separadas dos desenhos e documentos de homologação (aba Engenharia e Homologação).

## Auditoria das fotos antigas (só administrador, em Produtos finais)
1. **Registrar fotos antigas**: cria o registro de auditoria de cada foto já cadastrada; não altera nenhum produto. Referência `blob:`/`data:`/arquivo local vira "Indisponível".
2. **Conferir arquivos**: confere cada arquivo no armazenamento. Existe → "Disponível" e o produto passa a usar o endereço estável. Não existe → "Indisponível": a referência quebrada some das telas, o registro antigo é mantido e o produto pede uma foto nova. Endereço externo que ainda abre fica como está.
Não substitui foto por imagem da internet e não apaga registros.

## Pedido de Venda em PDF
- Modelo da ND Carretas (referência: pedido 0056/2026): título, logotipo, cliente, descrição linha a linha, foto à direita com "FOTO ILUSTRATIVA", acessórios, valor com extenso, entrada, saldo, parcelas, prazo, observações, data e dados da empresa vendedora. Vários produtos e várias páginas.
- Medidas, acabamento, acessórios e desenho vêm da **configuração congelada** da venda, nunca do cadastro atual. O desenho (anexo, uma página por item) sai como ILUSTRATIVO enquanto a revisão não estiver validada; quando validado, informa a revisão.
- Foto: a principal do produto ou uma foto específica escolhida na emissão. Sem foto, o PDF sai sem ela e o aviso informa o motivo.
- Emissão automática ao converter o orçamento em pedido (versão 1). Depois, em Vendas > Pedido em PDF: visualizar, baixar e **emitir nova versão** (exige motivo). Cada versão fica imutável no bucket privado `sales-documents` com SHA-256, foto usada, configuração, revisão técnica, usuário e data.
- O PDF é montado no navegador (o desenho usa fontes do navegador) e enviado ao servidor, que confere o cabeçalho `%PDF`, grava, confirma e registra a versão.

## Limitações conhecidas
- A chave Pix não existe no cadastro da empresa: o PDF mostra só o meio de pagamento negociado.
- Cidade/local do pedido: o cadastro da empresa tem um único campo de endereço; o PDF mostra "Emitido em <data>".
- Se a conversão do orçamento for feita fora da tela (API direta), o PDF não é emitido sozinho; a tela de Vendas mostra "Nenhum PDF emitido" e permite emitir.
- Fotos de kits e matérias-primas continuam com o fluxo antigo (URL pública); só o produto final foi migrado.
