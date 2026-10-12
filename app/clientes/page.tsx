import { redirect } from "next/navigation"

/** O cadastro de clientes e fornecedores agora fica no módulo Comercial. */
export default function Page() {
  redirect("/comercial")
}
