import PDFDocument from "pdfkit"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const FONT_REGULAR = join(__dirname, "fonts", "NotoSans-Regular.ttf")
const FONT_BOLD = join(__dirname, "fonts", "NotoSans-Bold.ttf")

// ── Text cleaning ────────────────────────────────────────────────────────────
// Mojibake signature characters that indicate latin1-decoded UTF-8
const MOJIBAKE_RE = /[\xC3\xC2\xC4\xC5\xC6\xC8\xC9\xCA\xCB\xCC\xCD\xCE\xCF\xD0\xD1\xD2\xD3\xD4\xD5\xD6\xD8\xD9\xDA\xDB\xDC\xDD\xDE\xDF\xE2\xE3\xE4\xE5\xE6\xE8\xE9\xEA\xEB\xEC\xED\xEE\xEF\xF0\xF1\xF2\xF3\xF4\xF5\xF6\xF8\xF9\xFA\xFB\xFC\xFD\xFE]/

// Emoji regex: matches most emoji codepoints (supplementary plane pictographics,
// emoticons, dingbats, transport/map symbols, misc symbols, skin-tone modifiers,
// variation selectors, ZWJ, regional indicators, keycap sequences)
const EMOJI_RE = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu

function cleanText(val) {
  if (val == null) return ""
  let str = String(val)

  // Attempt to repair mojibake: re-encode latin1 → utf8
  if (MOJIBAKE_RE.test(str)) {
    try {
      const repaired = Buffer.from(str, "latin1").toString("utf8")
      // Only accept the repair if it reduced the mojibake characters
      if (!MOJIBAKE_RE.test(repaired) || repaired.length < str.length) {
        str = repaired
      }
    } catch { /* keep original */ }
  }

  // Remove emoji (Noto Sans doesn't include color emoji glyphs)
  str = str.replace(EMOJI_RE, "")

  // Remove control characters (keep \n \r \t and normal printable + Unicode)
  str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")

  // NFC normalize so accented characters use composed forms
  str = str.normalize("NFC")

  return str.trim()
}

function s(val) { return cleanText(val) }

