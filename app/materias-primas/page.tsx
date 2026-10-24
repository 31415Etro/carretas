import { redirect } from "next/navigation"

// o estoque agora é uma página só com abas
export default function Page() {
  redirect("/estoque-interno?aba=materias-primas")
}
