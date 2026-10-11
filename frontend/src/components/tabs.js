// Keyboard support for single-tab-stop groups: role="tablist" (segmented controls, view toggles,
// vertical switchers) and role="radiogroup" (star ratings). Left/Right (and Up/Down) move to the
// previous/next item and select it; Home/End jump to the ends.
// Pair with a roving tabindex: tabIndex={selected ? 0 : -1} on each item, so Tab enters the group once.
const GROUP = '[role="tablist"], [role="radiogroup"]'

export const rovingKeyDown = (itemSelector) => (e) => {
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const list = e.currentTarget
  const items = [...list.querySelectorAll(itemSelector)].filter((t) => !t.disabled && t.closest(GROUP) === list)
  const i = items.indexOf(document.activeElement)
  if (i < 0 || !items.length) return
  e.preventDefault()
  let next = i
  if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = items.length - 1
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length
  else next = (i + 1) % items.length
  items[next].focus()
  items[next].scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  items[next].click()
}

export const onTablistKeyDown = rovingKeyDown('[role="tab"]')
export const onRadiogroupKeyDown = rovingKeyDown('[role="radio"]')
