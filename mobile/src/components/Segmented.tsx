// Segmented control (the web's components/Segmented.jsx).
//   <Segmented options={[{ value: 'a', label: 'A' }, 'b']} value={v} onChange={setV} />
import { Pressable, View } from 'react-native'

import { makeStyles } from '@/theme'
import { Text } from './Text'

type Option<T extends string> = T | { value: T; label: string }

export function Segmented<T extends string>({ options, value, onChange, label }: { options: Option<T>[]; value: T; onChange: (v: T) => void; label?: string }) {
  const s = useStyles()
  return (
    <View style={s.wrap} accessibilityRole="tablist" accessibilityLabel={label}>
      {options.map((o) => {
        const val = typeof o === 'string' ? o : o.value
        const text = typeof o === 'string' ? o : o.label
        const active = val === value
        return (
          <Pressable
            key={val}
            onPress={() => onChange(val)}
            hitSlop={{ top: 3, bottom: 3 }}
            style={[s.btn, active && s.active]}
            accessibilityRole="tab"
            accessibilityLabel={text}
            accessibilityState={{ selected: active }}
          >
            <Text variant="small" weight="600" muted={!active} numberOfLines={1} maxFontSizeMultiplier={1.6}>{text}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const useStyles = makeStyles((t) => ({
  wrap: { flexDirection: 'row', backgroundColor: t.c.soft, borderRadius: t.radius.md, padding: 3 },
  btn: { flex: 1, minHeight: 38, paddingVertical: 8, paddingHorizontal: 6, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  active: {
    backgroundColor: t.scheme === 'dark' ? t.c.line : '#fff',
    shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
}))
