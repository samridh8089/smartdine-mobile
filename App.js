import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import * as Notifications from 'expo-notifications';

import { supabase } from './src/lib/supabase';
import { setupNotificationChannel, sendLocalNotification } from './src/lib/notifications';
import LoginScreen from './src/screens/LoginScreen';
import OwnerSignupScreen from './src/screens/OwnerSignupScreen';
import MainTabNavigator from './src/navigation/MainTabNavigator';
import ManagerTabNavigator from './src/navigation/ManagerTabNavigator';
import SupervisorTabNavigator from './src/navigation/SupervisorTabNavigator';
import KitchenTabNavigator from './src/navigation/KitchenTabNavigator';
import WaiterTabNavigator from './src/navigation/WaiterTabNavigator';
import CashierTabNavigator from './src/navigation/CashierTabNavigator';
import SuperAdminScreen from './src/screens/SuperAdminScreen';
import TableAssignmentScreen from './src/screens/TableAssignmentScreen';
import StaffManagementScreen from './src/screens/StaffManagementScreen';
import InventoryMobileScreen from './src/screens/InventoryMobileScreen';
import MenuMobileScreen from './src/screens/MenuMobileScreen';
import SubscriptionScreen from './src/screens/SubscriptionScreen';
import PaymentHistoryScreen from './src/screens/PaymentHistoryScreen';
import { getAssignedTableIdsForWaiter } from './src/lib/tableAssignments';

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
      <Image source={require('./assets/icon.png')} style={{ width: 64, height: 64, resizeMode: 'contain', marginBottom: 16 }} />
      <Text style={errStyles.title}>CleverOps</Text>
      <Text style={errStyles.msg}>{message || 'Updating app...'}</Text>
      <ActivityIndicator color="#059669" size="large" />
    </View>
  );
}

