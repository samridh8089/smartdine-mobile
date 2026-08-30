import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, Platform } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../lib/theme';

import DashboardScreen from '../screens/DashboardScreen';
import KitchenScreen from '../screens/KitchenScreen';
import WaiterOrdersScreen from '../screens/WaiterOrdersScreen';
import TableAssignmentScreen from '../screens/TableAssignmentScreen';
import StaffManagementScreen from '../screens/StaffManagementScreen';
import InventoryMobileScreen from '../screens/InventoryMobileScreen';
import MenuMobileScreen from '../screens/MenuMobileScreen';
import AccountScreen from '../screens/AccountScreen';
import OrdersScreen from '../screens/OrdersScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function ManagerOrdersStack({ route }) {
  const profile = route?.params?.profile;
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ManagerOrdersMain" component={WaiterOrdersScreen} initialParams={{ profile }} />
      <Stack.Screen name="ManagerAllOrders" component={OrdersScreen} initialParams={{ profile }} />
      <Stack.Screen name="TableAssignment" component={TableAssignmentScreen} initialParams={{ profile }} />
    </Stack.Navigator>
  );
}

function ManagerOpsStack({ route }) {
  const profile = route?.params?.profile;
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ManagerOpsDashboard" component={DashboardScreen} initialParams={{ profile }} />
      <Stack.Screen name="MenuManagement" component={MenuMobileScreen} initialParams={{ profile }} />
      <Stack.Screen name="TableAssignment" component={TableAssignmentScreen} initialParams={{ profile }} />
      <Stack.Screen name="StaffManagement" component={StaffManagementScreen} initialParams={{ profile }} />
      <Stack.Screen name="Inventory" component={InventoryMobileScreen} initialParams={{ profile }} />
      <Stack.Screen name="InventoryMobile" component={InventoryMobileScreen} initialParams={{ profile }} />
    </Stack.Navigator>
  );
}

export default function ManagerTabNavigator({ route }) {
  const profile = route?.params?.profile || {};

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
        name="ManagerOverview"
        component={ManagerOpsStack}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Overview',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ManagerKDS"
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
        name="ManagerLiveOrders"
        component={ManagerOrdersStack}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Live Orders',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="receipt-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ManagerStaff"
        component={StaffManagementScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Staff Roster',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" size={size} color={color} />
          ),
        }}
      />
      <Tab.Screen
        name="ManagerAccount"
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
