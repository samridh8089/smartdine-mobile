import React, { useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import KitchenScreen from '../screens/KitchenScreen';
import { COLORS, FONTS } from '../lib/theme';
import { supabase } from '../lib/supabase';

const Tab = createBottomTabNavigator();

function AccountScreen({ route }) {
  const profile = route?.params?.profile ?? {};
  const navigation = useNavigation();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setSigningOut(true);
            try {
              await supabase.auth.signOut();
            } catch (e) {}
            try {
              navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
            } catch (e2) {}
            setSigningOut(false);
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.accountContainer} edges={['top', 'left', 'right']}>
      <View style={styles.avatarCircle}>
        <Text style={styles.avatarText}>{profile.full_name?.[0]?.toUpperCase() || 'K'}</Text>
      </View>
      <Text style={styles.nameText}>{profile.full_name || 'Kitchen Staff'}</Text>
      <Text style={styles.emailText}>{profile.email || ''}</Text>

      <View style={styles.roleBadge}>
        <Text style={styles.roleBadgeText}>KITCHEN STAFF</Text>
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
  },
  avatarText: { color: '#ffffff', fontSize: 32, fontWeight: '700' },
  nameText: { fontSize: 22, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  emailText: { fontSize: 14, color: '#64748b', marginBottom: 12 },
  roleBadge: { backgroundColor: COLORS.primaryLight, paddingHorizontal: 16, paddingVertical: 6, borderRadius: 999, marginBottom: 40 },
  roleBadgeText: { color: COLORS.primary, fontWeight: '700', fontSize: 12, letterSpacing: 0.8 },
  footerBrand: { fontSize: 12, color: '#94a3b8', marginBottom: 24 },
  signOutBtn: {
    width: '85%',
    backgroundColor: '#ffffff',
    paddingVertical: 14,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justify: 'center',
    elevation: 2,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  signOutBtnText: { fontSize: 15, color: '#ef4444', fontWeight: '700' },
});

export default function KitchenTabNavigator({ route }) {
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
        name="KitchenDisplay"
        component={KitchenScreen}
        initialParams={{ profile }}
        options={{
          tabBarLabel: 'Kitchen Display',
          tabBarIcon: ({ focused, color }) => (
            <MaterialCommunityIcons name="chef-hat" size={24} color={color} />
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
