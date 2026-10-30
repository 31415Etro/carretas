import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
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

// crypto.randomUUID só existe em página segura (HTTPS ou localhost); em http:// (teste por IP) ou em navegador antigo a tela do Financeiro quebrava.
const RANDOM_UUID_POLYFILL = `(function(){var c=window.crypto;if(c&&!c.randomUUID&&c.getRandomValues){c.randomUUID=function(){var b=new Uint8Array(16);c.getRandomValues(b);b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;var h=Array.prototype.map.call(b,function(x){return ('0'+x.toString(16)).slice(-2)}).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)}}})();`

export const metadata: Metadata = {
  title: "ND Carretas",
  description: "Gestão de fabricação, estoque, compras, vendas, serviços e financeiro de carretas",
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
      <head>
        <script dangerouslySetInnerHTML={{ __html: RANDOM_UUID_POLYFILL }} />
      </head>
      <body className={`notranslate font-sans ${inter.variable} ${interMono.variable} antialiased`} translate="no">
        <AuthProvider>
          <div className="app-bg" />
          <Suspense fallback={null}>{children}</Suspense>
          <Toaster />
          <TextNormalizer />
          <SystemErrorMonitor />
        </AuthProvider>
      </body>
    </html>
  )
}
