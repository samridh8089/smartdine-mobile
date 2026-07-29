import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import DashboardScreen from '../screens/DashboardScreen';
import OrdersScreen from '../screens/OrdersScreen';
import KitchenScreen from '../screens/KitchenScreen';
import WaiterPunchScreen from '../screens/WaiterPunchScreen';
import { supabase } from '../lib/supabase';

const Tab = createBottomTabNavigator();

function SettingsScreen({ route }) {
  const profile = route?.params?.profile || {};

  return (
    <View style={styles.container}>
      <View style={styles.profileCard}>
        <Text style={styles.name}>{profile.full_name || 'Staff User'}</Text>
        <Text style={styles.email}>{profile.email}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{profile.role?.toUpperCase() || 'OWNER'}</Text>
        </View>
      </View>

      <TouchableOpacity 
        style={styles.signOutBtn}
        onPress={() => supabase.auth.signOut()}
      >
        <Text style={styles.signOutText}>Sign Out / Logout</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function MainTabNavigator({ route }) {
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
        tabBarActiveTintColor: '#059669',
        tabBarInactiveTintColor: '#64748b',
        tabBarLabelStyle: {
          fontSize: 13,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen 
        name="Dashboard" 
        component={DashboardScreen} 
        initialParams={{ profile }}
        options={{ tabBarLabel: 'Overview' }}
      />
      <Tab.Screen 
        name="Orders" 
        component={OrdersScreen} 
        initialParams={{ profile }}
        options={{ tabBarLabel: 'Live Orders' }}
      />
      <Tab.Screen 
        name="PunchOrder" 
        component={WaiterPunchScreen} 
        initialParams={{ profile }}
        options={{ tabBarLabel: 'Punch Order' }}
      />
      <Tab.Screen 
        name="Kitchen" 
        component={KitchenScreen} 
        initialParams={{ profile }}
        options={{ tabBarLabel: 'Kitchen' }}
      />
      <Tab.Screen 
        name="Settings" 
        component={SettingsScreen} 
        initialParams={{ profile }}
        options={{ tabBarLabel: 'Account' }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileCard: {
    backgroundColor: '#ffffff',
    padding: 24,
    borderRadius: 16,
    width: '100%',
    alignItems: 'center',
    marginBottom: 32,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  name: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 4,
  },
  email: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 16,
  },
  roleBadge: {
    backgroundColor: '#059669',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  roleText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  signOutBtn: {
    backgroundColor: '#ef4444',
    padding: 16,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  signOutText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
