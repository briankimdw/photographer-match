import { Star } from 'lucide-react'
import { onRadiogroupKeyDown } from './tabs.js'

// Read-only: an image labelled "Rated 4.5 out of 5".
// With onChange: a radio group (one tab stop, arrow keys pick a rating), named by `label`.
export default function Stars({ value, size = 14, onChange, label = 'Rating' }) {
  if (!onChange) {
    const rounded = Math.round((value ?? 0) * 10) / 10
    return (
      <span className="stars" role="img" aria-label={`Rated ${rounded} out of 5`}>
        {[1, 2, 3, 4, 5].map((n) => {
          const on = n <= Math.round(value)
          return <Star key={n} size={size} className={on ? 'on' : ''} fill={on ? 'currentColor' : 'none'} aria-hidden="true" />
        })}
      </span>
    )
  }
  const current = Math.round(value) || 0
  return (
    <span className="stars stars-input" role="radiogroup" aria-label={label} onKeyDown={onRadiogroupKeyDown}>
      {[1, 2, 3, 4, 5].map((n) => {
        const on = n <= current
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === current}
            aria-label={`${n} star${n === 1 ? '' : 's'}`}
            tabIndex={n === current || (!current && n === 1) ? 0 : -1}
            className={on ? 'on' : ''}
            onClick={() => onChange(n)}
          >
            <Star size={size} fill={on ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>
        )
      })}
    </span>
  )
}

