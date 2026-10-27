import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Platform } from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import WaiterOrdersScreen from '../screens/WaiterOrdersScreen';
import WaiterCallsScreen from '../screens/WaiterCallsScreen';
import WaiterPunchScreen from '../screens/WaiterPunchScreen';
import AttendanceMobileScreen from '../screens/AttendanceMobileScreen';
import AccountScreen from '../screens/AccountScreen';
import { COLORS, FONTS } from '../lib/theme';

const Tab = createBottomTabNavigator();

export default function WaiterTabNavigator({ route }) {
  const profile = route?.params?.profile ?? {};

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary || '#059669',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#f1f5f9',
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingBottom: Platform.OS === 'ios' ? 28 : 8,
          paddingTop: 6,
          elevation: 12,
          shadowColor: '#000',
          shadowOpacity: 0.04,
          shadowRadius: 8,
        },
        tabBarLabelStyle: { ...FONTS.semiBold, fontSize: 10 },
      }}
    >
      <Tab.Screen
        name="Delivery"
        component={WaiterOrdersScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Delivery',
          tabBarIcon: ({ color, size }) => (
            <MaterialIcons name="delivery-dining" size={24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Calls"
        component={WaiterCallsScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Calls',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" size={22} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Punch"
        component={WaiterPunchScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Punch Order',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle-outline" size={24} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Attendance"
        component={AttendanceMobileScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Attendance',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="camera-outline" size={22} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Account"
        component={AccountScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Account',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={22} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
