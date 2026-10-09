"use client"

import { useEffect } from "react"

const replacements: Array<[RegExp, string]> = [
  [/Ã§/g, "ç"],
  [/Ã£/g, "ã"],
  [/Ã¡/g, "á"],
  [/Ã¢/g, "â"],
  [/Ã©/g, "é"],
  [/Ãª/g, "ê"],
  [/Ã­/g, "í"],
  [/Ã³/g, "ó"],
  [/Ã´/g, "ô"],
  [/Ãµ/g, "õ"],
  [/Ãº/g, "ú"],
  [/Ã‡/g, "Ç"],
  [/Ãƒ/g, "Ã"],
  [/\bConfiguracoes\b/g, "Configurações"],
  [/\bConfiguracao\b/g, "Configuração"],
  [/\bUsuarios\b/g, "Usuários"],
  [/\busuarios\b/g, "usuários"],
  [/\bpermissoes\b/g, "permissões"],
  [/\bPermissoes\b/g, "Permissões"],
  [/\bServicos\b/g, "Serviços"],
  [/\bServicos\b/g, "Serviços"],
  [/\bservicos\b/g, "serviços"],
  [/\bServico\b/g, "Serviço"],
  [/\bservico\b/g, "serviço"],
  [/\bOrdens de Servico\b/g, "Ordens de Serviço"],
  [/\bordem de servico\b/g, "ordem de serviço"],
  [/\bOrdem de Servico\b/g, "Ordem de Serviço"],
  [/\bTipo de Servico\b/g, "Tipo de Serviço"],
  [/\bTipo de servico\b/g, "Tipo de serviço"],
  [/\bVisao\b/g, "Visão"],
  [/\bvisao\b/g, "visão"],
  [/\bSaidas\b/g, "Saídas"],
  [/\bsaidas\b/g, "saídas"],
  [/\bCartao\b/g, "Cartão"],
  [/\bcartao\b/g, "cartão"],
  [/\bCredito\b/g, "Crédito"],
  [/\bcredito\b/g, "crédito"],
  [/\bImportacao\b/g, "Importação"],
  [/\bimportacao\b/g, "importação"],
  [/\bImportacoes\b/g, "Importações"],
  [/\bimportacoes\b/g, "importações"],
  [/\bLancamentos\b/g, "Lançamentos"],
  [/\blancamentos\b/g, "lançamentos"],
  [/\bLancamento\b/g, "Lançamento"],
  [/\blancamento\b/g, "lançamento"],
  [/\bDescricao\b/g, "Descrição"],
  [/\bdescricao\b/g, "descrição"],
  [/\bObservacao\b/g, "Observação"],
  [/\bobservacao\b/g, "observação"],
  [/\bObservacoes\b/g, "Observações"],
  [/\bobservacoes\b/g, "observações"],
  [/\bAcoes\b/g, "Ações"],
  [/\bacoes\b/g, "ações"],
  [/\bAcao\b/g, "Ação"],
  [/\bacao\b/g, "ação"],
  [/\bEndereco\b/g, "Endereço"],
  [/\bendereco\b/g, "endereço"],
  [/\bVeiculos\b/g, "Veículos"],
  [/\bveiculos\b/g, "veículos"],
  [/\bVeiculo\b/g, "Veículo"],
  [/\bveiculo\b/g, "veículo"],
  [/\bManutencao\b/g, "Manutenção"],
  [/\bmanutencao\b/g, "manutenção"],
  [/\bOperacao\b/g, "Operação"],
  [/\boperacao\b/g, "operação"],
  [/\bOrcamento\b/g, "Orçamento"],
  [/\borcamento\b/g, "orçamento"],
  [/\bRelatorios\b/g, "Relatórios"],
  [/\brelatorios\b/g, "relatórios"],
  [/\bHistorico\b/g, "Histórico"],
  [/\bhistorico\b/g, "histórico"],
  [/\bPrevia\b/g, "Prévia"],
  [/\bprevia\b/g, "prévia"],
  [/\bConfianca\b/g, "Confiança"],
  [/\bconfianca\b/g, "confiança"],
  [/\bComparacao\b/g, "Comparação"],
  [/\bcomparacao\b/g, "comparação"],
  [/\bCompetencia\b/g, "Competência"],
  [/\bcompetencia\b/g, "competência"],
  [/\bConferencia\b/g, "Conferência"],
  [/\bconferencia\b/g, "conferência"],
  [/\bMes\b/g, "Mês"],
  [/\bmes\b/g, "mês"],
  [/\bNumero\b/g, "Número"],
  [/\bnumero\b/g, "número"],
  [/\bNao\b/g, "Não"],
  [/\bnao\b/g, "não"],
  [/\bSao\b/g, "São"],
  [/\bsao\b/g, "são"],
  [/\bProxima\b/g, "Próxima"],
  [/\bproxima\b/g, "próxima"],
  [/\bPublico\b/g, "Público"],
  [/\bpublico\b/g, "público"],
  [/\bFormulario\b/g, "Formulário"],
  [/\bformulario\b/g, "formulário"],
  [/\bPadrao\b/g, "Padrão"],
  [/\bpadrao\b/g, "padrão"],
  [/\bObrigatoria\b/g, "Obrigatória"],
  [/\bobrigatoria\b/g, "obrigatória"],
  [/\bObrigatorias\b/g, "Obrigatórias"],
  [/\bobrigatorias\b/g, "obrigatórias"],
  [/\bDisponivel\b/g, "Disponível"],
  [/\bdisponivel\b/g, "disponível"],
  [/\bExecucao\b/g, "Execução"],
  [/\bexecucao\b/g, "execução"],
  [/\bConcluidas\b/g, "Concluídas"],
  [/\bconcluidas\b/g, "concluídas"],
  [/\bConcluida\b/g, "Concluída"],
  [/\bconcluida\b/g, "concluída"],
  [/\bEvidencias\b/g, "Evidências"],
  [/\bevidencias\b/g, "evidências"],
  [/\bRelatorio\b/g, "Relatório"],
  [/\brelatorio\b/g, "relatório"],
  [/\bExportacao\b/g, "Exportação"],
  [/\bexportacao\b/g, "exportação"],
  [/\bSelecao\b/g, "Seleção"],
  [/\bselecao\b/g, "seleção"],
  [/\bSelecione\b/g, "Selecione"],
  [/\bMarcar selecao\b/g, "Marcar seleção"],
  [/\bLimpar selecao\b/g, "Limpar seleção"],
  [/\bConfirmar importacao\b/g, "Confirmar importação"],
  [/\bBaixar previa\b/g, "Baixar prévia"],
  [/\bcartoes\b/g, "cartões"],
  [/\bCartoes\b/g, "Cartões"],
  [/\bDiferenca\b/g, "Diferença"],
  [/\bdiferenca\b/g, "diferença"],
  [/\bcelula\b/g, "célula"],
  [/\bCelula\b/g, "Célula"],
  [/\bposicao\b/g, "posição"],
  [/\bPosicao\b/g, "Posição"],
  [/\bReferencia\b/g, "Referência"],
  [/\breferencia\b/g, "referência"],
  [/\bMetodo\b/g, "Método"],
  [/\bmetodo\b/g, "método"],
  [/\bdefinicao\b/g, "definição"],
  [/\bDefinicao\b/g, "Definição"],
  [/\bfevereiro\b/g, "Fevereiro"],
  [/\bMarco\b/g, "Março"],
  [/\bmarco\b/g, "março"],
]

