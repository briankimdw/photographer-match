// The five tabs, same as the web's components/TabBar.jsx: Home, Discover, Bookings, Inbox, Me.
import { Tabs } from 'expo-router/js-tabs'
import { CalendarCheck, House, Layers, MessageCircle, User } from 'lucide-react-native'
import { Platform, Text } from 'react-native'

import useUnreadCount from '@/hooks/useUnreadCount'
import { useTheme } from '@/theme'

export default function TabLayout() {
  const { c } = useTheme()
  const unread = useUnreadCount() // inbox badge, live
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.ink,
        tabBarInactiveTintColor: c.faint,
        // Web preview only: the default 49pt bar clips the labels' descenders (native sizes itself).
        tabBarStyle: { backgroundColor: c.bg, borderTopColor: c.line, ...(Platform.OS === 'web' ? { height: 56 } : null) },
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '600' },
        // Tab labels grow a little with the font size (a 10.5pt label at 2x no longer fits five tabs; iOS's own tab bars don't scale either).
        tabBarLabel: ({ color, children }) => (
          <Text style={{ color, fontSize: 10.5, fontWeight: '600' }} maxFontSizeMultiplier={1.35} numberOfLines={1}>{children}</Text>
        ),
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color, size }) => <House color={color} size={size ?? 22} /> }} />
      <Tabs.Screen name="discover" options={{ title: 'Discover', tabBarIcon: ({ color, size }) => <Layers color={color} size={size ?? 22} /> }} />
      <Tabs.Screen name="bookings" options={{ title: 'Bookings', tabBarIcon: ({ color, size }) => <CalendarCheck color={color} size={size ?? 22} /> }} />
      <Tabs.Screen name="inbox" options={{ title: 'Inbox', tabBarAccessibilityLabel: unread > 0 ? `Inbox, ${unread} unread` : 'Inbox', tabBarBadge: unread > 0 ? (unread > 9 ? '9+' : unread) : undefined, tabBarBadgeStyle: { backgroundColor: c.accent, color: c.onAccent, fontSize: 10 }, tabBarIcon: ({ color, size }) => <MessageCircle color={color} size={size ?? 22} /> }} />
      <Tabs.Screen name="me" options={{ title: 'Me', tabBarIcon: ({ color, size }) => <User color={color} size={size ?? 22} /> }} />
    </Tabs>
  )
}
