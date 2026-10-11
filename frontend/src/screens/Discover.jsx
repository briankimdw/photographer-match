import { useSearchParams } from 'react-router-dom'
import { onTablistKeyDown } from '../components/tabs.js'
import SwipeDeck from '../components/discover/SwipeDeck.jsx'
import Explore from '../components/discover/Explore.jsx'
import '../components/discover/discover.css'

// Discover = get inspired. Two modes, switched in the header:
//   For you  — the SigLIP-ranked swipe deck (one vertical at a time)
//   Explore  — a masonry grid of real work across every vertical
// The mode lives in the URL (?mode=explore) so Back returns to the same view.
export default function Discover() {
  const [params, setParams] = useSearchParams()
  const mode = params.get('mode') === 'explore' ? 'explore' : 'foryou'
  const setMode = (next) => {
    if (next === mode) return
    const p = new URLSearchParams()
    if (next === 'explore') p.set('mode', 'explore')
    setParams(p, { replace: true })
    document.querySelector('.viewport')?.scrollTo({ top: 0 })
    // The other mode renders its own header: keep keyboard focus on the tab the user picked.
    if (document.activeElement?.closest?.('.dc-tabs')) {
      requestAnimationFrame(() => document.querySelector('.dc-tabs [aria-selected="true"]')?.focus())
    }
  }

  const tabs = (
    <>
    <h1 className="sr-only">Discover</h1>
    <div className="dc-tabs" role="tablist" aria-label="Discover" onKeyDown={onTablistKeyDown}>
      {[
        { value: 'foryou', label: 'For you' },
        { value: 'explore', label: 'Explore' },
      ].map((t) => (
        <button key={t.value} role="tab" aria-selected={mode === t.value} tabIndex={mode === t.value ? 0 : -1} className={mode === t.value ? 'on' : ''} onClick={() => setMode(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
    </>
  )

  return mode === 'explore' ? <Explore tabs={tabs} /> : <SwipeDeck tabs={tabs} initialVertical={params.get('v') || undefined} />
}
