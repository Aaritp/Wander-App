import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import rateLimit from "express-rate-limit"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { generatePDF } from "./pdf.js"
import { SYSTEM_PROMPT } from "./prompts.js"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, ".env") })

const isProduction = process.env.NODE_ENV === "production"

const app = express()

// Render terminates TLS at a proxy, so the client IP arrives in X-Forwarded-For.
// Without this every request looks like it came from the proxy and the rate
// limiters would throttle all users as a single client.
app.set("trust proxy", 1)

// ─── CORS allowlist ──────────────────────────────────────────────────────────
// The frontend is served from this same server, so browsers send no Origin for
// it and it is unaffected by any of this. Cross-origin callers must be listed
// in ALLOWED_ORIGINS. Defaults to allowing nothing, so the permissive case is
// always an explicit choice.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean)

if (isProduction && allowedOrigins.length === 0) {
  console.warn("ALLOWED_ORIGINS is not set — cross-origin requests will be rejected. Same-origin requests are unaffected.")
}

const isLocalhost = origin => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)

// Browsers send an Origin header on same-origin requests too — on any non-GET
// request, and on subresources marked crossorigin — so "no Origin" is not a
// sufficient test for same-origin. Compare the origin's host to the host the
// request came in on.
const isSameOrigin = (origin, req) => {
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

const corsOptions = (req, callback) => {
  const origin = req.headers.origin
  const allowed =
    !origin ||                                        // curl, health checks, navigations
    isSameOrigin(origin, req) ||                      // the app's own frontend
    allowedOrigins.includes(origin) ||
    (!isProduction && isLocalhost(origin))

  callback(allowed ? null : new Error("Not allowed by CORS"), { origin: true })
}

// Scoped to /api: the static frontend is public by nature and must not be
// gated, or the browser cannot load its own script and stylesheet.
app.use("/api", cors(corsOptions))

app.use(express.json({ limit: "1mb" }))

// ─── Rate limiting ───────────────────────────────────────────────────────────
// Every one of these endpoints is unauthenticated and spends money — /api/chat
// on Gemini, and /api/maps, /api/places and /api/transit on the Google Maps
// platform. The baseline limiter is mounted on /api so any route added later is
// covered by default. Static frontend assets sit outside /api and stay
// unthrottled.
const makeLimiter = (max, message) => rateLimit({
  windowMs: 15 * 60 * 1000,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: message },
})

app.use("/api", makeLimiter(150, "Too many requests. Please try again later."))
app.use("/api/chat", makeLimiter(20, "Too many chat requests. Please wait a few minutes."))
app.use("/api/speak", makeLimiter(40, "Too many speech requests. Please wait a few minutes."))
app.use("/api/pdf", makeLimiter(10, "Too many PDF downloads. Please wait a few minutes."))
// The itinerary view fires one /api/maps per place and per meal, so this needs
// more headroom than the others.
app.use("/api/maps", makeLimiter(120, "Too many map requests. Please wait a few minutes."))
app.use("/api/map-image", makeLimiter(120, "Too many map requests. Please wait a few minutes."))
app.use("/api/place-photo", makeLimiter(120, "Too many photo requests. Please wait a few minutes."))
app.use("/api/places", makeLimiter(40, "Too many place lookups. Please wait a few minutes."))
app.use("/api/transit", makeLimiter(40, "Too many transit lookups. Please wait a few minutes."))

// Full detail goes to the server log; the client gets a generic message. Keeps
// SDK internals, upstream request URLs and filesystem paths out of responses.
const fail = (res, status, message) => res.status(status).json({ error: message })

const requireQuery = (value, name) =>
  typeof value === "string" && value.trim() && value.length <= 200
    ? null
    : `'${name}' is required and must be a string under 200 characters.`

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

// ─── Daily spend ceilings ────────────────────────────────────────────────────
// Rate limits are per IP, so a proxy pool walks around them. These are hard
// caps on total upstream calls per day, which bound the bill regardless. They
// live in process memory, so they reset on restart/redeploy and are not shared
// across instances — they limit cost, they do not prevent abuse.
const makeDailyBudget = (limit, label) => {
  let used = 0
  let day = new Date().toISOString().slice(0, 10)
  return (cost = 1) => {
    const today = new Date().toISOString().slice(0, 10)
    if (today !== day) { day = today; used = 0 }
    if (used + cost > limit) {
      console.warn(`Daily ${label} limit of ${limit} reached.`)
      return false
    }
    used += cost
    return true
  }
}

