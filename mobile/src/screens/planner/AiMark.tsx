// The planner's round accent mark (the web's .plan-ai-mark; a solid accent here,
// since the web's gradient needs a gradient library).
import { Sparkles, type LucideIcon } from 'lucide-react-native'
import { View } from 'react-native'

import { useTheme } from '@/theme'

export function AiMark({ icon: Icon = Sparkles, size = 30 }: { icon?: LucideIcon; size?: number }) {
  const { c } = useTheme()
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2, backgroundColor: c.accent, alignItems: 'center', justifyContent: 'center',
        ...(size >= 50 ? { shadowColor: c.accent, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 4 } : null),
      }}
    >
      <Icon size={Math.round(size * 0.48)} color={c.onAccent} />
    </View>
  )
}
