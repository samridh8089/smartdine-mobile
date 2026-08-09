import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, ScrollView, RefreshControl, Platform,
  Alert, TextInput, Modal, Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { startAlarm, stopAlarm, stopAllAlarms } from '../lib/alarmManager';
import { sendLocalNotification } from '../lib/notifications';
import {
  COLORS, FONTS, RADIUS, SHADOWS,
  formatCurrency, getStatusColor, getStatusLabel, timeAgo,
} from '../lib/theme';
import OTAUpdateBtn from '../components/OTAUpdateBtn';

const ORDER_STATUSES = ['all', 'new', 'accepted', 'preparing', 'ready', 'served', 'completed', 'cancelled'];
const PENDING_OWNER_ORDERS_KEY = '@smartdine_owner_pending_orders';

export default function OrdersScreen({ route }) {
  const navigation = useNavigation();
  const profile = route?.params?.profile ?? {};
  const [restaurantId, setRestaurantId] = useState(
    profile?.restaurant_id || profile?.restaurants?.id || null
  );
  const role = profile?.role ?? 'owner';

  useEffect(() => {
    async function fetchMissingRestaurantId() {
      if (!restaurantId) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: p } = await supabase
              .from('profiles')
              .select('restaurant_id')
              .eq('id', user.id)
              .maybeSingle();
            if (p?.restaurant_id) setRestaurantId(p.restaurant_id);
          }
        } catch (e) {
          console.log('[OrdersScreen] fetch restaurant_id error:', e?.message);
        }
      }
    }
    fetchMissingRestaurantId();
  }, [restaurantId]);

  const [tab, setTab] = useState('orders'); // 'orders' | 'calls'
  const [orders, setOrders] = useState([]);
  const [calls, setCalls] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [isOffline, setIsOffline] = useState(false);
  const [pendingQueue, setPendingQueue] = useState([]);

  const knownReadyIds = useRef(new Set());
  const knownCallIds = useRef(new Set());

  // Load offline queue on init
  useEffect(() => {
    async function loadPendingQueue() {
      try {
        const stored = await AsyncStorage.getItem(PENDING_OWNER_ORDERS_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setPendingQueue(parsed);
          }
        }
      } catch (e) {
        console.log('[OrdersScreen] Load pending queue error:', e?.message);
      }
    }
    loadPendingQueue();
  }, []);

  const savePendingQueue = async (queue) => {
    setPendingQueue(queue);
    try {
      await AsyncStorage.setItem(PENDING_OWNER_ORDERS_KEY, JSON.stringify(queue));
    } catch (e) {
      console.log('[OrdersScreen] Save pending queue error:', e?.message);
    }
  };

  const loadOrders = useCallback(async () => {
    if (!restaurantId) { setLoading(false); setRefreshing(false); return; }
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*), order_batches(*)')
        .eq('restaurant_id', restaurantId)
        .not('status', 'in', '(completed,cancelled)')
        .order('created_at', { ascending: false });

      if (error) {
        console.log('Orders load DB error:', error.message);
        setIsOffline(true);
        return;
      }

      setIsOffline(false);
      const allOrders = data || [];
      setOrders(allOrders);

      // Check for ready orders -> sound alert
      const readyOrders = allOrders.filter(o => o.status === 'ready');
      let hasNewReady = false;
      readyOrders.forEach(o => {
        if (!knownReadyIds.current.has(o.id)) {
          knownReadyIds.current.add(o.id);
          hasNewReady = true;
        }
      });
      if (hasNewReady && ['owner', 'manager', 'waiter'].includes(role)) {
        startAlarm('food_ready', 'Order Ready', 'Food is ready for pickup');
        sendLocalNotification('Order Ready', 'Food is ready for pickup');
        Vibration.vibrate([0, 500, 250, 500]);
      }
      if (readyOrders.length === 0) stopAlarm('food_ready');

    } catch (e) {
      console.log('Orders load catch error:', e?.message);
      setIsOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId, role]);

  const loadCalls = useCallback(async () => {
    if (!restaurantId) return;
    try {
      const { data, error } = await supabase
        .from('customer_requests')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) {
        console.log('Calls load error:', error.message);
        setIsOffline(true);
        return;
      }

      const allCalls = data || [];
      setCalls(allCalls);

      let hasNew = false;
      allCalls.forEach(c => {
        if (!knownCallIds.current.has(c.id)) {
          knownCallIds.current.add(c.id);
          hasNew = true;
        }
      });
      if (hasNew && ['owner', 'manager', 'waiter'].includes(role)) {
        startAlarm('waiter_call', 'Customer Call', 'A customer needs assistance');
        sendLocalNotification('Customer Call', 'A customer needs assistance');
        Vibration.vibrate([0, 300, 200, 300]);
      }
      if (allCalls.length === 0) stopAlarm('waiter_call');
    } catch (e) {
      console.log('Calls load catch error:', e?.message);
    }
  }, [restaurantId, role]);

  // Flush pending queue when online
  const flushPendingQueue = useCallback(async () => {
    if (pendingQueue.length === 0) return;
    console.log(`[OrdersScreen] Retrying ${pendingQueue.length} queued offline actions...`);
    const remaining = [];
    for (const item of pendingQueue) {
      try {
        if (item.type === 'update_order_status') {
          const updates = { status: item.newStatus };
          if (item.newStatus === 'completed') updates.payment_status = 'paid';
          await supabase.from('orders').update(updates).eq('id', item.orderId);
          if (['accepted', 'preparing', 'ready', 'completed'].includes(item.newStatus)) {
            await supabase.from('order_batches').update({ status: item.newStatus }).eq('order_id', item.orderId);
          }
        } else if (item.type === 'cancel_order') {
          await supabase.from('orders').update({ status: 'cancelled', cancel_reason: item.cancelReason }).eq('id', item.orderId);
          await supabase.from('order_batches').update({ status: 'cancelled' }).eq('order_id', item.orderId);
        }
      } catch (err) {
        console.log('[OrdersScreen] Failed retrying pending action:', err?.message);
        remaining.push(item);
      }
    }
    await savePendingQueue(remaining);
    await loadOrders();
  }, [pendingQueue, loadOrders]);

  useEffect(() => {
    if (!isOffline && pendingQueue.length > 0) {
      flushPendingQueue();
    }
  }, [isOffline, pendingQueue, flushPendingQueue]);

  useEffect(() => {
    loadOrders();
    loadCalls();

    if (!restaurantId) return;
    const channel = supabase
      .channel(`orders-screen-realtime-${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` }, loadOrders)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_batches', filter: `restaurant_id=eq.${restaurantId}` }, loadOrders)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_requests', filter: `restaurant_id=eq.${restaurantId}` }, loadCalls)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsOffline(false);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setIsOffline(true);
        }
      });

    const timer = setInterval(() => {
      loadOrders();
      loadCalls();
    }, 8000);

    return () => {
      stopAllAlarms();
      Vibration.cancel();
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [restaurantId, loadOrders, loadCalls]);

  const updateOrderStatus = async (orderId, newStatus) => {
    setActionLoading(true);
    try {
      const updates = { status: newStatus };
      if (newStatus === 'completed') updates.payment_status = 'paid';

      const { error } = await supabase
        .from('orders')
        .update(updates)
        .eq('id', orderId);

      if (error) throw error;

      // Update batches if needed
      if (['accepted', 'preparing', 'ready', 'completed'].includes(newStatus)) {
        await supabase
          .from('order_batches')
          .update({ status: newStatus })
          .eq('order_id', orderId);
      }

      await loadOrders();
      if (selectedOrder?.id === orderId) {
        setSelectedOrder(prev => prev ? { ...prev, status: newStatus } : null);
      }
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not update order status');
    } finally {
      setActionLoading(false);
    }
  };

  const cancelOrder = async (orderId) => {
    if (!orderId) return;
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          cancel_reason: cancelReason || 'Cancelled by staff',
        })
        .eq('id', orderId);

      if (error) throw error;

      await supabase
        .from('order_batches')
        .update({ status: 'cancelled' })
        .eq('order_id', orderId);

      setShowCancelModal(false);
      setCancelReason('');
      setSelectedOrder(null);
      await loadOrders();
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not cancel order');
    } finally {
      setActionLoading(false);
    }
  };

  const resolveCall = async (callId) => {
    try {
      await supabase
        .from('customer_requests')
        .update({ status: 'completed' })
        .eq('id', callId);
      stopAlarm('waiter_call');
      Vibration.cancel();
      await loadCalls();
    } catch (e) {
      Alert.alert('Error', 'Failed to resolve call');
    }
  };

  const getItemName = (item) => {
    return item.name || item.item_name || item.menu_items?.name || 'Item';
  };

  const getItemsSummaryText = (items) => {
    if (!items || !items.length) return 'No items';
    return items.map(i => `${getItemName(i)} x${i.quantity || 1}`).join(', ');
  };

  // Filter orders
  const filteredOrders = orders.filter(o => {
    const matchStatus = statusFilter === 'all' || o.status === statusFilter;
    const itemsSummary = getItemsSummaryText(o.order_items).toLowerCase();
    const tableName = (o.table_name || `Table ${o.table_id || ''}`).toLowerCase();
    const q = search.toLowerCase().trim();
    const matchSearch = !q || tableName.includes(q) || itemsSummary.includes(q);
    const matchRole = role !== 'waiter' || ['ready', 'served'].includes(o.status);
    return matchStatus && matchSearch && matchRole;
  });

  const getActionButtons = (order) => {
    if (!order) return null;
    const s = order.status;

    return (
      <View style={styles.actionRow}>
        {s === 'new' && (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: COLORS.primary }]}
            disabled={actionLoading}
            onPress={() => updateOrderStatus(order.id, 'accepted')}
          >
            <Ionicons name="checkmark-circle-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.btnText}>Accept Order</Text>
          </TouchableOpacity>
        )}

        {s === 'accepted' && (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#3b82f6' }]}
            disabled={actionLoading}
            onPress={() => updateOrderStatus(order.id, 'preparing')}
          >
            <Ionicons name="restaurant-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.btnText}>Start Preparing</Text>
          </TouchableOpacity>
        )}

        {s === 'preparing' && (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#8b5cf6' }]}
            disabled={actionLoading}
            onPress={() => updateOrderStatus(order.id, 'ready')}
          >
            <Ionicons name="alarm-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.btnText}>Mark Ready</Text>
          </TouchableOpacity>
        )}

        {s === 'ready' && (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#06b6d4' }]}
            disabled={actionLoading}
            onPress={() => updateOrderStatus(order.id, 'served')}
          >
            <Ionicons name="checkmark-done-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.btnText}>Mark Served</Text>
          </TouchableOpacity>
        )}

        {['served', 'ready'].includes(s) && ['owner', 'manager', 'cashier'].includes(role) && (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: COLORS.primary }]}
            disabled={actionLoading}
            onPress={() => updateOrderStatus(order.id, 'completed')}
          >
            <Ionicons name="cash-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.btnText}>Complete & Pay</Text>
          </TouchableOpacity>
        )}

        {['new', 'accepted'].includes(s) && (
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: '#ef4444', marginTop: 8 }]}
            disabled={actionLoading}
            onPress={() => setShowCancelModal(true)}
          >
            <Ionicons name="close-circle-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.btnText}>Cancel Order</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderOrderItem = ({ item }) => {
    const statusColor = getStatusColor(item.status);
    const items = item.order_items || [];
    const tableName = item.table_name || (item.order_type === 'takeaway' ? 'Takeaway' : `Table ${item.table_id || ''}`);

    return (
      <TouchableOpacity
        style={styles.orderCard}
        onPress={() => setSelectedOrder(item)}
        activeOpacity={0.7}
      >
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
            <Text style={[styles.statusBadgeText, { color: statusColor }]}>
              {getStatusLabel(item.status)}
            </Text>
          </View>
        </View>

        <Text style={styles.itemsSummary} numberOfLines={2}>
          {getItemsSummaryText(items)}
        </Text>

        <View style={styles.cardFooter}>
          <Text style={styles.timeAgoText}>{timeAgo(item.created_at)}</Text>
          <Text style={styles.priceText}>{formatCurrency(item.total || 0)}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Top Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Live Orders</Text>

        {/* Tab Switcher */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'orders' && styles.tabBtnActive]}
            onPress={() => setTab('orders')}
          >
            <Text style={[styles.tabText, tab === 'orders' && styles.tabTextActive]}>
              Orders ({orders.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, tab === 'calls' && styles.tabBtnActive]}
            onPress={() => setTab('calls')}
          >
            <Text style={[styles.tabText, tab === 'calls' && styles.tabTextActive]}>
              Calls {calls.length > 0 ? `(${calls.length})` : ''}
            </Text>
            {calls.length > 0 && <View style={styles.callDot} />}
          </TouchableOpacity>
        </View>
      </View>

      {/* Offline Connectivity Banner */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="wifi-outline" size={16} color="#ffffff" style={{ marginRight: 8 }} />
          <Text style={styles.offlineBannerText}>
            ⚡ Offline mode — Changes will auto-sync on reconnect {pendingQueue.length > 0 ? `(${pendingQueue.length} pending)` : ''}
          </Text>
        </View>
      )}

      {tab === 'orders' ? (
        <View style={{ flex: 1 }}>
          {/* Search Box */}
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={18} color="#94a3b8" style={{ marginRight: 8 }} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search table or item..."
              placeholderTextColor="#94a3b8"
              value={search}
              onChangeText={setSearch}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <Ionicons name="close-circle" size={18} color="#94a3b8" />
              </TouchableOpacity>
            )}
          </View>

          {/* Horizontal Status Chips */}
          <View style={styles.chipContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipScroll}
            >
              {ORDER_STATUSES.map(st => {
                const active = statusFilter === st;
                return (
                  <TouchableOpacity
                    key={st}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setStatusFilter(st)}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {st.charAt(0).toUpperCase() + st.slice(1)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
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
              renderItem={renderOrderItem}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadOrders(); loadCalls(); }} />
              }
              ListEmptyComponent={
                <View style={styles.emptyContainer}>
                  <Ionicons name="receipt-outline" size={48} color="#cbd5e1" style={{ marginBottom: 12 }} />
                  <Text style={styles.emptyText}>No orders found</Text>
                </View>
              }
            />
          )}
        </View>
      ) : (
        /* Calls Tab */
        <FlatList
          data={calls}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadCalls(); }} />
          }
          renderItem={({ item }) => (
            <View style={styles.callCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={styles.callIconBg}>
                  <Ionicons
                    name={item.request_type === 'bill' ? 'card-outline' : 'notifications-outline'}
                    size={22}
                    color={COLORS.primary}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.callTableName}>{item.table_name || `Table ${item.table_id || ''}`}</Text>
                  <Text style={styles.callTypeText}>
                    {item.request_type === 'bill' ? 'Requested Bill Payment' : 'Called Waiter for Help'}
                  </Text>
                  <Text style={styles.timeAgoText}>{timeAgo(item.created_at)}</Text>
                </View>
              </View>

              <TouchableOpacity
                style={styles.resolveBtn}
                onPress={() => resolveCall(item.id)}
              >
                <Ionicons name="checkmark-outline" size={18} color="#fff" style={{ marginRight: 4 }} />
                <Text style={styles.resolveBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="checkmark-circle-outline" size={48} color="#cbd5e1" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>No pending customer calls</Text>
            </View>
          }
        />
      )}

      {/* Order Detail Modal */}
      {selectedOrder && (
        <Modal
          visible={!!selectedOrder}
          animationType="slide"
          transparent
          onRequestClose={() => setSelectedOrder(null)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>
                    {selectedOrder.table_name || (selectedOrder.order_type === 'takeaway' ? 'Takeaway' : `Table ${selectedOrder.table_id || ''}`)}
                  </Text>
                  <Text style={styles.modalTime}>{timeAgo(selectedOrder.created_at)}</Text>
                </View>

                <TouchableOpacity onPress={() => setSelectedOrder(null)}>
                  <Ionicons name="close" size={24} color="#64748b" />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 300, marginVertical: 12 }}>
                <Text style={styles.sectionLabel}>ORDER ITEMS</Text>
                {(selectedOrder.order_items || []).map((item, idx) => (
                  <View key={idx} style={styles.itemRow}>
                    <Text style={styles.itemName}>{getItemName(item)}</Text>
                    <Text style={styles.itemQty}>x{item.quantity || 1}</Text>
                    <Text style={styles.itemPrice}>{formatCurrency((item.price || 0) * (item.quantity || 1))}</Text>
                  </View>
                ))}
              </ScrollView>

              <View style={styles.modalTotalRow}>
                <Text style={styles.totalLabel}>Total Amount</Text>
                <Text style={styles.totalValue}>{formatCurrency(selectedOrder.total || 0)}</Text>
              </View>

              <View style={styles.paymentBadgeRow}>
                <View style={[
                  styles.payBadge,
                  { backgroundColor: selectedOrder.payment_status === 'paid' ? '#dcfce7' : '#fef3c7' }
                ]}>
                  <Ionicons
                    name={selectedOrder.payment_status === 'paid' ? 'checkmark-circle' : 'time-outline'}
                    size={16}
                    color={selectedOrder.payment_status === 'paid' ? '#16a34a' : '#d97706'}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[
                    styles.payBadgeText,
                    { color: selectedOrder.payment_status === 'paid' ? '#15803d' : '#b45309' }
                  ]}>
                    {selectedOrder.payment_status === 'paid' ? 'Payment Verified' : 'Payment Pending'}
                  </Text>
                </View>
              </View>

              {getActionButtons(selectedOrder)}
            </View>
          </View>
        </Modal>
      )}

      {/* Cancel Order Reason Modal */}
      <Modal
        visible={showCancelModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowCancelModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { padding: 20 }]}>
            <Text style={styles.modalTitle}>Cancel Order</Text>
            <Text style={{ fontSize: 13, color: '#64748b', marginVertical: 8 }}>
              Please enter a reason for cancelling this order:
            </Text>

            <TextInput
              style={styles.reasonInput}
              placeholder="e.g. Out of stock, Customer cancelled..."
              placeholderTextColor="#94a3b8"
              value={cancelReason}
              onChangeText={setCancelReason}
            />

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#f1f5f9' }]}
                onPress={() => setShowCancelModal(false)}
              >
                <Text style={{ color: '#64748b', fontWeight: '600' }}>Keep Order</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#ef4444', marginLeft: 10 }]}
                disabled={actionLoading}
                onPress={() => cancelOrder(selectedOrder?.id)}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Confirm Cancel</Text>
              </TouchableOpacity>
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
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a', marginBottom: 12 },
  offlineBanner: {
    backgroundColor: '#3b82f6',
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justify: 'center',
  },
  offlineBannerText: { color: '#ffffff', fontWeight: '600', fontSize: 12 },
  tabContainer: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 10, padding: 4 },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabBtnActive: { backgroundColor: '#ffffff', elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4 },
  tabText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  tabTextActive: { color: COLORS.primary, fontWeight: '700' },
  callDot: { position: 'absolute', top: 6, right: 12, width: 8, height: 8, borderRadius: 4, backgroundColor: '#ef4444' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchInput: { flex: 1, fontSize: 14, color: '#0f172a' },
  chipContainer: { height: 44, marginBottom: 8 },
  chipScroll: { paddingHorizontal: 16, alignItems: 'center' },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  chipTextActive: { color: '#ffffff', fontWeight: '700' },
  listContent: { padding: 16 },
  orderCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  tableName: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  itemsSummary: { fontSize: 13, color: '#475569', marginBottom: 12, lineHeight: 18 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  timeAgoText: { fontSize: 12, color: '#94a3b8' },
  priceText: { fontSize: 16, fontWeight: '700', color: COLORS.primary },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 15, color: '#94a3b8', fontWeight: '600' },
  callCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
    justify: 'space-between',
    alignItems: 'center',
    elevation: 2,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  callIconBg: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center' },
  callTableName: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  callTypeText: { fontSize: 13, color: '#475569', marginVertical: 2 },
  resolveBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, flexDirection: 'row', alignItems: 'center' },
  resolveBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#ffffff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  modalTime: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.8, marginBottom: 8 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  itemName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1e293b' },
  itemQty: { fontSize: 14, fontWeight: '600', color: '#64748b', marginHorizontal: 12 },
  itemPrice: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  modalTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 14, marginBottom: 12 },
  totalLabel: { fontSize: 15, fontWeight: '600', color: '#64748b' },
  totalValue: { fontSize: 22, fontWeight: '700', color: COLORS.primary },
  paymentBadgeRow: { marginBottom: 16 },
  payBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, selfAlign: 'flex-start' },
  payBadgeText: { fontSize: 12, fontWeight: '700' },
  actionRow: { marginTop: 8 },
  btn: { paddingVertical: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
  reasonInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f172a' },
  modalBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
});
