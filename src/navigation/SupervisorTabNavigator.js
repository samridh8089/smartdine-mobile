import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, Platform } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../lib/theme';

import KitchenScreen from '../screens/KitchenScreen';
import MenuMobileScreen from '../screens/MenuMobileScreen';
import WaiterOrdersScreen from '../screens/WaiterOrdersScreen';
import WaiterCallsScreen from '../screens/WaiterCallsScreen';
import TableAssignmentScreen from '../screens/TableAssignmentScreen';
import InventoryMobileScreen from '../screens/InventoryMobileScreen';
import AccountScreen from '../screens/AccountScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function WaiterSupervisorStack({ route }) {
  const profile = route?.params?.profile;
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="WaiterCallsMain" component={WaiterCallsScreen} initialParams={{ profile }} />
      <Stack.Screen name="TableAssignment" component={TableAssignmentScreen} initialParams={{ profile }} />
    </Stack.Navigator>
  );
}

export default function SupervisorTabNavigator({ route }) {
  const profile = route?.params?.profile || {};
  const department = (profile.department || '').toLowerCase().trim();

  // If department is Kitchen Supervisor
  if (department === 'kitchen') {
    return (
      <Tab.Navigator
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: COLORS.primary,
          tabBarInactiveTintColor: '#94a3b8',
          tabBarStyle: {
            backgroundColor: '#ffffff',
            borderTopColor: '#f1f5f9',
            height: Platform.OS === 'ios' ? 88 : 64,
            paddingBottom: Platform.OS === 'ios' ? 28 : 10,
            paddingTop: 8,
          },
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: '700',
          },
        }}
      >
        <Tab.Screen
          name="SupervisorKDS"
          component={KitchenScreen}
          initialParams={{ profile }}
          options={{
            tabBarLabel: 'Kitchen KDS',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name="chef-hat" size={size} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="SupervisorMenu"
          component={MenuMobileScreen}
          initialParams={{ profile }}
          options={{
            tabBarLabel: 'Menu',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name="book-open-page-variant-outline" size={size} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="SupervisorInventory"
          component={InventoryMobileScreen}
          initialParams={{ profile }}
          options={{
            tabBarLabel: 'Inventory',
            tabBarIcon: ({ color, size }) => (
              <MaterialCommunityIcons name="package-variant-closed" size={size} color={color} />
            ),
          }}
        />
        <Tab.Screen
          name="SupervisorAccount"
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

  // If department is Waiter Supervisor (or default)
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#f1f5f9',
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
        },
      }}
    >
      <Tab.Screen
        name="SupervisorCalls"
        component={WaiterSupervisorStack}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Calls & Tables',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="notifications-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="SupervisorOrders"
        component={WaiterOrdersScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Live Orders',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="restaurant-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="SupervisorAssignments"
        component={TableAssignmentScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Table Roster',
          tabBarIcon: ({ color, size }) => (
            <MaterialCommunityIcons name="table-chair" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="SupervisorAccount"
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
