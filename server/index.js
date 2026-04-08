import express from "express"
import cors from "cors"
import dotenv from "dotenv"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { generatePDF } from "./pdf.js"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, ".env") })

const app = express()
app.use(cors())
app.use(express.json({ limit: "10mb" }))

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)

// Function to enrich itinerary with API data
async function enrichItinerary(itinerary) {
  if (!itinerary.days || !itinerary.destination) return itinerary

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

  const enrichedDays = await Promise.all(itinerary.days.map(async (day) => {
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

  return { ...itinerary, days: enrichedDays }
}

// ─── Chat endpoint (Gemini) ──────────────────────────────────────────────────
app.post("/api/chat", async (req, res) => {
  const { messages, systemPrompt } = req.body

  try {
    const model = genAI.getGenerativeModel({
      model: "models/gemini-2.5-flash",
      systemInstruction: systemPrompt,
      generationConfig: {
        maxOutputTokens: 65536,
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
    res.status(500).json({ error: err.message })
  }
})

// ─── Text-to-speech endpoint (Edge TTS) ─────────────────────────────────────
app.post("/api/speak", async (req, res) => {
  const { text } = req.body

  try {
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
    res.status(500).json({ error: err.message })
  }
})

// ─── PDF generation endpoint ─────────────────────────────────────────────────
app.post("/api/pdf", async (req, res) => {
  const { itinerary } = req.body
  try {
    const pdfBuffer = await generatePDF(itinerary)
    const filename = `${itinerary.destination.replace(/,?\s+/g, "-")}-itinerary.pdf`
    res.set("Content-Type", "application/pdf")
    res.set("Content-Disposition", `attachment; filename="${filename}"`)
    res.send(pdfBuffer)
  } catch (err) {
    console.error("PDF error:", err)
    res.status(500).json({ error: err.message })
  }
})

// ─── Google Maps static image endpoint ──────────────────────────────────────
app.get("/api/maps", async (req, res) => {
  const { query, size = "400x300" } = req.query
  try {
    // First, geocode the query to get lat/lng
    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${process.env.GOOGLE_API_KEY}`
    const geocodeResponse = await fetch(geocodeUrl)
    const geocodeData = await geocodeResponse.json()
    if (!geocodeData.results || geocodeData.results.length === 0) {
      return res.status(404).json({ error: "Location not found" })
    }
    const { lat, lng } = geocodeData.results[0].geometry.location

    // Generate static map URL
    const mapUrl = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=15&size=${size}&markers=color:red%7C${lat},${lng}&key=${process.env.GOOGLE_API_KEY}`
    
    res.json({ mapUrl, lat, lng })
  } catch (err) {
    console.error("Maps error:", err)
    res.status(500).json({ error: err.message })
  }
})

// ─── Google Places search with reviews endpoint ─────────────────────────────
app.get("/api/places", async (req, res) => {
  const { query, location, radius = 5000 } = req.query
  try {
    const loc = location || "40.7128,-74.0060" // Default to NYC
    const placesUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${loc}&radius=${radius}&keyword=${encodeURIComponent(query)}&key=${process.env.GOOGLE_API_KEY}`
    const placesResponse = await fetch(placesUrl)
    const placesData = await placesResponse.json()

    const places = await Promise.all(placesData.results.slice(0, 5).map(async (place) => {
      // Get place details including reviews
      const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=name,rating,reviews,formatted_address,photos&key=${process.env.GOOGLE_API_KEY}`
      const detailsResponse = await fetch(detailsUrl)
      const detailsData = await detailsResponse.json()
      const details = detailsData.result
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
        photo: details.photos ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${details.photos[0].photo_reference}&key=${process.env.GOOGLE_API_KEY}` : null
      }
    }))

    res.json({ places })
  } catch (err) {
    console.error("Places error:", err)
    res.status(500).json({ error: err.message })
  }
})

// ─── Google Transit directions endpoint ──────────────────────────────────────
app.get("/api/transit", async (req, res) => {
  const { origin, destination, mode = "transit" } = req.query
  try {
    const directionsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&mode=${mode}&key=${process.env.GOOGLE_API_KEY}`
    const directionsResponse = await fetch(directionsUrl)
    const directionsData = await directionsResponse.json()

    if (!directionsData.routes || directionsData.routes.length === 0) {
      return res.status(404).json({ error: "No routes found" })
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
    res.status(500).json({ error: err.message })
  }
})

// ─── Serve frontend in production ────────────────────────────────────────────
const distPath = join(__dirname, "..", "dist")
app.use(express.static(distPath))
app.get("*", (req, res) => {
  res.sendFile(join(distPath, "index.html"))
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