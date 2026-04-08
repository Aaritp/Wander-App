import { useState, useRef, useEffect } from "react"
import "./VoiceAgent.css"

const SYSTEM_PROMPT = `You are Wander, a warm and knowledgeable AI travel planning assistant. You have deep expertise in global travel, local culture, food, and transportation systems.

Your job is to quickly gather the traveler's preferences, then build a personalized itinerary.

CRITICAL RULES:
- Keep your "message" field to 2-3 sentences MAX. Be concise and conversational.
- NEVER write long paragraphs, bullet-point lists, or detailed breakdowns in the message field.
- Do NOT include emoji or special Unicode symbols in the itinerary JSON field values. Keep all values as plain text only.
- Be efficient. Do NOT drag out the conversation. Aim for 2-3 exchanges before generating the itinerary.

CONVERSATION FLOW:
Turn 1 (your first response after the user says where they want to go):
Ask the essential details ALL AT ONCE in a short, friendly way. Example:
"Amazing choice! To build your perfect trip, tell me:
- Travel dates and how many days?
- Who's going? (solo, couple, family, friends)
- Budget range? (budget / mid-range / luxury)
- What are you most excited about? (food, history, nightlife, nature, shopping, etc.)
- Anything to avoid?"

Turn 2: If the user answers most of those, you have enough. Say "I have everything I need!" and generate the itinerary immediately. Only ask a brief follow-up if critical info is missing (like dates).

Do NOT ask about accommodation style, transport comfort, or travel pace separately. Make reasonable defaults based on their budget and group.

RESPONSE FORMAT:
Always respond with a JSON object:
{
  "message": "Your conversational response here (2-3 sentences max)",
  "question": "The next question to ask (short, friendly)",
  "profileUpdate": { "key": "value" },
  "itinerary": null or { ... full itinerary object when ready ... },
  "done": false or true
}

ITINERARY FORMAT (when ready):
{
  "destination": "Tokyo, Japan",
  "dates": "June 10-17, 2025",
  "travelers": "Couple",
  "budget": "Mid-range (~$150/day)",
  "days": [
    {
      "day": 1,
      "title": "Arrival & Shinjuku",
      "theme": "Getting your bearings",
      "morning": { "activity": "...", "place": "...", "place_query": "specific restaurant name for API lookup", "tip": "...", "duration": "2hrs" },
      "afternoon": { "activity": "...", "place": "...", "place_query": "specific attraction name for API lookup", "tip": "...", "duration": "3hrs" },
      "evening": { "activity": "...", "place": "...", "place_query": "specific venue name for API lookup", "tip": "...", "duration": "2hrs" },
      "meals": {
        "breakfast": { "name": "...", "type": "...", "place_query": "specific cafe name for API lookup", "cost": "$", "why": "..." },
        "lunch": { "name": "...", "type": "...", "place_query": "specific restaurant name for API lookup", "cost": "$$", "why": "..." },
        "dinner": { "name": "...", "type": "...", "place_query": "specific restaurant name for API lookup", "cost": "$$", "why": "..." }
      },
      "transport": "Take the Yamanote Line from...",
      "budget_estimate": "$120"
    }
  ],
  "transit_guide": {
    "overview": "Tokyo has one of the world's best transit systems...",
    "key_card": "Get a Suica card at any airport or station",
    "apps": ["Google Maps", "Citymapper"],
    "tips": ["...", "..."],
    "common_mistakes": ["...", "..."]
  },
  "total_budget_estimate": "$850-1100",
  "insider_tips": ["...", "..."]
}

Be warm, specific, and excited about travel. Reference their previous answers to show you're listening.`

