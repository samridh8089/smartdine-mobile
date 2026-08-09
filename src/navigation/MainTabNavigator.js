import React, { useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import DashboardScreen from '../screens/DashboardScreen';
import OrdersScreen from '../screens/OrdersScreen';
import WaiterPunchScreen from '../screens/WaiterPunchScreen';
import KitchenScreen from '../screens/KitchenScreen';
import ReportsScreen from '../screens/ReportsScreen';
import { COLORS, FONTS } from '../lib/theme';
import { supabase } from '../lib/supabase';

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

function AccountScreen({ route }) {
  const profile = route?.params?.profile ?? {};
  const navigation = useNavigation();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      `Are you sure you want to sign out?\n\nYou can log in with any other account after this.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setSigningOut(true);
            try {
              await supabase.auth.signOut();
            } catch (e) {
              console.log('[AccountScreen] signOut error:', e?.message);
            }
            // Navigate directly to Login regardless of signOut result
            try {
              navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
            } catch (e2) {
              console.log('[AccountScreen] nav reset error:', e2?.message);
            }
            setSigningOut(false);
          },
        },
      ]
    );
  };

  const restaurantName = profile.restaurant_name || profile.restaurants?.name || '';

  return (
    <SafeAreaView style={styles.accountContainer} edges={['top', 'left', 'right']}>
      <View style={styles.avatarCircle}>
        <Text style={styles.avatarText}>{profile.full_name?.[0]?.toUpperCase() || 'S'}</Text>
      </View>
      <Text style={styles.nameText}>{profile.full_name || 'Staff User'}</Text>
      <Text style={styles.emailText}>{profile.email || ''}</Text>
      {restaurantName ? (
        <Text style={styles.restaurantName}>{restaurantName}</Text>
      ) : null}

      <View style={styles.roleBadge}>
        <Text style={styles.roleBadgeText}>{profile.role?.toUpperCase() || 'OWNER'}</Text>
      </View>

      <Text style={styles.footerBrand}>Powered by CleverOps · cleverops.in</Text>

      <TouchableOpacity
        style={[styles.signOutBtn, signingOut && { opacity: 0.6 }]}
        onPress={handleSignOut}
        disabled={signingOut}
        activeOpacity={0.8}
      >
        {signingOut ? (
          <ActivityIndicator size="small" color="#ef4444" style={{ marginRight: 8 }} />
        ) : (
          <Ionicons name="log-out-outline" size={20} color="#ef4444" style={{ marginRight: 8 }} />
        )}
        <Text style={styles.signOutBtnText}>{signingOut ? 'Signing Out...' : 'Sign Out'}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
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
          backgroundColor: '#ffffff',
          borderTopColor: '#f1f5f9',
          borderTopWidth: 1,
          height: 64,
          paddingBottom: 8,
          paddingTop: 6,
          elevation: 12,
          shadowColor: '#000',
          shadowOpacity: 0.08,
          shadowRadius: 10,
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
