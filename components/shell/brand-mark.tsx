/** Marca provisória em texto; troque por logotipo quando a empresa enviar a identidade visual. */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1.5 whitespace-nowrap font-bold tracking-tight ${className}`}>
      <span className="text-primary">ND Carretas</span>
      <span className="text-sm font-medium text-muted-foreground">ERP</span>
    </span>
  )
}
