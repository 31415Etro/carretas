import { type NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  try {
    const { address } = await request.json()

    if (!address) {
      return NextResponse.json({ error: "Address is required" }, { status: 400 })
    }

    // Only use server-side environment variable
    const apiKey = process.env.GOOGLE_MAPS_API_KEY

    if (!apiKey) {
      return NextResponse.json({ error: "Google Maps API key not configured" }, { status: 500 })
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
    const response = await fetch(url)
    const data = await response.json()

    if (data.status === "OK" && data.results.length > 0) {
      const location = data.results[0].geometry.location
      return NextResponse.json({ lat: location.lat, lng: location.lng })
    }

    return NextResponse.json({ error: "Could not geocode address", status: data.status }, { status: 404 })
  } catch (error: any) {
    console.error("[v0] Geocoding error:", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
