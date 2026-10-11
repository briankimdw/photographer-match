import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import useDialog from './useDialog.js'

// Bottom sheet rendered inside the phone frame. A modal dialog: focus moves in when it opens,
// stays inside while it's open, Escape closes it, and focus returns to the trigger afterwards.
// `label` names a sheet that has no visible title.
export default function Sheet({ open, onClose, title, label, children }) {
  const ref = useRef(null)
  const titleId = useId()
  useDialog(ref, open, onClose)
  if (!open) return null
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet" ref={ref} role="dialog" aria-modal="true" tabIndex={-1}
        aria-labelledby={title ? titleId : undefined} aria-label={title ? undefined : label || 'Options'}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-handle" aria-hidden="true" />
        {title && (
          <div className="sheet-head">
            <h2 className="sheet-title" id={titleId}>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
      </div>
    </div>,
    document.getElementById('phone'),
  )
}