function normalizeText(value: string) {
  return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
}

function normalizeNode(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement
      if (!parent || ["SCRIPT", "STYLE", "TEXTAREA", "CODE", "PRE"].includes(parent.tagName)) {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const textNodes: Text[] = []
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text)

  textNodes.forEach((node) => {
    const next = normalizeText(node.nodeValue || "")
    if (next !== node.nodeValue) node.nodeValue = next
  })

  if (root instanceof Element) {
    const elements = [root, ...Array.from(root.querySelectorAll<HTMLElement>("input, textarea, [title], [aria-label], [placeholder]"))]
    elements.forEach((element) => {
      ;(["placeholder", "title", "aria-label"] as const).forEach((attribute) => {
        const current = element.getAttribute(attribute)
        if (!current) return
        const next = normalizeText(current)
        if (next !== current) element.setAttribute(attribute, next)
      })
    })
  }
}

export function TextNormalizer() {
  useEffect(() => {
    const pending = new Set<Node>([document.body])
    let scheduled = false

    const flush = () => {
      scheduled = false
      const roots = [...pending]
      pending.clear()
      roots.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const textNode = node as Text
          const next = normalizeText(textNode.nodeValue || "")
          if (next !== textNode.nodeValue) textNode.nodeValue = next
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          normalizeNode(node as Element)
        }
      })
    }

    const schedule = () => {
      if (scheduled) return
      scheduled = true
      if ("requestIdleCallback" in window) {
        window.requestIdleCallback(flush, { timeout: 250 })
      } else {
        window.setTimeout(flush, 16)
      }
    }

    schedule()

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => pending.add(node))
      })
      schedule()
    })

    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  return null
}
