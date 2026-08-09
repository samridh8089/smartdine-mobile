import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import * as Notifications from 'expo-notifications';

import { supabase } from './src/lib/supabase';
import { setupNotificationChannel, sendLocalNotification } from './src/lib/notifications';
import { startAlarm } from './src/lib/alarmManager';
import LoginScreen from './src/screens/LoginScreen';
import MainTabNavigator from './src/navigation/MainTabNavigator';
import KitchenTabNavigator from './src/navigation/KitchenTabNavigator';
import WaiterTabNavigator from './src/navigation/WaiterTabNavigator';
import CashierTabNavigator from './src/navigation/CashierTabNavigator';
import SuperAdminScreen from './src/screens/SuperAdminScreen';

export const navigationRef = createNavigationContainerRef();

const Stack = createNativeStackNavigator();

// ─── Error Boundary ───────────────────────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.log('[ErrorBoundary] Caught error:', error?.message);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={errStyles.container}>
          <Ionicons name="warning-outline" size={48} color="#ef4444" style={{ marginBottom: 16 }} />
          <Text style={errStyles.title}>Something went wrong</Text>
          <Text style={errStyles.msg}>{this.state.error?.message || 'Unknown error'}</Text>
          <TouchableOpacity
            style={errStyles.btn}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={errStyles.btnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const errStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1e293b', justifyContent: 'center', alignItems: 'center', padding: 24 },
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 8 },
  msg: { color: '#94a3b8', fontSize: 13, textAlign: 'center', marginBottom: 32, lineHeight: 20 },
  btn: { backgroundColor: '#059669', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});

