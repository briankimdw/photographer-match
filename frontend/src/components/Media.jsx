import { useState } from 'react'
import { RealPhoto } from './Badges.jsx'

const srcOf = (p) => (typeof p === 'string' ? p : p?.src)

// photos: image URLs (or { src } objects).
// label: what the photos show (e.g. the post title), used for their alt text.
export function Carousel({ photos = [], aspect = '4 / 5', label = '' }) {
  const seeds = photos.map(srcOf).filter(Boolean)
  const [index, setIndex] = useState(0)
  const onScroll = (e) => setIndex(Math.round(e.target.scrollLeft / e.target.clientWidth))
  const many = seeds.length > 1
  return (
    <div className="carousel" style={{ aspectRatio: aspect }}>
      {/* Focusable when it scrolls, so arrow keys can page through the photos. */}
      <div className="carousel-track" onScroll={onScroll} tabIndex={many ? 0 : undefined}
        role={many ? 'group' : undefined} aria-roledescription={many ? 'carousel' : undefined}
        aria-label={many ? `${label || 'Photos'}, ${seeds.length} photos` : undefined}>
        {seeds.map((s, i) => (
          <img key={s} src={s} alt={label ? (many ? `${label}, photo ${i + 1} of ${seeds.length}` : label) : ''} loading="lazy" draggable={false} />
        ))}
      </div>
      {many && (
        <>
          <div className="carousel-count" aria-hidden="true">
            {index + 1}/{seeds.length}
          </div>
          <div className="carousel-dots" aria-hidden="true">
            {seeds.map((s, i) => (
              <span key={s} className={i === index ? 'on' : ''} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Paired before/after viewer: src is the edited photo, beforeSrc the original.
// Without a beforeSrc the "before" side fakes an unedited look with a CSS filter.
export function BeforeAfter({ src, beforeSrc, aspect = '4 / 5' }) {
  const [pos, setPos] = useState(50)
  return (
    <div className="before-after" style={{ aspectRatio: aspect }}>
      <img src={src} alt="After" draggable={false} />
      <div className={`ba-before ${beforeSrc ? 'real' : ''}`} style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <img src={beforeSrc || src} alt="Before" draggable={false} />
      </div>
      <div className="ba-divider" style={{ left: `${pos}%` }} aria-hidden="true">
        <span className="ba-knob">⇆</span>
      </div>
      <span className="ba-label left" aria-hidden="true">Before</span>
      <span className="ba-label right" aria-hidden="true">After</span>
      <input
        type="range"
        min="0"
        max="100"
        value={pos}
        onChange={(e) => setPos(Number(e.target.value))}
        onClick={(e) => e.stopPropagation()}
        aria-label="Before and after: drag or use arrow keys to compare"
        aria-valuetext={`${pos}% before`}
      />
    </div>
  )
}

// An album (from toViewerAlbum) as a carousel or before/after slider.
export function PostMedia({ post }) {
  return (
    <div className="post-media">
      {post.type === 'beforeafter' ? <BeforeAfter src={post.photos[0]?.src} beforeSrc={post.photos[0]?.beforeSrc} /> : <Carousel photos={post.photos} label={post.title} />}
      {post.realPhoto && <RealPhoto overlay />}
    </div>
  )
}
