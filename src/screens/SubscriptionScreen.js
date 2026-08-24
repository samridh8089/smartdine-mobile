import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl, Modal, TextInput, Platform, Linking
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, Feather, FontAwesome5 } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { COLORS, FONTS, formatCurrency } from '../lib/theme';
import { createRazorpayOrder, activateSubscriptionInDb } from '../lib/razorpayService';

const API_BASE_URL = 'https://www.cleverops.in';

export default function SubscriptionScreen({ route, navigation }) {
  const profile = route?.params?.profile || {};
  const restaurantId = profile.restaurant_id || profile.restaurants?.id || profile.id;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pricingPlans, setPricingPlans] = useState([]);
  const [restaurantData, setRestaurantData] = useState(null);
  const [billingInterval, setBillingInterval] = useState('monthly'); // 'monthly' | 'yearly'
  const [purchasingPlanId, setPurchasingPlanId] = useState(null);

  // In-App Razorpay Checkout Simulation / Bridge Modal
  const [checkoutModalVisible, setCheckoutModalVisible] = useState(false);
  const [activeOrder, setActiveOrder] = useState(null);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('upi'); // 'upi' | 'card' | 'netbanking'

  useEffect(() => {
    loadData();

    // Setup Supabase Realtime listener on restaurant table
    if (restaurantId) {
      const channel = supabase
        .channel(`restaurant-sub-${restaurantId}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'restaurants',
          filter: `id=eq.${restaurantId}`
        }, (payload) => {
          console.log('[SubscriptionScreen] Realtime restaurant update:', payload.new);
          if (payload.new) {
            setRestaurantData(payload.new);
          }
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [restaurantId]);

  async function loadData() {
    try {
      setLoading(true);

      // 1. Fetch Pricing Plans dynamically
      const { data: plans, error: pErr } = await supabase
        .from('pricing_plans')
        .select('*')
        .order('price_monthly', { ascending: true });

      if (plans && plans.length > 0) {
        setPricingPlans(plans);
      } else {
        // Fallback default plans
        setPricingPlans([
          {
            id: 'starter',
            name: 'Starter Plan',
            price_monthly: 299,
            price_yearly: 2990,
            features: ['5 Dining Tables & Dynamic QR Codes', 'Standard KDS', 'Live Dine-In Ordering', 'Daily Revenue Analytics']
          },
          {
            id: 'pro',
            name: 'Pro Plan',
            price_monthly: 599,
            price_yearly: 5990,
            features: ['20 Dining Tables & Smart QRs', 'Waiter Calling Bell', 'Promotions & Discounts', 'Advanced Sales & Tax Reports', 'Multi-Staff Role Portals']
          },
          {
            id: 'premium',
            name: 'Premium Plan',
            price_monthly: 999,
            price_yearly: 9990,
            features: ['Unlimited Tables & QRs', 'Recipe & Inventory Engine', 'Custom Restaurant Branding', 'Realtime Multi-Device Sync', '24/7 Priority Support']
          }
        ]);
      }

      // 2. Fetch Restaurant Current Plan & Status
      let activeRestId = restaurantId;
      if (!activeRestId) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user?.id) {
            const { data: p } = await supabase.from('profiles').select('restaurant_id, email').eq('id', user.id).maybeSingle();
            if (p?.restaurant_id) {
              activeRestId = p.restaurant_id;
            } else if (p?.email) {
              const { data: r } = await supabase.from('restaurants').select('*').limit(10);
              const matched = (r || []).find(item => item.settings?.owner_email === p.email);
              if (matched) activeRestId = matched.id;
            }
          }
        } catch (e) {}
      }

      if (activeRestId) {
        const { data: rest, error: rErr } = await supabase
          .from('restaurants')
          .select('*')
          .eq('id', activeRestId)
          .maybeSingle();

        if (rest) {
          setRestaurantData(rest);
          if (rest.billing_interval) {
            setBillingInterval(rest.billing_interval);
          }
        }
      }
    } catch (e) {
      console.log('[SubscriptionScreen] Load error:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const currentPlanId = (restaurantData?.subscription_plan || 'starter').toLowerCase();
  const currentStatus = restaurantData?.subscription_status || 'trial';
  const expiryDate = restaurantData?.trial_ends_at ? new Date(restaurantData.trial_ends_at).toLocaleDateString() : 'N/A';

  const handleBuyPlan = async (plan) => {
    setPurchasingPlanId(plan.id);
    try {
      const price = billingInterval === 'yearly' ? (plan.price_yearly || plan.price_monthly * 10) : plan.price_monthly;

      // 1. Create real Razorpay order on server
      const orderData = await createRazorpayOrder({
        amount: price,
        currency: 'INR',
        plan: plan.id,
        restaurantId,
        billingInterval
      });

      if (!orderData || !orderData.order_id) {
        throw new Error('Failed to initialize payment order on server');
      }

      // 2. Open Official Real Razorpay Gateway (Google Pay, PhonePe, Cards with Bank OTP, Netbanking)
      const checkoutUrl = `${API_BASE_URL}/checkout?orderId=${orderData.order_id}&amount=${price}&plan=${plan.id}&restaurantId=${restaurantId}&billingInterval=${billingInterval}&keyId=${orderData.key || 'rzp_live_TK1Nbl3mJiENjR'}&restaurantName=${encodeURIComponent(restaurantData?.name || 'Restaurant')}&email=${encodeURIComponent(profile?.email || '')}`;
      
      await Linking.openURL(checkoutUrl);
    } catch (err) {
      console.log('[SubscriptionScreen Pay Error]:', err?.message);
      Alert.alert('Payment Error', err?.message || 'Could not open Razorpay checkout.');
    } finally {
      setPurchasingPlanId(null);
    }
  };

  const handleConfirmPayment = async (status = 'success') => {
    if (!activeOrder) return;

    if (status === 'cancel') {
      setCheckoutModalVisible(false);
      setActiveOrder(null);
      Alert.alert('Payment Cancelled', 'You cancelled the payment request.');
      return;
    }

    if (status === 'failure') {
      setCheckoutModalVisible(false);
      setActiveOrder(null);
      Alert.alert('Payment Failed', 'Transaction could not be completed. Please try again with another payment method.');
      return;
    }

    setVerifyingPayment(true);
    try {
      const paymentId = `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

      // Activate plan in Supabase directly
      await activateSubscriptionInDb({
        restaurantId,
        plan: activeOrder.plan_name,
        billingInterval: activeOrder.billing_interval,
        amount: activeOrder.amount,
        razorpay_payment_id: paymentId,
        razorpay_order_id: activeOrder.order_id
      });

      setCheckoutModalVisible(false);
      setActiveOrder(null);

      // Refresh local data
      await loadData();

      Alert.alert(
        'Payment Successful!',
        `Payment of ₹${activeOrder.amount} confirmed.\nYour ${activeOrder.planTitle.toUpperCase()} subscription is now ACTIVE!`
      );
    } catch (err) {
      Alert.alert('Activation Failed', err?.message || 'Payment could not be completed.');
    } finally {
      setVerifyingPayment(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#0f172a" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.headerTitle}>Subscription & Plans</Text>
          <Text style={styles.headerSubtitle}>Upgrade or manage your CleverOps SaaS plan</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('PaymentHistory', { profile })} style={styles.historyBtn}>
          <Ionicons name="receipt-outline" size={20} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading subscription plans...</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} />}
          showsVerticalScrollIndicator={false}
        >
          {/* Current Active Plan Status Banner */}
          <View style={styles.currentPlanCard}>
            <View style={styles.planBadgeRow}>
              <View style={[styles.activeStatusPill, { backgroundColor: currentStatus === 'active' ? '#ecfdf5' : '#fffbeb' }]}>
                <View style={[styles.statusDot, { backgroundColor: currentStatus === 'active' ? '#059669' : '#d97706' }]} />
                <Text style={[styles.statusPillText, { color: currentStatus === 'active' ? '#047857' : '#b45309' }]}>
                  {currentStatus.toUpperCase()} PLAN
                </Text>
              </View>
              <Text style={styles.expiryText}>Expires: {expiryDate}</Text>
            </View>

            <Text style={styles.currentPlanTitle}>{currentPlanId.toUpperCase()} PLAN</Text>
            <Text style={styles.currentPlanSub}>
              Realtime multi-device synchronization & automated order workflow enabled.
            </Text>
          </View>

          {/* Billing Cycle Toggle */}
          <View style={styles.toggleWrapper}>
            <TouchableOpacity
              style={[styles.toggleBtn, billingInterval === 'monthly' && styles.toggleBtnActive]}
              onPress={() => setBillingInterval('monthly')}
            >
              <Text style={[styles.toggleText, billingInterval === 'monthly' && styles.toggleTextActive]}>
                Monthly Billing
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleBtn, billingInterval === 'yearly' && styles.toggleBtnActive]}
              onPress={() => setBillingInterval('yearly')}
            >
              <Text style={[styles.toggleText, billingInterval === 'yearly' && styles.toggleTextActive]}>
                Annual (Save 20%)
              </Text>
            </TouchableOpacity>
          </View>

          {/* Pricing Plans List */}
          {(() => {
            const uniquePlans = pricingPlans.filter((p, index, self) => {
              const pid = (p.id || '').toLowerCase();
              const isStandard = ['starter', 'pro', 'premium', 'custom'].includes(pid);
              return isStandard && index === self.findIndex(t => t.id.toLowerCase() === pid);
            });

            return uniquePlans.map((plan) => {
              const isCurrent = currentPlanId === plan.id.toLowerCase() && currentStatus === 'active';
              const isCustom = plan.id.toLowerCase().includes('custom') || plan.plan_type === 'custom';
              const price = billingInterval === 'yearly'
                ? (plan.price_yearly || plan.price_monthly * 10)
                : plan.price_monthly;

              // Extract clean features array (ignoring __SPECS__)
              const rawFeatures = Array.isArray(plan.features) ? plan.features : [];
              const cleanFeatures = rawFeatures.filter(f => typeof f === 'string' && !f.startsWith('__SPECS__'));

            return (
              <View
                key={plan.id}
                style={[
                  styles.planCard,
                  isCurrent && styles.planCardCurrent,
                  plan.id === 'pro' && styles.planCardPopular
                ]}
              >
                {plan.id === 'pro' && (
                  <View style={styles.popularBadge}>
                    <Text style={styles.popularBadgeText}>MOST POPULAR</Text>
                  </View>
                )}

                <View style={styles.planCardHeader}>
                  <View>
                    <Text style={styles.planName}>{plan.name || plan.id.toUpperCase()}</Text>
                    {isCustom ? (
                      <Text style={[styles.priceAmount, { fontSize: 18, color: COLORS.primary }]}>Custom Pricing</Text>
                    ) : (
                      <Text style={styles.planPriceRow}>
                        <Text style={styles.currencySymbol}>₹</Text>
                        <Text style={styles.priceAmount}>{price}</Text>
                        <Text style={styles.periodText}>/{billingInterval === 'yearly' ? 'year' : 'month'}</Text>
                      </Text>
                    )}
                  </View>

                  {isCurrent && (
                    <View style={styles.currentBadge}>
                      <Ionicons name="checkmark-circle" size={16} color="#059669" />
                      <Text style={styles.currentBadgeText}>Current Plan</Text>
                    </View>
                  )}
                </View>

                {/* Features List */}
                <View style={styles.featuresContainer}>
                  {cleanFeatures.map((feat, idx) => (
                    <View key={idx} style={styles.featureItem}>
                      <Ionicons name="checkmark-circle" size={16} color="#059669" style={{ marginRight: 8, marginTop: 2 }} />
                      <Text style={styles.featureText}>{feat}</Text>
                    </View>
                  ))}
                </View>

                {/* Action Button */}
                {isCustom ? (
                  <TouchableOpacity
                    style={[styles.buyBtn, { backgroundColor: '#0284c7' }]}
                    onPress={() => Linking.openURL('tel:8949266064')}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="call" size={16} color="#ffffff" style={{ marginRight: 8 }} />
                    <Text style={styles.buyBtnText}>Talk to Sales — 8949266064</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[
                      styles.buyBtn,
                      isCurrent && styles.buyBtnDisabled,
                      purchasingPlanId === plan.id && { opacity: 0.7 }
                    ]}
                    onPress={() => handleBuyPlan(plan)}
                    disabled={isCurrent || purchasingPlanId === plan.id}
                    activeOpacity={0.8}
                  >
                    {purchasingPlanId === plan.id ? (
                      <ActivityIndicator size="small" color="#ffffff" />
                    ) : (
                      <>
                        <FontAwesome5 name="shield-alt" size={14} color="#ffffff" style={{ marginRight: 8 }} />
                        <Text style={styles.buyBtnText}>
                          {isCurrent ? 'Active Subscription' : `Upgrade to ${plan.name || plan.id.toUpperCase()}`}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            );
          });
        })()}
        </ScrollView>
      )}

      {/* Razorpay In-App Checkout Modal */}
      <Modal
        visible={checkoutModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => handleConfirmPayment('cancel')}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.checkoutCard}>
            {/* Modal Header */}
            <View style={styles.checkoutHeader}>
              <View style={styles.rzpLogoRow}>
                <MaterialCommunityIcons name="credit-card-chip" size={24} color="#0284c7" />
                <Text style={styles.rzpTitle}>Razorpay Checkout</Text>
              </View>
              <TouchableOpacity onPress={() => handleConfirmPayment('cancel')} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Order Summary */}
            <View style={styles.summaryBox}>
              <Text style={styles.summaryLabel}>Total Payable Amount</Text>
              <Text style={styles.summaryAmount}>₹{activeOrder?.amount}</Text>
              <Text style={styles.summaryPlanName}>
                {activeOrder?.planTitle?.toUpperCase()} Plan ({activeOrder?.billing_interval})
              </Text>
              <Text style={styles.orderIdText}>Order ID: {activeOrder?.order_id}</Text>
            </View>

            {/* Prefilled Customer Details */}
            <View style={styles.prefillBox}>
              <Text style={styles.prefillTitle}>PREFILLED BILLING CONTACT</Text>
              <Text style={styles.prefillItem}>• Name: {profile.full_name || 'Restaurant Owner'}</Text>
              <Text style={styles.prefillItem}>• Email: {profile.email || 'owner@restaurant.com'}</Text>
              <Text style={styles.prefillItem}>• Phone: {profile.phone || '+91 9876543210'}</Text>
            </View>

            {/* Payment Method Selector */}
            <Text style={styles.methodTitle}>SELECT PAYMENT METHOD</Text>
            <View style={styles.methodRow}>
              {[
                { key: 'upi', label: 'UPI / QR', icon: 'qrcode-scan' },
                { key: 'card', label: 'Cards', icon: 'credit-card-outline' },
                { key: 'netbanking', label: 'NetBanking', icon: 'bank-outline' }
              ].map((m) => (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.methodChip, paymentMethod === m.key && styles.methodChipActive]}
                  onPress={() => setPaymentMethod(m.key)}
                >
                  <MaterialCommunityIcons
                    name={m.icon}
                    size={18}
                    color={paymentMethod === m.key ? '#ffffff' : '#64748b'}
                  />
                  <Text style={[styles.methodChipText, paymentMethod === m.key && styles.methodChipTextActive]}>
                    {m.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Action Buttons */}
            <View style={styles.actionBtnStack}>
              <TouchableOpacity
                style={styles.paySuccessBtn}
                onPress={() => handleConfirmPayment('success')}
                disabled={verifyingPayment}
              >
                {verifyingPayment ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#ffffff" style={{ marginRight: 8 }} />
                    <Text style={styles.paySuccessText}>Pay ₹{activeOrder?.amount} (Razorpay Test)</Text>
                  </>
                )}
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <TouchableOpacity
                  style={[styles.paySecondaryBtn, { flex: 1, backgroundColor: '#fef2f2' }]}
                  onPress={() => handleConfirmPayment('failure')}
                  disabled={verifyingPayment}
                >
                  <Text style={[styles.paySecondaryText, { color: '#dc2626' }]}>Simulate Fail</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.paySecondaryBtn, { flex: 1, backgroundColor: '#f1f5f9' }]}
                  onPress={() => handleConfirmPayment('cancel')}
                  disabled={verifyingPayment}
                >
                  <Text style={[styles.paySecondaryText, { color: '#64748b' }]}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9'
  },
  backBtn: { padding: 6, borderRadius: 8, backgroundColor: '#f8fafc' },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  headerSubtitle: { fontSize: 11, color: '#64748b', marginTop: 1 },
  historyBtn: { padding: 8, borderRadius: 8, backgroundColor: '#ecfdf5' },
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { marginTop: 12, color: '#64748b', fontSize: 13 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  currentPlanCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16
  },
  planBadgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  activeStatusPill: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 6 },
  statusPillText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  expiryText: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  currentPlanTitle: { fontSize: 20, fontWeight: '800', color: '#0f172a', marginBottom: 4 },
  currentPlanSub: { fontSize: 12, color: '#64748b', lineHeight: 18 },
  toggleWrapper: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 12,
    padding: 4,
    marginBottom: 16
  },
  toggleBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  toggleBtnActive: { backgroundColor: '#ffffff', elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4 },
  toggleText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  toggleTextActive: { color: COLORS.primary, fontWeight: '700' },
  planCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    marginBottom: 16,
    position: 'relative'
  },
  planCardCurrent: { borderColor: COLORS.primary, backgroundColor: '#fcfdfd' },
  planCardPopular: { borderColor: '#0284c7' },
  popularBadge: {
    position: 'absolute',
    top: -10,
    right: 20,
    backgroundColor: '#0284c7',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8
  },
  popularBadgeText: { color: '#ffffff', fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5 },
  planCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  planName: { fontSize: 18, fontWeight: '800', color: '#0f172a', marginBottom: 4 },
  planPriceRow: { flexDirection: 'row', alignItems: 'baseline' },
  currencySymbol: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  priceAmount: { fontSize: 26, fontWeight: '900', color: '#0f172a' },
  periodText: { fontSize: 12, color: '#64748b', marginLeft: 4, fontWeight: '600' },
  currentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10
  },
  currentBadgeText: { fontSize: 11, fontWeight: '700', color: '#059669' },
  featuresContainer: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 14, marginBottom: 16 },
  featureItem: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  featureText: { fontSize: 12.5, color: '#334155', flex: 1, lineHeight: 18 },
  buyBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center'
  },
  buyBtnDisabled: { backgroundColor: '#94a3b8' },
  buyBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  checkoutCard: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 32
  },
  checkoutHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  rzpLogoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rzpTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a' },
  closeBtn: { padding: 4 },
  summaryBox: { backgroundColor: '#f0f9ff', borderRadius: 14, padding: 14, alignItems: 'center', marginBottom: 14 },
  summaryLabel: { fontSize: 11, fontWeight: '700', color: '#0369a1', letterSpacing: 0.5 },
  summaryAmount: { fontSize: 28, fontWeight: '900', color: '#0284c7', marginVertical: 2 },
  summaryPlanName: { fontSize: 12, fontWeight: '700', color: '#0369a1' },
  orderIdText: { fontSize: 10, color: '#64748b', marginTop: 4, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  prefillBox: { backgroundColor: '#f8fafc', borderRadius: 12, padding: 12, marginBottom: 14 },
  prefillTitle: { fontSize: 10.5, fontWeight: '800', color: '#64748b', letterSpacing: 0.5, marginBottom: 4 },
  prefillItem: { fontSize: 11.5, color: '#334155', marginTop: 2 },
  methodTitle: { fontSize: 11, fontWeight: '800', color: '#64748b', letterSpacing: 0.5, marginBottom: 8 },
  methodRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  methodChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    backgroundColor: '#f1f5f9',
    borderRadius: 10
  },
  methodChipActive: { backgroundColor: '#0284c7' },
  methodChipText: { fontSize: 11, fontWeight: '600', color: '#475569' },
  methodChipTextActive: { color: '#ffffff', fontWeight: '700' },
  actionBtnStack: { gap: 6 },
  paySuccessBtn: {
    backgroundColor: '#059669',
    paddingVertical: 14,
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center'
  },
  paySuccessText: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  paySecondaryBtn: { paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  paySecondaryText: { fontSize: 12, fontWeight: '700' }
});
