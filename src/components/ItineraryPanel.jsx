import { useState, useEffect } from "react"
import "./ItineraryPanel.css"

const HERO_IMAGES = {
  default: "https://images.unsplash.com/photo-1506929562872-bb421503ef21?w=1600&q=80",
  beach: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1600&q=80",
  city: "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=1600&q=80",
  mountain: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1600&q=80",
  europe: "https://images.unsplash.com/photo-1499856871958-5b9627545d1a?w=1600&q=80",
  tropical: "https://images.unsplash.com/photo-1552733407-5d5c46c3bb3b?w=1600&q=80",
  japan: "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=1600&q=80",
  desert: "https://images.unsplash.com/photo-1549944850-84e00be4203b?w=1600&q=80",
}

function pickHeroImage(destination) {
  if (!destination) return HERO_IMAGES.default
  const d = destination.toLowerCase()
  if (/beach|island|coast|bali|maldiv|hawaii|cancun|seychell/i.test(d)) return HERO_IMAGES.beach
  if (/mountain|alps|himalay|trek|patagonia|nepal/i.test(d)) return HERO_IMAGES.mountain
  if (/japan|tokyo|kyoto|osaka/i.test(d)) return HERO_IMAGES.japan
  if (/france|paris|italy|rome|florence|venice|spain|madrid|greece|athens|santorini|portugal|lisbon|amsterdam|berlin|vienna|prague|switzerland|london|england|ireland|scotland|europe|munich|brussels|copenhagen|stockholm|budapest|croatia|monaco/i.test(d)) return HERO_IMAGES.europe
  if (/thailand|bangkok|vietnam|philippines|indonesia|singapore|caribbean|costa rica|mexico|puerto rico|fiji|tahiti|sri lanka|cambodia|laos/i.test(d)) return HERO_IMAGES.tropical
  if (/dubai|morocco|egypt|jordan|marrakech|sahara|desert|abu dhabi|qatar|oman|tunisia|petra/i.test(d)) return HERO_IMAGES.desert
  if (/new york|hong kong|shanghai|seoul|mumbai|sydney|melbourne|toronto|chicago|san francisco|los angeles|rio|buenos aires|cape town|istanbul|moscow|beijing|city/i.test(d)) return HERO_IMAGES.city
  return HERO_IMAGES.default
}

