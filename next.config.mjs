/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || (process.env.VERCEL ? ".next" : ".next-local"),
  outputFileTracingRoot: import.meta.dirname,
  // OCR local (tesseract.js) das fotos de nota: pacote fora do bundle e idioma português junto da função
  serverExternalPackages: ["tesseract.js"],
  outputFileTracingIncludes: { "/api/financeiro/nf": ["./public/tessdata/**/*", "./node_modules/tesseract.js-core/**/*"] },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