export default function VoiceAgent({
  onItineraryUpdate,
  onConversationUpdate,
  onProfileUpdate,
  onComplete,
  onClose,
  resultMode,
  finalItinerary,
}) {
  const [messages, setMessages] = useState([{ type: "agent", text: "Hi! I'm Wander, your AI travel planner. Where in the world are you dreaming of going?" }])
  const [isListening, setIsListening] = useState(false)
  const [isThinking, setIsThinking] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [inputText, setInputText] = useState("")
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")
  const [voiceEnabled, setVoiceEnabled] = useState(true)

  const recognitionRef = useRef(null)
  const messagesEndRef = useRef(null)
  const audioRef = useRef(null)
  const conversationRef = useRef([])
  const initializedRef = useRef(false)
  const transcriptRef = useRef("")

  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    if (resultMode) {
      setDone(true)
      setMessages(prev => [...prev, { type: "agent", text: "Your itinerary is ready! You can download it as a PDF, or keep chatting to refine anything." }])
    } else {
      speakMessage("Hi! I'm Wander, your AI travel planner. Where in the world are you dreaming of going?")
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current = null
    }
    setIsSpeaking(false)
  }

  const speakMessage = async (text) => {
    if (!voiceEnabled) return
    stopSpeaking()
    setIsSpeaking(true)
    try {
      const res = await fetch("/api/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audioRef.current = audio
        audio.onended = () => setIsSpeaking(false)
        audio.play().catch(() => setIsSpeaking(false))
      } else {
        fallbackSpeak(text)
      }
    } catch {
      fallbackSpeak(text)
    }
  }

  const fallbackSpeak = (text) => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 300))
      utterance.rate = 1.0
      utterance.pitch = 1.0
      utterance.onend = () => setIsSpeaking(false)
      utterance.onerror = () => setIsSpeaking(false)
      window.speechSynthesis.speak(utterance)
    } else {
      setIsSpeaking(false)
    }
  }

  const startListening = () => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      setError("Speech recognition not supported. Use the text input below.")
      return
    }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = "en-US"

    recognition.onstart = () => setIsListening(true)
    recognition.onresult = (e) => {
      const t = Array.from(e.results).map(r => r[0].transcript).join("")
      setTranscript(t)
      transcriptRef.current = t
    }
    recognition.onend = () => {
      setIsListening(false)
      if (transcriptRef.current) {
        handleUserMessage(transcriptRef.current)
        setTranscript("")
        transcriptRef.current = ""
      }
    }
    recognition.onerror = () => setIsListening(false)

    recognitionRef.current = recognition
    recognition.start()
  }

  const stopListening = () => {
    recognitionRef.current?.stop()
    setIsListening(false)
  }

  const handleUserMessage = async (text) => {
    if (!text.trim() || isThinking) return

    // Interrupt bot speech when user sends a message
    stopSpeaking()

    const userMsg = { role: "user", content: text }
    const newMessages = [...conversationRef.current, userMsg]
    conversationRef.current = newMessages

    setMessages(prev => [...prev, { type: "user", text }])
    setInputText("")
    setIsThinking(true)
    setError("")

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages,
          systemPrompt: SYSTEM_PROMPT,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `Server error (${res.status})`)
      }

      const data = await res.json()
      let parsed

      try {
        const raw = data.content[0].text
        const cleaned = raw.replace(/```json\n?|```/g, "").trim()
        parsed = JSON.parse(cleaned)
      } catch {
        // Robust fallback: try to extract fields via regex from truncated JSON
        const raw = data.content[0].text || ""
        const msgMatch = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/)
        const questionMatch = raw.match(/"question"\s*:\s*"((?:[^"\\]|\\.)*)"/)
        const doneMatch = raw.match(/"done"\s*:\s*(true|false)/)

        // Try to extract itinerary object even from partial JSON
        let itinerary = null
        const itinStart = raw.indexOf('"itinerary"')
        if (itinStart !== -1) {
          const objStart = raw.indexOf('{', itinStart + 11)
          if (objStart !== -1) {
            // Find matching brace by counting
            let depth = 0
            let end = -1
            for (let j = objStart; j < raw.length; j++) {
              if (raw[j] === '{') depth++
              else if (raw[j] === '}') { depth--; if (depth === 0) { end = j; break } }
            }
            if (end !== -1) {
              try { itinerary = JSON.parse(raw.slice(objStart, end + 1)) } catch {}
            }
          }
        }

        parsed = {
          message: msgMatch ? msgMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : raw.slice(0, 300),
          question: questionMatch ? questionMatch[1] : "",
          itinerary,
          done: doneMatch ? doneMatch[1] === "true" : false,
          profileUpdate: null,
        }
      }

      const assistantMsg = {
        role: "assistant",
        content: JSON.stringify(parsed),
      }
      conversationRef.current = [...newMessages, assistantMsg]

      const displayText = parsed.question
        ? `${parsed.message} ${parsed.question}`
        : parsed.message

      setMessages(prev => [...prev, { type: "agent", text: displayText }])
      onConversationUpdate(conversationRef.current)

      if (parsed.profileUpdate) {
        onProfileUpdate(parsed.profileUpdate)
      }

      if (parsed.itinerary) {
        onItineraryUpdate(parsed.itinerary)
      }

      if (parsed.done && parsed.itinerary) {
        setDone(true)
        onComplete(parsed.itinerary, parsed.profileUpdate || {})
      }

      speakMessage(displayText)
    } catch (e) {
      console.error("Chat error:", e)
      setError(e.message || "Something went wrong. Try again.")
    } finally {
      setIsThinking(false)
    }
  }

  const handleTextSubmit = (e) => {
    e.preventDefault()
    handleUserMessage(inputText)
  }

  return (
    <div className="voice-agent">
      <div className="agent-header">
        <div className="agent-avatar">
          <span className="avatar-letter">W</span>
          <span className={`avatar-pulse ${isSpeaking ? "speaking" : isThinking ? "thinking" : ""}`} />
        </div>
        <div className="agent-info">
          <h2 className="agent-name">The Atelier</h2>
          <p className="agent-status">
            {isListening ? "Listening..." : isThinking ? "Thinking..." : isSpeaking ? "Speaking..." : "Your Digital Concierge"}
          </p>
        </div>
        <button
          className={`voice-toggle ${voiceEnabled ? "on" : "off"}`}
          onClick={() => setVoiceEnabled(!voiceEnabled)}
          title={voiceEnabled ? "Mute" : "Unmute"}
        >
          {voiceEnabled ? "🔊" : "🔇"}
        </button>
        {onClose && (
          <button className="close-btn" onClick={onClose} title="Close">
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>close</span>
          </button>
        )}
      </div>

      <div className="messages-list">
        {messages.map((msg, i) => (
          <div key={i} className={`msg msg-${msg.type}`}>
            <span>{msg.text}</span>
          </div>
        ))}
        {isThinking && (
          <div className="msg msg-agent thinking-dots">
            <span /><span /><span />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {!done && (
        <div className="input-area">
          {error && <p className="error-msg">{error}</p>}
          {isListening && transcript && (
            <div className="interim-transcript">{transcript}</div>
          )}
          <div className="input-row">
            <button
              className={`mic-btn ${isListening ? "active" : ""} ${isSpeaking ? "disabled" : ""}`}
              onClick={isListening ? stopListening : startListening}
              disabled={isThinking}
              title={isListening ? "Tap to stop" : "Tap to speak"}
            >
              <MicIcon active={isListening} />
            </button>
            <form onSubmit={handleTextSubmit} className="text-form">
              <input
                type="text"
                placeholder="Or type your answer..."
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                disabled={isThinking || isListening}
                className="text-input"
              />
              <button type="submit" className="send-btn" disabled={!inputText.trim() || isThinking}>
                <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>north_east</span>
              </button>
            </form>
          </div>
          <p className="mic-hint">Tap the mic to speak to Wander</p>
        </div>
      )}

      {done && (
        <div className="done-area">
          <div className="done-msg">
            <span className="done-check">✓</span>
            <p>Your itinerary is ready on the left!</p>
          </div>
          <p className="done-refine">Want to adjust anything? Just type below:</p>
          <form onSubmit={handleTextSubmit} className="text-form refine-form">
            <input
              type="text"
              placeholder="e.g. Make Day 2 more relaxed..."
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              className="text-input"
            />
            <button type="submit" className="send-btn" disabled={!inputText.trim() || isThinking}>
              <span className="material-symbols-outlined" style={{ fontSize: '20px' }}>north_east</span>
            </button>
          </form>
        </div>
      )}
    </div>
  )
}

function MicIcon({ active }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  )
}