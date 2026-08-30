import React from 'react';
import { StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import DashboardScreen from '../screens/DashboardScreen';
import OrdersScreen from '../screens/OrdersScreen';
import WaiterPunchScreen from '../screens/WaiterPunchScreen';
import KitchenScreen from '../screens/KitchenScreen';
import ReportsScreen from '../screens/ReportsScreen';
import AccountScreen from '../screens/AccountScreen';
import { COLORS, FONTS } from '../lib/theme';

const Tab = createBottomTabNavigator();

function TabIcon({ routeName, focused, color }) {
  const size = 22;
  switch (routeName) {
    case 'Overview':
      return <Ionicons name={focused ? 'grid' : 'grid-outline'} size={size} color={color} />;
    case 'Orders':
      return <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={size} color={color} />;
    case 'Punch':
      return <Ionicons name={focused ? 'add-circle' : 'add-circle-outline'} size={size + 2} color={color} />;
    case 'Kitchen':
      return <MaterialCommunityIcons name={focused ? 'chef-hat' : 'chef-hat'} size={size} color={color} />;
    case 'Reports':
      return <Ionicons name={focused ? 'stats-chart' : 'stats-chart-outline'} size={size} color={color} />;
    case 'Account':
      return <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />;
    default:
      return <Ionicons name="ellipse" size={size} color={color} />;
  }
}

const styles = StyleSheet.create({
  accountContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    paddingTop: 40,
  },
  avatarCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justify: 'center',
    marginBottom: 16,
    elevation: 4,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '700',
  },
  nameText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 4,
  },
  emailText: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 12,
  },
  roleBadge: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 999,
    marginBottom: 40,
  },
  roleBadgeText: {
    color: COLORS.primary,
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  restaurantName: {
    fontSize: 14,
    color: '#059669',
    fontWeight: '600',
    marginBottom: 8,
  },
  footerBrand: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 24,
  },
  signOutBtn: {
    width: '85%',
    backgroundColor: '#ffffff',
    paddingVertical: 14,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  signOutBtnText: {
    fontSize: 15,
    color: '#ef4444',
    fontWeight: '700',
  },
});

export default function MainTabNavigator({ route }) {
  const profile = route?.params?.profile ?? {};

  return (
    <Tab.Navigator
      screenOptions={({ route: tabRoute }) => ({
        headerShown: false,
        tabBarActiveTintColor: COLORS.primary,
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: {
          backgroundColor: 'rgba(255, 255, 255, 0.92)',
          borderTopColor: 'rgba(226, 232, 240, 0.8)',
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
          elevation: 16,
          shadowColor: '#000',
          shadowOpacity: 0.12,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: -4 },
        },
        tabBarLabelStyle: { ...FONTS.semiBold, fontSize: 11 },
        tabBarIcon: ({ focused, color }) => (
          <TabIcon routeName={tabRoute.name} focused={focused} color={color} />
        ),
      })}
    >
      <Tab.Screen
        name="Overview"
        component={DashboardScreen}
        initialParams={{ profile }}
        options={{ tabBarLabel: 'Overview' }}
      />
      <Tab.Screen
        name="Orders"
        component={OrdersScreen}
        initialParams={{ profile }}
        options={{ tabBarLabel: 'Orders' }}
      />
      <Tab.Screen
        name="Punch"
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
        name="Reports"
        component={ReportsScreen}
        initialParams={{ profile }}
        options={{ tabBarLabel: 'Reports' }}
      />
      <Tab.Screen
        name="Account"
        component={AccountScreen}
        initialParams={{ profile }}
        options={{ tabBarLabel: 'Account' }}
      />
    </Tab.Navigator>
  );
}
