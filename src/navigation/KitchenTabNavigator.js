import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import KitchenScreen from '../screens/KitchenScreen';
import MenuMobileScreen from '../screens/MenuMobileScreen';
import InventoryMobileScreen from '../screens/InventoryMobileScreen';
import AttendanceMobileScreen from '../screens/AttendanceMobileScreen';
import AccountScreen from '../screens/AccountScreen';
import { COLORS, FONTS } from '../lib/theme';

const Tab = createBottomTabNavigator();

export default function KitchenTabNavigator({ route }) {
  const profile = route?.params?.profile ?? {};
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 14 : 0);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary || '#059669',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#e2e8f0',
          borderTopWidth: 1,
          height: (Platform.OS === 'ios' ? 60 : 64) + bottomInset,
          paddingBottom: bottomInset + (Platform.OS === 'ios' ? 0 : 6),
          paddingTop: 6,
          elevation: 16,
          shadowColor: '#000',
          shadowOpacity: 0.06,
          shadowRadius: 8,
        },
        tabBarLabelStyle: { ...FONTS.semiBold, fontSize: 10 },
      }}
    >
      <Tab.Screen
        name="Kitchen"
        component={KitchenScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Kitchen',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="chef-hat" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Menu"
        component={MenuMobileScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Smart Menu',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="book-open-page-variant-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="Inventory"
        component={InventoryMobileScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Stock',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="package-variant-closed" size={size} color={color} />
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
            <Ionicons name="camera-outline" size={size} color={color} />
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
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}
