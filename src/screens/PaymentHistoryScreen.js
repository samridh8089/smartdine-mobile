import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { COLORS } from '../lib/theme';

export default function PaymentHistoryScreen({ route, navigation }) {
  const profile = route?.params?.profile || {};
  const restaurantId = profile.restaurant_id || profile.restaurants?.id || profile.id;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    loadPayments();
  }, [restaurantId]);

  async function loadPayments() {
    try {
      setLoading(true);

      // 1. Fetch from payments table if available
      const { data: payList, error: pErr } = await supabase
        .from('payments')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (payList && payList.length > 0) {
        setPayments(payList);
      } else {
        // Fallback to restaurant settings.payment_history
        const { data: rest } = await supabase
          .from('restaurants')
          .select('settings, subscription_plan, created_at')
          .eq('id', restaurantId)
          .maybeSingle();

        const history = rest?.settings?.payment_history || [];
        if (history.length > 0) {
          setPayments(history);
        } else if (rest?.subscription_plan) {
          // Default initial record
          setPayments([{
            id: 'init_sub_01',
            order_id: 'ord_initial_setup',
            plan_name: rest.subscription_plan,
            amount: 599,
            status: 'success',
            created_at: rest.created_at || new Date().toISOString()
          }]);
        }
      }
    } catch (e) {
      console.log('[PaymentHistoryScreen] Load error:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  const renderItem = ({ item }) => {
    const isSuccess = item.status === 'success' || item.status === 'captured';
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.iconCircle}>
            <MaterialCommunityIcons
              name={isSuccess ? 'check-decagram' : 'alert-circle'}
              size={20}
              color={isSuccess ? '#059669' : '#dc2626'}
            />
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.planName}>{(item.plan_name || 'Pro').toUpperCase()} PLAN</Text>
            <Text style={styles.orderId}>Order: {item.order_id || item.id}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.amountText}>₹{item.amount || 0}</Text>
            <View style={[styles.statusPill, { backgroundColor: isSuccess ? '#ecfdf5' : '#fef2f2' }]}>
              <Text style={[styles.statusText, { color: isSuccess ? '#059669' : '#dc2626' }]}>
                {item.status ? item.status.toUpperCase() : 'PAID'}
              </Text>
            </View>
          </View>
        </View>
        <View style={styles.cardBottom}>
          <Text style={styles.dateText}>
            {new Date(item.created_at || Date.now()).toLocaleDateString([], {
              year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
            })}
          </Text>
          <Text style={styles.gatewayText}>Razorpay Secure</Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#0f172a" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.headerTitle}>Payment History</Text>
          <Text style={styles.headerSubtitle}>Past invoices & subscription receipts</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading payment history...</Text>
        </View>
      ) : payments.length === 0 ? (
        <View style={styles.centerBox}>
          <MaterialCommunityIcons name="receipt" size={48} color="#94a3b8" />
          <Text style={styles.emptyTitle}>No Payments Found</Text>
          <Text style={styles.emptySub}>Subscription invoices and payment receipts will appear here.</Text>
        </View>
      ) : (
        <FlatList
          data={payments}
          keyExtractor={(item, i) => item.id || String(i)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadPayments(); }} />}
        />
      )}
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
  centerBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  loadingText: { marginTop: 12, color: '#64748b', fontSize: 13 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginTop: 12 },
  emptySub: { fontSize: 12, color: '#64748b', textAlign: 'center', marginTop: 4 },
  listContent: { padding: 16 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0'
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  iconCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1f5f9', justifyContent: 'center', alignItems: 'center' },
  planName: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  orderId: { fontSize: 11, color: '#64748b', marginTop: 2 },
  amountText: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginTop: 4 },
  statusText: { fontSize: 10, fontWeight: '800' },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#f8fafc',
    paddingTop: 8,
    marginTop: 10
  },
  dateText: { fontSize: 11, color: '#94a3b8' },
  gatewayText: { fontSize: 11, color: '#94a3b8', fontWeight: '600' }
});
