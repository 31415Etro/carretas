const fs = require("fs")
const { createClient } = require("@supabase/supabase-js")

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) process.env[match[1]] = match[2]
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  let candidates = 0
  let updated = 0

  for (;;) {
    const { data, error } = await supabase
      .from("client_environments")
      .select("id,location,name,notes")
      .not("location", "eq", "")
      .limit(500)

    if (error) throw error
    if (!data?.length) break

    const rows = data.filter((row) => {
      const location = String(row.location || "")
      const notes = String(row.notes || "")
      return location && notes && (notes.startsWith(`${location}-`) || notes.startsWith(`${location} -`)) && row.name !== notes
    })

    candidates += rows.length

    for (const row of rows) {
      const { error: updateError } = await supabase
        .from("client_environments")
        .update({ location: "", name: row.notes, notes: row.notes })
        .eq("id", row.id)

      if (updateError) throw updateError
      updated += 1
    }

    if (!rows.length) break
  }

  const { data: sample, error: sampleError } = await supabase
    .from("client_environments")
    .select("id,location,name,notes,status,clients(name)")
    .limit(10)

  if (sampleError) throw sampleError

  console.log(JSON.stringify({ candidates, updated, sample }, null, 2))
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
