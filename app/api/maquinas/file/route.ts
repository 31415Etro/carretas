import { NextResponse } from "next/server"
import { machineError, machinesContext, signedFileUrl, uploadFile } from "@/lib/machines-server"

/** Abre foto ou documento (URL assinada de 5 min), só se o arquivo pertencer a uma máquina desta empresa e o usuário puder vê-lo. */
export async function GET(request: Request) {
  const context = await machinesContext()
  if (context instanceof NextResponse) return context
  try {
    return NextResponse.redirect(await signedFileUrl(context, new URL(request.url).searchParams.get("path") || ""))
  } catch (error) {
    return machineError(error, "Erro ao abrir o arquivo.")
  }
}

/** Envia foto ou documento (JPG, PNG, WEBP ou PDF até 20 MB) para o armazenamento privado da empresa. */
export async function POST(request: Request) {
  const context = await machinesContext()
  if (context instanceof NextResponse) return context
  try {
    return NextResponse.json(await uploadFile(context, await request.formData()))
  } catch (error) {
    return machineError(error, "Erro ao enviar o arquivo.")
  }
}
