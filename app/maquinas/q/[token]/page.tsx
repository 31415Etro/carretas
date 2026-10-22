import { QrLanding } from "@/components/machines/machines-pages-more"

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <QrLanding token={token} />
}
