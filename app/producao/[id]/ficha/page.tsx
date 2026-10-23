import { FabricationSheet } from "@/components/production/fabrication-sheet"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <FabricationSheet id={id} />
}
