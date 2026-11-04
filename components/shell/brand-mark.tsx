/** Logotipo Dexo + ND Carretas; a altura vem do className (ex.: h-10). */
export function BrandMark({ className = "h-10" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/logo-dexo-nd.png" alt="Dexo | ND Carretas" className={`w-auto max-w-full rounded-md bg-white object-contain ${className}`} />
  )
}
