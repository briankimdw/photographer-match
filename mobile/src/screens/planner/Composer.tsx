// The planner's prompt box (the web's components/planner/Composer.jsx). `hero` is the big
// first-message version; otherwise the compact follow-up bar docked at the bottom.
// `replyTo` shows which planner question is being answered.
import { ArrowUp, CornerDownRight, X } from 'lucide-react-native'
import { useEffect, useRef } from 'react'
import { Pressable, TextInput, View } from 'react-native'

import { Text } from '@/components'
import { makeStyles, useTheme } from '@/theme'

type Props = {
  value: string
  onChange: (v: string) => void
  onSubmit: (text: string) => void
  busy?: boolean
  hero?: boolean
  placeholder?: string
  replyTo?: string | null
  onClearReply?: () => void
}

export default function Composer({ value, onChange, onSubmit, busy = false, hero = false, placeholder, replyTo, onClearReply }: Props) {
  const s = useStyles()
  const { c } = useTheme()
  const ref = useRef<TextInput>(null)

  useEffect(() => {
    if (replyTo) ref.current?.focus()
  }, [replyTo])

  const canSend = value.trim().length > 0 && !busy
  const submit = () => {
    if (canSend) onSubmit(value.trim())
  }

  return (
    <View>
      {!!replyTo && (
        <View style={s.replyTo}>
          <CornerDownRight size={14} color={c.muted} />
          <Text variant="tiny" muted numberOfLines={1} style={s.grow}>{replyTo}</Text>
          <Pressable onPress={onClearReply} hitSlop={15} accessibilityRole="button" accessibilityLabel="Stop replying">
            <X size={14} color={c.muted} />
          </Pressable>
        </View>
      )}
      <View style={[s.box, hero && s.boxHero]}>
        <TextInput
          ref={ref}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={c.faint}
          multiline
          // Return sends on the compact bar; the hero box allows new lines.
          submitBehavior={hero ? 'newline' : 'submit'}
          onSubmitEditing={hero ? undefined : submit}
          returnKeyType={hero ? 'default' : 'send'}
          accessibilityLabel="Describe your event"
          maxFontSizeMultiplier={2}
          style={[s.input, hero && s.inputHero]}
        />
        <Pressable
          onPress={submit}
          disabled={!canSend}
          hitSlop={4}
          style={({ pressed }) => [s.send, !canSend && s.sendOff, pressed && { transform: [{ scale: 0.92 }] }]}
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSend }}
        >
          <ArrowUp size={18} strokeWidth={2.5} color={canSend ? c.onInk : '#fff'} />
        </Pressable>
      </View>
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  replyTo: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 6, paddingBottom: 6 },
  grow: { flex: 1 },
  box: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8, backgroundColor: t.c.card, borderWidth: 1, borderColor: t.scheme === 'dark' ? t.c.line : '#e3e3e3',
    borderRadius: 22, paddingVertical: 6, paddingRight: 6, paddingLeft: 14,
  },
  boxHero: {
    flexDirection: 'column', alignItems: 'stretch', padding: 14, paddingBottom: 10, borderRadius: 18,
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2,
  },
  input: { flex: 1, fontSize: 14.5, lineHeight: 20, color: t.c.ink, paddingVertical: 6, maxHeight: 120 },
  inputHero: { flex: 0, fontSize: 16, minHeight: 72, maxHeight: 220, textAlignVertical: 'top' },
  send: { width: 36, height: 36, borderRadius: 18, alignSelf: 'flex-end', backgroundColor: t.c.ink, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: t.scheme === 'dark' ? '#3f3f46' : '#cfcfcf' },
}))
