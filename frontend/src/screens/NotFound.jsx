import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import TopBar from '../components/TopBar.jsx'
import { EmptyState } from '../components/States.jsx'

// Any URL no route matches (a mistyped or outdated link).
export default function NotFound() {
  return (
    <div>
      <TopBar title="Page not found" />
      <EmptyState
        icon={Compass}
        title="This page doesn’t exist"
        text="The link may be mistyped or out of date."
        action={<Link to="/" className="btn sm">Go home</Link>}
      />
    </div>
  )
}