// ─── Root App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [otaChecking, setOtaChecking] = useState(false);
  const [otaMessage, setOtaMessage] = useState('Checking for updates...');

  useEffect(() => {
    // 1. Silent background OTA check only if explicitly needed
    async function forceCheckOTA() {
      // Keep embedded build intact
      setOtaChecking(false);
    }
    forceCheckOTA();

    // 2. Safe setup of notification channels on app startup & token refresh listener
    let tokenSubscription = null;
    try {
      setupNotificationChannel().catch(e => console.log('[App] Notification setup warning:', e?.message));
      if (typeof Notifications?.addPushTokenListener === 'function') {
        tokenSubscription = Notifications.addPushTokenListener(async ({ data: newToken }) => {
          try {
            const { data: { user } } = await supabase.auth.getUser();
            if (user?.id && newToken) {
              await supabase.from('profiles').update({ push_token: newToken }).eq('id', user.id);
              console.log('[NotificationDiagnostics] Token auto-refreshed in database');
            }
          } catch (e) {
            console.log('[App] Token refresh handler error:', e?.message);
          }
        });
      }
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
          .select('restaurant_id, role, department')
          .eq('id', user.id)
          .maybeSingle();

        const restId = p?.restaurant_id;
        if (!restId) return;

        // Fetch assigned tables for waiter
        let assignedTables = [];
        if (p.role === 'waiter') {
          assignedTables = await getAssignedTableIdsForWaiter(restId, user.id);
        }

        globalChannel = supabase
          .channel(`global-app-events-${restId}`)
          .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restId}`,
          }, async (payload) => {
            console.log('[App Global] New order inserted:', payload.new?.id);
            const roleNorm = (p.role || '').toLowerCase().trim();
            const deptNorm = (p.department || '').toLowerCase().trim();
            const orderTableId = payload.new?.table_id;

            // Kitchen / Kitchen Supervisor / Owner / Manager
            if (
              ['kitchen', 'kds', 'kitchen_staff', 'owner', 'manager'].includes(roleNorm) ||
              (roleNorm === 'supervisor' && (deptNorm === 'kitchen' || !deptNorm))
            ) {
              const { startAlarm } = await import('./src/lib/alarmManager');
              startAlarm('new_order', '🔔 New Order Arrived!', 'A new order needs attention.');
              sendLocalNotification('🔔 New Order Arrived!', 'A new order needs attention.', 'smartdine_kitchen');
            }

            // Waiter / Waiter Supervisor
            if (roleNorm === 'waiter') {
              if (!orderTableId || assignedTables.length === 0 || assignedTables.includes(orderTableId)) {
                const { startAlarm } = await import('./src/lib/alarmManager');
                startAlarm('new_order', '🔔 New Order for Your Table!', `Table order received.`);
                sendLocalNotification('🔔 New Order for Your Table!', `Table order received.`, 'smartdine_waiter');
              }
            }
          })
          .on('postgres_changes', {
            event: 'INSERT', schema: 'public', table: 'customer_requests', filter: `restaurant_id=eq.${restId}`,
          }, async (payload) => {
            console.log('[App Global] New customer request inserted:', payload.new?.id);
            const reqTableId = payload.new?.table_id;
            const roleNorm = (p.role || '').toLowerCase().trim();
            const deptNorm = (p.department || '').toLowerCase().trim();

            const isAllowedWaiter = roleNorm === 'waiter' && (!reqTableId || assignedTables.length === 0 || assignedTables.includes(reqTableId));
            const isManagerOrOwner = ['owner', 'manager'].includes(roleNorm);
            const isWaiterSupervisor = roleNorm === 'supervisor' && (deptNorm === 'waiter' || !deptNorm);

            if (isAllowedWaiter || isManagerOrOwner || isWaiterSupervisor) {
              const { startAlarm } = await import('./src/lib/alarmManager');
              startAlarm('waiter_call', '🔔 Customer Call', 'A customer at a table needs assistance');
              sendLocalNotification('🔔 Customer Call', 'A customer at a table needs assistance', 'smartdine-urgent-v3');
            }
          })
          .on('postgres_changes', {
            event: 'UPDATE', schema: 'public', table: 'restaurants', filter: `id=eq.${restId}`,
          }, async (payload) => {
            console.log('[App Global] Restaurant plan updated in realtime:', payload.new?.subscription_plan, payload.new?.subscription_status);
            if (payload.new?.subscription_plan) {
              sendLocalNotification('🎉 Plan Activated', `Your restaurant subscription is now ${payload.new.subscription_plan.toUpperCase()} (${(payload.new.subscription_status || 'active').toUpperCase()})`, 'smartdine_waiter');
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
      tokenSubscription?.remove?.();
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
          <Stack.Screen name="OwnerSignup" component={OwnerSignupScreen} />

          {/* Owner Portal */}
          <Stack.Screen name="MainApp" component={MainTabNavigator} />

          {/* Manager Portal */}
          <Stack.Screen name="ManagerApp" component={ManagerTabNavigator} />

          {/* Supervisor Portal */}
          <Stack.Screen name="SupervisorApp" component={SupervisorTabNavigator} />

          {/* Kitchen Staff Portal */}
          <Stack.Screen name="KitchenApp" component={KitchenTabNavigator} />

          {/* Waiter Portal */}
          <Stack.Screen name="WaiterApp" component={WaiterTabNavigator} />

          {/* Cashier Portal */}
          <Stack.Screen name="CashierApp" component={CashierTabNavigator} />

          {/* Super Admin Portal */}
          <Stack.Screen name="SuperAdmin" component={SuperAdminScreen} />

          {/* Shared Operational Screens */}
          <Stack.Screen name="TableAssignment" component={TableAssignmentScreen} />
          <Stack.Screen name="StaffManagement" component={StaffManagementScreen} />
          <Stack.Screen name="Inventory" component={InventoryMobileScreen} />
          <Stack.Screen name="InventoryMobile" component={InventoryMobileScreen} />
          <Stack.Screen name="MenuManagement" component={MenuMobileScreen} />
          <Stack.Screen name="Subscription" component={SubscriptionScreen} />
          <Stack.Screen name="PaymentHistory" component={PaymentHistoryScreen} />
        </Stack.Navigator>
      </NavigationContainer>
    </ErrorBoundary>
  );
}
