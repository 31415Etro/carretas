import type { Metadata, Viewport } from "next"

export const metadata: Metadata = {
  title: "ND Carretas · Chão de fábrica",
  description: "Tarefas, materiais e desenhos para os colaboradores da fábrica",
  manifest: "/tablet.webmanifest",
  appleWebApp: { capable: true, title: "Chão de fábrica", statusBarStyle: "black-translucent" },
}

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#020617" }

/** Experiência exclusiva para tablets: sem menus administrativos, financeiros ou comerciais. */
export default function TabletLayout({ children }: { children: React.ReactNode }) {
  return <div className="select-none">{children}</div>
}
