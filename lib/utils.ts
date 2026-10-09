import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

const alphaNumericCollator = new Intl.Collator("pt-BR", {
  numeric: true,
  sensitivity: "base",
})

const neutralChoicePattern = /^(all|todos?|todas?|none|nenhum|nenhuma|sem(?:-|\s)|selecione)/i

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function compareAlphaNumeric(left: unknown, right: unknown) {
  return alphaNumericCollator.compare(String(left ?? "").trim(), String(right ?? "").trim())
}

export function sortAlphaNumeric<T>(items: readonly T[], label: (item: T) => unknown) {
  return [...items].sort((left, right) => compareAlphaNumeric(label(left), label(right)))
}

export function sortChoiceOptions<T extends { value: string; label: string }>(items: readonly T[]) {
  return [...items].sort((left, right) => {
    const leftNeutral = neutralChoicePattern.test(left.value)
    const rightNeutral = neutralChoicePattern.test(right.value)
    if (leftNeutral !== rightNeutral) return leftNeutral ? -1 : 1
    return compareAlphaNumeric(left.label || left.value, right.label || right.value)
  })
}

export function getInitials(name: string): string {
  if (!name || name.trim() === "") return "??"

  const words = name
    .trim()
    .split(" ")
    .filter((word) => word.length > 0)

  if (words.length === 0) return "??"
  if (words.length === 1) return words[0].substring(0, 2).toUpperCase()

  // Get first letter of first name and first letter of last name
  return (words[0][0] + words[words.length - 1][0]).toUpperCase()
}
