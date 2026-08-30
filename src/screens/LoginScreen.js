import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform,
  Animated, StatusBar, ScrollView, TouchableWithoutFeedback, Keyboard, Alert, Image, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { COLORS } from '../lib/theme';
import { registerForPushNotificationsAsync } from '../lib/notifications';
import * as Updates from 'expo-updates';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // Forgot password modal state
  const [forgotModalVisible, setForgotModalVisible] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);

  // Unverified staff state & resend
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const [resendingVerification, setResendingVerification] = useState(false);

  const fadeAnim = useState(new Animated.Value(0))[0];
  const slideAnim = useState(new Animated.Value(30))[0];

  const handleResendVerificationEmail = async () => {
    const target = (unverifiedEmail || email).trim().toLowerCase();
    if (!target || !target.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    setResendingVerification(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: target,
      });
      if (error) throw error;
      Alert.alert(
        'Verification Email Sent',
        `A new verification link has been sent to ${target}. Please check your inbox and verify your email to log in.`
      );
    } catch (e) {
      Alert.alert('Resend Failed', e?.message || 'Could not resend verification email.');
    } finally {
      setResendingVerification(false);
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
        await fetchProfileAndNavigate(session.user.id);
        return;
      }
    } catch (e) {
      console.log('[LoginScreen] session check error:', e?.message);
    }
    setCheckingSession(false);
    animateIn();
  }

  async function fetchProfileAndNavigate(userId) {
    try {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('*, restaurants(name, settings)')
        .eq('id', userId)
        .maybeSingle();

      if (error || !profile || !profile.role) {
        console.log('[LoginScreen] Missing or unverified profile role:', error?.message);
        setCheckingSession(false);
        setErrorMsg('Your account role could not be verified. Please contact your administrator.');
        animateIn();
        return;
      }

      // Check staff email verification if not owner or super admin
      const isOwnerOrSuper = profile.role === 'owner' || profile.role === 'super_admin';
      if (!isOwnerOrSuper) {
        const { data: userData } = await supabase.auth.getUser();
        const emailConfirmed = userData?.user?.email_confirmed_at || profile.is_verified === true || profile.verification_status === 'verified';
        if (!emailConfirmed && (profile.is_verified === false || profile.verification_status === 'pending_verification')) {
          await supabase.auth.signOut().catch(() => {});
          setCheckingSession(false);
          setErrorMsg('Your email is not verified yet. Please verify your email before signing in, or use Resend Verification below.');
          setUnverifiedEmail(profile.email || userData?.user?.email || '');
          animateIn();
          return;
        }
      }

      // Check active status
      const staffMeta = profile.restaurants?.settings?.staff_metadata || {};
      const metaActive = staffMeta[userId]?.is_active;
      const isProfileActive = profile.is_active !== false && metaActive !== false;

      if (!isProfileActive && !isOwnerOrSuper) {
        await supabase.auth.signOut().catch(() => {});
        setCheckingSession(false);
        setErrorMsg('Your staff account has been deactivated. Please contact your manager or administrator.');
        animateIn();
        return;
      }

      if (profile.restaurants?.name && !profile.restaurant_name) {
        profile.restaurant_name = profile.restaurants.name;
      }

      // Resolve department if not in profiles column directly
      if (!profile.department && staffMeta[userId]?.department) {
        profile.department = staffMeta[userId].department;
      }

      setTimeout(() => {
        registerForPushNotificationsAsync(userId).catch(() => {});
      }, 500);

      navigateByRole(profile.role, profile);
    } catch (e) {
      console.log('[LoginScreen] profile fetch error:', e?.message);
      setCheckingSession(false);
      setErrorMsg('Your account role could not be verified. Please contact your administrator.');
      animateIn();
    }
  }

  function navigateByRole(role, profile) {
    setCheckingSession(false);
    const normalizedRole = (role || '').toLowerCase().trim();
    switch (normalizedRole) {
      case 'kitchen':
      case 'kds':
      case 'kitchen_staff':
        navigation.replace('KitchenApp', { profile });
        break;
      case 'waiter':
        navigation.replace('WaiterApp', { profile });
        break;
      case 'cashier':
        navigation.replace('CashierApp', { profile });
        break;
      case 'supervisor':
        navigation.replace('SupervisorApp', { profile });
        break;
      case 'manager':
        navigation.replace('ManagerApp', { profile });
        break;
      case 'super_admin':
        navigation.replace('SuperAdmin', { profile });
        break;
      case 'owner':
        navigation.replace('MainApp', { profile });
        break;
      default:
        setErrorMsg('Your account role could not be verified. Please contact your administrator.');
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
      await supabase.auth.signOut().catch(() => {});

      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: cleanPassword,
      });

      if (error) {
        setErrorMsg(error.message || 'Invalid email or password. Please try again.');
        return;
      }

      if (data?.user) {
        await fetchProfileAndNavigate(data.user.id);
      } else {
        setErrorMsg('Login failed. Please try again.');
      }
    } catch (e) {
      setErrorMsg(e?.message || 'Network error. Check your internet connection.');
    } finally {
      setLoading(false);
    }
  }

  async function handleSendResetPassword() {
    const clean = forgotEmail.trim().toLowerCase();
    if (!clean || !clean.includes('@')) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(clean);
      if (error) throw error;
      Alert.alert(
        'Reset Instructions Sent',
        `If an account is associated with ${clean}, password reset instructions have been sent.`
      );
      setForgotModalVisible(false);
      setForgotEmail('');
    } catch (e) {
      Alert.alert('Password Reset', e?.message || 'Failed to send password reset email.');
    } finally {
      setForgotLoading(false);
    }
  }

  if (checkingSession) {
    return (
      <View style={styles.splashContainer}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />
        <View style={styles.splashLogoCircle}>
          <MaterialCommunityIcons name="silverware-fork-knife" size={40} color="#ffffff" />
        </View>
        <Text style={styles.splashTitle}>CleverOps</Text>
        <Text style={styles.splashSubtitle}>Staff & Operations Portal</Text>
        <ActivityIndicator color="#ffffff" size="large" style={{ marginTop: 32 }} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
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
            {/* Top Brand Header */}
            <View style={styles.brandHeader}>
              <View style={styles.logoCircle}>
                <MaterialCommunityIcons name="silverware-fork-knife" size={32} color="#ffffff" />
              </View>
              <Text style={styles.appName}>CleverOps</Text>
              <Text style={styles.appTagline}>Smart Restaurant Operations</Text>
            </View>

            {/* Login Card */}
            <Animated.View
              style={[
                styles.card,
                {
                  opacity: fadeAnim,
                  transform: [{ translateY: slideAnim }],
                },
              ]}
            >
              <Text style={styles.cardTitle}>Sign In</Text>

              {/* Error Message */}
              {!!errorMsg && (
                <View style={styles.errorBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    <Ionicons name="alert-circle-outline" size={18} color="#dc2626" style={{ marginRight: 8, marginTop: 2 }} />
                    <Text style={[styles.errorText, { flex: 1 }]}>{errorMsg}</Text>
                  </View>
                  {!!unverifiedEmail && (
                    <TouchableOpacity
                      style={{
                        marginTop: 10,
                        backgroundColor: '#dc2626',
                        paddingVertical: 8,
                        paddingHorizontal: 14,
                        borderRadius: 8,
                        alignItems: 'center',
                        flexDirection: 'row',
                        justifyContent: 'center',
                        gap: 6
                      }}
                      onPress={handleResendVerificationEmail}
                      disabled={resendingVerification}
                    >
                      {resendingVerification ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <>
                          <Ionicons name="mail-outline" size={15} color="#ffffff" />
                          <Text style={{ color: '#ffffff', fontSize: 12, fontWeight: '700' }}>Resend Verification Email</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {/* Email Field */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>EMAIL ADDRESS</Text>
                <View style={styles.inputWrapper}>
                  <Ionicons name="mail-outline" size={20} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="staff@restaurant.com"
                    placeholderTextColor="#94a3b8"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={email}
                    onChangeText={(t) => { setEmail(t); setErrorMsg(''); setUnverifiedEmail(''); }}
                    returnKeyType="next"
                    editable={!loading}
                  />
                </View>
              </View>

              {/* Password Field */}
              <View style={styles.inputContainer}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Text style={styles.inputLabel}>PASSWORD</Text>
                  <TouchableOpacity onPress={() => { setForgotEmail(email); setForgotModalVisible(true); }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.primary }}>Forgot Password?</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.inputWrapper}>
                  <Ionicons name="lock-closed-outline" size={20} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="••••••••"
                    placeholderTextColor="#94a3b8"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={(t) => { setPassword(t); setErrorMsg(''); setUnverifiedEmail(''); }}
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

              {/* Create Restaurant Account (Owner Signup) */}
              <TouchableOpacity
                style={styles.signupBtn}
                onPress={async () => {
                  try {
                    await supabase.auth.signOut().catch(() => {});
                    await AsyncStorage.clear().catch(() => {});
                  } catch (e) {}
                  navigation.navigate('OwnerSignup');
                }}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons name="store-plus" size={20} color="#059669" style={{ marginRight: 8 }} />
                <Text style={styles.signupBtnText}>Create Restaurant Account</Text>
              </TouchableOpacity>
              {/* Dedicated Support Contact Card */}
              <View style={{ backgroundColor: '#ffffff', borderRadius: 16, padding: 14, marginTop: 16, borderWidth: 1, borderColor: '#cbd5e1', width: '100%', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                    <Ionicons name="headset-outline" size={16} color="#2563eb" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '800', color: '#0f172a' }}>CleverOps 24x7 Support</Text>
                    <Text style={{ fontSize: 11, color: '#64748b', fontWeight: '500' }}>Deepak Kumar Soni · Technical Help</Text>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6, borderTopWidth: 1, borderTopColor: '#f1f5f9' }}>
                  <TouchableOpacity onPress={() => Linking.openURL('tel:+918949266064')}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#2563eb' }}>📞 89492 66064</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => Linking.openURL('tel:+917742054535')}>
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#059669' }}>📞 77420 54535</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </Animated.View>

            <Text style={styles.footerText}>Powered by CleverOps · cleverops.in</Text>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      {/* Forgot Password Modal */}
      <Modal
        visible={forgotModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setForgotModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 }}>
          <View style={{ width: '100%', maxWidth: 360, backgroundColor: '#ffffff', borderRadius: 20, padding: 24, elevation: 6 }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 8 }}>Reset Password</Text>
            <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
              Enter your registered email address to receive password reset instructions.
            </Text>
            <View style={[styles.inputWrapper, { marginBottom: 16 }]}>
              <Ionicons name="mail-outline" size={20} color="#94a3b8" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="staff@restaurant.com"
                placeholderTextColor="#94a3b8"
                keyboardType="email-address"
                autoCapitalize="none"
                value={forgotEmail}
                onChangeText={setForgotEmail}
              />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12 }}>
              <TouchableOpacity
                onPress={() => setForgotModalVisible(false)}
                style={{ paddingVertical: 10, paddingHorizontal: 16 }}
              >
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#64748b' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSendResetPassword}
                disabled={forgotLoading}
                style={{ backgroundColor: COLORS.primary, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10 }}
              >
                {forgotLoading ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#ffffff' }}>Send Link</Text>
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
  signupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
    borderWidth: 1.5,
    borderColor: '#a7f3d0',
    height: 50,
    borderRadius: 12,
    marginTop: 12,
  },
  signupBtnText: {
    color: '#059669',
    fontSize: 15,
    fontWeight: '800',
  },
  updateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0f9ff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#bae6fd',
  },
  updateBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0284c7',
  },
  footerText: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 24,
  },
});

