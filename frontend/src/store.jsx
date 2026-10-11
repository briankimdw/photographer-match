import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from './auth.jsx'
import { getMyProviders } from './api/portfolio.js'
import * as social from './api/social.js'
import { addCorrections as saveCorrections, getTasteProfile, likePhoto, removeCorrection as deleteCorrection } from './api/discover.js'
import { invalidate } from './api/catalog.js'

// App-wide state for the signed-in user, kept in sync with Supabase:
// who they follow, their shortlist, liked/saved photos, "Not into this" tags,
// and their photographer listing (if any). Screen-specific data (bookings,
// messages, profiles) is loaded by each screen through src/api/*.
const StoreContext = createContext(null)

// Which listing is selected, remembered on this device.
const SELECTED_KEY = 'pm:selected-listing'
const readSelected = () => {
  try { return localStorage.getItem(SELECTED_KEY) } catch { return null }
}

const toggled = (set, id, on) => {
  const next = new Set(set)
  on ? next.add(id) : next.delete(id)
  return next
}

export function StoreProvider({ children }) {
  const { user } = useAuth()
  const uid = user?.id ?? null

  // A user may have several listings (one per vertical); one is selected at a time.
  const [myProviders, setMyProviders] = useState([]) // providers rows (+ `vertical` slug)
  const [selectedId, setSelectedId] = useState(readSelected)
  const myProvider = myProviders.find((p) => p.id === selectedId) || myProviders[0] || null
  const [following, setFollowing] = useState(new Set()) // provider ids
  const [shortlist, setShortlist] = useState(new Set()) // provider ids
  const [liked, setLiked] = useState(new Set()) // photo ids
  const [saved, setSaved] = useState(new Set()) // photo ids in any collection
  const [corrections, setCorrections] = useState([]) // "Not into this" tags
  const [discoverHistory, setDiscoverHistory] = useState([]) // this session's swipes: [{ id, action, swipeId }]
  const [mode, setMode] = useState('client') // client | provider
  const [payoutsConnected, setPayoutsConnected] = useState(false) // Stripe isn't connected yet
  const [watermarkDefault, setWatermarkDefault] = useState(true)
  const [toastMsg, setToastMsg] = useState(null)
  const toastTimer = useRef()

  const toast = useCallback((msg) => {
    setToastMsg(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(null), 2600)
  }, [])

  // Reload my listings; `select` (a provider id) switches to that listing, e.g. one just created.
  const refreshProvider = useCallback(async (select = null) => {
    if (!uid) return setMyProviders([])
    try {
      setMyProviders(await getMyProviders(uid))
      if (typeof select === 'string') selectProvider(select)
    } catch (e) {
      console.warn(e)
    }
  }, [uid]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectProvider = useCallback((id) => {
    setSelectedId(id)
    try { localStorage.setItem(SELECTED_KEY, id) } catch { /* private mode */ }
  }, [])

  // Load everything for the signed-in user; clear it on sign-out.
  useEffect(() => {
    setDiscoverHistory([])
    if (!uid) {
      setMyProviders([])
      setFollowing(new Set())
      setShortlist(new Set())
      setLiked(new Set())
      setSaved(new Set())
      setCorrections([])
      setMode('client')
      return
    }
    let live = true
    Promise.all([
      getMyProviders(uid),
      social.listFollowing(),
      social.listShortlist(),
      social.listLikedPhotoIds(),
      social.listSavedPhotoIds(),
      getTasteProfile(),
    ])
      .then(([providers, follows, short, likes, saves, taste]) => {
        if (!live) return
        setMyProviders(providers)
        setFollowing(new Set(follows))
        setShortlist(new Set(short))
        setLiked(new Set(likes))
        setSaved(new Set(saves))
        setCorrections(taste.corrections)
      })
      .catch((e) => console.warn('Could not load your data', e))
    return () => {
      live = false
    }
  }, [uid])

  // Optimistic toggle: update the UI now, write to the database, undo on failure.
  const optimistic = (setter, id, on, write, verb) => {
    if (!uid) {
      toast(`Sign in to ${verb}`)
      return false
    }
    setter((s) => toggled(s, id, on))
    write().catch((e) => {
      console.warn(e)
      setter((s) => toggled(s, id, !on))
      toast('Couldn’t save that. Try again.')
    })
    return true
  }

  const toggleFollow = (providerId) => {
    const on = !following.has(providerId)
    return optimistic(setFollowing, providerId, on, () => {
      invalidate('providers') // follower counts
      return on ? social.follow(providerId) : social.unfollow(providerId)
    }, 'follow vendors')
  }

  const toggleShortlist = (providerId) => {
    const on = !shortlist.has(providerId)
    return optimistic(setShortlist, providerId, on, () => (on ? social.addToShortlist(providerId) : social.removeFromShortlist(providerId)), 'save vendors')
  }

  // photo: { id (photo id), albumId, providerId }. Liking is a taste signal; un-liking just clears the heart.
  const toggleLike = (photo) => {
    const id = photo.id ?? photo
    const on = !liked.has(id)
    return optimistic(setLiked, id, on, () => (on ? likePhoto(typeof photo === 'object' ? photo : { id }) : Promise.resolve()), 'like photos')
  }

  // Save to (or remove from) the default "Saved" collection.
  const toggleSave = (photoId) => {
    const on = !saved.has(photoId)
    return optimistic(setSaved, photoId, on, async () => {
      const col = await social.defaultCollection()
      return on ? social.addToCollection(col.id, photoId) : social.removeFromCollection(col.id, photoId)
    }, 'save photos')
  }
  // After saving into a specific collection (SaveSheet), mark it saved here too.
  const markSaved = (photoId) => setSaved((s) => toggled(s, photoId, true))

  const addCorrections = (tags) => {
    if (!uid) return toast('Sign in to tune your feed')
    setCorrections((prev) => [...new Set([...prev, ...tags])])
    saveCorrections(tags).catch((e) => console.warn(e))
  }
  const removeCorrection = (tag) => {
    setCorrections((prev) => prev.filter((t) => t !== tag))
    deleteCorrection(tag).catch((e) => console.warn(e))
  }

  const value = {
    // signed-in user's listings (one per vertical) and the selected one
    myProvider, myProviders, refreshProvider, selectProvider,
    isProvider: !!myProvider,
    identityStatus: myProvider?.identity_verified ? 'verified' : 'unverified',
    // social
    following, toggleFollow,
    shortlist, toggleShortlist,
    liked, toggleLike,
    saved, toggleSave, markSaved,
    // discover
    discoverHistory, setDiscoverHistory,
    corrections, addCorrections, removeCorrection,
    // UI
    mode, setMode,
    payoutsConnected, setPayoutsConnected,
    watermarkDefault, setWatermarkDefault,
    toast, toastMsg,
  }
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export const useStore = () => useContext(StoreContext)
