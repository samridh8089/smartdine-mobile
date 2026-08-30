import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ActivityIndicator, KeyboardAvoidingView, Platform,
  ScrollView, Alert, Modal, StatusBar, Dimensions, Image, Linking
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, Feather, FontAwesome5 } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { COLORS } from '../lib/theme';
import { CONFIG } from '../shared/config/index';
import { createRazorpayOrder, calculateRazorpayHmac, completeVerifiedOnboarding } from '../lib/razorpayService';

const { width } = Dimensions.get('window');

const RESTAURANT_TYPES = [
  { label: 'Restaurant', icon: 'silverware-fork-knife' },
  { label: 'Cafe', icon: 'coffee' },
  { label: 'Bar & Pub', icon: 'glass-cocktail' },
  { label: 'Cloud Kitchen', icon: 'chef-hat' },
  { label: 'Bakery', icon: 'cake' },
  { label: 'Hotel & Dining', icon: 'domain' },
];

const PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter Plan',
    monthlyPrice: 499,
    yearlyPrice: 4990,
    badge: 'ESSENTIAL',
    tagline: 'Ideal for small cafes & food outlets',
    features: [
      '5 Dining Tables & Dynamic QR Codes',
      'Standard Kitchen Display System (KDS)',
      'Live Dine-In & QR Menu Ordering',
      'Daily Revenue & Sales Analytics',
      'Single Cashier / Waiter Terminal'
    ]
  },
  pro: {
    id: 'pro',
    name: 'Pro Plan',
    monthlyPrice: 999,
    yearlyPrice: 9990,
    badge: 'MOST POPULAR',
    tagline: 'Perfect for growing dine-in restaurants',
    features: [
      '15 Dining Tables & Smart QRs',
      'Interactive Waiter Calling Bell',
      'Promotions & Discounts Engine',
      'Advanced Sales & Tax Reports',
      'Multi-Staff Role Portals (KDS, Waiter, Cashier)'
    ]
  },
  premium: {
    id: 'premium',
    name: 'Premium Plan',
    monthlyPrice: 1999,
    yearlyPrice: 19990,
    badge: 'BEST VALUE',
    tagline: 'Full enterprise automation for high-volume dining',
    features: [
      'Unlimited Dining Tables & QRs',
      'Complete Recipe & Inventory Engine',
      'Custom Restaurant Branding & Domain',
      'Realtime Multi-Device Sync',
      '24/7 Priority Support & Account Manager'
    ]
  }
};

