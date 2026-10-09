import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import { Suspense } from "react"
import { AuthProvider } from "@/lib/auth-context"
import { Toaster } from "@/components/ui/toaster"
import { TextNormalizer } from "@/components/text-normalizer"
import { SystemErrorMonitor } from "@/components/system-error-monitor"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
})

const interMono = Inter({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
})

export const metadata: Metadata = {
  title: "Dexo CRM",
  description: "Sistema de gestão operacional e financeiro",
  generator: "v0.app",
  other: {
    google: "notranslate",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR" translate="no" className="notranslate">
      <body className={`notranslate font-sans ${inter.variable} ${interMono.variable} antialiased`} translate="no">
        <AuthProvider>
          <div className="app-bg" />
          <Suspense fallback={null}>{children}</Suspense>
          <Toaster />
          <TextNormalizer />
          <SystemErrorMonitor />
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  )
}