const geminiBudget = makeDailyBudget(Number(process.env.DAILY_GEMINI_LIMIT) || 500, "Gemini")
const googleBudget = makeDailyBudget(Number(process.env.DAILY_GOOGLE_API_LIMIT) || 5000, "Google Maps")

// A real planning conversation is a handful of turns; anything far past that is
// someone using the endpoint as a general-purpose model proxy.
const MAX_MESSAGES = 40
const MAX_TOTAL_CHARS = 200_000

// enrichItinerary makes 2 Google calls per place and per meal, so a 7-day
// itinerary is over 80 calls. Cap how much of an itinerary gets enriched so one
// oversized response can't drain the Maps quota on its own.
const MAX_ENRICHED_DAYS = 10

// Function to enrich itinerary with API data
async function enrichItinerary(itinerary) {
  if (!Array.isArray(itinerary.days) || !itinerary.destination) return itinerary
  if (!process.env.GOOGLE_API_KEY) return itinerary

  const days = itinerary.days.slice(0, MAX_ENRICHED_DAYS)
  // Worst case per day: 3 activities + 3 meals, 2 calls each, plus one geocode.
  if (!googleBudget(days.length * 12 + 1)) return itinerary

  // Geocode destination for location
  let location = "40.7128,-74.0060" // Default NYC
  try {
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(itinerary.destination)}&key=${process.env.GOOGLE_API_KEY}`
    const geocodeResponse = await fetch(geocodeUrl)
    const geocodeData = await geocodeResponse.json()
    if (geocodeData.results && geocodeData.results.length > 0) {
      const { lat, lng } = geocodeData.results[0].geometry.location
      location = `${lat},${lng}`
    }
  } catch (err) {
    console.error("Geocode error:", err)
  }

  const enrichedDays = await Promise.all(days.map(async (day) => {
    const enrichedDay = { ...day }

    // Enrich activities
    const activities = ['morning', 'afternoon', 'evening']
    for (const act of activities) {
      if (day[act] && day[act].place_query) {
        try {
          // Search places
          const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${location}&radius=5000&keyword=${encodeURIComponent(day[act].place_query)}&key=${process.env.GOOGLE_API_KEY}`
          const placesResponse = await fetch(placesUrl)
          const placesData = await placesResponse.json()
          if (placesData.results && placesData.results.length > 0) {
            const place = placesData.results[0]
            // Get details
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=rating,reviews,formatted_address&key=${process.env.GOOGLE_API_KEY}`
            const detailsResponse = await fetch(detailsUrl)
            const detailsData = await detailsResponse.json()
            const details = detailsData.result
            enrichedDay[act] = {
              ...day[act],
              rating: details.rating,
              reviews: details.reviews ? details.reviews.slice(0, 2).map(r => r.text) : [],
              address: details.formatted_address
            }
          }
        } catch (err) {
          console.error(`Error enriching ${act}:`, err)
        }
      }
    }

    // Enrich meals
    const meals = ['breakfast', 'lunch', 'dinner']
    for (const meal of meals) {
      if (day.meals && day.meals[meal] && day.meals[meal].place_query) {
        try {
          const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${location}&radius=5000&keyword=${encodeURIComponent(day.meals[meal].place_query)}&key=${process.env.GOOGLE_API_KEY}`
          const placesResponse = await fetch(placesUrl)
          const placesData = await placesResponse.json()
          if (placesData.results && placesData.results.length > 0) {
            const place = placesData.results[0]
            const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=rating,reviews,formatted_address&key=${process.env.GOOGLE_API_KEY}`
            const detailsResponse = await fetch(detailsUrl)
            const detailsData = await detailsResponse.json()
            const details = detailsData.result
            enrichedDay.meals[meal] = {
              ...day.meals[meal],
              rating: details.rating,
              reviews: details.reviews ? details.reviews.slice(0, 2).map(r => r.text) : [],
              address: details.formatted_address
            }
          }
        } catch (err) {
          console.error(`Error enriching ${meal}:`, err)
        }
      }
    }

    return enrichedDay
  }))

  // Days past the enrichment cap are kept as-is rather than dropped.
  return { ...itinerary, days: [...enrichedDays, ...itinerary.days.slice(MAX_ENRICHED_DAYS)] }
}

// ─── Chat endpoint (Gemini) ──────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body || {}

    if (!Array.isArray(messages) || messages.length === 0) {
      return fail(res, 400, "'messages' must be a non-empty array.")
    }
    if (messages.length > MAX_MESSAGES) {
      return fail(res, 400, "Conversation is too long. Please start a new one.")
    }

    const totalChars = messages.reduce((sum, m) => {
      const content = typeof m?.content === "string" ? m.content : JSON.stringify(m?.content ?? "")
      return sum + content.length
    }, 0)
    if (totalChars > MAX_TOTAL_CHARS) {
      return fail(res, 400, "Conversation is too large. Please start a new one.")
    }

    if (!geminiBudget()) {
      return fail(res, 503, "The travel planner is temporarily unavailable. Please try again tomorrow.")
    }

    const model = genAI.getGenerativeModel({
      model: "models/gemini-2.5-flash",
      // Deliberately ignores any systemPrompt in the request body.
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
      },
    })

    // Gemini uses "model" instead of "assistant" for AI turns
    const history = messages.slice(0, -1).map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }],
    }))

    const chat = model.startChat({ history })

    const lastMessage = messages[messages.length - 1]
    const result = await chat.sendMessage(lastMessage.content)
    const text = result.response.text()

    // Parse the JSON response
    let responseData
    try {
      responseData = JSON.parse(text)
    } catch (err) {
      // Fallback parsing if JSON is malformed
      responseData = { message: text, done: false }
    }

    // Enrich itinerary with API data if present
    if (responseData.itinerary) {
      responseData.itinerary = await enrichItinerary(responseData.itinerary)
    }

    // Return in same shape the frontend expects
    res.json({ content: [{ text: JSON.stringify(responseData) }] })
  } catch (err) {
    console.error("Chat error:", err)
    fail(res, 500, "Something went wrong generating a response. Please try again.")
  }
})

// ─── Text-to-speech endpoint (Edge TTS) ─────────────────────────────────────
app.post("/api/speak", async (req, res) => {
  try {
    const { text } = req.body || {}

    if (typeof text !== "string" || !text.trim()) {
      return fail(res, 400, "A non-empty 'text' string is required.")
    }

    const tts = new MsEdgeTTS()
    await tts.setMetadata("en-US-JennyNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const { audioStream } = tts.toStream(text.slice(0, 500))

    const chunks = []
    for await (const chunk of audioStream) {
      chunks.push(chunk)
    }
    const audioBuffer = Buffer.concat(chunks)

    res.set("Content-Type", "audio/mpeg")
    res.send(audioBuffer)
  } catch (err) {
    console.error("TTS error:", err)
    fail(res, 500, "Speech generation failed. Please try again.")
  }
})

// ─── PDF generation endpoint ─────────────────────────────────────────────────

// pdf.js iterates these fields, so confirm their shape here and return a clear
// 400 rather than failing partway through rendering.
const validateItinerary = (itinerary) => {
  if (!itinerary || typeof itinerary !== "object" || Array.isArray(itinerary)) {
    return "'itinerary' must be an object."
  }
  if (typeof itinerary.destination !== "string" || !itinerary.destination.trim()) {
    return "'itinerary.destination' must be a non-empty string."
  }
  if (itinerary.days != null && !Array.isArray(itinerary.days)) {
    return "'itinerary.days' must be an array."
  }
  if (itinerary.insider_tips != null && !Array.isArray(itinerary.insider_tips)) {
    return "'itinerary.insider_tips' must be an array."
  }
  const guide = itinerary.transit_guide
  if (guide != null) {
    if (typeof guide !== "object" || Array.isArray(guide)) {
      return "'itinerary.transit_guide' must be an object."
    }
    for (const key of ["apps", "tips", "common_mistakes"]) {
      if (guide[key] != null && !Array.isArray(guide[key])) {
        return `'itinerary.transit_guide.${key}' must be an array.`
      }
    }
  }
  return null
}

// The destination is attacker-controlled and goes into a response header, so
// reduce it to a safe slug rather than trying to escape it. Quotes, semicolons,
// and CR/LF would otherwise break out of the quoted filename.
const toFilenameSlug = (destination) => {
  const slug = destination
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "")
  // Nothing survived the slug (e.g. a fully non-Latin destination) — browsers
  // will use the filename* form below anyway.
  return slug ? `${slug}-itinerary.pdf` : "itinerary.pdf"
}

app.post("/api/pdf", async (req, res) => {
  try {
    const { itinerary } = req.body || {}

    const invalid = validateItinerary(itinerary)
    if (invalid) return fail(res, 400, invalid)

    const pdfBuffer = await generatePDF(itinerary)

    const asciiName = toFilenameSlug(itinerary.destination)
    // filename* carries the readable original for destinations that don't
    // survive the slug (non-Latin scripts); filename is the ASCII fallback.
    const utf8Name = encodeURIComponent(`${itinerary.destination.trim().slice(0, 60)}-itinerary.pdf`)

    res.set("Content-Type", "application/pdf")
    res.set("Content-Disposition", `attachment; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`)
    res.send(pdfBuffer)
  } catch (err) {
    console.error("PDF error:", err)
    fail(res, 500, "Could not generate the PDF. Please try again.")
  }
})

// ─── Google Maps static image endpoint ──────────────────────────────────────
app.get("/api/maps", async (req, res) => {
  try {
    const { query } = req.query
    // size is echoed into an upstream URL, so only accept WIDTHxHEIGHT.
    const size = /^\d{2,4}x\d{2,4}$/.test(req.query.size || "") ? req.query.size : "400x300"

    const invalid = requireQuery(query, "query")
    if (invalid) return fail(res, 400, invalid)
    if (!process.env.GOOGLE_API_KEY) return fail(res, 503, "Map lookups are not configured.")
    if (!googleBudget(2)) return fail(res, 503, "Map lookups are temporarily unavailable.")

    // First, geocode the query to get lat/lng
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${process.env.GOOGLE_API_KEY}`
    const geocodeResponse = await fetch(geocodeUrl)
    const geocodeData = await geocodeResponse.json()
    if (!geocodeData.results || geocodeData.results.length === 0) {
      return res.status(404).json({ error: "Location not found" })
    }
    const { lat, lng } = geocodeData.results[0].geometry.location

    // Return a same-origin path served by the proxy below, so credentials stay
    // on the server rather than travelling to the browser in an image URL.
    const mapUrl = `/api/map-image?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&size=${encodeURIComponent(size)}`

    res.json({ mapUrl, lat, lng })
  } catch (err) {
    console.error("Maps error:", err)
    fail(res, 500, "Could not look up that location.")
  }
})