export function generatePDF(itinerary) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" })
    const buffers = []
    doc.on("data", chunk => buffers.push(chunk))
    doc.on("end", () => resolve(Buffer.concat(buffers)))
    doc.on("error", reject)

    // Register embedded Unicode fonts
    doc.registerFont("NotoSans", FONT_REGULAR)
    doc.registerFont("NotoSans-Bold", FONT_BOLD)

    const w = 495 // usable width (595 - 2*50)

    // ── Cover ──
    doc.font("NotoSans-Bold").fontSize(28).text(s(itinerary.destination), { width: w })
    doc.moveDown(0.5)
    doc.font("NotoSans").fontSize(12).text("Your Personalized Travel Itinerary")
    doc.moveDown(1)

    const meta = [
      itinerary.dates && `Dates: ${s(itinerary.dates)}`,
      itinerary.travelers && `Travelers: ${s(itinerary.travelers)}`,
      itinerary.budget && `Budget: ${s(itinerary.budget)}`,
    ].filter(Boolean)
    meta.forEach(line => doc.font("NotoSans").fontSize(11).text(line))

    doc.moveDown(2)
    doc.font("NotoSans").fontSize(10).text("Made with Wander AI")

    // ── Days ──
    if (itinerary.days) {
      itinerary.days.forEach(day => {
        doc.addPage()

        doc.font("NotoSans-Bold").fontSize(18).text(s(`Day ${day.day}: ${day.title}`), { width: w })
        if (day.theme) {
          doc.font("NotoSans").fontSize(10).text(s(day.theme))
        }
        doc.moveDown(1)

        const blocks = [
          day.morning && { label: "Morning", data: day.morning },
          day.afternoon && { label: "Afternoon", data: day.afternoon },
          day.evening && { label: "Evening", data: day.evening },
        ].filter(Boolean)

        blocks.forEach(block => {
          doc.font("NotoSans-Bold").fontSize(12).text(block.label)
          const place = s(block.data.place || block.data.activity)
          if (place) doc.font("NotoSans-Bold").fontSize(11).text(place)
          if (block.data.activity && block.data.place && block.data.activity !== block.data.place) {
            doc.font("NotoSans").fontSize(10).text(s(block.data.activity), { width: w })
          }
          if (block.data.duration) doc.font("NotoSans").fontSize(10).text(`Duration: ${s(block.data.duration)}`)
          if (block.data.tip) doc.font("NotoSans").fontSize(10).text(`Tip: ${s(block.data.tip)}`, { width: w })
          doc.moveDown(0.8)
        })

        // Meals
        if (day.meals) {
          doc.font("NotoSans-Bold").fontSize(13).text("Where to Eat")
          doc.moveDown(0.3)

          const meals = [
            day.meals.breakfast && { label: "Breakfast", data: day.meals.breakfast },
            day.meals.lunch && { label: "Lunch", data: day.meals.lunch },
            day.meals.dinner && { label: "Dinner", data: day.meals.dinner },
          ].filter(Boolean)

          meals.forEach(meal => {
            const cost = meal.data.cost ? ` (${s(meal.data.cost)})` : ""
            doc.font("NotoSans-Bold").fontSize(10).text(`${meal.label}: ${s(meal.data.name)}${cost}`)
            if (meal.data.why) doc.font("NotoSans").fontSize(10).text(s(meal.data.why), { width: w })
            doc.moveDown(0.3)
          })
          doc.moveDown(0.5)
        }

        // Transport
        if (day.transport) {
          doc.font("NotoSans-Bold").fontSize(10).text("Getting Around:")
          doc.font("NotoSans").fontSize(10).text(s(day.transport), { width: w })
          doc.moveDown(0.5)
        }

        // Budget
        if (day.budget_estimate) {
          doc.font("NotoSans").fontSize(10).text(`Estimated daily spend: ${s(day.budget_estimate)}`)
        }
      })
    }

    // ── Transit Guide ──
    if (itinerary.transit_guide) {
      doc.addPage()
      const guide = itinerary.transit_guide

      doc.font("NotoSans-Bold").fontSize(18).text("Transit Guide")
      doc.moveDown(0.8)

      if (guide.overview) {
        doc.font("NotoSans").fontSize(11).text(s(guide.overview), { width: w })
        doc.moveDown(0.8)
      }
      if (guide.key_card) {
        doc.font("NotoSans-Bold").fontSize(11).text("Key Card / Pass:")
        doc.font("NotoSans").fontSize(11).text(s(guide.key_card))
        doc.moveDown(0.5)
      }
      if (guide.apps?.length) {
        doc.font("NotoSans-Bold").fontSize(11).text("Apps to download:")
        doc.font("NotoSans").fontSize(11).text(guide.apps.map(a => s(a)).join(", "))
        doc.moveDown(0.5)
      }
      if (guide.tips?.length) {
        doc.font("NotoSans-Bold").fontSize(11).text("Tips:")
        guide.tips.forEach(tip => doc.font("NotoSans").fontSize(10).text(`- ${s(tip)}`, { width: w }))
        doc.moveDown(0.5)
      }
      if (guide.common_mistakes?.length) {
        doc.font("NotoSans-Bold").fontSize(11).text("Common mistakes to avoid:")
        guide.common_mistakes.forEach(m => doc.font("NotoSans").fontSize(10).text(`- ${s(m)}`, { width: w }))
      }
    }

    // ── Insider Tips ──
    if (itinerary.insider_tips?.length) {
      doc.addPage()
      doc.font("NotoSans-Bold").fontSize(18).text("Insider Tips")
      doc.moveDown(0.8)
      itinerary.insider_tips.forEach((tip, i) => {
        doc.font("NotoSans").fontSize(11).text(`${i + 1}. ${s(tip)}`, { width: w })
        doc.moveDown(0.5)
      })
    }

    // ── Budget Summary ──
    if (itinerary.total_budget_estimate) {
      doc.addPage()
      doc.font("NotoSans-Bold").fontSize(18).text("Budget Summary")
      doc.moveDown(1)
      doc.font("NotoSans").fontSize(14).text(`Total trip estimate: ${s(itinerary.total_budget_estimate)}`)
      doc.moveDown(2)
      doc.font("NotoSans").fontSize(12).text("Have an amazing trip! -- Wander AI")
    }

    doc.end()
  })
}