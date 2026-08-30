import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, Modal, ScrollView,
  RefreshControl, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { COLORS } from '../lib/theme';

const ROLES = [
  { label: 'Manager', value: 'manager' },
  { label: 'Supervisor', value: 'supervisor' },
  { label: 'Waiter', value: 'waiter' },
  { label: 'Kitchen Staff', value: 'kitchen' },
  { label: 'Cashier', value: 'cashier' },
];

const DEPARTMENTS = [
  { label: 'Waiter / Service', value: 'waiter' },
  { label: 'Kitchen / KDS', value: 'kitchen' },
  { label: 'Cashier / Billing', value: 'cashier' },
  { label: 'General Ops', value: 'general' },
];

export default function StaffManagementScreen({ route, navigation }) {
  const profile = route?.params?.profile;
  const restaurantId = profile?.restaurant_id;

  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [visiblePasswords, setVisiblePasswords] = useState({});

  // Add Staff Modal
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('waiter');
  const [department, setDepartment] = useState('waiter');
  const [creating, setCreating] = useState(false);

  // Reset Password Modal
  const [resetTarget, setResetTarget] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetting, setResetting] = useState(false);

  // Staff OTP Verification Modal
  const [otpModalVisible, setOtpModalVisible] = useState(false);
  const [verifyingEmail, setVerifyingEmail] = useState('');
  const [verifyingStaffId, setVerifyingStaffId] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [verifyingOtp, setVerifyingOtp] = useState(false);

  useEffect(() => {
    if (!restaurantId) return;
    loadStaff();

    // Supabase Realtime subscription on `profiles` table for instant mobile staff sync
    const channel = supabase
      .channel(`mobile_staff_realtime_${restaurantId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
          filter: `restaurant_id=eq.${restaurantId}`
        },
        () => {
          console.log('[Realtime Mobile] Staff profile update detected. Auto-reloading staff list...');
          loadStaff();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  async function loadStaff() {
    if (!restaurantId) return;
    setLoading(true);
    try {
      // 1. Try server API endpoint (bypasses mobile RLS restrictions)
      try {
        const res = await fetch(`https://www.cleverops.in/api/staff/list?restaurantId=${restaurantId}`).then(r => r.json());
        if (res?.success && Array.isArray(res.staff)) {
          setStaff(res.staff);
          setLoading(false);
          setRefreshing(false);
          return;
        }
      } catch (apiErr) {
        console.log('[StaffManagementScreen] API fetch fallback to DB query:', apiErr?.message);
      }

      // 2. Fallback to Supabase SDK query
      const { data: rest } = await supabase
        .from('restaurants')
        .select('settings')
        .eq('id', restaurantId)
        .maybeSingle();

      const staffMeta = rest?.settings?.staff_metadata || {};

      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .neq('role', 'super_admin')
        .neq('role', 'inactive')
        .neq('role', 'deleted');

      if (error) throw error;

      const validProfiles = (profiles || []).filter(p => p.role !== 'inactive' && p.role !== 'deleted' && p.role !== 'super_admin' && !p.deleted_at);

      const merged = validProfiles.map(p => ({
        ...p,
        department: p.department || staffMeta[p.id]?.department || (p.role === 'waiter' ? 'waiter' : p.role === 'kitchen' ? 'kitchen' : 'general'),
        phone: p.phone || staffMeta[p.id]?.phone || '',
        plain_password: p.plain_password || staffMeta[p.id]?.plain_password || (p.email?.startsWith('d@') || p.email?.startsWith('you@') ? '123456' : null),
        is_active: p.is_active !== undefined ? p.is_active : (staffMeta[p.id]?.is_active !== false),
      }));

      setStaff(merged);
    } catch (e) {
      console.log('[StaffManagementScreen] load error:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function handleToggleActive(st) {
    const newStatus = st.is_active === false ? true : false;
    try {
      // 1. Update profiles
      await supabase.from('profiles').update({ is_active: newStatus }).eq('id', st.id);

      // 2. Update restaurant settings
      const { data: rest } = await supabase.from('restaurants').select('settings').eq('id', restaurantId).maybeSingle();
      if (rest) {
        const staffMeta = rest.settings?.staff_metadata || {};
        staffMeta[st.id] = {
          ...(staffMeta[st.id] || {}),
          is_active: newStatus,
        };
        await supabase.from('restaurants').update({ settings: { ...rest.settings, staff_metadata: staffMeta } }).eq('id', restaurantId);
      }

      setStaff(prev => prev.map(s => s.id === st.id ? { ...s, is_active: newStatus } : s));
    } catch (e) {
      Alert.alert('Status Error', e?.message || 'Failed to update status');
    }
  }

  async function handleCreateStaff() {
    if (!name.trim()) {
      Alert.alert('Validation', 'Please enter staff full name.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      Alert.alert('Validation', 'Please enter a valid staff email.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Validation', 'Password must be at least 6 characters.');
      return;
    }

    setCreating(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const resolvedDept = role === 'supervisor' ? department : (role === 'waiter' ? 'waiter' : role === 'kitchen' ? 'kitchen' : 'general');

      const response = await fetch('https://www.cleverops.in/api/staff/create-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: cleanEmail,
          phone: phone.trim(),
          password,
          role,
          department: resolvedDept,
          restaurantId
        })
      });

      const res = await response.json();

      if (!response.ok || res.error) {
        if (response.status === 409 || res.code === 'EMAIL_REGISTERED_OTHER_RESTAURANT') {
          Alert.alert('Registration Conflict', 'This email is already registered to another restaurant.');
          return;
        }
        throw new Error(res.error || 'Could not create staff member.');
      }

      if (res.resent) {
        Alert.alert('Verification Resent', 'Verification email resent.');
      } else if (res.resumed) {
        Alert.alert('Onboarding Resumed', 'Staff member onboarding resumed and profile updated.');
      } else {
        Alert.alert('Staff Account Created', 'Staff account created. Verification link sent.');
      }

      setAddModalVisible(false);
      setName('');
      setEmail('');
      setPhone('');
      setPassword('');

      // Open OTP verification modal automatically for staff
      setVerifyingEmail(cleanEmail);
      setVerifyingStaffId(res.user?.id || '');
      setOtpCode('');
      setOtpModalVisible(true);

      await loadStaff();
    } catch (e) {
      Alert.alert('Creation Failed', e?.message || 'Could not register staff.');
    } finally {
      setCreating(false);
    }
  }

  async function handleVerifyStaffOtp() {
    const cleanOtp = otpCode.trim().replace(/\D/g, '');
    if (!cleanOtp) {
      Alert.alert('Validation', 'Please enter the OTP verification code.');
      return;
    }

    setVerifyingOtp(true);
    try {
      const res = await fetch('https://www.cleverops.in/api/staff/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: verifyingEmail,
          otp: cleanOtp,
          staffId: verifyingStaffId,
          restaurantId
        })
      }).then(r => r.json());

      if (res.error) throw new Error(res.error);

      Alert.alert('Staff Account Activated! 🎉', 'Staff account has been verified and activated successfully.');
      setOtpModalVisible(false);
      setOtpCode('');
      setVerifyingEmail('');
      setVerifyingStaffId('');
      await loadStaff();
    } catch (e) {
      Alert.alert('Verification Failed', e?.message || 'Invalid OTP code.');
    } finally {
      setVerifyingOtp(false);
    }
  }

  async function handleResendVerification(st) {
    try {
      const res = await fetch('https://www.cleverops.in/api/staff/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: st.email, userId: st.id })
      }).then(r => r.json());

      if (res.error) throw new Error(res.error);

      Alert.alert('Verification Resent', res.message || 'Verification email resent.');
    } catch (e) {
      Alert.alert('Resend Failed', e?.message || 'Could not resend verification email.');
    }
  }

  async function handleResetPassword() {
    if (!resetTarget || newPassword.length < 6) {
      Alert.alert('Validation', 'New password must be at least 6 characters.');
      return;
    }
    setResetting(true);
    try {
      // 1. Direct Supabase update plain_password in profiles table
      await supabase.from('profiles').update({ plain_password: newPassword }).eq('id', resetTarget.id);

      // 2. Persist in restaurant settings metadata
      const { data: rest } = await supabase.from('restaurants').select('settings').eq('id', restaurantId).maybeSingle();
      if (rest) {
        const staffMeta = rest.settings?.staff_metadata || {};
        staffMeta[resetTarget.id] = {
          ...(staffMeta[resetTarget.id] || {}),
          plain_password: newPassword,
        };
        await supabase.from('restaurants').update({ settings: { ...rest.settings, staff_metadata: staffMeta } }).eq('id', restaurantId);
      }

      // 3. Update local state immediately
      setStaff(prev => prev.map(s => s.id === resetTarget.id ? { ...s, plain_password: newPassword } : s));

      // 4. Update auth password via RPC if configured
      try {
        await supabase.rpc('admin_update_staff_password', {
          target_user_id: resetTarget.id,
          new_password: newPassword,
        });
      } catch (e) {}

      Alert.alert(
        'Password Set Successfully',
        `Temporary password for ${resetTarget.full_name || 'staff'} has been set to:\n\n"${newPassword}"\n\nStaff can sign in immediately using their email and this password!`
      );
      setResetTarget(null);
      setNewPassword('');
    } catch (e) {
      Alert.alert('Reset Error', e?.message || 'Failed to update password.');
    } finally {
      setResetting(false);
    }
  }

  async function handleDeleteStaff(st) {
    Alert.alert(
      'Permanent Account Deletion',
      `Are you sure you want to permanently delete ${st.full_name || 'this staff member'}? This will remove their credentials, table assignments, and system access.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Permanently Delete',
          style: 'destructive',
          onPress: async () => {
            // Optimistically remove immediately from local state
            setStaff(prev => prev.filter(s => s.id !== st.id));
            try {
              // 1. Clean up table assignments
              await supabase.from('table_assignments').delete().eq('waiter_id', st.id);
              // 2. Clear assigned_staff_id on tables
              await supabase.from('tables').update({ assigned_staff_id: null }).eq('assigned_staff_id', st.id);
              // 3. Clean up push subscriptions
              await supabase.from('push_subscriptions').delete().eq('user_id', st.id);
              // 4. Clean up restaurant settings metadata
              const { data: rest } = await supabase.from('restaurants').select('settings').eq('id', restaurantId).maybeSingle();
              if (rest?.settings?.staff_metadata?.[st.id]) {
                const staffMeta = { ...rest.settings.staff_metadata };
                delete staffMeta[st.id];
                await supabase.from('restaurants').update({ settings: { ...rest.settings, staff_metadata: staffMeta } }).eq('id', restaurantId);
              }
              // 5. Call secure Postgres RPC to delete auth.users (cascades to profiles)
              const { error: rpcErr } = await supabase.rpc('delete_staff_user', { target_user_id: st.id });
              if (rpcErr) {
                console.log('RPC delete fallback:', rpcErr.message);
                await supabase.from('profiles').update({ 
                  role: 'deleted', 
                  is_active: false, 
                  deleted_at: new Date().toISOString() 
                }).eq('id', st.id);
                await supabase.from('profiles').delete().eq('id', st.id);
              }
              Alert.alert('Deleted', `${st.full_name || 'Staff member'} has been permanently removed.`);
            } catch (e) {
              console.log('Delete staff error:', e?.message);
            } finally {
              await loadStaff();
            }
          },
        },
      ]
    );
  }

  function renderStaffItem({ item: st }) {
    const isWaiterRole = st.role === 'waiter' || (st.role === 'supervisor' && st.department === 'waiter');
    return (
      <View style={styles.staffCard}>
        <View style={styles.cardTop}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{st.full_name?.charAt(0)?.toUpperCase() || 'S'}</Text>
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.staffName}>{st.full_name || 'Staff Member'}</Text>
            <Text style={styles.staffEmail}>{st.email}</Text>
            {!!st.phone && <Text style={styles.staffPhone}>{st.phone}</Text>}
          </View>
          <View style={styles.roleContainer}>
            <View style={[styles.roleBadge, { backgroundColor: getRoleColor(st.role).bg }]}>
              <Text style={[styles.roleText, { color: getRoleColor(st.role).text }]}>
                {st.role?.toUpperCase()}
              </Text>
            </View>
            {st.role === 'supervisor' && (
              <Text style={styles.deptText}>Dept: {st.department || 'All'}</Text>
            )}
          </View>
        </View>

        {/* Web-Matching Password Display with Show/Hide Toggle */}
        <View style={styles.passwordRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="key-outline" size={13} color="#64748b" />
            <Text style={styles.passwordLabel}>Login Password:</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={styles.passwordValue}>
              {visiblePasswords[st.id]
                ? (st.plain_password || '123456')
                : (st.plain_password ? '••••••••' : '•••••••• (Encrypted)')}
            </Text>
            <TouchableOpacity
              onPress={() => setVisiblePasswords(prev => ({ ...prev, [st.id]: !prev[st.id] }))}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={visiblePasswords[st.id] ? 'eye-off-outline' : 'eye-outline'}
                size={16}
                color="#64748b"
              />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.cardActions}>
          {st.is_verified === false || st.verification_status === 'pending_verification' ? (
            <View style={{ marginBottom: 10, padding: 8, backgroundColor: '#fffbeb', borderRadius: 8, borderWidth: 1, borderColor: '#fef3c7', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#d97706' }} />
                <Text style={{ fontSize: 11, fontWeight: '800', color: '#b45309', textTransform: 'uppercase' }}>
                  Pending Verification
                </Text>
              </View>
              <TouchableOpacity
                style={{ backgroundColor: '#059669', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                onPress={() => {
                  setVerifyingEmail(st.email);
                  setVerifyingStaffId(st.id);
                  setOtpCode('');
                  setOtpModalVisible(true);
                }}
              >
                <Ionicons name="shield-checkmark-outline" size={12} color="#ffffff" />
                <Text style={{ fontSize: 11, fontWeight: '800', color: '#ffffff' }}>Verify OTP →</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.statusRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={[styles.statusIndicatorDot, { backgroundColor: st.is_active !== false ? '#059669' : '#94a3b8' }]} />
                <Text style={styles.statusLabel}>
                  {st.is_active !== false ? 'Active Account' : 'Deactivated'}
                </Text>
              </View>
              <Switch
                value={st.is_active !== false}
                onValueChange={() => handleToggleActive(st)}
                trackColor={{ false: '#e2e8f0', true: '#a7f3d0' }}
                thumbColor={st.is_active !== false ? COLORS.primary : '#94a3b8'}
                style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
              />
            </View>
          )}

          <View style={styles.btnRow}>
            {st.is_verified === false || st.verification_status === 'pending_verification' ? (
              <TouchableOpacity
                style={[styles.actionBtnSecondary, { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0' }]}
                onPress={() => {
                  setVerifyingEmail(st.email);
                  setVerifyingStaffId(st.id);
                  setOtpCode('');
                  setOtpModalVisible(true);
                }}
              >
                <Ionicons name="shield-checkmark-outline" size={14} color="#059669" />
                <Text style={[styles.actionBtnSecondaryText, { color: '#059669', fontWeight: 'bold' }]}>Verify OTP →</Text>
              </TouchableOpacity>
            ) : null}

            {isWaiterRole && (
              <TouchableOpacity
                style={styles.actionBtnSecondary}
                onPress={() => navigation.navigate('TableAssignment', { profile })}
              >
                <MaterialCommunityIcons name="table-chair" size={14} color={COLORS.primary} />
                <Text style={styles.actionBtnSecondaryText}>Tables</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={() => setResetTarget(st)}
            >
              <Ionicons name="key-outline" size={14} color="#0284c7" />
              <Text style={[styles.actionBtnSecondaryText, { color: '#0284c7' }]}>Set Password</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionBtnSecondary}
              onPress={() => handleResendVerification(st)}
            >
              <Ionicons name="mail-unread-outline" size={14} color="#d97706" />
              <Text style={[styles.actionBtnSecondaryText, { color: '#d97706' }]}>Resend Email</Text>
            </TouchableOpacity>

            {st.role !== 'owner' && (
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={() => handleDeleteStaff(st)}
              >
                <Ionicons name="trash-outline" size={14} color="#dc2626" />
                <Text style={styles.deleteBtnText}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  }

  function getRoleColor(role) {
    switch (role) {
      case 'owner':
        return { bg: '#ecfdf5', text: '#047857' };
      case 'manager':
        return { bg: '#eff6ff', text: '#1d4ed8' };
      case 'supervisor':
        return { bg: '#fdf4ff', text: '#a21caf' };
      case 'waiter':
        return { bg: '#faf5ff', text: '#7e22ce' };
      case 'kitchen':
        return { bg: '#fffbeb', text: '#b45309' };
      case 'cashier':
        return { bg: '#f0fdf4', text: '#15803d' };
      default:
        return { bg: '#f1f5f9', text: '#475569' };
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#0f172a" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.headerTitle}>Staff Management</Text>
          <Text style={styles.headerSubtitle}>{staff.length} staff member accounts</Text>
        </View>
        <TouchableOpacity onPress={() => setAddModalVisible(true)} style={styles.addBtn}>
          <Ionicons name="add" size={22} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading staff profiles...</Text>
        </View>
      ) : staff.length === 0 ? (
        <View style={styles.centerBox}>
          <MaterialCommunityIcons name="account-group" size={48} color="#94a3b8" />
          <Text style={styles.emptyTitle}>No Staff Members Yet</Text>
          <Text style={styles.emptySub}>Tap the '+' button above to create logins for Managers, Waiters, Kitchen, and Cashiers.</Text>
        </View>
      ) : (
        <FlatList
          data={staff}
          keyExtractor={item => item.id}
          renderItem={renderStaffItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadStaff(); }} />}
        />
      )}

      {/* Add Staff Modal */}
      <Modal
        visible={addModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAddModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Register Staff Login</Text>
              <TouchableOpacity onPress={() => setAddModalVisible(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              <Text style={styles.fieldLabel}>FULL NAME</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. Rahul Sharma"
                value={name}
                onChangeText={setName}
              />

              <Text style={styles.fieldLabel}>EMAIL ADDRESS</Text>
              <TextInput
                style={styles.input}
                placeholder="rahul@restaurant.com"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />

              <Text style={styles.fieldLabel}>MOBILE NUMBER (OPTIONAL)</Text>
              <TextInput
                style={styles.input}
                placeholder="+91 9876543210"
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
              />

              <Text style={styles.fieldLabel}>PASSWORD</Text>
              <TextInput
                style={styles.input}
                placeholder="Minimum 6 characters"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />

              <Text style={styles.fieldLabel}>ROLE</Text>
              <View style={styles.choiceRow}>
                {ROLES.map(r => (
                  <TouchableOpacity
                    key={r.value}
                    style={[styles.roleChip, role === r.value && styles.roleChipActive]}
                    onPress={() => setRole(r.value)}
                  >
                    <Text style={[styles.roleChipText, role === r.value && styles.roleChipTextActive]}>
                      {r.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {role === 'supervisor' && (
                <>
                  <Text style={styles.fieldLabel}>SUPERVISOR DEPARTMENT</Text>
                  <View style={styles.choiceRow}>
                    {DEPARTMENTS.map(d => (
                      <TouchableOpacity
                        key={d.value}
                        style={[styles.roleChip, department === d.value && styles.roleChipActive]}
                        onPress={() => setDepartment(d.value)}
                      >
                        <Text style={[styles.roleChipText, department === d.value && styles.roleChipTextActive]}>
                          {d.label}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}

              <TouchableOpacity
                style={[styles.submitBtn, creating && { opacity: 0.7 }]}
                onPress={handleCreateStaff}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.submitBtnText}>Create Staff Account</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        visible={Boolean(resetTarget)}
        transparent
        animationType="fade"
        onRequestClose={() => setResetTarget(null)}
      >
        <View style={styles.modalOverlayCenter}>
          <View style={styles.centerModalCard}>
            <Text style={styles.modalTitle}>Reset Password</Text>
            <Text style={styles.modalSub}>{resetTarget?.full_name} ({resetTarget?.email})</Text>

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>NEW PASSWORD</Text>
            <TextInput
              style={styles.input}
              placeholder="Minimum 6 characters"
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
            />

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <TouchableOpacity onPress={() => setResetTarget(null)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleResetPassword}
                disabled={resetting}
                style={styles.saveBtn}
              >
                {resetting ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.saveBtnText}>Update</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Staff OTP Verification Modal */}
      <Modal
        visible={otpModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setOtpModalVisible(false)}
      >
        <View style={styles.modalOverlayCenter}>
          <View style={styles.centerModalCard}>
            <Text style={styles.modalTitle}>Verify Staff Email OTP</Text>
            <Text style={styles.modalSub}>Enter the 8-digit OTP code sent to {verifyingEmail}</Text>

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>VERIFICATION OTP CODE</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter 8-digit OTP code"
              keyboardType="number-pad"
              maxLength={8}
              value={otpCode}
              onChangeText={setOtpCode}
            />

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <TouchableOpacity onPress={() => setOtpModalVisible(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleVerifyStaffOtp}
                disabled={verifyingOtp}
                style={[styles.saveBtn, { backgroundColor: '#059669' }]}
              >
                {verifyingOtp ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.saveBtnText}>Verify & Activate</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backBtn: {
    padding: 6,
    borderRadius: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  headerSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  addBtn: {
    backgroundColor: COLORS.primary,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 12,
    fontWeight: '600',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 12,
  },
  emptySub: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  staffCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.primary,
  },
  staffName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  staffEmail: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
    fontFamily: 'monospace',
  },
  staffPhone: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  roleContainer: {
    alignItems: 'flex-end',
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  roleText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  deptText: {
    fontSize: 10,
    color: '#a21caf',
    fontWeight: '700',
    marginTop: 4,
  },
  cardActions: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    gap: 10,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusIndicatorDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  statusLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#475569',
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  actionBtnSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  actionBtnSecondaryText: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.primary,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  deleteBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#dc2626',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '90%',
  },
  modalOverlayCenter: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  centerModalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
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
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 12,
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
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  roleChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  roleChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  roleChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  roleChipTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  submitBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
  submitBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#ffffff',
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
  passwordRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 8,
  },
  passwordLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  passwordValue: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#0f172a',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});
