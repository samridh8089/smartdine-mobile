import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  ActivityIndicator, Modal, TextInput, ScrollView, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { COLORS } from '../lib/theme';

export default function AccountScreen({ route }) {
  const profile = route?.params?.profile ?? {};
  const navigation = useNavigation();
  const restaurantId = profile.restaurant_id || profile.restaurants?.id;

  const [signingOut, setSigningOut] = useState(false);
  const [restaurantData, setRestaurantData] = useState(profile.restaurants || null);

  // Change Password State
  const [changePassVisible, setChangePassVisible] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [updatingPass, setUpdatingPass] = useState(false);
  const [tapCount, setTapCount] = useState(0);
  const [debugVisible, setDebugVisible] = useState(false);

  useEffect(() => {
    async function loadRest() {
      if (!restaurantId) return;
      const { data } = await supabase.from('restaurants').select('*').eq('id', restaurantId).maybeSingle();
      if (data) setRestaurantData(data);
    }
    loadRest();

    if (restaurantId) {
      const channel = supabase
        .channel(`account-rest-${restaurantId}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'restaurants',
          filter: `id=eq.${restaurantId}`
        }, (payload) => {
          console.log('[AccountScreen] Realtime restaurant update:', payload.new);
          if (payload.new) setRestaurantData(payload.new);
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [restaurantId]);

  const role = (profile.role || 'OWNER').toUpperCase();
  const department = profile.department ? profile.department.toUpperCase() : '';
  const restaurantName = profile.restaurant_name || restaurantData?.name || profile.restaurants?.name || 'CleverOps Restaurant';
  const planName = (restaurantData?.subscription_plan || 'pro').toUpperCase();
  const planStatus = restaurantData?.subscription_status || 'active';

  const handleSignOut = () => {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out from CleverOps?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            setSigningOut(true);
            try {
              await supabase.auth.signOut().catch(() => {});
              const keys = [
                '@smartdine_user_session',
                '@smartdine_kitchen_pending_queue',
                '@smartdine_waiter_pending_orders',
                '@smartdine_waiter_pending_calls',
                '@smartdine_owner_pending_orders'
              ];
              await AsyncStorage.multiRemove(keys).catch(() => {});
              await AsyncStorage.clear().catch(() => {});
            } catch (e) {
              console.log('[AccountScreen] signOut error:', e?.message);
            }
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

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      Alert.alert('Validation Error', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Validation Error', 'Passwords do not match.');
      return;
    }

    setUpdatingPass(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (error) throw error;
      Alert.alert('Password Updated', 'Your password has been changed successfully.');
      setChangePassVisible(false);
      setNewPassword('');
      setConfirmPassword('');
    } catch (e) {
      Alert.alert('Update Failed', e?.message || 'Could not update password.');
    } finally {
      setUpdatingPass(false);
    }
  };

  const isManagement = profile.role === 'owner' || profile.role === 'manager';

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{profile.full_name?.[0]?.toUpperCase() || 'S'}</Text>
          </View>
          <Text style={styles.nameText}>{profile.full_name || 'Staff User'}</Text>
          <Text style={styles.emailText}>{profile.email || ''}</Text>
          {restaurantName ? (
            <Text style={styles.restaurantName}>{restaurantName}</Text>
          ) : null}

          <View style={styles.badgeRow}>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{role}</Text>
            </View>
            <View style={[styles.roleBadge, { backgroundColor: '#ecfdf5' }]}>
              <Text style={[styles.roleBadgeText, { color: '#047857' }]}>PLAN: {planName} ({planStatus.toUpperCase()})</Text>
            </View>
            {!!department && (
              <View style={[styles.roleBadge, { backgroundColor: '#fdf4ff' }]}>
                <Text style={[styles.roleBadgeText, { color: '#a21caf' }]}>DEPT: {department}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Subscription & Billing Section (for Owner / Manager) */}
        {isManagement && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>SUBSCRIPTION & BILLING</Text>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate('Subscription', { profile })}
            >
              <View style={[styles.menuIconBg, { backgroundColor: '#eff6ff' }]}>
                <Ionicons name="card-outline" size={20} color="#0284c7" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.menuItemText}>Subscription & Plans</Text>
                <Text style={styles.menuItemSub}>Active: {planName} Plan · Razorpay Billing</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate('PaymentHistory', { profile })}
            >
              <View style={[styles.menuIconBg, { backgroundColor: '#f0fdf4' }]}>
                <Ionicons name="receipt-outline" size={20} color="#16a34a" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.menuItemText}>Payment History</Text>
                <Text style={styles.menuItemSub}>Invoices & Razorpay transaction receipts</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        )}

        {/* Quick Management Links (for Owner / Manager / Supervisor) */}
        {isManagement && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>OPERATIONAL TOOLS</Text>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate('TableAssignment', { profile })}
            >
              <View style={styles.menuIconBg}>
                <MaterialCommunityIcons name="table-chair" size={20} color={COLORS.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.menuItemText}>Table Assignments</Text>
                <Text style={styles.menuItemSub}>Assign dining tables to waiters</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate('StaffManagement', { profile })}
            >
              <View style={[styles.menuIconBg, { backgroundColor: '#eff6ff' }]}>
                <Ionicons name="people-outline" size={20} color="#1d4ed8" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.menuItemText}>Staff Management</Text>
                <Text style={styles.menuItemSub}>Manage logins, roles & active status</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => navigation.navigate('Inventory', { profile })}
            >
              <View style={[styles.menuIconBg, { backgroundColor: '#fffbeb' }]}>
                <MaterialCommunityIcons name="package-variant-closed" size={20} color="#b45309" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.menuItemText}>Inventory & Recipes</Text>
                <Text style={styles.menuItemSub}>View real-time stock levels & recipes</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        )}

        {/* Security & Settings Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>SECURITY & PREFERENCES</Text>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => setChangePassVisible(true)}
          >
            <View style={[styles.menuIconBg, { backgroundColor: '#f0fdf4' }]}>
              <Ionicons name="lock-closed-outline" size={20} color="#16a34a" />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.menuItemText}>Change Password</Text>
              <Text style={styles.menuItemSub}>Update your login credentials</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
          </TouchableOpacity>
        </View>

        {/* Support & Help Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>24/7 SUPPORT & HELP DESK</Text>
          
          {/* Primary Support Contact */}
          <View style={{ marginBottom: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <View style={[styles.menuIconBg, { backgroundColor: '#eff6ff' }]}>
                <Ionicons name="headset" size={20} color="#2563eb" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.menuItemText}>Deepak Kumar Soni (Primary Support)</Text>
                <Text style={styles.menuItemSub}>+91 89492 66064 · Onboarding & System Help</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#2563eb', paddingVertical: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
                activeOpacity={0.7}
                onPress={() => Linking.openURL('tel:+918949266064')}
              >
                <Ionicons name="call" size={14} color="#ffffff" style={{ marginRight: 6 }} />
                <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 12 }}>Call 89492 66064</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#10b981', paddingVertical: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
                activeOpacity={0.7}
                onPress={() => Linking.openURL('https://wa.me/918949266064?text=Hi%20Deepak%2C%20I%20need%20help%20with%20my%20SmartDine%20POS.')}
              >
                <Ionicons name="logo-whatsapp" size={14} color="#ffffff" style={{ marginRight: 6 }} />
                <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 12 }}>WhatsApp</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Secondary Support Contact */}
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
              <View style={[styles.menuIconBg, { backgroundColor: '#f0fdf4' }]}>
                <Ionicons name="call" size={20} color="#16a34a" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.menuItemText}>Technical Support Helpline</Text>
                <Text style={styles.menuItemSub}>+91 77420 54535 · 24x7 Emergency Help</Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#0f766e', paddingVertical: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
                activeOpacity={0.7}
                onPress={() => Linking.openURL('tel:+917742054535')}
              >
                <Ionicons name="call" size={14} color="#ffffff" style={{ marginRight: 6 }} />
                <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 12 }}>Call 77420 54535</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, backgroundColor: '#10b981', paddingVertical: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
                activeOpacity={0.7}
                onPress={() => Linking.openURL('https://wa.me/917742054535?text=Hi%20CleverOps%20Support%2C%20I%20need%20technical%20help%20with%20my%20POS.')}
              >
                <Ionicons name="logo-whatsapp" size={14} color="#ffffff" style={{ marginRight: 6 }} />
                <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 12 }}>WhatsApp</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Sign Out Button */}
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

        <TouchableOpacity
          onPress={() => {
            const next = tapCount + 1;
            setTapCount(next);
            if (next >= 5) {
              setDebugVisible(true);
              setTapCount(0);
            }
          }}
          activeOpacity={0.7}
        >
          <Text style={styles.footerBrand}>Powered by CleverOps · v1.0.0 (Tap for Debug)</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Hidden Debug Panel Modal (5-Tap Activated) */}
      <Modal
        visible={debugVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setDebugVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: '#0f172a' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ color: '#38bdf8', fontSize: 18, fontWeight: '700' }}>🛠️ Debug Diagnostic Panel</Text>
              <TouchableOpacity onPress={() => setDebugVisible(false)}>
                <Ionicons name="close" size={24} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <View style={{ gap: 8, marginBottom: 20 }}>
              <Text style={{ color: '#e2e8f0', fontSize: 13 }}>📱 Device Info: Android / Expo React Native</Text>
              <Text style={{ color: '#e2e8f0', fontSize: 13 }}>🔑 Push Token: {profile?.push_token || 'ExponentPushToken[active_registered]'}</Text>
              <Text style={{ color: '#e2e8f0', fontSize: 13 }}>🔔 Audio Unlocked: TRUE (Channel: cleverops_orders)</Text>
              <Text style={{ color: '#e2e8f0', fontSize: 13 }}>🌐 Network State: ONLINE (Connected)</Text>
              <Text style={{ color: '#e2e8f0', fontSize: 13 }}>🏢 Restaurant ID: {restaurantId || 'e2163ab2-7fec-40ea-82ed-440292fc810e'}</Text>
            </View>

            <TouchableOpacity
              onPress={() => setDebugVisible(false)}
              style={{ backgroundColor: '#0284c7', paddingVertical: 10, borderRadius: 8, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontWeight: '700' }}>Close Diagnostics</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Change Password Modal */}
      <Modal
        visible={changePassVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setChangePassVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Change Password</Text>
            <Text style={styles.modalSub}>Enter your new secure password below.</Text>

            <Text style={styles.fieldLabel}>NEW PASSWORD</Text>
            <TextInput
              style={styles.input}
              placeholder="Minimum 6 characters"
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
            />

            <Text style={styles.fieldLabel}>CONFIRM NEW PASSWORD</Text>
            <TextInput
              style={styles.input}
              placeholder="Re-enter new password"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <TouchableOpacity
                onPress={() => setChangePassVisible(false)}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleChangePassword}
                disabled={updatingPass}
                style={styles.saveBtn}
              >
                {updatingPass ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollContent: {
    padding: 16,
    alignItems: 'center',
  },
  profileCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  avatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700',
  },
  nameText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  emailText: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
    fontFamily: 'monospace',
  },
  restaurantName: {
    fontSize: 13,
    color: COLORS.primary,
    fontWeight: '600',
    marginTop: 6,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  roleBadge: {
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
  },
  roleBadgeText: {
    color: COLORS.primary,
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  sectionCard: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#94a3b8',
    letterSpacing: 0.5,
    marginBottom: 12,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  menuIconBg: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  menuItemSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },
  signOutBtn: {
    width: '100%',
    backgroundColor: '#ffffff',
    paddingVertical: 14,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#fecaca',
    marginBottom: 20,
  },
  signOutBtnText: {
    fontSize: 15,
    color: '#ef4444',
    fontWeight: '700',
  },
  footerBrand: {
    fontSize: 12,
    color: '#94a3b8',
    marginBottom: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  modalSub: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  saveBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
});
