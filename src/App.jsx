import { useState } from "react"
import VoiceAgent from "./components/VoiceAgent"
import ItineraryPanel from "./components/ItineraryPanel"
import WelcomeScreen from "./components/WelcomeScreen"
import "./App.css"

const GREETING = "Hi! I'm Wander, your AI travel planner. Where in the world are you dreaming of going?"

export default function App() {
  const [phase, setPhase] = useState("welcome") // welcome | planning | result
  const [itinerary, setItinerary] = useState(null)
  const [userProfile, setUserProfile] = useState({})
  const [showAgent, setShowAgent] = useState(false)

  // The concierge unmounts every time it's closed, so anything that needs to
  // survive a close/reopen lives here instead of inside VoiceAgent.
  // `conversation` is the full LLM history and is re-sent on every turn;
  // `chatMessages` is the separate display shape rendered as bubbles.
  const [conversation, setConversation] = useState([])
  const [chatMessages, setChatMessages] = useState([{ type: "agent", text: GREETING }])
  const [agentDone, setAgentDone] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(true)

  const handleStart = () => {
    setPhase("planning")
    setShowAgent(true)
  }

  const handleItineraryUpdate = (newItinerary) => {
    setItinerary(newItinerary)
  }

  // The model sends a partial delta each turn, so merge rather than replace —
  // otherwise preferences gathered on earlier turns get dropped.
  const handleProfileUpdate = (profile) => {
    setUserProfile(prev => ({ ...prev, ...profile }))
  }

  const handleComplete = (finalItinerary, profile) => {
    setItinerary(finalItinerary)
    setUserProfile(prev => ({ ...prev, ...profile }))
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
                conversation={conversation}
                setConversation={setConversation}
                chatMessages={chatMessages}
                setChatMessages={setChatMessages}
                done={agentDone}
                setDone={setAgentDone}
                voiceEnabled={voiceEnabled}
                setVoiceEnabled={setVoiceEnabled}
                greeting={GREETING}
                onItineraryUpdate={handleItineraryUpdate}
                onProfileUpdate={handleProfileUpdate}
                onComplete={handleComplete}
                onClose={() => setShowAgent(false)}
                resultMode={phase === "result"}
              />
            </>
          )}
        </div>
      )}
    </div>
  )
}