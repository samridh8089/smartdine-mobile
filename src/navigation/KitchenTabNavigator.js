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
          backgroundColor: '#1e293b',
          borderTopColor: '#334155',
        },
        tabBarActiveTintColor: '#0ea5e9',
        tabBarInactiveTintColor: '#94a3b8',
      }}
    >
      <Tab.Screen 
        name="Kitchen" 
        component={KitchenScreen} 
        options={{ tabBarLabel: 'KDS' }}
      />
      <Tab.Screen 
        name="Settings" 
        component={KitchenSettings} 
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    color: '#f8fafc',
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