// ─── Static map image proxy ──────────────────────────────────────────────────
// Fetches the tile server-side so the API key never reaches the browser.
app.get("/api/map-image", async (req, res) => {
  try {
    const lat = Number(req.query.lat)
    const lng = Number(req.query.lng)
    const size = /^\d{2,4}x\d{2,4}$/.test(req.query.size || "") ? req.query.size : "400x300"

    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      return fail(res, 400, "'lat' and 'lng' must be valid coordinates.")
    }
    if (!process.env.GOOGLE_API_KEY) return fail(res, 503, "Map images are not configured.")
    if (!googleBudget()) return fail(res, 503, "Map images are temporarily unavailable.")

    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=15&size=${size}&markers=color:red%7C${lat},${lng}&key=${process.env.GOOGLE_API_KEY}`
    const upstream = await fetch(url)
    if (!upstream.ok) return fail(res, 502, "Could not load the map image.")

    res.set("Content-Type", upstream.headers.get("content-type") || "image/png")
    res.set("Cache-Control", "public, max-age=86400")
    res.send(Buffer.from(await upstream.arrayBuffer()))
  } catch (err) {
    console.error("Map image error:", err)
    fail(res, 500, "Could not load the map image.")
  }
})

// ─── Place photo proxy ───────────────────────────────────────────────────────
app.get("/api/place-photo", async (req, res) => {
  try {
    const { ref } = req.query
    const invalid = requireQuery(ref, "ref")
    if (invalid) return fail(res, 400, invalid)
    if (!process.env.GOOGLE_API_KEY) return fail(res, 503, "Place photos are not configured.")
    if (!googleBudget()) return fail(res, 503, "Place photos are temporarily unavailable.")

    const url = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${encodeURIComponent(ref)}&key=${process.env.GOOGLE_API_KEY}`
    const upstream = await fetch(url)
    if (!upstream.ok) return fail(res, 502, "Could not load the photo.")

    res.set("Content-Type", upstream.headers.get("content-type") || "image/jpeg")
    res.set("Cache-Control", "public, max-age=86400")
    res.send(Buffer.from(await upstream.arrayBuffer()))
  } catch (err) {
    console.error("Place photo error:", err)
    fail(res, 500, "Could not load the photo.")
  }
})

