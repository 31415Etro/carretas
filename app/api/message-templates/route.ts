import { getMessageTemplates } from "@/lib/actions/message-templates"
import { NextResponse } from "next/server"

export async function GET() {
  try {
    const templates = await getMessageTemplates()
    return NextResponse.json(templates)
  } catch (error) {
    console.error("[v0] GET /api/message-templates error:", error)
    return NextResponse.json({ error: "Failed to fetch templates" }, { status: 500 })
  }
}
