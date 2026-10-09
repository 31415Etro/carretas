type ServiceOrderCreation = {
  createdAt: string
}

type ScheduledServiceOrder = ServiceOrderCreation & {
  scheduledDate: string
}

function creationTimestamp(createdAt: string) {
  const timestamp = Date.parse(createdAt)
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}

export function sortServiceOrdersByNewestCreation<T extends ServiceOrderCreation>(orders: readonly T[]) {
  return [...orders].sort(
    (left, right) => creationTimestamp(right.createdAt) - creationTimestamp(left.createdAt),
  )
}

function scheduledDateTimestamp(value: string) {
  const text = String(value || "").trim()
  const match = text.match(/^(?:(\d{4})-(\d{2})-(\d{2})|(\d{2})\/(\d{2})\/(\d{4}))/)
  if (match) {
    const year = Number(match[1] || match[6])
    const month = Number(match[2] || match[5])
    const day = Number(match[3] || match[4])
    const timestamp = Date.UTC(year, month - 1, day)
    const parsed = new Date(timestamp)
    if (parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day) return timestamp
    return Number.NEGATIVE_INFINITY
  }
  const timestamp = Date.parse(text)
  return Number.isNaN(timestamp) ? Number.NEGATIVE_INFINITY : timestamp
}

export function sortServiceOrdersByNewestScheduledDate<T extends ScheduledServiceOrder>(orders: readonly T[]) {
  return [...orders].sort((left, right) => {
    const scheduledDifference = scheduledDateTimestamp(right.scheduledDate) - scheduledDateTimestamp(left.scheduledDate)
    return scheduledDifference || creationTimestamp(right.createdAt) - creationTimestamp(left.createdAt)
  })
}
