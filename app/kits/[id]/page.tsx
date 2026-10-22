import { KitDetailPage } from "@/components/kits/kit-detail-page"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <KitDetailPage id={id} />
}
