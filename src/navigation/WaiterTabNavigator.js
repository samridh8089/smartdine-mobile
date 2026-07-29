import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import WaiterOrdersScreen from '../screens/WaiterOrdersScreen';
import WaiterCallsScreen from '../screens/WaiterCallsScreen';
import WaiterPunchScreen from '../screens/WaiterPunchScreen';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';

const Tab = createBottomTabNavigator();

function WaiterSettings() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Waiter Settings</Text>
      <TouchableOpacity 
        style={styles.signOutBtn}
        onPress={() => supabase.auth.signOut()}
      >
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function WaiterTabNavigator({ route }) {
  const profile = route?.params?.profile || {};

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarIcon: () => null,
        tabBarIconStyle: { display: 'none' },
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#e2e8f0',
          height: 56,
          paddingBottom: 16,
          paddingTop: 12,
        },
        tabBarActiveTintColor: '#0ea5e9',
        tabBarInactiveTintColor: '#64748b',
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen 
        name="Deliveries" 
        component={WaiterOrdersScreen} 
        initialParams={{ profile }}
        options={{ tabBarLabel: 'Delivery' }}
      />
      <Tab.Screen 
        name="Guest Calls" 
        component={WaiterCallsScreen} 
        initialParams={{ profile }}
        options={{ tabBarLabel: 'Guest Calls' }}
      />
      <Tab.Screen 
        name="Punch Order" 
        component={WaiterPunchScreen} 
        initialParams={{ profile }}
        options={{ tabBarLabel: 'Punch Order' }}
      />
      <Tab.Screen 
        name="Settings" 
        component={WaiterSettings} 
        options={{ tabBarLabel: 'Settings' }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    color: '#0f172a',
    marginBottom: 20,
    fontWeight: 'bold',
  },
  signOutBtn: {
    backgroundColor: '#ef4444',
    padding: 12,
    borderRadius: 8,
    width: 200,
    alignItems: 'center',
  },
  signOutText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  }
});
