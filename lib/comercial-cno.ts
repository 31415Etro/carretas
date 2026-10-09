const OLC_ALPHABET = "23456789CFGHJMPQRVWX"
const OLC_PAIR_RESOLUTIONS = [20, 1, 0.05, 0.0025, 0.000125]

export function decodeOpenLocationCode(rawCode?: string) {
  if (!rawCode) return null
  const normalized = rawCode
    .trim()
    .toUpperCase()
    .replace(/\s/g, "")
    .replace(/\+/g, "")
    .replace(/0/g, "")

  if (normalized.length < 8) return null
  if ([...normalized].some((char) => !OLC_ALPHABET.includes(char))) return null

  let lat = -90
  let lng = -180
  let latResolution = 20
  let lngResolution = 20
  const pairLength = Math.min(10, normalized.length - (normalized.length % 2))

  for (let index = 0; index < pairLength && index < 10; index += 2) {
    const resolution = OLC_PAIR_RESOLUTIONS[index / 2]
    lat += OLC_ALPHABET.indexOf(normalized[index]) * resolution
    lng += OLC_ALPHABET.indexOf(normalized[index + 1]) * resolution
    latResolution = resolution
    lngResolution = resolution
  }

  for (let index = 10; index < normalized.length; index += 1) {
    const digit = OLC_ALPHABET.indexOf(normalized[index])
    latResolution /= 5
    lngResolution /= 4
    lat += Math.floor(digit / 4) * latResolution
    lng += (digit % 4) * lngResolution
  }

  const decoded = {
    lat: lat + latResolution / 2,
    lng: lng + lngResolution / 2,
  }

  if (decoded.lat < -90 || decoded.lat > 90 || decoded.lng < -180 || decoded.lng > 180) return null
  return decoded
}
