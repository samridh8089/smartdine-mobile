import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, Text, ScrollView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { supabase } from './src/lib/supabase';

// Safe notification channel setup
function safeSetupNotifications() {
  try {
    const { setupNotificationChannel } = require('./src/lib/notifications');
    setupNotificationChannel();
  } catch (e) {
    console.log('Notification setup error (non-fatal):', e.message);
  }
}

import LoginScreen from './src/screens/LoginScreen';
import MainTabNavigator from './src/navigation/MainTabNavigator';
import KitchenTabNavigator from './src/navigation/KitchenTabNavigator';
import WaiterTabNavigator from './src/navigation/WaiterTabNavigator';
import SuperAdminScreen from './src/screens/SuperAdminScreen';

export const navigationRef = createNavigationContainerRef();
const Stack = createNativeStackNavigator();

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.log('=== APP ERROR ===');
    console.log('Error:', error?.toString());
    console.log('Stack:', errorInfo?.componentStack);
    this.setState({ errorInfo });
  }
  render() {
    if (this.state.hasError) {
      const errMsg = this.state.error?.toString() || 'Unknown error';
      const stack = this.state.errorInfo?.componentStack || '';
      return (
        <View style={{ flex: 1, backgroundColor: '#f8fafc', padding: 20, paddingTop: 60 }}>
          <ScrollView>
            <Text style={{ color: '#ef4444', fontSize: 20, fontWeight: 'bold', marginBottom: 12 }}>
              App Error
            </Text>
            <Text style={{ color: '#0ea5e9', fontSize: 13, marginBottom: 8, fontWeight: 'bold' }}>
              Error Details:
            </Text>
            <Text style={{ color: '#0f172a', fontSize: 12, marginBottom: 16, fontFamily: 'monospace', backgroundColor: '#ffffff', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0' }}>
              {errMsg}
            </Text>
            <Text style={{ color: '#0ea5e9', fontSize: 13, marginBottom: 8, fontWeight: 'bold' }}>
              Component Stack:
            </Text>
            <Text style={{ color: '#64748b', fontSize: 11, fontFamily: 'monospace', backgroundColor: '#ffffff', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0' }}>
              {stack}
            </Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  useEffect(() => {
    safeSetupNotifications();

    // Auto-check and apply latest EAS OTA update on startup (prevents booting old embedded APK bundle)
    const checkUpdates = async () => {
      if (__DEV__) return;
      try {
        const Updates = require('expo-updates');
        if (Updates && Updates.checkForUpdateAsync) {
          const update = await Updates.checkForUpdateAsync();
          if (update.isAvailable) {
            await Updates.fetchUpdateAsync();
            await Updates.reloadAsync();
          }
        }
      } catch (e) {
        console.log('EAS Updates auto-check error (non-fatal):', e.message);
      }
    };
    checkUpdates();

    let subscription;
    try {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') {
          if (navigationRef.isReady()) {
            navigationRef.reset({
              index: 0,
              routes: [{ name: 'Login' }],
            });
          }
        }
      });
      subscription = data?.subscription;
    } catch (e) {
      console.log('Auth state change setup error (non-fatal):', e.message);
    }

    return () => {
      try {
        subscription?.unsubscribe();
      } catch (_) {}
    };
  }, []);

  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <NavigationContainer ref={navigationRef}>
          <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Login">
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="MainApp" component={MainTabNavigator} />
            <Stack.Screen name="KitchenApp" component={KitchenTabNavigator} />
            <Stack.Screen name="WaiterApp" component={WaiterTabNavigator} />
            <Stack.Screen name="SuperAdmin" component={SuperAdminScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
});
