import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import WaiterOrdersScreen from '../screens/WaiterOrdersScreen';
import WaiterCallsScreen from '../screens/WaiterCallsScreen';
import WaiterPunchScreen from '../screens/WaiterPunchScreen';
import AccountScreen from '../screens/AccountScreen';
import { COLORS, FONTS } from '../lib/theme';

const Tab = createBottomTabNavigator();

export default function WaiterTabNavigator({ route }) {
  const profile = route?.params?.profile ?? {};

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#f1f5f9',
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
          elevation: 12,
        },
        tabBarLabelStyle: { ...FONTS.semiBold, fontSize: 11 },
      }}
    >
      <Tab.Screen
        name="Delivery"
        component={WaiterOrdersScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Delivery',
          tabBarIcon: ({ focused, color }) => (
            <MaterialIcons name="delivery-dining" size={24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Calls"
        component={WaiterCallsScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Guest Calls',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'notifications' : 'notifications-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Punch"
        component={WaiterPunchScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Punch Order',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'add-circle' : 'add-circle-outline'} size={24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Account"
        component={AccountScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Account',
          tabBarIcon: ({ focused, color }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={22} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
