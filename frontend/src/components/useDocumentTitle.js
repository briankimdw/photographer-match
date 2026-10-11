import { useEffect } from 'react'

export const APP_NAME = 'PhotoMatch'

// Sets the browser tab / screen-reader page title ("Bookings · PhotoMatch").
// App sets a per-route default first; screens with a more specific name (a vendor, an event) override it.
export default function useDocumentTitle(title) {
  useEffect(() => {
    if (title) document.title = `${title} · ${APP_NAME}`
  }, [title])
}
