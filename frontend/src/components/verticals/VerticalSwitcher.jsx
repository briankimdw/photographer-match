import { useEffect, useRef } from 'react'
import { GROUPS, VERTICALS, verticalMeta, verticalsInGroup } from '../../verticals/index.js'
import VerticalIcon from './VerticalIcon.jsx'
import { onTablistKeyDown } from '../tabs.js'

// Airbnb-style row of verticals (icon over label), "All" first.
//   value: vertical slug or null (All); onChange(slug|null)
//   counts: { [slug]: n } from countProvidersByVertical(); verticals with providers come
//           first, empty ones follow (dimmed) so people can still look.
export default function VerticalSwitcher({ value, onChange, counts }) {
  const ref = useRef()
  const has = (slug) => !counts || (counts[slug] || 0) > 0
  const list = [...VERTICALS.filter((v) => has(v.slug)), ...VERTICALS.filter((v) => !has(v.slug))]
  // A vertical from the URL that the catalog doesn't know still gets a chip.
  if (value && !VERTICALS.some((v) => v.slug === value)) list.unshift(verticalMeta(value))

  // Keep the selected chip in view (e.g. arriving with ?v=catering).
  useEffect(() => {
    ref.current?.querySelector('.v-switch-item.on')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [value])

  return (
    <div className="v-switch scroll-x" ref={ref} role="tablist" aria-label="Service type" onKeyDown={onTablistKeyDown}>
      <button role="tab" aria-selected={!value} tabIndex={!value ? 0 : -1} className={`v-switch-item ${!value ? 'on' : ''}`} onClick={() => onChange(null)}>
        <VerticalIcon name="LayoutGrid" size={22} />
        <span>All</span>
      </button>
      {list.map((v) => (
        <button
          key={v.slug}
          role="tab"
          aria-selected={value === v.slug}
          tabIndex={value === v.slug ? 0 : -1}
          className={`v-switch-item ${value === v.slug ? 'on' : ''} ${has(v.slug) ? '' : 'empty'}`}
          style={{ '--tint': v.tint }}
          onClick={() => onChange(v.slug)}
        >
          <VerticalIcon name={v.icon} size={22} />
          <span>{v.name}</span>
        </button>
      ))}
    </div>
  )
}

// Every vertical as a grid of icons, grouped (GROUPS). For "What do you offer?".
//   value: slug; onChange(slug); live: Set of slugs the database has (others say "Soon"); taken: Set of slugs already listed.
export function VerticalGrid({ value, onChange, live, taken }) {
  return (
    <div className="v-grid-groups">
      {GROUPS.map((g) => (
        <section key={g.slug} className="v-grid-group">
          <div className="filter-label">{g.name}</div>
          <div className="v-grid">
            {verticalsInGroup(g.slug).map((v) => {
              const soon = live && !live.has(v.slug)
              const mine = taken?.has(v.slug)
              return (
                <button
                  type="button"
                  key={v.slug}
                  className={`v-grid-item ${value === v.slug ? 'on' : ''} ${soon ? 'soon' : ''}`}
                  style={{ '--tint': v.tint }}
                  aria-pressed={value === v.slug}
                  disabled={mine}
                  onClick={() => onChange(v.slug)}
                >
                  <span className="v-grid-icon"><VerticalIcon name={v.icon} size={20} /></span>
                  <span className="v-grid-name">{v.name}</span>
                  {mine ? <span className="v-grid-note">Listed</span> : soon ? <span className="v-grid-note">Soon</span> : null}
                </button>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
