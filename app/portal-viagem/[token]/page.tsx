import { TravelAdvancePortal } from "@/components/finance/travel-advance-portal"

export const dynamic = "force-dynamic"

// Página pública (sem login): o link enviado ao funcionário para prestar contas da antecipação de reembolso para viagem. Não tem menu nem
// navegação para o resto do sistema de propósito — é uma página isolada, acessada só pelo link com o token.
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <TravelAdvancePortal token={token} />
}
