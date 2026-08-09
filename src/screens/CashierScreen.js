import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { COLORS, FONTS, RADIUS, SHADOWS, formatCurrency, timeAgo, getStatusColor, getStatusLabel } from '../lib/theme';

export default function CashierScreen({ route }) {
  const profile = route?.params?.profile ?? {};
  const restaurantId = profile?.restaurant_id;

  const [tab, setTab] = useState('all'); // 'all' | 'unpaid' | 'marked' | 'paid'
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState({});

  const loadOrders = useCallback(async () => {
    if (!restaurantId) { setLoading(false); return; }
    try {
      const { data } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('restaurant_id', restaurantId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(100);

      setOrders(data || []);
    } catch (e) {
      console.log('Cashier load error:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    loadOrders();

    if (!restaurantId) return;
    const sub = supabase.channel('cashier-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` }, loadOrders)
      .subscribe();

    const timer = setInterval(loadOrders, 8000);
    return () => { clearInterval(timer); supabase.removeChannel(sub); };
  }, [restaurantId, loadOrders]);

  async function verifyPayment(orderId) {
    setActionLoading(p => ({ ...p, [orderId]: true }));
    try {
      const { error } = await supabase
        .from('orders')
        .update({ payment_status: 'paid' })
        .eq('id', orderId);
      if (error) throw error;
      await loadOrders();
    } catch (e) {
      Alert.alert('Error', e.message || 'Payment verification failed');
    } finally {
      setActionLoading(p => ({ ...p, [orderId]: false }));
    }
  }

  async function completeOrder(orderId) {
    setActionLoading(p => ({ ...p, [orderId]: true }));
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'completed', payment_status: 'paid' })
        .eq('id', orderId);
      if (error) throw error;

      await supabase
        .from('order_batches')
        .update({ status: 'completed' })
        .eq('order_id', orderId);

      await loadOrders();
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not complete order');
    } finally {
      setActionLoading(p => ({ ...p, [orderId]: false }));
    }
  }

  const getItemName = (item) => item.name || item.item_name || item.menu_items?.name || 'Item';
  const getItemsSummaryText = (items) => {
    if (!items || !items.length) return 'No items';
    return items.map(i => `${getItemName(i)} x${i.quantity || 1}`).join(', ');
  };

  const markedCount = orders.filter(o => o.payment_status === 'customer_marked_paid').length;
  const unpaidCount = orders.filter(o => o.payment_status === 'pending').length;

  const filteredOrders = orders.filter(o => {
    if (tab === 'unpaid') return o.payment_status === 'pending';
    if (tab === 'marked') return o.payment_status === 'customer_marked_paid';
    if (tab === 'paid') return o.payment_status === 'paid';
    return true;
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Cashier Panel</Text>
          <Text style={styles.subtitle}>Manage billing & payment verifications</Text>
        </View>

        {markedCount > 0 && (
          <View style={styles.alertBadge}>
            <Ionicons name="alert-circle" size={14} color="#fff" style={{ marginRight: 4 }} />
            <Text style={styles.alertBadgeText}>{markedCount} to verify</Text>
          </View>
        )}
      </View>

      {/* Filter Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity style={[styles.tabBtn, tab === 'all' && styles.tabBtnActive]} onPress={() => setTab('all')}>
          <Text style={[styles.tabText, tab === 'all' && styles.tabTextActive]}>All ({orders.length})</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tabBtn, tab === 'unpaid' && styles.tabBtnActive]} onPress={() => setTab('unpaid')}>
          <Text style={[styles.tabText, tab === 'unpaid' && styles.tabTextActive]}>Unpaid ({unpaidCount})</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tabBtn, tab === 'marked' && styles.tabBtnActive]} onPress={() => setTab('marked')}>
          <Text style={[styles.tabText, tab === 'marked' && styles.tabTextActive]}>To Verify ({markedCount})</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tabBtn, tab === 'paid' && styles.tabBtnActive]} onPress={() => setTab('paid')}>
          <Text style={[styles.tabText, tab === 'paid' && styles.tabTextActive]}>Paid</Text>
        </TouchableOpacity>
      </View>

      {/* Orders List */}
      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredOrders}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadOrders(); }} />
          }
          renderItem={({ item }) => {
            const isBusy = actionLoading[item.id];
            const statusColor = getStatusColor(item.status);
            const tableName = item.table_name || (item.order_type === 'takeaway' ? 'Takeaway' : `Table ${item.table_id || ''}`);
            const items = item.order_items || [];

            return (
              <View style={styles.orderCard}>
                <View style={styles.cardHeader}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons
                      name={item.order_type === 'takeaway' ? 'bag-handle-outline' : 'restaurant-outline'}
                      size={18}
                      color={COLORS.textDark}
                      style={{ marginRight: 6 }}
                    />
                    <Text style={styles.tableName}>{tableName}</Text>
                  </View>

                  <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
                    <Text style={[styles.statusBadgeText, { color: statusColor }]}>{getStatusLabel(item.status)}</Text>
                  </View>
                </View>

                <Text style={styles.itemsSummary} numberOfLines={2}>{getItemsSummaryText(items)}</Text>

                <View style={styles.cardFooter}>
                  <View>
                    <Text style={styles.timeAgo}>{timeAgo(item.created_at)}</Text>
                    <Text style={styles.totalText}>{formatCurrency(item.total || 0)}</Text>
                  </View>

                  {/* Payment Status & Actions */}
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {item.payment_status === 'customer_marked_paid' && (
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#f59e0b' }]}
                        disabled={isBusy}
                        onPress={() => verifyPayment(item.id)}
                      >
                        <Ionicons name="checkmark-circle-outline" size={16} color="#fff" style={{ marginRight: 4 }} />
                        <Text style={styles.actionBtnText}>Verify Payment</Text>
                      </TouchableOpacity>
                    )}

                    {['ready', 'served'].includes(item.status) && item.payment_status === 'paid' && (
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: COLORS.primary }]}
                        disabled={isBusy}
                        onPress={() => completeOrder(item.id)}
                      >
                        <Ionicons name="cash-outline" size={16} color="#fff" style={{ marginRight: 4 }} />
                        <Text style={styles.actionBtnText}>Complete</Text>
                      </TouchableOpacity>
                    )}

                    {item.payment_status === 'paid' && item.status === 'completed' && (
                      <View style={styles.paidBadge}>
                        <Ionicons name="checkmark-circle" size={16} color="#22c55e" style={{ marginRight: 4 }} />
                        <Text style={styles.paidBadgeText}>Paid & Completed</Text>
                      </View>
                    )}

                    {item.payment_status === 'pending' && !['ready', 'served'].includes(item.status) && (
                      <View style={styles.unpaidBadge}>
                        <Ionicons name="time-outline" size={14} color="#d97706" style={{ marginRight: 4 }} />
                        <Text style={styles.unpaidBadgeText}>Payment Pending</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="card-outline" size={48} color="#cbd5e1" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>No orders in this cashier view</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row',
    justify: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  alertBadge: { backgroundColor: '#f59e0b', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, flexDirection: 'row', alignItems: 'center' },
  alertBadgeText: { color: '#ffffff', fontWeight: '700', fontSize: 12 },
  tabsContainer: { flexDirection: 'row', backgroundColor: '#ffffff', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8, backgroundColor: '#f1f5f9', marginHorizontal: 3 },
  tabBtnActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  tabTextActive: { color: '#ffffff', fontWeight: '700' },
  listContent: { padding: 16 },
  orderCard: { backgroundColor: '#ffffff', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9', elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  tableName: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  itemsSummary: { fontSize: 13, color: '#475569', marginBottom: 12 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  timeAgo: { fontSize: 11, color: '#94a3b8' },
  totalText: { fontSize: 18, fontWeight: '700', color: COLORS.primary },
  actionBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, flexDirection: 'row', alignItems: 'center' },
  actionBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  paidBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0fdf4', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  paidBadgeText: { color: '#15803d', fontWeight: '700', fontSize: 12 },
  unpaidBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fef3c7', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  unpaidBadgeText: { color: '#b45309', fontWeight: '700', fontSize: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },
});
