import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View, Text, ScrollView } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { supabase } from './src/lib/supabase';
import { setupNotificationChannel } from './src/lib/notifications';

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
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.log('ErrorBoundary caught error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0f172a', padding: 20, paddingTop: 60 }}>
          <ScrollView>
            <Text style={{ color: '#ef4444', fontSize: 22, fontWeight: 'bold', marginBottom: 16 }}>
              App Error
            </Text>
            <Text style={{ color: '#f8fafc', fontSize: 14 }}>{String(this.state.error)}</Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  useEffect(() => {
    // Safely setup notification channel on mount
    try {
      setupNotificationChannel();
    } catch (e) {
      console.log('App notification init error:', e);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        if (navigationRef.isReady()) {
          navigationRef.reset({
            index: 0,
            routes: [{ name: 'Login' }],
          });
        }
      }
    });

    return () => subscription?.unsubscribe();
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
