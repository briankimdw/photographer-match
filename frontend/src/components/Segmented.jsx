import { onTablistKeyDown } from './tabs.js'

// A segmented control is a small tab list: one tab stop, arrow keys switch between options.
export default function Segmented({ options, value, onChange, className = '', label }) {
  return (
    <div className={`segmented ${className}`} role="tablist" aria-label={label} onKeyDown={onTablistKeyDown}>
      {options.map((o, i) => {
        const val = typeof o === 'string' ? o : o.value
        const lab = typeof o === 'string' ? o : o.label
        const on = value === val
        const none = !options.some((x) => (typeof x === 'string' ? x : x.value) === value)
        return (
          <button key={val} type="button" role="tab" aria-selected={on} tabIndex={on || (none && i === 0) ? 0 : -1} className={on ? 'active' : ''} onClick={() => onChange(val)}>
            {lab}
          </button>
        )
      })}
    </div>
  )
}