export default function ItineraryPanel({ itinerary, userProfile, showDownload, onOpenAgent }) {
  const [activeDay, setActiveDay] = useState(0)
  const [activeTab, setActiveTab] = useState("itinerary")

  const handleDownload = async () => {
    const res = await fetch("/api/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itinerary }),
    })
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${itinerary.destination.replace(/,?\s+/g, "-")}-itinerary.pdf`
      a.click()
    }
  }

  if (!itinerary) {
    return (
      <div className="itinerary-empty">
        <div className="empty-animation">
          <div className="globe-icon">🌍</div>
          <div className="orbit-ring" />
          <div className="orbit-dot" />
        </div>
        <h3>Your itinerary is taking shape</h3>
        <p>As you converse with The Atelier, your bespoke travel plan will materialise here.</p>
        <div className="preview-cards">
          <div className="preview-card skeleton" />
          <div className="preview-card skeleton" style={{ width: "80%", opacity: 0.5 }} />
          <div className="preview-card skeleton" style={{ width: "60%", opacity: 0.25 }} />
        </div>
      </div>
    )
  }

  return (
    <div className="itinerary-panel">
      <nav className="itinerary-nav">
        <span className="itinerary-nav-logo">Wander</span>
        <div className="itinerary-nav-links">
          <a href="#" className={activeTab === "itinerary" ? "active" : ""} onClick={(e) => { e.preventDefault(); setActiveTab("itinerary") }}>Itinerary</a>
          <a href="#" className={activeTab === "transit" ? "active" : ""} onClick={(e) => { e.preventDefault(); setActiveTab("transit") }}>Transit</a>
          <a href="#" className={activeTab === "tips" ? "active" : ""} onClick={(e) => { e.preventDefault(); setActiveTab("tips") }}>Insider Tips</a>
        </div>
        <div className="itinerary-nav-actions">
          {showDownload && (
            <button className="download-btn" onClick={handleDownload}>
              <span className="material-symbols-outlined" style={{ fontSize: "1rem" }}>download</span>
              <span>Export PDF</span>
            </button>
          )}
        </div>
      </nav>

      <div className="itinerary-header">
        <img className="header-bg-img" src={pickHeroImage(itinerary.destination)} alt="" />
        <div className="header-gradient" />
        <div className="header-content">
          <h1 className="destination-title">{itinerary.destination}</h1>
          <div className="trip-meta">
            {itinerary.dates && <span className="meta-tag">{itinerary.dates}</span>}
            {itinerary.travelers && <span className="meta-tag">{itinerary.travelers}</span>}
            {itinerary.budget && <span className="meta-tag">{itinerary.budget}</span>}
          </div>
        </div>
      </div>

      {activeTab === "itinerary" && itinerary.days && (
        <>
          <div className="panel-tabs">
            {itinerary.days.map((day, i) => (
              <button
                key={i}
                className={`tab ${activeDay === i ? "active" : ""}`}
                onClick={() => setActiveDay(i)}
              >
                Day {day.day}
              </button>
            ))}
          </div>

          <div className="itinerary-content">
            <div>
              {itinerary.days[activeDay] && (
                <DayView day={itinerary.days[activeDay]} />
              )}
            </div>
            <div className="sidebar">
              {itinerary.transit_guide && <TransitGuide guide={itinerary.transit_guide} />}
            </div>
          </div>
        </>
      )}

      {activeTab === "transit" && itinerary.transit_guide && (
        <div className="itinerary-content" style={{ gridTemplateColumns: "1fr" }}>
          <TransitGuide guide={itinerary.transit_guide} />
        </div>
      )}

      {activeTab === "tips" && itinerary.insider_tips && (
        <div className="itinerary-content" style={{ gridTemplateColumns: "1fr" }}>
          <InsiderTips tips={itinerary.insider_tips} totalBudget={itinerary.total_budget_estimate} />
        </div>
      )}
    </div>
  )
}

function DayView({ day }) {
  return (
    <div className="day-view">
      <div className="day-header">
        <h2 className="day-title">{day.title}</h2>
        {day.theme && <p className="day-theme">{day.theme}</p>}
        {day.budget_estimate && (
          <span className="day-budget">Est. {day.budget_estimate}</span>
        )}
      </div>

      <div className="time-blocks">
        {day.morning && (
          <TimeBlock time="Morning" emoji="🌅" block={day.morning} color="amber" />
        )}
        {day.afternoon && (
          <TimeBlock time="Afternoon" emoji="☀️" block={day.afternoon} color="accent" />
        )}
        {day.evening && (
          <TimeBlock time="Evening" emoji="🌙" block={day.evening} color="teal" />
        )}
      </div>

      {day.meals && (
        <div className="meals-section">
          <h4 className="section-label">Where to eat</h4>
          <div className="meals-grid">
            {day.meals.breakfast && <MealCard meal={day.meals.breakfast} label="Breakfast" />}
            {day.meals.lunch && <MealCard meal={day.meals.lunch} label="Lunch" />}
            {day.meals.dinner && <MealCard meal={day.meals.dinner} label="Dinner" />}
          </div>
        </div>
      )}

      {day.transport && (
        <div className="transport-note">
          <span className="transport-icon">🚇</span>
          <p>{day.transport}</p>
        </div>
      )}
    </div>
  )
}

function TimeBlock({ time, emoji, block, color }) {
  const [mapUrl, setMapUrl] = useState(null)

  useEffect(() => {
    if (block.place_query) {
      fetch(`/api/maps?query=${encodeURIComponent(block.place_query)}`)
        .then(res => res.json())
        .then(data => setMapUrl(data.mapUrl))
        .catch(err => console.error('Map fetch error:', err))
    }
  }, [block.place_query])

  return (
    <div className={`time-block time-block-${color}`}>
      <div className="time-label">
        <span className="time-emoji">{emoji}</span>
        <span>{time}</span>
        {block.duration && <span className="duration">{block.duration}</span>}
      </div>
      <div className="time-content">
        <p className="activity-name">{block.place || block.activity}</p>
        <p className="activity-desc">{block.activity !== block.place ? block.activity : ""}</p>
        {block.address && <p className="activity-address">📍 {block.address}</p>}
        {block.rating && (
          <div className="activity-rating">
            ⭐ {block.rating}/5
            {block.reviews && block.reviews.length > 0 && (
              <div className="activity-reviews">
                {block.reviews.slice(0, 1).map((review, i) => (
                  <blockquote key={i}>"{review}"</blockquote>
                ))}
              </div>
            )}
          </div>
        )}
        {mapUrl && (
          <div className="activity-map">
            <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(block.place_query || block.place)}`} target="_blank" rel="noopener noreferrer">
              <img src={mapUrl} alt={`${block.place} map`} style={{ width: '100%', height: '200px', borderRadius: '8px', cursor: 'pointer' }} />
            </a>
          </div>
        )}
        {block.tip && (
          <div className="pro-tip">
            <span className="material-symbols-outlined" style={{ fontSize: "1rem", color: "var(--primary, #7d5630)" }}>lightbulb</span>
            <span>{block.tip}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function MealCard({ meal, label }) {
  const [mapUrl, setMapUrl] = useState(null)

  useEffect(() => {
    if (meal.place_query) {
      fetch(`/api/maps?query=${encodeURIComponent(meal.place_query)}`)
        .then(res => res.json())
        .then(data => setMapUrl(data.mapUrl))
        .catch(err => console.error('Map fetch error:', err))
    }
  }, [meal.place_query])

  return (
    <div className="meal-card">
      <div className="meal-header">
        <span className="meal-label">{label}</span>
        {meal.cost && <span className="meal-cost">{meal.cost}</span>}
      </div>
      <p className="meal-name">{meal.name}</p>
      {meal.type && <p className="meal-type">{meal.type}</p>}
      {meal.address && <p className="meal-address">📍 {meal.address}</p>}
      {meal.rating && (
        <div className="meal-rating">
          ⭐ {meal.rating}/5
          {meal.reviews && meal.reviews.length > 0 && (
            <div className="meal-reviews">
              {meal.reviews.slice(0, 1).map((review, i) => (
                <blockquote key={i}>"{review}"</blockquote>
              ))}
            </div>
          )}
        </div>
      )}
      {mapUrl && (
        <div className="meal-map">
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(meal.place_query || meal.name)}`} target="_blank" rel="noopener noreferrer">
            <img src={mapUrl} alt={`${meal.name} map`} style={{ width: '100%', height: '150px', borderRadius: '8px', cursor: 'pointer' }} />
          </a>
        </div>
      )}
      {meal.why && <p className="meal-why">{meal.why}</p>}
    </div>
  )
}

function TransitGuide({ guide }) {
  return (
    <div className="insider-tips-card">
      <h3><span className="material-symbols-outlined tips-icon">directions_transit</span> Transit Guide</h3>
      {guide.overview && (
        <div className="transit-overview">
          <p>{guide.overview}</p>
        </div>
      )}
      {guide.key_card && (
        <div className="key-card-callout">
          <span className="material-symbols-outlined" style={{ color: "var(--primary, #7d5630)" }}>credit_card</span>
          <div>
            <p className="callout-label">Key card / pass</p>
            <p>{guide.key_card}</p>
          </div>
        </div>
      )}
      {guide.apps && guide.apps.length > 0 && (
        <div className="transit-section">
          <h4>Apps to download</h4>
          <div className="app-tags">
            {guide.apps.map((app, i) => (
              <span key={i} className="app-tag">{app}</span>
            ))}
          </div>
        </div>
      )}
      {guide.tips && guide.tips.length > 0 && (
        <div className="transit-section">
          <h4>Tips</h4>
          <ul className="transit-list">
            {guide.tips.map((tip, i) => (
              <li key={i}>{tip}</li>
            ))}
          </ul>
        </div>
      )}
      {guide.common_mistakes && guide.common_mistakes.length > 0 && (
        <div className="transit-section mistakes">
          <h4>Common mistakes to avoid</h4>
          <ul className="transit-list">
            {guide.common_mistakes.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function InsiderTips({ tips, totalBudget }) {
  return (
    <div className="insider-tips-card">
      <h3><span className="material-symbols-outlined tips-icon">auto_awesome</span> Insider Tips</h3>
      {totalBudget && (
        <div className="budget-summary">
          <p className="budget-label">Total trip estimate</p>
          <p className="budget-amount">{totalBudget}</p>
        </div>
      )}
      <div className="tips-list">
        {tips.map((tip, i) => (
          <div key={i} className="tip-item">
            <span className="tip-num">{String(i + 1).padStart(2, "0")}</span>
            <p>{tip}</p>
          </div>
        ))}
      </div>
    </div>
  )
}