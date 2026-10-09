type PageResult<T> = { data: T[] | null; error: { message: string; code?: string } | null }

export async function readAllPages<T>(fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>) {
  const rows: T[] = []
  const size = 500
  for (let from = 0; ; from += size) {
    const { data, error } = await fetchPage(from, from + size - 1)
    if (error) throw Object.assign(new Error(error.message), { code: error.code })
    rows.push(...(data || []))
    if (!data || data.length < size) return rows
  }
}