// ─── Google Places search with reviews endpoint ─────────────────────────────
app.get("/api/places", async (req, res) => {
  try {
    const { query, location } = req.query

    const invalid = requireQuery(query, "query")
    if (invalid) return fail(res, 400, invalid)
    // Both are interpolated into an upstream URL, so constrain their shape.
    const loc = /^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/.test(location || "")
      ? location
      : "40.7128,-74.0060" // Default to NYC
    const radius = Math.min(Math.max(Number(req.query.radius) || 5000, 1), 50000)

    if (!process.env.GOOGLE_API_KEY) return fail(res, 503, "Place lookups are not configured.")
    // One nearby search plus up to five detail lookups.
    if (!googleBudget(6)) return fail(res, 503, "Place lookups are temporarily unavailable.")

    const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${loc}&radius=${radius}&keyword=${encodeURIComponent(query)}&key=${process.env.GOOGLE_API_KEY}`
    const placesResponse = await fetch(placesUrl)
    const placesData = await placesResponse.json()

    if (!Array.isArray(placesData.results)) return res.json({ places: [] })

    const places = await Promise.all(placesData.results.slice(0, 5).map(async (place) => {
      // Get place details including reviews
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,rating,reviews,formatted_address,photos&key=${process.env.GOOGLE_API_KEY}`
      const detailsResponse = await fetch(detailsUrl)
      const detailsData = await detailsResponse.json()
      const details = detailsData.result || {}
      return {
        name: place.name,
        rating: details.rating,
        address: details.formatted_address,
        reviews: details.reviews ? details.reviews.slice(0, 3).map(r => ({
          author: r.author_name,
          rating: r.rating,
          text: r.text,
          time: r.time
        })) : [],
        // Proxied through this server so the API key stays server-side.
        photo: details.photos?.[0]
          ? `/api/place-photo?ref=${encodeURIComponent(details.photos[0].photo_reference)}`
          : null
      }
    }))

    res.json({ places })
  } catch (err) {
    console.error("Places error:", err)
    fail(res, 500, "Could not look up places.")
  }
})

