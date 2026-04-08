import { useState, useRef, useEffect } from "react"
import VoiceAgent from "./components/VoiceAgent"
import ItineraryPanel from "./components/ItineraryPanel"
import WelcomeScreen from "./components/WelcomeScreen"
import "./App.css"

export default function App() {
  const [phase, setPhase] = useState("welcome") // welcome | planning | result
  const [itinerary, setItinerary] = useState(null)
  const [conversation, setConversation] = useState([])
  const [userProfile, setUserProfile] = useState({})
  const [showAgent, setShowAgent] = useState(false)

  const handleStart = () => {
    setPhase("planning")
    setShowAgent(true)
  }

  const handleItineraryUpdate = (newItinerary) => {
    setItinerary(newItinerary)
  }

  const handleConversationUpdate = (msgs) => {
    setConversation(msgs)
  }

  const handleProfileUpdate = (profile) => {
    setUserProfile(profile)
  }

  const handleComplete = (finalItinerary, profile) => {
    setItinerary(finalItinerary)
    setUserProfile(profile)
    setPhase("result")
  }

  return (
    <div className="app">
      {phase === "welcome" && (
        <WelcomeScreen onStart={handleStart} />
      )}
      {(phase === "planning" || phase === "result") && (
        <div className="main-layout">
          <ItineraryPanel
            itinerary={itinerary}
            userProfile={userProfile}
            showDownload={phase === "result"}
            onOpenAgent={() => setShowAgent(true)}
          />

          {/* Floating concierge button */}
          {!showAgent && (
            <button className="concierge-fab" onClick={() => setShowAgent(true)} title="Open Wander Concierge">
              <span className="material-symbols-outlined">auto_awesome</span>
            </button>
          )}

          {/* Voice Agent overlay */}
          {showAgent && (
            <>
              <div className="voice-overlay-backdrop" onClick={() => setShowAgent(false)} />
              <VoiceAgent
                onItineraryUpdate={handleItineraryUpdate}
                onConversationUpdate={handleConversationUpdate}
                onProfileUpdate={handleProfileUpdate}
                onComplete={handleComplete}
                onClose={() => setShowAgent(false)}
                resultMode={phase === "result"}
                finalItinerary={itinerary}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}