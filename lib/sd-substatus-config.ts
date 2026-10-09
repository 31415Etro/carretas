import type { SDSubStatus } from "./types"

export const sdSubStatusConfig: Record<
  SDSubStatus,
  { label: string; color: string; bgColor: string; description: string }
> = {
  analise_dados: {
    label: "Análise dos dados",
    color: "#3B82F6",
    bgColor: "#DBEAFE",
    description: "Analyzing client data and requirements",
  },
  elaboracao_layout: {
    label: "Elaboração Layout",
    color: "#8B5CF6",
    bgColor: "#EDE9FE",
    description: "Creating layout design",
  },
  preparando_pc_fpv: {
    label: "Preparando PC + FPV",
    color: "#F59E0B",
    bgColor: "#FEF3C7",
    description: "Preparing PC and FPV documentation",
  },
  elaborando_proposta: {
    label: "Elaborando Proposta",
    color: "#10B981",
    bgColor: "#D1FAE5",
    description: "Developing final proposal",
  },
}
