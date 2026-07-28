import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { supabase } from './src/lib/supabase';

// Lazy load notifications to prevent crash
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
    console.log('=== APP CRASH ERROR ===');
    console.log('Error:', error?.toString());
    console.log('Stack:', errorInfo?.componentStack);
    this.setState({ errorInfo });
  }
  render() {
    if (this.state.hasError) {
      const errMsg = this.state.error?.toString() || 'Unknown error';
      const stack = this.state.errorInfo?.componentStack || '';
      return (
        <View style={{ flex: 1, backgroundColor: '#0f172a', padding: 20, paddingTop: 60 }}>
          <ScrollView>
            <Text style={{ color: '#ef4444', fontSize: 20, fontWeight: 'bold', marginBottom: 12 }}>
              ❌ App Crashed
            </Text>
            <Text style={{ color: '#fbbf24', fontSize: 13, marginBottom: 8, fontWeight: 'bold' }}>
              Error:
            </Text>
            <Text style={{ color: '#f8fafc', fontSize: 12, marginBottom: 16, fontFamily: 'monospace' }}>
              {errMsg}
            </Text>
            <Text style={{ color: '#fbbf24', fontSize: 13, marginBottom: 8, fontWeight: 'bold' }}>
              Component Stack:
            </Text>
            <Text style={{ color: '#94a3b8', fontSize: 11, fontFamily: 'monospace' }}>
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
        <StatusBar style="light" />
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
    backgroundColor: '#0f172a',
  },
});
