import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import useDocumentTitle from './useDocumentTitle.js'

// `heading={false}` when the page has its own <h1> below the bar.
export default function TopBar({ title, subtitle, right, back = true, heading = true }) {
  const navigate = useNavigate()
  useDocumentTitle(typeof title === 'string' && title ? title : null)
  const Title = heading ? 'h1' : 'div'
  return (
    <header className="topbar">
      <div className="topbar-side">
        {back && (
          <button className="icon-btn" onClick={() => navigate(-1)} aria-label="Back">
            <ChevronLeft size={24} aria-hidden="true" />
          </button>
        )}
      </div>
      <Title className="topbar-title">
        <span className="topbar-name">{title}</span>
        {subtitle && <small>{subtitle}</small>}
      </Title>
      <div className="topbar-side right">{right}</div>
    </header>
  )
}
