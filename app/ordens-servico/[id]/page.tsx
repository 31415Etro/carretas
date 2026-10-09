import { OsDetailPage } from "@/components/os/os-detail-page"

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <OsDetailPage id={id} />
}
