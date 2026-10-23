import { UnitPage } from "@/components/shop-floor/unit-page"

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <UnitPage token={token} />
}
