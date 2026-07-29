import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import KitchenScreen from '../screens/KitchenScreen';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';

const Tab = createBottomTabNavigator();

function KitchenSettings() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Kitchen Settings</Text>
      <TouchableOpacity 
        style={styles.signOutBtn}
        onPress={() => supabase.auth.signOut()}
      >
        <Text style={styles.signOutText}>Sign Out</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function KitchenTabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#e2e8f0',
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarActiveTintColor: '#0ea5e9',
        tabBarInactiveTintColor: '#64748b',
        tabBarLabelStyle: {
          fontSize: 13,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen 
        name="Kitchen" 
        component={KitchenScreen} 
        options={{ tabBarLabel: 'Kitchen Display' }}
      />
      <Tab.Screen 
        name="Settings" 
        component={KitchenSettings} 
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
