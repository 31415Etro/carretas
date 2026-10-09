export type SearchableOption = {
  value: string
  label: string
  disabled?: boolean
}

function normalizeSearch(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .trim()
}

export function filterSearchableOptions<T extends SearchableOption>(options: T[], query: string) {
  const normalizedQuery = normalizeSearch(query)
  if (!normalizedQuery) return options

  return options.filter((option) => normalizeSearch(option.label).includes(normalizedQuery))
}
