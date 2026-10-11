// Search for people by name or @username and pick one or more (the web's
// components/PeoplePicker.jsx). An empty box lists people you've talked to.
//   selected: [{ profileId, name, avatar, ... }]; onChange(nextSelected)
//   exclude: profile ids that can't be picked (e.g. people already in the group)
import { Briefcase, Check, Search, X } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'

import { searchPeople } from '@shared/api/messages.js'
import { Avatar, Loading, Text, TextField } from '@/components'
import { makeStyles, useTheme } from '@/theme'

// What searchPeople() returns (and conversation members look like).
export type Person = {
  id: string
  profileId: string
  name: string
  username?: string | null
  avatar: string
  isPhotographer?: boolean
  businessName?: string | null
  city?: string | null
}

type Props = {
  selected: Person[]
  onChange: (next: Person[]) => void
  exclude?: string[]
  autoFocus?: boolean
  max?: number
}

export default function PeoplePicker({ selected, onChange, exclude = [], autoFocus = true, max = 30 }: Props) {
  const s = useStyles()
  const { c } = useTheme()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Person[] | null>(null)
  const [busy, setBusy] = useState(false)

  // Debounced search.
  useEffect(() => {
    let live = true
    setBusy(true)
    const t = setTimeout(() => {
      searchPeople(q)
        .then((r) => live && setResults(r as Person[]))
        .catch((e: unknown) => {
          console.warn(e)
          if (live) setResults([])
        })
        .finally(() => live && setBusy(false))
    }, q ? 250 : 0)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q])

  const picked = new Set(selected.map((p) => p.profileId))
  const toggle = (p: Person) => {
    if (picked.has(p.profileId)) onChange(selected.filter((x) => x.profileId !== p.profileId))
    else if (selected.length < max) onChange([...selected, p])
  }
  const list = (results || []).filter((p) => !exclude.includes(p.profileId))

  return (
    <View>
      {selected.length > 0 && (
        <View style={s.tokens}>
          {selected.map((p) => (
            <Pressable key={p.profileId} onPress={() => toggle(p)} style={s.token} accessibilityRole="button" accessibilityLabel={`Remove ${p.name}`}>
              <Text variant="small" weight="600" style={{ color: c.onInk }}>{p.name.split(' ')[0]}</Text>
              <X size={12} color={c.onInk} />
            </Pressable>
          ))}
        </View>
      )}
      <TextField
        icon={Search}
        autoFocus={autoFocus}
        placeholder={selected.length ? 'Add more…' : 'Search by name or @username'}
        value={q}
        onChangeText={setQ}
        autoCapitalize="none"
        autoCorrect={false}
        clearable
        returnKeyType="search"
        onKeyPress={(e) => {
          if (e.nativeEvent.key === 'Backspace' && !q && selected.length) onChange(selected.slice(0, -1))
        }}
      />

      <Text variant="label" style={s.label}>{q.trim() ? 'People' : 'Recent'}</Text>
      {busy && !results ? (
        <Loading inline />
      ) : !list.length ? (
        <Text variant="small" muted style={s.empty}>
          {q.trim() ? `No one found for “${q.trim()}”.` : 'Search for anyone: vendors or clients.'}
        </Text>
      ) : (
        list.map((p) => {
          const on = picked.has(p.profileId)
          const sub = [p.username && `@${p.username}`, p.businessName && p.businessName !== p.name ? p.businessName : null, p.city].filter(Boolean).join(' · ')
          return (
            <Pressable
              key={p.profileId}
              onPress={() => toggle(p)}
              style={({ pressed }) => [s.row, pressed && { backgroundColor: c.soft }]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }} aria-checked={on}
              accessibilityLabel={p.name}
            >
              <Avatar uri={p.avatar} name={p.name} />
              <View style={s.grow}>
                <View style={s.nameRow}>
                  <Text weight="600" numberOfLines={1} style={s.shrink}>{p.name}</Text>
                  {p.isPhotographer && (
                    <View style={s.badge} accessibilityLabel="Vendor">
                      <Briefcase size={10} color={c.muted} />
                    </View>
                  )}
                </View>
                {!!sub && <Text variant="tiny" muted numberOfLines={1}>{sub}</Text>}
              </View>
              <View style={[s.check, on && s.checkOn]}>{on && <Check size={14} strokeWidth={3} color={c.onInk} />}</View>
            </Pressable>
          )
        })
      )}
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  tokens: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: t.space.sm },
  token: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.c.ink, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  label: { marginTop: t.space.lg, marginBottom: t.space.xs },
  empty: { paddingVertical: t.space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderRadius: t.radius.md },
  grow: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  badge: { width: 18, height: 18, borderRadius: 9, backgroundColor: t.c.soft, alignItems: 'center', justifyContent: 'center' },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: t.c.line, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: t.c.ink, borderColor: t.c.ink },
}))
