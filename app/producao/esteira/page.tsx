import { redirect } from "next/navigation"

// a esteira agora é uma área da Central de Produção
export default function Page() {
  redirect("/producao?area=esteira")
}
