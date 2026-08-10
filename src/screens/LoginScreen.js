import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform,
  Animated, StatusBar, ScrollView, TouchableWithoutFeedback, Keyboard, Alert,
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

  const fadeAnim = useState(new Animated.Value(0))[0];
  const slideAnim = useState(new Animated.Value(30))[0];

  const [checkingUpdate, setCheckingUpdate] = useState(false);

  const handleCheckUpdate = async () => {
    if (__DEV__) {
      Alert.alert('You\'re up to date', 'You\'re using the latest version of CleverOps.');
      return;
    }
    setCheckingUpdate(true);
    try {
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        Alert.alert(
          'Update available',
          'New features and improvements are ready.',
          [
            {
              text: 'Update Now',
              onPress: async () => {
                try {
                  await Updates.fetchUpdateAsync();
                  await Updates.reloadAsync();
                } catch (fetchErr) {
                  Alert.alert('Update unavailable', 'Please try again later.');
                }
              },
            },
          ],
          { cancelable: false }
        );
      } else {
        Alert.alert('You\'re up to date', 'You\'re using the latest version of CleverOps.');
      }
    } catch (error) {
      console.log('[OTAUpdate] Error:', error?.message);
      Alert.alert('Update unavailable', 'Please try again later.');
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
        .select('*, restaurants(name)')
        .eq('id', userId)
        .maybeSingle();

      if (error || !profile || !profile.role) {
        console.log('[LoginScreen] Missing or unverified profile role:', error?.message);
        setCheckingSession(false);
        setErrorMsg('Your account role could not be verified. Please contact your administrator.');
        animateIn();
        return;
      }

      if (profile.restaurants?.name && !profile.restaurant_name) {
        profile.restaurant_name = profile.restaurants.name;
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
      case 'super_admin':
        navigation.replace('SuperAdmin', { profile });
        break;
      case 'owner':
      case 'manager':
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
              <View style={styles.logoCircle}>
                <MaterialCommunityIcons name="silverware-fork-knife" size={30} color="#ffffff" />
              </View>
              <Text style={styles.appName}>CleverOps</Text>
              <Text style={styles.appTagline}>Staff & Operations Portal</Text>
            </View>

            {/* Form Card */}
            <Animated.View style={[styles.card, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              <Text style={styles.cardTitle}>Sign In</Text>
              <Text style={styles.cardSubtitle}>Enter your restaurant staff credentials</Text>

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

              {/* Single Polished OTA Check for Updates Button */}
              <TouchableOpacity
                style={styles.updateBtn}
                onPress={handleCheckUpdate}
                disabled={checkingUpdate}
                activeOpacity={0.7}
              >
                {checkingUpdate ? (
                  <ActivityIndicator size="small" color="#0284c7" style={{ marginRight: 8 }} />
                ) : (
                  <Ionicons name="cloud-download-outline" size={18} color="#0284c7" style={{ marginRight: 8 }} />
                )}
                <Text style={styles.updateBtnText}>
                  {checkingUpdate ? 'Checking for updates...' : 'Check for Updates'}
                </Text>
              </TouchableOpacity>
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