// ─── OTA Splash Screen ────────────────────────────────────────────────────────
function OTASplash({ message }) {
  return (
    <View style={errStyles.container}>
      <MaterialCommunityIcons name="silverware-fork-knife" size={48} color="#059669" style={{ marginBottom: 16 }} />
      <Text style={errStyles.title}>SmartDine</Text>
      <Text style={errStyles.msg}>{message || 'Updating app...'}</Text>
      <ActivityIndicator color="#059669" size="large" />
    </View>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [otaChecking, setOtaChecking] = useState(!__DEV__);
  const [otaMessage, setOtaMessage] = useState('Checking for updates...');

  useEffect(() => {
    // 1. Force OTA update FIRST before anything else loads
    async function forceCheckOTA() {
      if (__DEV__) { setOtaChecking(false); return; }
      try {
        setOtaMessage('Checking for updates...');
        const update = await Updates.checkForUpdateAsync();
        if (update.isAvailable) {
          setOtaMessage('Downloading update...');
          console.log('[Updates] New update found! Downloading...');
          await Updates.fetchUpdateAsync();
          setOtaMessage('Applying update, restarting...');
          await Updates.reloadAsync();
          return; // App will restart — nothing below runs
        }
      } catch (e) {
        console.log('[Updates] Auto sync notice:', e?.message);
      }
      setOtaChecking(false); // No update — proceed to app
    }
    forceCheckOTA();

    // 2. Safe setup of notification channels on app startup
    try {
      setupNotificationChannel().catch(e => console.log('[App] Notification setup warning:', e?.message));
    } catch (e) {
      console.log('[App] Notification setup error:', e?.message);
    }

    // 3. Notification Tap Listener — Route based on user role / screen on tap
    let responseSubscription = null;
    try {
      if (typeof Notifications?.addNotificationResponseReceivedListener === 'function') {
        responseSubscription = Notifications.addNotificationResponseReceivedListener(async () => {
          if (navigationRef.isReady()) {
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (user) {
                const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
                if (p?.role === 'waiter') {
                  navigationRef.navigate('WaiterApp');
                  return;
                } else if (p?.role === 'kitchen') {
                  navigationRef.navigate('KitchenApp');
                  return;
                } else if (p?.role === 'owner' || p?.role === 'manager' || p?.role === 'cashier') {
                  navigationRef.navigate('MainApp');
                  return;
                }
              }
            } catch (e) {
              console.log('[App] Role check on tap error:', e?.message);
            }
            navigationRef.navigate('KitchenApp');
          }
        });
      }
    } catch (e) {
      console.log('[App] Notification response listener error:', e?.message);
    }

    // 4. Global Realtime Listener for new orders & customer requests in background / lockscreen
    let globalChannel = null;
    async function setupGlobalRealtimeListener() {
      try {
        if (globalChannel) {
          try {
            await supabase.removeChannel(globalChannel);
          } catch (cleanErr) {
            console.log('[App Global] Channel cleanup warning:', cleanErr?.message);
          }
          globalChannel = null;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data: p } = await supabase
          .from('profiles')
          .select('restaurant_id, role')
          .eq('id', user.id)
          .maybeSingle();

        const restId = p?.restaurant_id;
        if (!restId) return;

        globalChannel = supabase
          .channel(`global-app-events-${restId}`)
          .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'order_batches', filter: `restaurant_id=eq.${restId}`,
          }, async (payload) => {
            console.log('[App Global] New order batch inserted:', payload.new?.id);
            if (p.role === 'kitchen' || p.role === 'owner') {
              startAlarm('new_order', '🔔 New Order Arrived!', 'A new order needs attention.');
              sendLocalNotification('🔔 New Order Arrived!', 'A new order needs attention.', 'smartdine-urgent-v3');
            }
          })
          .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'customer_requests', filter: `restaurant_id=eq.${restId}`,
          }, async (payload) => {
            console.log('[App Global] New customer request inserted:', payload.new?.id);
            if (p.role === 'waiter' || p.role === 'owner') {
              startAlarm('waiter_call', '🔔 Customer Call', 'A customer at a table needs assistance');
              sendLocalNotification('🔔 Customer Call', 'A customer at a table needs assistance', 'smartdine-urgent-v3');
            }
          })
          .subscribe();
      } catch (e) {
        console.log('[App Global] Listener error:', e?.message);
      }
    }
    setupGlobalRealtimeListener();

    // 5. Listen for sign-out to reset navigation
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        if (globalChannel) {
          supabase.removeChannel(globalChannel);
          globalChannel = null;
        }
        try {
          if (navigationRef.isReady()) {
            navigationRef.reset({ index: 0, routes: [{ name: 'Login' }] });
          }
        } catch (e) {
          console.log('[App] Nav reset error:', e?.message);
        }
      } else if (event === 'SIGNED_IN') {
        setupGlobalRealtimeListener();
      }
    });

    return () => {
      responseSubscription?.remove?.();
      subscription?.unsubscribe?.();
      if (globalChannel) {
        supabase.removeChannel(globalChannel);
        globalChannel = null;
      }
    };
  }, []);

  // Show OTA splash until check is complete
  if (otaChecking) {
    return <OTASplash message={otaMessage} />;
  }

  return (
    <ErrorBoundary>
      <StatusBar style="auto" />
      <NavigationContainer ref={navigationRef}>
        <Stack.Navigator
          initialRouteName="Login"
          screenOptions={{ headerShown: false, animation: 'fade' }}
        >
          {/* Auth */}
          <Stack.Screen name="Login" component={LoginScreen} />

          {/* Owner / Manager Portal */}
          <Stack.Screen name="MainApp" component={MainTabNavigator} />

          {/* Kitchen Staff Portal */}
          <Stack.Screen name="KitchenApp" component={KitchenTabNavigator} />

          {/* Waiter Portal */}
          <Stack.Screen name="WaiterApp" component={WaiterTabNavigator} />

          {/* Cashier Portal */}
          <Stack.Screen name="CashierApp" component={CashierTabNavigator} />

          {/* Super Admin Portal */}
          <Stack.Screen name="SuperAdmin" component={SuperAdminScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
  );
}
