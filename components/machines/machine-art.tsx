"use client"

import { HelpCircle, OctagonX, Play, Wrench } from "lucide-react"
import { cn } from "@/lib/utils"
import { normalizeIllustration, statusMeta, type MachineStatus } from "@/lib/machines"

const icons = { play: Play, wrench: Wrench, octagon: OctagonX, help: HelpCircle }

export function StatusIcon({ status, className }: { status: MachineStatus; className?: string }) {
  const Icon = icons[statusMeta[status]?.icon || "help"]
  return <Icon className={className} aria-hidden />
}

/** Selo de status: ícone + texto + cor (a leitura nunca depende só da cor). */
export function StatusPill({ status, className, pulse = false }: { status: MachineStatus; className?: string; pulse?: boolean }) {
  const meta = statusMeta[status] || statusMeta["Nao informado"]
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", className)} style={{ background: meta.soft, color: meta.text }}>
      <span className="relative flex h-2.5 w-2.5 items-center justify-center" aria-hidden>
        {pulse && status === "Em operacao" ? <span className="absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping" style={{ background: meta.color }} /> : null}
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: meta.color }} />
      </span>
      {meta.label}
    </span>
  )
}

/**
 * Desenhos simplificados (traço, sem preenchimento colorido): o próprio desenho recebe a cor do status
 * (`color` = contorno) e há uma luz de fundo; não é uma bolinha ao lado.
 */
function Drawing({ kind }: { kind: string }) {
  const f = "none"
  switch (kind) {
    case "solda_mig":
      return (
        <g fill={f} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="38" y="40" width="74" height="70" rx="6" />
          <rect x="46" y="48" width="30" height="16" rx="2" />
          <circle cx="92" cy="56" r="7" /><circle cx="92" cy="56" r="2" />
          <path d="M46 78h58M46 88h58M46 98h40" />
          <circle cx="52" cy="122" r="9" /><circle cx="98" cy="122" r="9" />
          <path d="M112 62h22c10 0 14 8 14 16v18" /><path d="M148 96l8 10M156 106l10-4" />
          <path d="M166 102l6-10" strokeWidth="2.5" />
        </g>
      )
    case "compressor":
      return (
        <g fill={f} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="30" y="64" width="110" height="38" rx="19" />
          <path d="M52 64v38M118 64v38" />
          <rect x="58" y="36" width="52" height="28" rx="4" />
          <path d="M70 36V26h28v10" /><path d="M72 44h24M72 52h24" />
          <circle cx="146" cy="52" r="12" /><path d="M146 52l5-5" />
          <path d="M140 83h14" />
          <path d="M44 102v14M126 102v14M34 116h20M116 116h20" />
        </g>
      )
    case "furadeira":
      return (
        <g fill={f} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="40" y="118" width="100" height="10" rx="2" />
          <path d="M58 118V30h22" /><rect x="52" y="26" width="64" height="26" rx="4" />
          <rect x="82" y="52" width="22" height="22" rx="3" />
          <path d="M93 74v26" /><path d="M93 100l-3 9 6-0 0 0z" />
          <rect x="68" y="108" width="50" height="6" rx="1" />
          <path d="M122 38h16M138 34v8" />
        </g>
      )
    case "esmerilhadeira":
      return (
        <g fill={f} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="30" y="112" width="120" height="14" rx="3" />
          <path d="M90 112V70" /><rect x="62" y="52" width="56" height="22" rx="8" />
          <circle cx="44" cy="76" r="22" /><circle cx="44" cy="76" r="6" />
          <path d="M118 62h22" /><path d="M126 96l-14 16" />
          <path d="M14 56l8 6M12 76h8M14 96l8-6" strokeWidth="2.5" />
        </g>
      )
    case "serra":
      return (
        <g fill={f} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="28" y="104" width="124" height="22" rx="3" />
          <path d="M46 104V50a24 24 0 0 1 24-24h14" /><circle cx="46" cy="38" r="12" /><circle cx="92" cy="38" r="12" />
          <path d="M46 26h46M46 50h46" />
          <rect x="100" y="76" width="42" height="28" rx="2" />
          <path d="M70 50v54" strokeDasharray="3 5" />
        </g>
      )
    case "corte":
      return (
        <g fill={f} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="22" y="96" width="136" height="18" rx="3" />
          <path d="M34 114v14M146 114v14" />
          <path d="M28 96V54h124v42" /><rect x="72" y="36" width="36" height="22" rx="3" />
          <path d="M90 58v22l4 6" /><path d="M94 86l9 7M94 86l-9 7M94 86v11" strokeWidth="2.5" />
          <path d="M40 80h30M110 80h30" strokeDasharray="4 4" />
        </g>
      )
    case "dobradeira":
      return (
        <g fill={f} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M44 128V32h68v22" /><rect x="34" y="124" width="116" height="8" rx="2" />
          <rect x="82" y="54" width="60" height="30" rx="3" />
          <path d="M96 84v14h32V84" /><path d="M86 112h60" />
          <path d="M56 50v-8M56 66v-8" /><circle cx="62" cy="84" r="9" />
        </g>
      )
    case "pintura":
      return (
        <g fill={f} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="24" y="28" width="82" height="100" rx="5" />
          <path d="M24 46h82" /><rect x="36" y="58" width="58" height="56" rx="3" strokeDasharray="4 4" />
          <path d="M118 84h20c8 0 10-6 10-14V56h14v16" /><rect x="136" y="46" width="24" height="12" rx="3" />
          <path d="M160 50l10-6M160 56l12 0M160 62l10 6" strokeWidth="2.5" />
          <circle cx="132" cy="104" r="8" /><path d="M132 112v14" />
        </g>
      )
    default:
      return (
        <g fill={f} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <rect x="32" y="36" width="116" height="78" rx="8" />
          <circle cx="90" cy="75" r="22" /><circle cx="90" cy="75" r="7" />
          <path d="M90 53v-8M90 105v8M68 75h-8M120 75h8M74 59l-5-5M106 91l5 5M74 91l-5 5M106 59l5-5" />
          <path d="M46 114v12M134 114v12M36 126h20M124 126h20" />
        </g>
      )
  }
}

