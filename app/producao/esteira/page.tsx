import { redirect } from "next/navigation"

// a esteira agora é uma aba da página Produção
export default function Page() {
  redirect("/producao?aba=esteira")
}
