import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform,
  Animated, StatusBar, ScrollView, TouchableWithoutFeedback, Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { COLORS } from '../lib/theme';
import { registerForPushNotificationsAsync } from '../lib/notifications';
import * as Updates from 'expo-updates';
import OTAUpdateBtn from '../components/OTAUpdateBtn';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const fadeAnim = useState(new Animated.Value(0))[0];
  const slideAnim = useState(new Animated.Value(30))[0];

  const [selectedRole, setSelectedRole] = useState('auto'); // 'auto' | 'kitchen' | 'waiter' | 'owner'
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const handleCheckUpdate = async () => {
    if (__DEV__) {
      Alert.alert('Development Mode', 'OTA updates are active in Production standalone build.');
      return;
    }
    setCheckingUpdate(true);
    try {
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        await Updates.fetchUpdateAsync();
        Alert.alert(
          'Update Successful! 🎉',
          'App has been updated to the latest version. Restarting now...',
          [
            {
              text: 'OK',
              onPress: async () => {
                await Updates.reloadAsync();
              },
            },
          ],
          { cancelable: false }
        );
      } else {
        Alert.alert('App Up To Date ✅', 'You are already using the latest version of SmartDine!');
      }
    } catch (error) {
      console.log('[OTAUpdate] Error:', error?.message);
      Alert.alert('Update Check', error?.message || 'Unable to check for updates right now.');
    } finally {
      setCheckingUpdate(false);
    }
  };

  useEffect(() => {
    checkExistingSession();
  }, []);

  function animateIn() {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }

  async function checkExistingSession() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        await fetchProfileAndNavigate(session.user.id, session.user.email || '');
        return;
      }
    } catch (e) {
      console.log('[LoginScreen] session check error:', e?.message);
    }
    setCheckingSession(false);
    animateIn();
  }

  async function fetchProfileAndNavigate(userId, userEmail = '') {
    try {
      let profile = null;

      // 1. Fetch profile from database
      const { data: p1 } = await supabase
        .from('profiles')
        .select('*, restaurants(name)')
        .eq('id', userId)
        .maybeSingle();

      if (p1) profile = p1;

      const em = (userEmail || profile?.email || email || '').toLowerCase();

      // Priority 1: User explicitly picked role chip on Login screen
      // Priority 2: Database profile.role ('kitchen', 'waiter', 'owner', 'cashier')
      // Priority 3: Email prefix inference
      let finalRole = (selectedRole !== 'auto' ? selectedRole : null) || profile?.role;

      if (!finalRole) {
        if (em.includes('kitchen') || em.startsWith('youk@')) finalRole = 'kitchen';
        else if (em.includes('waiter') || em.startsWith('youw@')) finalRole = 'waiter';
        else if (em.includes('cashier')) finalRole = 'cashier';
        else finalRole = 'owner';
      }

      if (!profile) {
        profile = { id: userId, role: finalRole, email: em, restaurant_id: 'c1853f65-c10c-4f8a-b379-00a60f404ef9' };
      } else {
        profile.role = finalRole;
        if (!profile.restaurant_id) profile.restaurant_id = 'c1853f65-c10c-4f8a-b379-00a60f404ef9';
      }

      if (profile.restaurants?.name && !profile.restaurant_name) {
        profile.restaurant_name = profile.restaurants.name;
      }

      setTimeout(() => {
        registerForPushNotificationsAsync(userId).catch(() => {});
      }, 500);

      navigateByRole(finalRole, profile);
    } catch (e) {
      console.log('[LoginScreen] profile fetch error:', e?.message);
      const em = (userEmail || email || '').toLowerCase();
      let fallbackRole = selectedRole !== 'auto' ? selectedRole : null;
      if (!fallbackRole) {
        if (em.includes('kitchen') || em.startsWith('youk@')) fallbackRole = 'kitchen';
        else if (em.includes('waiter') || em.startsWith('youw@')) fallbackRole = 'waiter';
        else if (em.includes('cashier')) fallbackRole = 'cashier';
        else fallbackRole = 'owner';
      }

      navigateByRole(fallbackRole, { id: userId, role: fallbackRole, email: em, restaurant_id: 'c1853f65-c10c-4f8a-b379-00a60f404ef9' });
    }
  }

  function navigateByRole(role, profile) {
    setCheckingSession(false);
    switch (role) {
      case 'kitchen':
        navigation.replace('KitchenApp', { profile });
        break;
      case 'waiter':
        navigation.replace('WaiterApp', { profile });
        break;
      case 'cashier':
        navigation.replace('CashierApp', { profile });
        break;
      case 'super_admin':
        navigation.replace('SuperAdmin', { profile });
        break;
      default:
        navigation.replace('MainApp', { profile });
        break;
    }
  }

  async function handleLogin() {
    Keyboard.dismiss();
    setErrorMsg('');

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password;

    if (!cleanEmail) {
      setErrorMsg('Please enter your email address.');
      return;
    }
    if (!cleanPassword) {
      setErrorMsg('Please enter your password.');
      return;
    }

    setLoading(true);
    try {
      // 1. Purge previous session state
      await supabase.auth.signOut().catch(() => {});

      // 2. Perform sign-in
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPassword,
      });

      if (error) {
        setErrorMsg(error.message || 'Invalid email or password. Please try again.');
        return;
      }

      if (data?.user) {
        await fetchProfileAndNavigate(data.user.id, cleanEmail);
      } else {
        setErrorMsg('Login failed. Please try again.');
      }
    } catch (e) {
      setErrorMsg(e?.message || 'Network error. Check your internet connection.');
    } finally {
      setLoading(false);
    }
  }

  if (checkingSession) {
    return (
      <View style={styles.splashContainer}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />
        <View style={styles.splashLogoCircle}>
          <MaterialCommunityIcons name="silverware-fork-knife" size={40} color="#ffffff" />
        </View>
        <Text style={styles.splashTitle}>SmartDine</Text>
        <Text style={styles.splashSubtitle}>Staff & Operations Portal</Text>
        <ActivityIndicator color="#ffffff" size="large" style={{ marginTop: 32 }} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#f8fafc" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            contentContainerStyle={styles.scrollInner}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Brand Header */}
            <View style={styles.brandHeader}>
              <View style={{ position: 'absolute', top: 0, right: 16, zIndex: 10 }}>
                <OTAUpdateBtn bgColor="#ffffff" iconColor={COLORS.primary} />
              </View>
              <View style={styles.logoCircle}>
                <MaterialCommunityIcons name="silverware-fork-knife" size={30} color="#ffffff" />
              </View>
              <Text style={styles.appName}>SmartDine</Text>
              <Text style={styles.appTagline}>Staff & Operations Portal</Text>
            </View>

            {/* Form Card */}
            <Animated.View style={[styles.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              <Text style={styles.cardTitle}>Sign In</Text>
              <Text style={styles.cardSubtitle}>Enter your restaurant staff credentials</Text>

              {/* OTA Update Action Chip */}
              <TouchableOpacity
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justify: 'center',
                  backgroundColor: '#e0f2fe',
                  paddingVertical: 10,
                  paddingHorizontal: 16,
                  borderRadius: 12,
                  marginBottom: 16,
                  borderWidth: 1,
                  borderColor: '#bae6fd'
                }}
                onPress={handleCheckUpdate}
                disabled={checkingUpdate}
              >
                {checkingUpdate ? (
                  <ActivityIndicator size="small" color="#0284c7" style={{ marginRight: 8 }} />
                ) : (
                  <Ionicons name="cloud-download-outline" size={18} color="#0284c7" style={{ marginRight: 8 }} />
                )}
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#0284c7' }}>
                  {checkingUpdate ? 'Checking for updates...' : 'Check & Apply App Updates 🚀'}
                </Text>
              </TouchableOpacity>

              {/* Error Banner */}
              {errorMsg ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle-outline" size={16} color="#dc2626" style={{ marginRight: 6 }} />
                  <Text style={styles.errorText}>{errorMsg}</Text>
                </View>
              ) : null}

              {/* Email Field */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Email Address</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="mail-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="owner@restaurant.com"
                    placeholderTextColor="#94a3b8"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={email}
                    onChangeText={(t) => { setEmail(t); setErrorMsg(''); }}
                    returnKeyType="next"
                    editable={!loading}
                  />
                </View>
              </View>

              {/* Password Field */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Password</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="lock-closed-outline" size={18} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="••••••••"
                    placeholderTextColor="#94a3b8"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={(t) => { setPassword(t); setErrorMsg(''); }}
                    returnKeyType="done"
                    onSubmitEditing={handleLogin}
                    editable={!loading}
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                    <Ionicons
                      name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                      size={18}
                      color="#94a3b8"
                    />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Sign In Button */}
              <TouchableOpacity
                style={[styles.loginBtn, loading && { opacity: 0.7 }]}
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.8}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <>
                    <Text style={styles.loginBtnText}>Sign In</Text>
                    <Ionicons name="arrow-forward" size={18} color="#ffffff" style={{ marginLeft: 8 }} />
                  </>
                )}
              </TouchableOpacity>

              {/* Interactive Role Selection Chips */}
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 8, marginTop: 12 }}>
                Login Portal Mode:
              </Text>
              <View style={styles.rolesRow}>
                {[
                  { label: 'Auto', key: 'auto' },
                  { label: 'Kitchen 👨‍🍳', key: 'kitchen' },
                  { label: 'Waiter 🛎️', key: 'waiter' },
                  { label: 'Owner 👑', key: 'owner' }
                ].map((item) => (
                  <TouchableOpacity
                    key={item.key}
                    style={[
                      styles.roleChip,
                      selectedRole === item.key && { backgroundColor: COLORS.primary, borderColor: COLORS.primary }
                    ]}
                    onPress={() => setSelectedRole(item.key)}
                  >
                    <Text style={[
                      styles.roleChipText,
                      selectedRole === item.key && { color: '#ffffff', fontWeight: '700' }
                    ]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </Animated.View>

            <Text style={styles.footerText}>Powered by CleverOps · cleverops.in</Text>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashLogoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  splashTitle: {
    fontSize: 30,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 1,
  },
  splashSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    marginTop: 4,
  },
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollInner: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  brandHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    elevation: 6,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  appName: {
    fontSize: 26,
    fontWeight: '700',
    color: '#0f172a',
  },
  appTagline: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 3,
  },
  card: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 24,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  cardTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 3,
    marginBottom: 20,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 16,
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 50,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: '#0f172a',
  },
  eyeBtn: {
    padding: 6,
  },
  loginBtn: {
    backgroundColor: COLORS.primary,
    height: 52,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    elevation: 3,
    shadowColor: COLORS.primary,
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  loginBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  rolesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  roleChip: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    margin: 3,
  },
  roleChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
  },
  footerText: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 24,
  },
});
