# Engenharia paramétrica e configurador de carretas

Script: `scripts/225_engenharia_parametrica.sql` (aditivo, idempotente, depende do 224). Testes: `scripts/tests-sql/etapa8.test.mjs`.

## Modelo
- **Revisão de engenharia** por produto (Rascunho → Em validação → Validada → Obsoleta). Só uma Validada por produto; revisão validada é imutável (nova revisão = cópia).
- **Parâmetros** (comprimento, largura, altura...) com unidade, escopo (externa/útil), passo, e **fonte documental obrigatória** (CCT, desenho, CAT...). Limites adotados só existem após decisão registrada da engenharia.
- **Pendências de engenharia**: conflito entre documentos é detectado, nunca resolvido sozinho; bloqueia a validação.
- **Opções, regras de compatibilidade e fórmulas**: fórmulas são árvores JSON avaliadas no banco (sem código arbitrário), versionadas e com aprovação (admin/gerente) antes da validação.
- **Configurador** (`product_configure`): valida limites/passo/carga/regras, calcula kits, materiais, plano de corte, custo e preço (base + opções), alerta de margem mínima; status Válida / Requer análise técnica / Fora dos limites / Inválida. Não altera preço automaticamente.
- **Congelamento**: ao ganhar/confirmar, a configuração é congelada e usada no pedido, PDF, ordem de produção, ficha de fabricação e documentação veicular. Mudança só por revisão controlada.

## Caso piloto FZ 1E
O CCT (largura 1000–2000, altura 500–2500) diverge do desenho (largura até 2300, altura até 2200). O sistema registra 2 pendências e **não publica nada como homologado**; o configurador usa o limite mais restritivo e envia para análise técnica até a engenharia decidir.
Falta cadastrar: valores padrão e passo, escopo das dimensões, regras, fórmulas, opções, memorial descritivo, CAD e anexos originais.

## Limitações conhecidas
- Sem perfil "engenharia" separado (usa admin/gerente).
- Mão de obra fixa na estrutura; preço não varia por medida (sem política de preço).
- Desenho 2D é ilustrativo (3D não implementado). Lote SERPRO não implementado.
- Quantidades de subkits sem fórmula; PDF do pedido não verificado visualmente.