// ─── Google Transit directions endpoint ──────────────────────────────────────
const TRANSIT_MODES = new Set(["transit", "driving", "walking", "bicycling"])

app.get("/api/transit", async (req, res) => {
  try {
    const { origin, destination } = req.query
    // mode is interpolated into the upstream URL, so allow only known values.
    const mode = TRANSIT_MODES.has(req.query.mode) ? req.query.mode : "transit"

    const invalid = requireQuery(origin, "origin") || requireQuery(destination, "destination")
    if (invalid) return fail(res, 400, invalid)
    if (!process.env.GOOGLE_API_KEY) return fail(res, 503, "Transit lookups are not configured.")
    if (!googleBudget()) return fail(res, 503, "Transit lookups are temporarily unavailable.")

    const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=${mode}&key=${process.env.GOOGLE_API_KEY}`
    const directionsResponse = await fetch(directionsUrl)
    const directionsData = await directionsResponse.json()

    if (!directionsData.routes || directionsData.routes.length === 0) {
      return fail(res, 404, "No routes found.")
    }

    const route = directionsData.routes[0]
    const leg = route.legs[0]

    const transitInfo = {
      distance: leg.distance.text,
      duration: leg.duration.text,
      steps: leg.steps.map(step => ({
        instruction: step.html_instructions.replace(/<[^>]*>/g, ''), // Remove HTML tags
        distance: step.distance.text,
        duration: step.duration.text,
        mode: step.travel_mode,
        transit_details: step.transit_details ? {
          line: step.transit_details.line.name,
          vehicle: step.transit_details.line.vehicle.type,
          departure_stop: step.transit_details.departure_stop.name,
          arrival_stop: step.transit_details.arrival_stop.name,
          departure_time: step.transit_details.departure_time.text,
          arrival_time: step.transit_details.arrival_time.text
        } : null
      }))
    }

    res.json({ transitInfo })
  } catch (err) {
    console.error("Transit error:", err)
    fail(res, 500, "Could not look up directions.")
  }
})

// ─── Serve frontend in production ────────────────────────────────────────────
const distPath = join(__dirname, "..", "dist")
app.use(express.static(distPath))
app.get("*", (req, res) => {
  res.sendFile(join(distPath, "index.html"))
})

// A rejected origin throws out of the cors middleware. Catch it here so it
// returns clean JSON instead of Express's default HTML error page, which
// includes a stack trace outside production.
app.use((err, req, res, next) => {
  if (err?.message === "Not allowed by CORS") {
    return fail(res, 403, "Origin not allowed.")
  }
  console.error("Unhandled error:", err)
  fail(res, 500, "Something went wrong.")
})

const PORT = process.env.PORT || 3001
const server = app.listen(PORT, () => console.log(`🌍 Wander backend running on port ${PORT}`))

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use. Try setting PORT to a different value or stop the process using that port.`)
  } else {
    console.error("Server error:", err)
  }
  process.exit(1)
})