/** Miniatura neutra para escolher a ilustração no cadastro. */
export function IllustrationThumb({ kind, className }: { kind: string; className?: string }) {
  return (
    <svg viewBox="0 0 180 140" className={cn("h-full w-full p-1 text-slate-600", className)} aria-hidden>
      <Drawing kind={normalizeIllustration(kind)} />
    </svg>
  )
}

type ArtProps = { illustration?: string; photoUrl?: string; status: MachineStatus; className?: string; alt?: string; compact?: boolean }

/**
 * Representação visual da máquina com o status "dentro" da imagem:
 *  - desenho SVG: contorno e luz de fundo na cor do status;
 *  - foto real: moldura, aura e faixa inferior (a foto nunca é recolorida).
 * Sempre acompanha ícone e texto do status para não depender só da cor.
 */
export function MachineArt({ illustration, photoUrl, status, className, alt, compact }: ArtProps) {
  const meta = statusMeta[status] || statusMeta["Nao informado"]
  const key = normalizeIllustration(illustration)
  return (
    <div
      className={cn("relative isolate overflow-hidden rounded-xl", compact ? "aspect-[4/3]" : "aspect-[16/10]", className)}
      style={{ background: `radial-gradient(120% 90% at 50% 40%, ${meta.soft} 0%, #ffffff 78%)`, boxShadow: `inset 0 0 0 2px ${meta.color}, 0 0 22px -4px ${meta.color}66` }}
      role="img"
      aria-label={`${alt || "Máquina"}: ${meta.label}`}
    >
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <svg viewBox="0 0 180 140" className="h-full w-full p-3" style={{ color: meta.color }} aria-hidden>
          <ellipse cx="90" cy="132" rx="62" ry="5" fill="currentColor" opacity="0.12" />
          <Drawing kind={key} />
        </svg>
      )}
      {status === "Em manutencao" ? (
        <span className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full text-white shadow" style={{ background: meta.color }}><Wrench className="h-4 w-4" aria-hidden /></span>
      ) : null}
      <span className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white" style={{ background: meta.color }}>
        <StatusIcon status={status} className="h-3 w-3" />
        {meta.label}
      </span>
    </div>
  )
}