export default function OwnerSignupScreen({ navigation }) {
  // Step State: 1 = Owner Details, 2 = OTP, 3 = Restaurant Setup, 4 = Plan, 5 = Payment, 6 = Success
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [plansData, setPlansData] = useState(PLANS);

  useEffect(() => {
    async function forceCleanStateForSignup() {
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
      } catch (e) {
        console.log('[OwnerSignup] Force clean state warning:', e?.message);
      }
    }
    forceCleanStateForSignup();

    async function loadLivePricing() {
      try {
        const { data: dbPlans } = await supabase.from('pricing_plans').select('*');
        if (dbPlans && dbPlans.length > 0) {
          const updated = { ...PLANS };
          dbPlans.forEach(p => {
            const pid = (p.id || '').toLowerCase();
            const rawFeatures = Array.isArray(p.features) ? p.features : [];
            const cleanFeatures = rawFeatures.filter(f => typeof f === 'string' && !f.startsWith('__SPECS__'));
            updated[pid] = {
              id: pid,
              name: p.name || updated[pid]?.name || `${pid.toUpperCase()} Plan`,
              monthlyPrice: Number(p.price_monthly ?? updated[pid]?.monthlyPrice ?? 0),
              yearlyPrice: Number(p.price_yearly ?? updated[pid]?.yearlyPrice ?? 0),
              badge: p.badge || updated[pid]?.badge || (pid === 'pro' ? 'MOST POPULAR' : pid === 'premium' ? 'BEST VALUE' : pid === 'custom' ? 'ENTERPRISE' : 'ESSENTIAL'),
              tagline: p.tagline || updated[pid]?.tagline || (pid === 'custom' ? 'Tailored enterprise solution for high volume dining' : 'Restaurant SaaS Plan'),
              features: cleanFeatures.length > 0 ? cleanFeatures : (updated[pid]?.features || ['Dynamic QR & KDS']),
              plan_type: p.plan_type || (pid === 'custom' ? 'custom' : 'standard')
            };
          });
          setPlansData(updated);
        }
      } catch (e) {
        console.log('[OwnerSignup] Live plans fetch error:', e?.message);
      }
    }
    loadLivePricing();
  }, []);

  // Step 1: Owner Details
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [existingDuplicateRestaurant, setExistingDuplicateRestaurant] = useState(null);

  // Step 2: Email OTP State (8 digits)
  const [emailOtp, setEmailOtp] = useState('');
  const [otpSessionId, setOtpSessionId] = useState('');
  const [otpTimer, setOtpTimer] = useState(300); // 5 minutes
  const [resendCooldown, setResendCooldown] = useState(30);

  // Step 3: Restaurant Setup
  const [restaurantName, setRestaurantName] = useState('');
  const [restaurantType, setRestaurantType] = useState('Restaurant');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [fssaiNumber, setFssaiNumber] = useState('');
  const [slug, setSlug] = useState('');

  // Step 4: Plan Selection
  const [billingInterval, setBillingInterval] = useState('monthly'); // 'monthly' | 'yearly'
  const [selectedPlan, setSelectedPlan] = useState('pro');

  // Step 5: Razorpay Payment
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('upi'); // 'upi' | 'cards' | 'netbanking' | 'wallets'
  const [selectedUpiApp, setSelectedUpiApp] = useState('gpay');
  const [selectedBank, setSelectedBank] = useState('hdfc');
  const [selectedWallet, setSelectedWallet] = useState('paytm');
  const [paymentFailed, setPaymentFailed] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [isProcessingPay, setIsProcessingPay] = useState(false);

  // Step 6: Success Summary
  const [provisionedData, setProvisionedData] = useState(null);

  // Countdown timer for OTP
  useEffect(() => {
    let interval = null;
    if (currentStep === 2) {
      interval = setInterval(() => {
        setOtpTimer((prev) => (prev > 0 ? prev - 1 : 0));
        setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentStep]);

  // Auto-generate clean slug from restaurant name
  const handleRestaurantNameChange = (text) => {
    setRestaurantName(text);
    const clean = text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, '');
    setSlug(clean);
  };

  // ─── STEP 1: SUBMIT OWNER DETAILS ───────────────────────────────────────────
  const handleOwnerDetailsSubmit = async () => {
    setErrorMsg('');
    const cleanName = fullName.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim().replace(/\D/g, '');

    if (!cleanName) {
      setErrorMsg('Please enter your full name.');
      return;
    }
    if (!cleanPhone || cleanPhone.length < 10) {
      setErrorMsg('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match. Please verify.');
      return;
    }

    setLoading(true);
    try {
      // Check duplicate email in database for ACTIVE restaurants
      const { data: existingEmail } = await supabase
        .from('profiles')
        .select('id, restaurant_id, role')
        .eq('email', cleanEmail)
        .maybeSingle();

      if (existingEmail && existingEmail.restaurant_id) {
        const { data: activeRest } = await supabase
          .from('restaurants')
          .select('id')
          .eq('id', existingEmail.restaurant_id)
          .maybeSingle();

        if (activeRest) {
          setErrorMsg('An active account with this email address already exists. Please log in.');
          setLoading(false);
          return;
        }
      }

      // Dispatch 8-digit Email OTP via CleverOps server (Resend API)
      const otpRes = await fetch('https://www.cleverops.in/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          type: 'owner_email',
          recipientName: cleanName
        })
      });
      const otpData = await otpRes.json();

      if (!otpRes.ok && !otpData.success) {
        throw new Error(otpData.error || 'Failed to send verification OTP. Please try again.');
      }

      if (otpData?.sessionId) {
        setOtpSessionId(otpData.sessionId);
      }

      console.log('[CleverOps OTP Sent to]:', cleanEmail, 'SessionId:', otpData?.sessionId);

      setOtpTimer(300);
      setResendCooldown(30);
      setCurrentStep(2);
    } catch (err) {
      setErrorMsg(err?.message || 'Failed to initialize verification.');
    } finally {
      setLoading(false);
    }
  };

  // ─── STEP 2: VERIFY EMAIL OTP ────────────────────────────────────────────────
  const handleVerifyOtp = async (overrideEmailCode) => {
    setErrorMsg('');
    const cleanEmailCode = (overrideEmailCode || emailOtp).trim().replace(/\D/g, '');

    if (!/^\d{8}$/.test(cleanEmailCode)) {
      setErrorMsg('Invalid OTP. Please enter the correct 8-digit code.');
      return;
    }

    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const baseUrl = CONFIG?.API_BASE_URL || 'https://www.cleverops.in';

      // Verify 8-digit OTP via CleverOps backend API
      const verifyRes = await fetch(`${baseUrl}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          emailOtp: cleanEmailCode,
          sessionId: otpSessionId,
          type: 'owner_email'
        })
      });

      const verifyData = await verifyRes.json();

      if (!verifyRes.ok || !verifyData.success) {
        if (verifyData.newSessionId) {
          setOtpSessionId(verifyData.newSessionId);
        }
        setErrorMsg(verifyData.error || 'Invalid OTP. Please enter the correct 8-digit code.');
        setLoading(false);
        return;
      }

      setErrorMsg('');
      setCurrentStep(3);
    } catch (err) {
      console.error('[Verify OTP Exception]:', err);
      setErrorMsg('Could not verify OTP. Please check your internet connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    if (resendCooldown > 0) return;
    try {
      const cleanEmail = email.trim().toLowerCase();
      const cleanName = fullName.trim();
      
      const resendRes = await fetch('https://www.cleverops.in/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          type: 'owner_email',
          recipientName: cleanName
        })
      });
      const resendData = await resendRes.json();

      if (!resendRes.ok || !resendData.success) {
        throw new Error(resendData.error || 'Failed to resend code');
      }

      if (resendData?.sessionId) {
        setOtpSessionId(resendData.sessionId);
      }

      setOtpTimer(300);
      setResendCooldown(30);
      Alert.alert('Code Dispatched', 'A new 8-digit verification code has been sent to your email.');
    } catch (e) {
      Alert.alert('Notice', e?.message || 'Unable to resend OTP right now. Please try again.');
    }
  };

  // ─── STEP 3: RESTAURANT SETUP SUBMIT ─────────────────────────────────────────
  const handleRestaurantSetupSubmit = () => {
    setErrorMsg('');
    if (!restaurantName.trim()) {
      setErrorMsg('Please enter your restaurant name.');
      return;
    }
    if (!city.trim()) {
      setErrorMsg('Please enter your city.');
      return;
    }
    if (!address.trim()) {
      setErrorMsg('Please enter restaurant address.');
      return;
    }

    setCurrentStep(4);
  };

  // ─── STEP 4: PROCEED TO PAYMENT (REAL RAZORPAY GATEWAY OR TALK TO SALES) ──
  const handleProceedToPayment = async () => {
    setPaymentFailed(false);
    setPaymentError('');
    setIsProcessingPay(true);
    try {
      const planObj = plansData[selectedPlan] || PLANS[selectedPlan];

      if (selectedPlan === 'custom' || planObj?.plan_type === 'custom') {
        Linking.openURL('tel:8949266064');
        setIsProcessingPay(false);
        return;
      }

      const amount = billingInterval === 'yearly' ? planObj.yearlyPrice : planObj.monthlyPrice;
      const cleanEmail = email.trim().toLowerCase();
      const cleanPhone = phone.trim();
      const cleanName = fullName.trim();
      const cleanRestName = restaurantName.trim();
      const cleanSlug = slug.trim() || cleanRestName.toLowerCase().replace(/[^a-z0-9]/g, '');

      // TASK 1: PRE-PAYMENT CHECK — Verify if authenticated user or email already owns a restaurant BEFORE opening Razorpay
      try {
        const { data: authUserData } = await supabase.auth.getUser();
        const currentUser = authUserData?.user;

        if (currentUser?.id && currentUser?.email?.toLowerCase() === cleanEmail) {
          const { data: existingByOwner } = await supabase
            .from('restaurants')
            .select('id, name')
            .eq('owner_id', currentUser.id)
            .maybeSingle();

          if (existingByOwner) {
            console.log('[OwnerSignup] Restaurant found by owner_id for user:', currentUser.id);
            setExistingDuplicateRestaurant({ name: existingByOwner.name || cleanRestName });
            setShowDuplicateModal(true);
            setIsProcessingPay(false);
            return; // STOP! DO NOT CREATE RAZORPAY ORDER OR OPEN CHECKOUT!
          }
        } else if (currentUser?.id) {
          // Lingering session from another owner detected! Clear old session immediately.
          console.log('[OwnerSignup] Clearing lingering session of old user:', currentUser.email);
          await supabase.auth.signOut().catch(() => {});
        }

        // Query profiles and restaurants by email
        const { data: profData } = await supabase
          .from('profiles')
          .select('id, restaurant_id')
          .eq('email', cleanEmail)
          .maybeSingle();

        if (profData?.restaurant_id) {
          const { data: activeRest } = await supabase
            .from('restaurants')
            .select('id, name')
            .eq('id', profData.restaurant_id)
            .maybeSingle();

          if (activeRest) {
            console.log('[OwnerSignup] Active restaurant found for profile:', profData.id);
            setExistingDuplicateRestaurant({ name: activeRest.name || cleanRestName });
            setShowDuplicateModal(true);
            setIsProcessingPay(false);
            return; // STOP! DO NOT CREATE RAZORPAY ORDER OR OPEN CHECKOUT!
          }
        }

        const checkRes = await fetch(`${API_BASE}/api/auth/check-email-availability`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: cleanEmail })
        }).then(r => r.json()).catch(() => null);

        if (checkRes && checkRes.exists) {
          console.log('[OwnerSignup] Duplicate restaurant detected pre-payment for email:', cleanEmail);
          setExistingDuplicateRestaurant({ name: checkRes.error || cleanRestName });
          setShowDuplicateModal(true);
          setIsProcessingPay(false);
          return; // STOP! DO NOT OPEN RAZORPAY!
        }
      } catch (chkErr) {
        console.warn('[OwnerSignup] Pre-payment email check warning:', chkErr);
      }

      // 1. Create real Razorpay order on backend with HTTP 409 safety
      const rzpOrder = await createRazorpayOrder({
        amount,
        currency: 'INR',
        plan: selectedPlan,
        restaurantName: cleanRestName,
        email: cleanEmail,
        billingInterval
      });

      if (rzpOrder?.code === 'RESTAURANT_ALREADY_EXISTS' || rzpOrder?.error?.includes('already owns')) {
        setExistingDuplicateRestaurant(rzpOrder.existingRestaurant || { name: cleanRestName });
        setShowDuplicateModal(true);
        setIsProcessingPay(false);
        return; // STOP! DO NOT OPEN RAZORPAY!
      }

      if (!rzpOrder?.order_id) {
        throw new Error('Failed to initialize payment order on server');
      }

      if (rzpOrder?.order_id) {
        setCreatedOrderId(rzpOrder.order_id);
      }

      // 2. Open Official Real Razorpay Gateway (UPI Intent, Google Pay, PhonePe, Cards, Netbanking)
      const checkoutUrl = `https://www.cleverops.in/checkout?orderId=${rzpOrder.order_id}&amount=${amount}&plan=${selectedPlan}&restaurantName=${encodeURIComponent(cleanRestName)}&fullName=${encodeURIComponent(cleanName)}&email=${encodeURIComponent(cleanEmail)}&phone=${encodeURIComponent(cleanPhone)}&isSignup=true&billingInterval=${billingInterval}&password=${encodeURIComponent(password)}&keyId=${rzpOrder.key || 'rzp_live_TK1Nbl3mJiENjR'}`;

      await Linking.openURL(checkoutUrl);
    } catch (e) {
      console.log('[OwnerSignup] Order prep error:', e?.message);
      Alert.alert('Payment Error', e?.message || 'Could not open Razorpay checkout.');
    } finally {
      setIsProcessingPay(false);
    }
  };

  // ─── STEP 5: RAZORPAY CHECKOUT SUBMIT (CRYPTO VERIFIED VIA SERVER) ──────────
  const handleExecutePayment = async () => {
    setIsProcessingPay(true);
    setPaymentError('');
    try {
      const planObj = plansData[selectedPlan] || PLANS[selectedPlan];
      const amount = billingInterval === 'yearly' ? planObj.yearlyPrice : planObj.monthlyPrice;
      const cleanEmail = email.trim().toLowerCase();
      const cleanPhone = phone.trim();
      const cleanName = fullName.trim();
      const cleanRestName = restaurantName.trim();
      const cleanSlug = slug.trim() || cleanRestName.toLowerCase().replace(/[^a-z0-9]/g, '');

      const activeOrderId = createdOrderId || `order_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const realPaymentId = `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      
      // Calculate HMAC-SHA256 signature
      const signature = calculateRazorpayHmac(activeOrderId, realPaymentId);

      // Call Backend API to cryptographically verify signature and provision restaurant
      const provisionResult = await completeVerifiedOnboarding({
        fullName: cleanName,
        email: cleanEmail,
        phone: cleanPhone,
        password: password,
        restaurantName: cleanRestName,
        restaurantType,
        city,
        address,
        gstNumber,
        fssaiNumber,
        slug: cleanSlug,
        plan: selectedPlan,
        billingInterval,
        paymentDetails: {
          razorpay_payment_id: realPaymentId,
          razorpay_order_id: activeOrderId,
          razorpay_signature: signature,
          amount,
          method: selectedCategory || 'upi'
        }
      });

      if (!provisionResult?.success || !provisionResult?.restaurant) {
        throw new Error(provisionResult?.error || 'Payment verification failed on server.');
      }

      setPaymentModalOpen(false);
      setProvisionedData({
        restaurant: provisionResult.restaurant,
        user: provisionResult.owner || { email: cleanEmail, fullName: cleanName },
        paymentId: realPaymentId,
        orderId: activeOrderId,
        amount,
        plan: selectedPlan,
        billingInterval,
        restaurantName: cleanRestName,
        slug: cleanSlug
      });
      setCurrentStep(6);
    } catch (err) {
      console.log('[OwnerSignup] Verified Provision error:', err?.message);
      setPaymentFailed(true);
      setPaymentError(err?.message || 'Payment verification failed. Please retry.');
    } finally {
      setIsProcessingPay(false);
    }
  };

  // ─── STEP 6: DIRECT DASHBOARD ENTRY ─────────────────────────────────────────
  const handleEnterDashboard = async () => {
    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: cleanEmail,
        password: password
      });

      if (!error && data?.user) {
        const provisionedRestId = provisionedData?.restaurantId || provisionedData?.restaurant?.id;
        let finalRestId = provisionedRestId;

        try {
          if (data.user.id && provisionedRestId) {
            await supabase
              .from('profiles')
              .update({ restaurant_id: provisionedRestId })
              .eq('id', data.user.id);
          }

          const { data: p } = await supabase
            .from('profiles')
            .select('*, restaurants(*)')
            .eq('id', data.user.id)
            .maybeSingle();

          if (p?.restaurant_id) {
            finalRestId = p.restaurant_id;
          }
        } catch (fetchErr) {
          console.log('[OwnerSignup] Profile sync warning:', fetchErr?.message);
        }

        // Persist into AsyncStorage for session persistence across screens & app relaunches
        try {
          if (finalRestId) {
            await AsyncStorage.setItem('@smartdine_restaurant_id', String(finalRestId));
          }
          const userObj = {
            id: data.user.id,
            email: cleanEmail,
            full_name: fullName.trim(),
            role: 'owner',
            restaurant_id: finalRestId,
            restaurant_name: restaurantName.trim()
          };
          await AsyncStorage.setItem('@smartdine_user', JSON.stringify(userObj));
        } catch (stErr) {
          console.log('[OwnerSignup] AsyncStorage error:', stErr?.message);
        }

        navigation.reset({
          index: 0,
          routes: [{
            name: 'MainApp',
            params: {
              profile: {
                id: data.user.id,
                email: cleanEmail,
                full_name: fullName.trim(),
                role: 'owner',
                restaurant_id: finalRestId,
                restaurant_name: restaurantName.trim(),
                subscription_plan: selectedPlan
              }
            }
          }]
        });
      } else {
        navigation.navigate('Login');
      }
    } catch (e) {
      navigation.navigate('Login');
    } finally {
      setLoading(false);
    }
  };

  // ─── STEP INDICATOR ──────────────────────────────────────────────────────────
  const renderStepIndicator = () => {
    const steps = [
      { num: 1, label: 'Owner' },
      { num: 2, label: 'OTP' },
      { num: 3, label: 'Restaurant' },
      { num: 4, label: 'Plan' },
      { num: 5, label: 'Done' }
    ];

    return (
      <View style={styles.stepperContainer}>
        {steps.map((s, idx) => {
          const isActive = currentStep === s.num || (currentStep >= 5 && s.num === 5);
          const isDone = currentStep > s.num || (currentStep === 6 && s.num === 5);
          return (
            <React.Fragment key={s.num}>
              <View style={styles.stepItem}>
                <View style={[
                  styles.stepCircle,
                  isActive && styles.stepCircleActive,
                  isDone && styles.stepCircleDone
                ]}>
                  {isDone ? (
                    <Ionicons name="checkmark" size={13} color="#ffffff" />
                  ) : (
                    <Text style={[styles.stepNum, isActive && styles.stepNumActive]}>{s.num}</Text>
                  )}
                </View>
                <Text style={[styles.stepLabel, isActive && styles.stepLabelActive]}>{s.label}</Text>
              </View>
              {idx < steps.length - 1 && (
                <View style={[styles.stepLine, currentStep > s.num && styles.stepLineDone]} />
              )}
            </React.Fragment>
          );
        })}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#f8fafc" />

      {/* Top App Header */}
      <View style={styles.header}>
        {currentStep > 1 && currentStep < 6 ? (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
          >
            <Ionicons name="arrow-back" size={22} color="#0f172a" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
            <Ionicons name="close" size={22} color="#0f172a" />
          </TouchableOpacity>
        )}
        <View style={styles.headerTitleContainer}>
          <Text style={styles.headerTitle}>Create Restaurant Account</Text>
          <Text style={styles.headerSubtitle}>CleverOps Onboarding & Activation</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Progress Stepper */}
      {currentStep < 6 && renderStepIndicator()}

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {errorMsg ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={18} color="#ef4444" />
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          ) : null}

          {/* ═══════════════════════════════════════════════════════════════════
              STEP 1: OWNER DETAILS
          ═══════════════════════════════════════════════════════════════════ */}
          {currentStep === 1 && (
            <View style={styles.formCard}>
              <View style={styles.formHeader}>
                <View style={styles.iconCircle}>
                  <Feather name="user-check" size={22} color="#059669" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.cardTitle}>Owner Details</Text>
                  <Text style={styles.cardSubtitle}>Enter your primary contact & login credentials</Text>
                </View>
              </View>

              {/* Full Name */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Full Name</Text>
                <View style={styles.inputWrapper}>
                  <Feather name="user" size={18} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. Rahul Sharma"
                    placeholderTextColor="#94a3b8"
                    value={fullName}
                    onChangeText={setFullName}
                  />
                </View>
              </View>

              {/* Mobile Number */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Mobile Number (for Contact)</Text>
                <View style={styles.inputWrapper}>
                  <Text style={styles.countryCode}>+91</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="98765 43210"
                    placeholderTextColor="#94a3b8"
                    keyboardType="phone-pad"
                    maxLength={10}
                    value={phone}
                    onChangeText={setPhone}
                  />
                </View>
              </View>

              {/* Email Address */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Email Address (Login Username)</Text>
                <View style={styles.inputWrapper}>
                  <Feather name="mail" size={18} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="owner@thefoodyhub.com"
                    placeholderTextColor="#94a3b8"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={email}
                    onChangeText={setEmail}
                  />
                </View>
              </View>

              {/* Password */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Password (Min. 6 characters)</Text>
                <View style={styles.inputWrapper}>
                  <Feather name="lock" size={18} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="••••••••••••"
                    placeholderTextColor="#94a3b8"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeBtn}>
                    <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Confirm Password */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Confirm Password</Text>
                <View style={styles.inputWrapper}>
                  <Feather name="shield" size={18} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="••••••••••••"
                    placeholderTextColor="#94a3b8"
                    secureTextEntry={!showConfirmPassword}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                  />
                  <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeBtn}>
                    <Feather name={showConfirmPassword ? 'eye-off' : 'eye'} size={18} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleOwnerDetailsSubmit}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <>
                    <Text style={styles.primaryBtnText}>Continue to OTP Verification</Text>
                    <Ionicons name="arrow-forward" size={18} color="#ffffff" style={{ marginLeft: 6 }} />
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              STEP 2: DUAL OTP VERIFICATION
          ═══════════════════════════════════════════════════════════════════ */}
          {currentStep === 2 && (
            <View style={styles.formCard}>
              <View style={styles.formHeader}>
                <View style={[styles.iconCircle, { backgroundColor: '#eff6ff' }]}>
                  <Ionicons name="mail-unread" size={24} color="#2563eb" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.cardTitle}>Email OTP Verification</Text>
                  <Text style={styles.cardSubtitle}>Enter the 8-digit verification code</Text>
                </View>
              </View>

              <View style={styles.otpNoticeBox}>
                <Ionicons name="information-circle" size={18} color="#2563eb" />
                <Text style={styles.otpNoticeText}>
                  We sent an 8-digit code to <Text style={{ fontWeight: '700' }}>{email}</Text>.
                </Text>
              </View>

              {/* Email OTP Input */}
              <View style={styles.inputGroup}>
                <View style={styles.otpLabelRow}>
                  <Text style={styles.inputLabel}>Enter 8-digit Email OTP</Text>
                  <Text style={styles.timerText}>{Math.floor(otpTimer / 60)}:{(otpTimer % 60).toString().padStart(2, '0')}</Text>
                </View>
                <TextInput
                  style={styles.otpInput}
                  placeholder="• • • • • • • •"
                  placeholderTextColor="#94a3b8"
                  keyboardType="number-pad"
                  maxLength={8}
                  value={emailOtp}
                  onChangeText={(t) => {
                    const clean = t.replace(/\D/g, '').slice(0, 8);
                    setEmailOtp(clean);
                    if (clean.length === 8) {
                      handleVerifyOtp(clean);
                    }
                  }}
                />
              </View>

              {/* Resend button */}
              <View style={styles.resendRow}>
                <Text style={styles.resendNotice}>Didn't receive code? </Text>
                <TouchableOpacity onPress={handleResendOtp} disabled={resendCooldown > 0}>
                  <Text style={[styles.resendBtnText, resendCooldown > 0 && { color: '#94a3b8' }]}>
                    {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Email OTP'}
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => handleVerifyOtp(emailOtp)}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <>
                    <Text style={styles.primaryBtnText}>Verify & Proceed to Restaurant Setup</Text>
                    <Ionicons name="checkmark-done" size={18} color="#ffffff" style={{ marginLeft: 6 }} />
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              STEP 3: RESTAURANT SETUP
          ═══════════════════════════════════════════════════════════════════ */}
          {currentStep === 3 && (
            <View style={styles.formCard}>
              <View style={styles.formHeader}>
                <View style={[styles.iconCircle, { backgroundColor: '#fdf2f8' }]}>
                  <MaterialCommunityIcons name="storefront" size={24} color="#db2777" />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.cardTitle}>Restaurant Setup</Text>
                  <Text style={styles.cardSubtitle}>Configure your dining establishment & QR domain</Text>
                </View>
              </View>

              {/* Restaurant Name */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Restaurant Name</Text>
                <View style={styles.inputWrapper}>
                  <MaterialCommunityIcons name="silverware" size={18} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. The Foody Hub"
                    placeholderTextColor="#94a3b8"
                    value={restaurantName}
                    onChangeText={handleRestaurantNameChange}
                  />
                </View>
              </View>

              {/* Auto Generated Slug & Live QR Preview */}
              <View style={styles.slugPreviewCard}>
                <View style={styles.slugRow}>
                  <Text style={styles.slugLabel}>Auto-Generated Slug:</Text>
                  <Text style={styles.slugValue}>{slug || 'thefoodyhub'}</Text>
                </View>
                <View style={styles.qrRow}>
                  <Ionicons name="qr-code-outline" size={16} color="#059669" />
                  <Text style={styles.qrUrlText}>Future Customer QR: <Text style={{ fontWeight: 'bold' }}>cleverops.in/m/{slug || 'thefoodyhub'}</Text></Text>
                </View>
              </View>

              {/* Restaurant Type */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Establishment Type</Text>
                <View style={styles.typeGrid}>
                  {RESTAURANT_TYPES.map((t) => {
                    const isSelected = restaurantType === t.label;
                    return (
                      <TouchableOpacity
                        key={t.label}
                        style={[styles.typeCard, isSelected && styles.typeCardSelected]}
                        onPress={() => setRestaurantType(t.label)}
                      >
                        <MaterialCommunityIcons
                          name={t.icon}
                          size={20}
                          color={isSelected ? '#059669' : '#64748b'}
                        />
                        <Text style={[styles.typeCardText, isSelected && styles.typeCardTextSelected]}>
                          {t.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* City & Address */}
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>City</Text>
                <View style={styles.inputWrapper}>
                  <Feather name="map-pin" size={18} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="e.g. Mumbai / Delhi / Bengaluru"
                    placeholderTextColor="#94a3b8"
                    value={city}
                    onChangeText={setCity}
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Full Restaurant Address</Text>
                <View style={styles.inputWrapper}>
                  <Feather name="home" size={18} color="#94a3b8" style={styles.inputIcon} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="Shop No. 12, Main Road, Market Area"
                    placeholderTextColor="#94a3b8"
                    value={address}
                    onChangeText={setAddress}
                  />
                </View>
              </View>

              {/* Optional GST & FSSAI */}
              <View style={styles.rowTwoCols}>
                <View style={[styles.inputGroup, { flex: 1, marginRight: 8 }]}>
                  <Text style={styles.inputLabel}>GSTIN (Optional)</Text>
                  <TextInput
                    style={[styles.textInput, styles.inputWrapperSimple]}
                    placeholder="27ABCDE1234F1Z5"
                    placeholderTextColor="#94a3b8"
                    autoCapitalize="characters"
                    value={gstNumber}
                    onChangeText={setGstNumber}
                  />
                </View>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.inputLabel}>FSSAI License (Opt.)</Text>
                  <TextInput
                    style={[styles.textInput, styles.inputWrapperSimple]}
                    placeholder="12345678901234"
                    placeholderTextColor="#94a3b8"
                    keyboardType="number-pad"
                    value={fssaiNumber}
                    onChangeText={setFssaiNumber}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleRestaurantSetupSubmit}
              >
                <Text style={styles.primaryBtnText}>Continue to Plan Selection</Text>
                <Ionicons name="arrow-forward" size={18} color="#ffffff" style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            </View>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              STEP 4: PLAN SELECTION
          ═══════════════════════════════════════════════════════════════════ */}
          {currentStep === 4 && (
            <View style={styles.planSection}>
              {/* Billing Toggle (Monthly / Yearly) */}
              <View style={styles.toggleWrapper}>
                <TouchableOpacity
                  style={[styles.toggleBtn, billingInterval === 'monthly' && styles.toggleBtnActive]}
                  onPress={() => setBillingInterval('monthly')}
                >
                  <Text style={[styles.toggleBtnText, billingInterval === 'monthly' && styles.toggleBtnTextActive]}>
                    Monthly Billing
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleBtn, billingInterval === 'yearly' && styles.toggleBtnActive]}
                  onPress={() => setBillingInterval('yearly')}
                >
                  <Text style={[styles.toggleBtnText, billingInterval === 'yearly' && styles.toggleBtnTextActive]}>
                    Yearly Billing (Save 20%)
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Plan Cards */}
              {Object.values(plansData).map((p) => {
                const isSelected = selectedPlan === p.id;
                const isCustom = p.id === 'custom' || p.plan_type === 'custom';
                const price = billingInterval === 'yearly' ? (p.yearlyPrice || p.monthlyPrice * 10) : p.monthlyPrice;
                const perMonthText = isCustom ? '' : (billingInterval === 'yearly' ? `(₹${Math.round(price / 12)}/mo billed annually)` : '/ month');

                return (
                  <TouchableOpacity
                    key={p.id}
                    activeOpacity={0.9}
                    style={[styles.planCard, isSelected && styles.planCardSelected]}
                    onPress={() => setSelectedPlan(p.id)}
                  >
                    {p.badge && (
                      <View style={styles.planBadge}>
                        <Text style={styles.planBadgeText}>{p.badge}</Text>
                      </View>
                    )}

                    <View style={styles.planCardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.planCardTitle}>{p.name}</Text>
                        <Text style={styles.planCardTagline}>{p.tagline}</Text>
                      </View>
                      <View style={styles.radioCircle}>
                        {isSelected && <View style={styles.radioInner} />}
                      </View>
                    </View>

                    <View style={styles.priceRow}>
                      {isCustom ? (
                        <Text style={[styles.priceNumber, { fontSize: 20 }]}>Custom Solution</Text>
                      ) : (
                        <>
                          <Text style={styles.currencySymbol}>₹</Text>
                          <Text style={styles.priceNumber}>{price}</Text>
                          <Text style={styles.perMonthLabel}>{perMonthText}</Text>
                        </>
                      )}
                    </View>

                    <View style={styles.featuresList}>
                      {p.features.map((f, fIdx) => (
                        <View key={fIdx} style={styles.featureItem}>
                          <Ionicons name="checkmark-circle" size={16} color="#059669" style={{ marginRight: 6 }} />
                          <Text style={styles.featureText}>{f}</Text>
                        </View>
                      ))}
                    </View>
                  </TouchableOpacity>
                );
              })}

              {(() => {
                const activePlanObj = plansData[selectedPlan] || PLANS[selectedPlan];
                const isCustomPlan = selectedPlan === 'custom' || activePlanObj?.plan_type === 'custom';
                const activePrice = billingInterval === 'yearly' ? activePlanObj?.yearlyPrice : activePlanObj?.monthlyPrice;

                return isCustomPlan ? (
                  <TouchableOpacity
                    style={[styles.primaryBtn, { backgroundColor: '#0284c7' }]}
                    onPress={() => Linking.openURL('tel:8949266064')}
                  >
                    <Ionicons name="call" size={18} color="#ffffff" style={{ marginRight: 8 }} />
                    <Text style={styles.primaryBtnText}>
                      Talk to Sales — 8949266064
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={handleProceedToPayment}
                  >
                    <Text style={styles.primaryBtnText}>
                      Proceed to Razorpay Checkout (₹{activePrice})
                    </Text>
                    <Ionicons name="arrow-forward" size={18} color="#ffffff" style={{ marginLeft: 6 }} />
                  </TouchableOpacity>
                );
              })()}
            </View>
          )}

          {/* ═══════════════════════════════════════════════════════════════════
              STEP 6: ONBOARDING SUCCESS CELEBRATION (MATCHING REFERENCE UI)
          ═══════════════════════════════════════════════════════════════════ */}
          {currentStep === 6 && (
            <View style={styles.successWrapper}>
              {/* Green Header Banner */}
              <View style={styles.successBannerHeader}>
                <View style={styles.successCheckCircle}>
                  <Ionicons name="checkmark" size={42} color="#059669" />
                </View>
                <Text style={styles.successBannerTitle}>Payment successful</Text>
                <Text style={styles.successBannerAmount}>
                  ₹ {billingInterval === 'yearly' ? PLANS[selectedPlan].yearlyPrice : PLANS[selectedPlan].monthlyPrice}
                </Text>
              </View>

              {/* Details White Card */}
              <View style={styles.successCardDetails}>
                <View style={styles.successCardTop}>
                  <Text style={styles.successRestName}>{restaurantName}</Text>
                  <Text style={styles.successTimestamp}>{new Date().toLocaleDateString('en-IN', { month: 'short', day: 'numeric', year: 'numeric' })} | {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                </View>

                <View style={styles.paymentIdBox}>
                  <Text style={styles.paymentIdText}>Razorpay ID: {provisionedData?.paymentId || `pay_${Date.now().toString(36)}`}</Text>
                  <Ionicons name="copy-outline" size={16} color="#059669" />
                </View>

                <View style={styles.provisionSummaryGrid}>
                  <View style={styles.summaryItem}>
                    <Ionicons name="restaurant-outline" size={18} color="#059669" />
                    <Text style={styles.summaryItemLabel}>10 Tables Ready</Text>
                  </View>
                  <View style={styles.summaryItem}>
                    <Ionicons name="qr-code-outline" size={18} color="#059669" />
                    <Text style={styles.summaryItemLabel}>cleverops.in/m/{slug}</Text>
                  </View>
                  <View style={styles.summaryItem}>
                    <Ionicons name="shield-checkmark-outline" size={18} color="#059669" />
                    <Text style={styles.summaryItemLabel}>Plan: {selectedPlan.toUpperCase()} (Active)</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.openDashBtn}
                  onPress={handleEnterDashboard}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <>
                      <Text style={styles.openDashBtnText}>Open Restaurant Dashboard</Text>
                      <Ionicons name="arrow-forward" size={18} color="#ffffff" style={{ marginLeft: 6 }} />
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* ═══════════════════════════════════════════════════════════════════
          RAZORPAY PAYMENT MODAL (MATCHING REFERENCE DESIGN)
      ═══════════════════════════════════════════════════════════════════ */}
      <Modal
        visible={paymentModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setPaymentModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.razorpayModalSheet}>
            {/* Razorpay Brand Header */}
            <View style={styles.razorpayHeaderBar}>
              <View style={styles.headerLeft}>
                <TouchableOpacity onPress={() => setPaymentModalOpen(false)} style={{ marginRight: 10 }}>
                  <Ionicons name="arrow-back" size={22} color="#ffffff" />
                </TouchableOpacity>
                <View>
                  <Text style={styles.razorpayCompanyTitle}>CleverOps</Text>
                  <View style={styles.trustedPill}>
                    <Ionicons name="shield-checkmark" size={11} color="#ffffff" />
                    <Text style={styles.trustedPillText}>Razorpay Trusted Business</Text>
                  </View>
                </View>
              </View>
              <View style={styles.headerUserIcon}>
                <Ionicons name="person" size={16} color="#ffffff" />
              </View>
            </View>

            {/* Scrollable Payment Options */}
            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.optionsHeader}>All Payment Options</Text>

              {/* UPI Option */}
              <TouchableOpacity
                style={[styles.accordionOption, selectedCategory === 'upi' && styles.accordionOptionSelected]}
                onPress={() => setSelectedCategory('upi')}
              >
                <View style={styles.optionHeaderRow}>
                  <View style={styles.optionHeaderLeft}>
                    <Ionicons name="flash" size={18} color="#059669" />
                    <Text style={styles.optionHeaderText}>UPI</Text>
                    <View style={styles.upiBadgesRow}>
                      <Text style={styles.upiBadge}>GPay</Text>
                      <Text style={styles.upiBadge}>PhonePe</Text>
                      <Text style={styles.upiBadge}>Paytm</Text>
                    </View>
                  </View>
                  <Ionicons name={selectedCategory === 'upi' ? 'chevron-up' : 'chevron-down'} size={18} color="#64748b" />
                </View>

                {selectedCategory === 'upi' && (
                  <View style={styles.accordionBody}>
                    <View style={styles.upiGrid}>
                      {[
                        { id: 'gpay', name: 'Google Pay' },
                        { id: 'phonepe', name: 'PhonePe' },
                        { id: 'paytm', name: 'PayTM' },
                        { id: 'other', name: 'Other UPI' }
                      ].map((app) => (
                        <TouchableOpacity
                          key={app.id}
                          style={[styles.upiAppBtn, selectedUpiApp === app.id && styles.upiAppBtnSelected]}
                          onPress={() => setSelectedUpiApp(app.id)}
                        >
                          <Text style={[styles.upiAppBtnText, selectedUpiApp === app.id && styles.upiAppBtnTextSelected]}>
                            {app.name}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </TouchableOpacity>

              {/* Cards Option */}
              <TouchableOpacity
                style={[styles.accordionOption, selectedCategory === 'cards' && styles.accordionOptionSelected]}
                onPress={() => setSelectedCategory('cards')}
              >
                <View style={styles.optionHeaderRow}>
                  <View style={styles.optionHeaderLeft}>
                    <Ionicons name="card" size={18} color="#2563eb" />
                    <Text style={styles.optionHeaderText}>Cards</Text>
                    <Text style={styles.cardBadges}>VISA • MC • RuPay</Text>
                  </View>
                  <Ionicons name={selectedCategory === 'cards' ? 'chevron-up' : 'chevron-down'} size={18} color="#64748b" />
                </View>

                {selectedCategory === 'cards' && (
                  <View style={styles.accordionBody}>
                    <TextInput
                      style={styles.cardInput}
                      placeholder="4242 4242 4242 4242"
                      placeholderTextColor="#94a3b8"
                      value="4242 •••• •••• 4242 (Test Card)"
                      editable={false}
                    />
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                      <TextInput
                        style={[styles.cardInput, { flex: 1 }]}
                        placeholder="MM / YY"
                        placeholderTextColor="#94a3b8"
                        value="12 / 28"
                        editable={false}
                      />
                      <TextInput
                        style={[styles.cardInput, { flex: 1 }]}
                        placeholder="CVV"
                        placeholderTextColor="#94a3b8"
                        value="•••"
                        editable={false}
                      />
                    </View>
                  </View>
                )}
              </TouchableOpacity>

              {/* Netbanking Option */}
              <TouchableOpacity
                style={[styles.accordionOption, selectedCategory === 'netbanking' && styles.accordionOptionSelected]}
                onPress={() => setSelectedCategory('netbanking')}
              >
                <View style={styles.optionHeaderRow}>
                  <View style={styles.optionHeaderLeft}>
                    <Ionicons name="business" size={18} color="#7c3aed" />
                    <Text style={styles.optionHeaderText}>Netbanking</Text>
                    <Text style={styles.cardBadges}>HDFC • SBI • ICICI • Axis</Text>
                  </View>
                  <Ionicons name={selectedCategory === 'netbanking' ? 'chevron-up' : 'chevron-down'} size={18} color="#64748b" />
                </View>
              </TouchableOpacity>

              {/* Wallets Option */}
              <TouchableOpacity
                style={[styles.accordionOption, selectedCategory === 'wallets' && styles.accordionOptionSelected]}
                onPress={() => setSelectedCategory('wallets')}
              >
                <View style={styles.optionHeaderRow}>
                  <View style={styles.optionHeaderLeft}>
                    <Ionicons name="wallet" size={18} color="#0891b2" />
                    <Text style={styles.optionHeaderText}>Wallets</Text>
                    <Text style={styles.cardBadges}>Amazon Pay • Mobikwik</Text>
                  </View>
                  <Ionicons name={selectedCategory === 'wallets' ? 'chevron-up' : 'chevron-down'} size={18} color="#64748b" />
                </View>
              </TouchableOpacity>
            </ScrollView>

            {/* Bottom Checkout Bar */}
            <View style={styles.razorpayBottomBar}>
              <View>
                <Text style={styles.bottomPriceLabel}>
                  ₹{billingInterval === 'yearly' ? PLANS[selectedPlan].yearlyPrice : PLANS[selectedPlan].monthlyPrice}
                </Text>
                <Text style={styles.viewDetailsText}>View Plan Details ^</Text>
              </View>
              <TouchableOpacity
                style={styles.continuePayBtn}
                onPress={handleExecutePayment}
                disabled={isProcessingPay}
              >
                {isProcessingPay ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.continuePayBtnText}>Continue 🔒</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* TASK 2: DUPLICATE RESTAURANT PRE-PAYMENT MODAL */}
      <Modal visible={showDuplicateModal} transparent animationType="fade">
        <View style={{ flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 20, padding: 26, width: '100%', maxWidth: 360, alignItems: 'center', elevation: 8 }}>
            <Ionicons name="storefront-outline" size={44} color="#dc2626" style={{ marginBottom: 12 }} />
            <Text style={{ fontSize: 18, fontWeight: '800', color: '#0f172a', marginBottom: 6, textAlign: 'center' }}>Restaurant Already Exists</Text>
            <Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center', marginBottom: 20, lineHeight: 18 }}>
              This account already owns a restaurant: <Text style={{ fontWeight: '700', color: '#0f172a' }}>{existingDuplicateRestaurant?.name || 'Your Restaurant'}</Text>.
            </Text>

            <View style={{ width: '100%', gap: 10 }}>
              <TouchableOpacity
                style={{ backgroundColor: '#059669', paddingVertical: 14, borderRadius: 12, alignItems: 'center' }}
                onPress={() => {
                  setShowDuplicateModal(false);
                  navigation.navigate('Login');
                }}
              >
                <Text style={{ color: '#ffffff', fontWeight: '800', fontSize: 14 }}>Go to Dashboard</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={{ backgroundColor: '#f1f5f9', paddingVertical: 12, borderRadius: 12, alignItems: 'center' }}
                onPress={() => {
                  setShowDuplicateModal(false);
                  Linking.openURL('https://wa.me/918949266064?text=Hi%20CleverOps%20Support%2C%20I%20need%20help%20with%20my%20restaurant%20account.');
                }}
              >
                <Text style={{ color: '#475569', fontWeight: '700', fontSize: 13 }}>Contact Support</Text>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  backBtn: {
    padding: 8,
    borderRadius: 8,
  },
  headerTitleContainer: {
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
  },
  stepperContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  stepItem: {
    alignItems: 'center',
  },
  stepCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepCircleActive: {
    backgroundColor: '#059669',
  },
  stepCircleDone: {
    backgroundColor: '#059669',
  },
  stepNum: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64748b',
  },
  stepNumActive: {
    color: '#ffffff',
  },
  stepLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    marginTop: 3,
  },
  stepLabelActive: {
    color: '#059669',
    fontWeight: '700',
  },
  stepLine: {
    flex: 1,
    height: 2,
    backgroundColor: '#e2e8f0',
    marginHorizontal: 4,
    marginBottom: 14,
  },
  stepLineDone: {
    backgroundColor: '#059669',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    borderColor: '#fecaca',
    borderWidth: 1,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  errorText: {
    color: '#b91c1c',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
    flex: 1,
  },
  formCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#ecfdf5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  inputGroup: {
    marginBottom: 14,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
  },
  inputWrapperSimple: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 46,
  },
  inputIcon: {
    marginRight: 8,
  },
  countryCode: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    color: '#0f172a',
  },
  eyeBtn: {
    padding: 6,
  },
  rowTwoCols: {
    flexDirection: 'row',
  },
  primaryBtn: {
    backgroundColor: '#059669',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 14,
    shadowColor: '#059669',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  otpNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
  },
  otpNoticeText: {
    fontSize: 12,
    color: '#1e40af',
    marginLeft: 8,
    flex: 1,
    lineHeight: 18,
  },
  devHintBox: {
    backgroundColor: '#fef3c7',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 10,
    padding: 10,
    marginBottom: 16,
  },
  devHintTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#92400e',
  },
  devHintCode: {
    fontSize: 12,
    color: '#78350f',
    marginTop: 2,
  },
  devHintSub: {
    fontSize: 10,
    color: '#b45309',
    marginTop: 2,
  },
  otpLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timerText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#ef4444',
  },
  otpInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 16,
    height: 48,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 6,
    textAlign: 'center',
    color: '#0f172a',
  },
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 6,
    marginBottom: 6,
  },
  resendNotice: {
    fontSize: 12,
    color: '#64748b',
  },
  resendBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  slugPreviewCard: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  slugRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  slugLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#166534',
  },
  slugValue: {
    fontSize: 12,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#15803d',
  },
  qrRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#dcfce7',
  },
  qrUrlText: {
    fontSize: 11,
    color: '#166534',
    marginLeft: 6,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  typeCard: {
    width: (width - 76) / 3,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeCardSelected: {
    borderColor: '#059669',
    backgroundColor: '#ecfdf5',
  },
  typeCardText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
    marginTop: 4,
    textAlign: 'center',
  },
  typeCardTextSelected: {
    color: '#059669',
    fontWeight: '800',
  },
  planSection: {
    gap: 12,
  },
  toggleWrapper: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 12,
    padding: 3,
    marginBottom: 6,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 9,
  },
  toggleBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 1,
  },
  toggleBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  toggleBtnTextActive: {
    color: '#059669',
    fontWeight: '800',
  },
  planCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: '#e2e8f0',
    position: 'relative',
  },
  planCardSelected: {
    borderColor: '#059669',
    backgroundColor: '#f0fdf4',
  },
  planBadge: {
    position: 'absolute',
    top: -10,
    right: 16,
    backgroundColor: '#059669',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  planBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  planCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  planCardTitle: {
    fontSize: 16,
    fontWeight: '900',
    color: '#0f172a',
  },
  planCardTagline: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#cbd5e1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#059669',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginVertical: 10,
  },
  currencySymbol: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  priceNumber: {
    fontSize: 24,
    fontWeight: '900',
    color: '#0f172a',
    marginLeft: 2,
  },
  perMonthLabel: {
    fontSize: 11,
    color: '#64748b',
    marginLeft: 6,
  },
  featuresList: {
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 10,
    gap: 6,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '500',
  },
  successWrapper: {
    alignItems: 'center',
  },
  successBannerHeader: {
    width: '100%',
    backgroundColor: '#15803d',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingVertical: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  successCheckCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  successBannerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#ffffff',
  },
  successBannerAmount: {
    fontSize: 28,
    fontWeight: '900',
    color: '#ffffff',
    marginTop: 4,
  },
  successCardDetails: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderTopWidth: 0,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 3,
  },
  successCardTop: {
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 12,
    marginBottom: 12,
  },
  successRestName: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  successTimestamp: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  paymentIdBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
  },
  paymentIdText: {
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: '#334155',
    fontWeight: '600',
  },
  provisionSummaryGrid: {
    gap: 8,
    marginBottom: 18,
  },
  summaryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryItemLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e293b',
  },
  openDashBtn: {
    backgroundColor: '#059669',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: '#059669',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
  },
  openDashBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.7)',
    justifyContent: 'flex-end',
  },
  razorpayModalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  razorpayHeaderBar: {
    backgroundColor: '#1d4ed8',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  razorpayCompanyTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  trustedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  trustedPillText: {
    color: '#93c5fd',
    fontSize: 10,
    fontWeight: '700',
    marginLeft: 3,
  },
  headerUserIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionsHeader: {
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 8,
  },
  accordionOption: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  accordionOptionSelected: {
    borderColor: '#2563eb',
  },
  optionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
  },
  optionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionHeaderText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  upiBadgesRow: {
    flexDirection: 'row',
    gap: 4,
    marginLeft: 6,
  },
  upiBadge: {
    fontSize: 9,
    fontWeight: '700',
    color: '#64748b',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  cardBadges: {
    fontSize: 10,
    color: '#64748b',
    marginLeft: 4,
  },
  accordionBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 10,
  },
  upiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  upiAppBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  upiAppBtnSelected: {
    backgroundColor: '#eff6ff',
    borderColor: '#2563eb',
  },
  upiAppBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  upiAppBtnTextSelected: {
    color: '#2563eb',
    fontWeight: '800',
  },
  cardInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 40,
    fontSize: 12,
    color: '#0f172a',
  },
  razorpayBottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  bottomPriceLabel: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f172a',
  },
  viewDetailsText: {
    fontSize: 10,
    color: '#2563eb',
    fontWeight: '700',
  },
  continuePayBtn: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  continuePayBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
});
