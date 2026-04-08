export default function WelcomeScreen({ onStart }) {
  return (
    <div className="welcome-screen">
      {/* Top Nav */}
      <nav className="welcome-nav">
        <div className="welcome-logo">Wander</div>
        <div className="welcome-nav-links">
          <a href="#" className="nav-link active">Journal</a>
          <a href="#" className="nav-link">Destinations</a>
          <a href="#" className="nav-link">Experiences</a>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="welcome-hero">
        <div className="hero-bg">
          <img
            src="https://images.unsplash.com/photo-1533105079780-92b9be482077?w=1920&q=80"
            alt="Stunning coastal view"
            className="hero-img"
          />
          <div className="hero-overlay" />
        </div>
        <div className="hero-content">
          <h1 className="hero-title">Wander</h1>
          <p className="hero-subtitle">Your AI-powered luxury travel concierge</p>
          <button className="hero-cta" onClick={onStart}>
            Plan Your Journey
          </button>
        </div>
        <div className="scroll-hint">
          <span className="scroll-text">Discover More</span>
          <span className="material-symbols-outlined">expand_more</span>
        </div>
      </main>

      <style>{`
        .welcome-screen {
          min-height: 100vh;
          background: #fcf9f5;
          color: #1c1c1a;
          font-family: 'Manrope', sans-serif;
        }

        .welcome-nav {
          position: fixed;
          top: 0;
          width: 100%;
          z-index: 50;
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 1.5rem 2.5rem;
          backdrop-filter: blur(12px);
          background: transparent;
        }

        .welcome-logo {
          font-family: 'Noto Serif', serif;
          font-size: 1.5rem;
          font-weight: 700;
          color: #c4956a;
        }

        .welcome-nav-links {
          display: flex;
          gap: 3rem;
          align-items: center;
        }

        .nav-link {
          font-family: 'Noto Serif', serif;
          font-size: 1.05rem;
          color: rgba(255, 255, 255, 0.85);
          text-decoration: none;
          letter-spacing: -0.02em;
          transition: opacity 0.3s;
        }
        .nav-link:hover { opacity: 0.7; }
        .nav-link.active { color: #c4956a; font-weight: 500; }

        .welcome-hero {
          position: relative;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        }

        .hero-bg {
          position: absolute;
          inset: 0;
          z-index: 0;
        }

        .hero-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .hero-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(to bottom, rgba(0,0,0,0.4), transparent 50%, #fcf9f5);
        }

        .hero-content {
          position: relative;
          z-index: 10;
          text-align: center;
          padding: 1.5rem;
          max-width: 900px;
        }

        .hero-title {
          font-family: 'Noto Serif', serif;
          font-size: clamp(4rem, 12vw, 10rem);
          font-weight: 400;
          color: white;
          letter-spacing: -0.03em;
          line-height: 1;
          margin-bottom: 1rem;
          text-shadow: 0 2px 40px rgba(0,0,0,0.15);
        }

        .hero-subtitle {
          font-family: 'Noto Serif', serif;
          font-size: clamp(1rem, 2.5vw, 1.5rem);
          font-style: italic;
          color: rgba(255, 255, 255, 0.9);
          margin-bottom: 3rem;
          letter-spacing: 0.02em;
        }

        .hero-cta {
          background: linear-gradient(135deg, #7d5630, #c4956a);
          color: white;
          border: none;
          border-radius: 0.75rem;
          padding: 1.15rem 3rem;
          font-family: 'Manrope', sans-serif;
          font-size: 0.85rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          cursor: pointer;
          box-shadow: 0 10px 40px -10px rgba(28, 28, 26, 0.15);
          transition: transform 0.2s, box-shadow 0.2s;
        }
        .hero-cta:hover {
          transform: translateY(-2px);
          box-shadow: 0 16px 48px -10px rgba(125, 86, 48, 0.35);
        }
        .hero-cta:active { transform: scale(0.97); }

        .scroll-hint {
          position: absolute;
          bottom: 3rem;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0.5rem;
          opacity: 0.5;
        }

        .scroll-text {
          font-family: 'Manrope', sans-serif;
          font-size: 0.6rem;
          text-transform: uppercase;
          letter-spacing: 0.2em;
          color: #1c1c1a;
        }

        .scroll-hint .material-symbols-outlined {
          color: #1c1c1a;
          font-size: 1.25rem;
        }

        @media (max-width: 768px) {
          .welcome-nav-links { display: none; }
          .welcome-nav { padding: 1rem 1.5rem; }
        }
      `}</style>
    </div>
  )
}
