export function AppFooter({ className = "" }: { className?: string }) {
  return (
    <footer className={`text-center text-xs text-slate-500 ${className}`}>
      © {new Date().getFullYear()} Genes IA Ltda. Todos os direitos reservados. Dexo<sup>®</sup> é propriedade intelectual da Genes IA Ltda.
      <br />
      Sistema desenvolvido exclusivamente para ND Carretas.
    </footer>
  )
}
