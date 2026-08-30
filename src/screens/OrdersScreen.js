import { getFormattedOrderId } from '../lib/orderUtils';
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
import { fetchTableAssignments } from '../lib/tableAssignments';

const ORDER_STATUSES = ['all', 'new', 'accepted', 'preparing', 'ready', 'served', 'completed', 'paid', 'cancelled'];
const PENDING_OWNER_ORDERS_KEY = '@smartdine_owner_pending_orders';

export default function OrdersScreen({ route }) {
  const navigation = useNavigation();
  const profile = route?.params?.profile ?? {};
  const [restaurantId, setRestaurantId] = useState(
    profile?.restaurant_id || profile?.restaurants?.id || null
  );
  const role = profile?.role ?? 'owner';

  const [assignedTableIds, setAssignedTableIds] = useState([]);
  const [assignedTableNames, setAssignedTableNames] = useState([]);

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

  // Load table assignments for waiter role
  const loadAssignedTables = useCallback(async () => {
    if (!restaurantId || !profile?.id) return;
    try {
      const assignments = await fetchTableAssignments(restaurantId);
      const myAssigns = (assignments || []).filter(a => a.waiter_id === profile.id && a.active !== false);
      setAssignedTableIds(myAssigns.map(a => a.table_id));
      setAssignedTableNames(myAssigns.map(a => a.table_name || 'Table'));
    } catch (e) {
      console.log('[OrdersScreen] loadAssignedTables error:', e?.message);
    }
  }, [restaurantId, profile?.id]);

  useEffect(() => {
    if (role === 'waiter' || (role === 'supervisor' && profile?.department === 'waiter')) {
      loadAssignedTables();
    }
  }, [role, profile?.department, loadAssignedTables]);

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

  // Payment Collection Modal
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentTargetOrder, setPaymentTargetOrder] = useState(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(null); // 'Cash' | 'UPI' | 'Card'
  const [paymentProcessing, setPaymentProcessing] = useState(false);

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
        .order('created_at', { ascending: false })
        .limit(150);

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
          const now = new Date().toISOString();
          const updates = { status: item.newStatus, updated_at: now };
          if (item.newStatus === 'completed') updates.payment_status = 'paid';
          await supabase.from('orders').update(updates).eq('id', item.orderId);
          if (['accepted', 'preparing', 'ready', 'served', 'completed'].includes(item.newStatus)) {
            const batchUpdates = { status: item.newStatus, updated_at: now };
            if (item.newStatus === 'accepted') batchUpdates.accepted_at = now;
            if (item.newStatus === 'preparing') batchUpdates.preparing_at = now;
            if (item.newStatus === 'ready') batchUpdates.ready_at = now;
            if (item.newStatus === 'served' || item.newStatus === 'completed') batchUpdates.served_at = now;
            await supabase.from('order_batches').update(batchUpdates).eq('order_id', item.orderId).neq('status', 'cancelled');
          }
        } else if (item.type === 'cancel_order') {
          const now = new Date().toISOString();
          await supabase.from('orders').update({ status: 'cancelled', cancellation_reason: item.cancelReason, cancelled_at: now }).eq('id', item.orderId);
          await supabase.from('order_batches').update({ status: 'cancelled', updated_at: now }).eq('order_id', item.orderId);
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

  const promptCollectPayment = (order) => {
    setPaymentTargetOrder(order);
    setSelectedPaymentMethod(null);
    setShowPaymentModal(true);
  };

  const handleConfirmPayment = async () => {
    if (!paymentTargetOrder || !selectedPaymentMethod) {
      Alert.alert('Selection Required', 'Please select a payment method (Cash, UPI, or Card).');
      return;
    }

    setPaymentProcessing(true);
    try {
      const now = new Date().toISOString();
      const staffName = profile?.full_name || profile?.name || (role === 'owner' ? 'Harsh Mehta' : 'Staff');
      const staffRole = profile?.role ? (profile.role.charAt(0).toUpperCase() + profile.role.slice(1)) : 'Owner';
      const collectorStr = `${staffName} (${staffRole})`;
      const method = selectedPaymentMethod.toLowerCase();
      const orderUpdates = {
        status: 'completed',
        payment_status: 'paid',
        payment_method: method,
        paid_at: now,
        completed_at: now,
        marked_paid_by: collectorStr,
        completed_by: collectorStr,
        updated_at: now,
      };

      const { error } = await supabase
        .from('orders')
        .update(orderUpdates)
        .eq('id', paymentTargetOrder.id);

      if (error) throw error;

      // Update batches with served_at/completed_at
      await supabase
        .from('order_batches')
        .update({ status: 'completed', served_at: now, updated_at: now })
        .eq('order_id', paymentTargetOrder.id)
        .neq('status', 'cancelled');

      setShowPaymentModal(false);
      const targetId = paymentTargetOrder.id;
      setPaymentTargetOrder(null);
      setSelectedPaymentMethod(null);

      Alert.alert(
        'Payment Settled',
        `₹${paymentTargetOrder.total || paymentTargetOrder.subtotal || 0} collected via ${selectedPaymentMethod} by ${collectorStr}.`
      );

      await loadOrders();
      if (selectedOrder?.id === targetId) {
        setSelectedOrder(prev => prev ? { ...prev, ...orderUpdates } : null);
      }
    } catch (e) {
      console.log('Payment collection error:', e?.message);
      Alert.alert('Payment Error', e?.message || 'Could not record payment');
    } finally {
      setPaymentProcessing(false);
    }
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    setActionLoading(true);
    try {
      const now = new Date().toISOString();
      const staffName = profile?.full_name || profile?.name || 'Staff';

      // 1. Call authoritative backend API first to run inventoryEngine transitions
      let apiSuccess = false;
      try {
        const apiRes = await fetch(`${CONFIG.API_BASE_URL}/api/staff/update-order-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId,
            newStatus,
            staffName
          })
        }).then(r => r.json());

        if (apiRes && apiRes.success) {
          apiSuccess = true;
        }
      } catch (apiErr) {
        console.log('[OrdersScreen] Backend API update failed, falling back:', apiErr?.message);
      }

      // 2. Direct client update fallback if offline or backend route unreachable
      if (!apiSuccess) {
        const updates = { status: newStatus, updated_at: now };
        if (newStatus === 'completed') updates.payment_status = 'paid';

        const { error } = await supabase
          .from('orders')
          .update(updates)
          .eq('id', orderId);

        if (error) throw new Error(error.message || 'Failed to update order status');

        if (['accepted', 'preparing', 'ready', 'served', 'completed'].includes(newStatus)) {
          const batchUpdates = { status: newStatus, updated_at: now };
          if (newStatus === 'accepted') batchUpdates.accepted_at = now;
          if (newStatus === 'preparing') batchUpdates.preparing_at = now;
          if (newStatus === 'ready') batchUpdates.ready_at = now;
          if (newStatus === 'served' || newStatus === 'completed') batchUpdates.served_at = now;

          await supabase
            .from('order_batches')
            .update(batchUpdates)
            .eq('order_id', orderId)
            .neq('status', 'cancelled');
        }

        if (['served', 'completed'].includes(newStatus)) {
          // Direct fallback consumption safeguard
          try {
            await supabase
              .from('inventory_reservations')
              .update({ status: 'CONSUMED', updated_at: now })
              .eq('order_id', orderId)
              .eq('status', 'ACTIVE');
          } catch (resErr) {
            console.log('[OrdersScreen] Reservation update notice:', resErr?.message);
          }
        }
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
    const trimmedReason = cancelReason.trim();
    if (!trimmedReason) {
      Alert.alert('Reason Required', 'Please enter a cancellation reason before cancelling.');
      return;
    }

    setActionLoading(true);
    try {
      const now = new Date().toISOString();
      const cancelUser = profile?.full_name || profile?.role || 'Staff';

      const { error } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          cancellation_reason: trimmedReason,
          cancelled_by: cancelUser,
          cancelled_at: now,
        })
        .eq('id', orderId);

      if (error) throw error;

      await supabase
        .from('order_batches')
        .update({ status: 'cancelled', updated_at: now })
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
    return item.menu_item_name || item.name || item.item_name || item.menu_items?.name || 'Item';
  };

  const getItemsSummaryText = (items) => {
    if (!items || !items.length) return 'No items';
    return items.map(i => `${getItemName(i)} x${i.quantity || 1}`).join(', ');
  };

  const getOrderTimeline = (order) => {
    if (!order) return [];
    const events = [];

    // 1. Created
    if (order.created_at) {
      events.push({
        title: 'Order Created',
        time: new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date(order.created_at).toLocaleDateString([], { day: '2-digit', month: 'short' }),
        color: '#0284c7',
      });
    }

    // 2. Accepted
    if (['accepted', 'preparing', 'ready', 'served', 'completed'].includes(order.status) || order.accepted_at) {
      const t = order.accepted_at || order.created_at;
      events.push({
        title: 'Order Accepted',
        time: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date(t).toLocaleDateString([], { day: '2-digit', month: 'short' }),
        color: '#16a34a',
      });
    }

    // 3. Kitchen Started
    if (['preparing', 'ready', 'served', 'completed'].includes(order.status) || order.preparing_at) {
      const t = order.preparing_at || order.created_at;
      events.push({
        title: 'Kitchen Started Preparing',
        time: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date(t).toLocaleDateString([], { day: '2-digit', month: 'short' }),
        color: '#ea580c',
      });
    }

    // 4. Ready
    if (['ready', 'served', 'completed'].includes(order.status) || order.ready_at) {
      const t = order.ready_at || order.created_at;
      events.push({
        title: 'Order Ready for Pickup',
        time: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date(t).toLocaleDateString([], { day: '2-digit', month: 'short' }),
        color: '#d97706',
      });
    }

    // 5. Served
    if (['served', 'completed'].includes(order.status) || order.served_at) {
      const t = order.served_at || order.created_at;
      events.push({
        title: 'Order Served to Table',
        time: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date(t).toLocaleDateString([], { day: '2-digit', month: 'short' }),
        color: '#7c3aed',
      });
    }

    // 6. Paid
    if (order.payment_status === 'paid' || order.status === 'completed' || order.paid_at) {
      const t = order.paid_at || order.updated_at || order.created_at;
      const rawMethod = (order.payment_method || order.payment_mode || order.metadata?.payment_method || 'Cash');
      const formattedMethod = rawMethod.charAt(0).toUpperCase() + rawMethod.slice(1);
      const collector = order.marked_paid_by || order.completed_by || order.waiter_name || `${profile?.full_name || 'Staff'} (${profile?.role ? profile.role.charAt(0).toUpperCase() + profile.role.slice(1) : 'Owner'})`;
      events.push({
        title: 'Payment Completed',
        method: formattedMethod,
        collectedBy: collector,
        time: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date(t).toLocaleDateString([], { day: '2-digit', month: 'short' }),
        color: '#059669',
      });
    }

    // 7. Cancelled
    if (order.status === 'cancelled') {
      const t = order.cancelled_at || order.updated_at || order.created_at;
      events.push({
        title: 'Order Cancelled',
        reason: order.cancellation_reason || order.cancel_reason || 'Cancelled by staff',
        cancelledBy: order.cancelled_by || order.server_name || 'Staff',
        time: new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        date: new Date(t).toLocaleDateString([], { day: '2-digit', month: 'short' }),
        color: '#dc2626',
      });
    }

    return events;
  };

  // Filter orders
  const isWaiterUser = role === 'waiter' || (role === 'supervisor' && profile?.department === 'waiter');

  const filteredOrders = orders.filter(o => {
    const matchStatus = statusFilter === 'all' 
      ? true 
      : statusFilter === 'paid' 
      ? o.payment_status === 'paid' 
      : o.status === statusFilter;
    const itemsSummary = getItemsSummaryText(o.order_items).toLowerCase();
    const tableName = (o.table_name || `Table ${o.table_id || ''}`).toLowerCase();
    const q = search.toLowerCase().trim();
    const matchSearch = !q || tableName.includes(q) || itemsSummary.includes(q);
    const matchRole = role !== 'waiter' || ['ready', 'served'].includes(o.status);
    const matchAssignedTable = !isWaiterUser || assignedTableIds.length === 0 || !o.table_id || assignedTableIds.includes(o.table_id);
    return matchStatus && matchSearch && matchRole && matchAssignedTable;
  });

  const filteredCalls = calls.filter(c => {
    if (!isWaiterUser || assignedTableIds.length === 0) return true;
    return !c.table_id || assignedTableIds.includes(c.table_id);
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
            onPress={() => promptCollectPayment(order)}
          >
            <Ionicons name="cash-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
            <Text style={styles.btnText}>Collect Payment</Text>
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
    const isPaid = item.payment_status === 'paid' || item.status === 'completed';

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
            <View><Text style={styles.tableName}>{tableName}</Text><Text style={{ fontSize: 11, fontWeight: '700', color: '#64748b' }}>#{getFormattedOrderId(item, profile?.restaurant_name || '')}</Text></View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {isPaid && (
              <View style={styles.paidBadge}>
                <Ionicons name="checkmark-circle" size={11} color="#16a34a" style={{ marginRight: 2 }} />
                <Text style={styles.paidBadgeText}>PAID</Text>
              </View>
            )}
            <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
              <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                {getStatusLabel(item.status)}
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.itemsSummary} numberOfLines={2}>
          {getItemsSummaryText(items)}
        </Text>

        {(() => {
          const rawInst = item.special_instructions || (item.batches && item.batches[0]?.special_instructions) || '';
          const cleanInst = rawInst
            .replace(/^\[Batch #\d+\]:\s*/, '')
            .split('\n')[0]
            .trim();
          if (cleanInst && !cleanInst.startsWith('[CANCELLED]')) {
            return (
              <View style={{ backgroundColor: '#fef3c7', borderColor: '#fde68a', borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, marginTop: 4, alignSelf: 'flex-start' }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#b45309' }} numberOfLines={1}>
                  📝 Note: {cleanInst}
                </Text>
              </View>
            );
          }
          return null;
        })()}

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
              Orders ({filteredOrders.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, tab === 'calls' && styles.tabBtnActive]}
            onPress={() => setTab('calls')}
          >
            <Text style={[styles.tabText, tab === 'calls' && styles.tabTextActive]}>
              Calls {filteredCalls.length > 0 ? `(${filteredCalls.length})` : ''}
            </Text>
            {filteredCalls.length > 0 && <View style={styles.callDot} />}
          </TouchableOpacity>
        </View>
      </View>

      {/* My Assigned Tables Banner for Waiters */}
      {isWaiterUser && (
        <View style={styles.assignedTablesBar}>
          <View style={styles.assignedTablesLeft}>
            <Ionicons name="restaurant-outline" size={16} color="#047857" style={{ marginRight: 6 }} />
            <Text style={styles.assignedTablesLabel}>My Assigned Tables:</Text>
          </View>
          <Text style={styles.assignedTablesList} numberOfLines={1}>
            {assignedTableNames.length > 0 ? assignedTableNames.join(', ') : 'All Tables (Unrestricted)'}
          </Text>
        </View>
      )}
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

              <ScrollView style={{ maxHeight: 380, marginVertical: 10 }} showsVerticalScrollIndicator={false}>
                <Text style={styles.sectionLabel}>ORDER ITEMS</Text>
                {(selectedOrder.order_items || []).map((item, idx) => (
                  <View key={idx} style={styles.itemRow}>
                    <Text style={styles.itemName}>{getItemName(item)}</Text>
                    <Text style={styles.itemQty}>x{item.quantity || 1}</Text>
                    <Text style={styles.itemPrice}>{formatCurrency((item.price || 0) * (item.quantity || 1))}</Text>
                  </View>
                ))}

                {/* 📝 Special Instructions Block */}
                {(() => {
                  const parts = [];
                  const addPart = (val) => {
                    if (!val || typeof val !== 'string') return;
                    const cleaned = val
                      .replace(/^\[Batch #\d+\]:\s*/gi, '')
                      .replace(/\[CANCELLED\].*/gi, '')
                      .replace(/PROMO OFFER:.*/gi, '')
                      .trim();
                    if (cleaned && !parts.includes(cleaned)) parts.push(cleaned);
                  };

                  if (selectedOrder?.special_instructions) addPart(selectedOrder.special_instructions);
                  if (selectedOrder?.batches && Array.isArray(selectedOrder.batches)) {
                    selectedOrder.batches.forEach(b => { if (b?.special_instructions) addPart(b.special_instructions); });
                  }
                  if (selectedOrder?.order_items && Array.isArray(selectedOrder.order_items)) {
                    selectedOrder.order_items.forEach(it => { if (it?.notes) addPart(it.notes); });
                  }

                  const notesText = parts.join(' | ');
                  if (!notesText) return null;

                  return (
                    <View style={{ backgroundColor: '#fef3c7', borderColor: '#f59e0b', borderWidth: 1.5, padding: 10, borderRadius: 10, marginTop: 10, marginBottom: 6 }}>
                      <Text style={{ fontSize: 11, fontWeight: '900', color: '#92400e', textTransform: 'uppercase', marginBottom: 2 }}>
                        📝 Special Instructions
                      </Text>
                      <Text style={{ fontSize: 13, fontWeight: '800', color: '#78350f' }}>
                        {notesText}
                      </Text>
                    </View>
                  );
                })()}

                {/* Audit Status Timeline */}
                <Text style={[styles.sectionLabel, { marginTop: 16 }]}>ORDER EVENT TIMELINE</Text>
                <View style={styles.timelineBox}>
                  {getOrderTimeline(selectedOrder).map((ev, i, arr) => (
                    <View key={i} style={styles.timelineRow}>
                      <View style={styles.timelineLeftCol}>
                        <View style={[styles.timelineNodeDot, { backgroundColor: ev.color }]} />
                        {i < arr.length - 1 && <View style={styles.timelineLine} />}
                      </View>
                      <View style={styles.timelineRightCol}>
                        <View style={styles.timelineHeaderRow}>
                          <Text style={[styles.timelineTitle, ev.color === '#dc2626' && { color: '#dc2626' }]}>
                            {ev.title}
                          </Text>
                          <Text style={styles.timelineTimeText}>{ev.date} at {ev.time}</Text>
                        </View>
                        {ev.method && (
                          <View style={{ marginTop: 3 }}>
                            <Text style={styles.timelineDetailText}>
                              <Text style={[styles.timelineDetailBold, { color: '#059669' }]}>{ev.method}</Text> collected by <Text style={styles.timelineDetailBold}>{ev.collectedBy}</Text>
                            </Text>
                          </View>
                        )}
                        {ev.reason && (
                          <View style={styles.timelineDetailRow}>
                            <Text style={styles.timelineDetailText}>Reason: <Text style={[styles.timelineDetailBold, { color: '#dc2626' }]}>"{ev.reason}"</Text></Text>
                            {ev.cancelledBy && <Text style={styles.timelineDetailText}>By: <Text style={styles.timelineDetailBold}>{ev.cancelledBy}</Text></Text>}
                          </View>
                        )}
                      </View>
                    </View>
                  ))}
                </View>
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

      {/* Interactive Payment Collection Modal */}
      <Modal
        visible={showPaymentModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowPaymentModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { maxHeight: '80%' }]}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="cash" size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
                <Text style={styles.modalHeaderTitle}>Collect Payment</Text>
              </View>
              <TouchableOpacity onPress={() => setShowPaymentModal(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            {paymentTargetOrder && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Order Header */}
                <View style={styles.payTargetCard}>
                  <View>
                    <Text style={styles.payTargetTable}>
                      {paymentTargetOrder.table_name || (paymentTargetOrder.order_type === 'takeaway' ? 'Takeaway' : `Table ${paymentTargetOrder.table_id || ''}`)}
                    </Text>
                    <Text style={styles.payTargetSub}>
                      {(paymentTargetOrder.order_items || []).length} items • Order #{getFormattedOrderId(paymentTargetOrder, profile?.restaurant_name || '')}
                    </Text>
                  </View>
                  <Text style={styles.payTargetAmount}>
                    {formatCurrency(paymentTargetOrder.total || paymentTargetOrder.subtotal || 0)}
                  </Text>
                </View>

                {/* Step 1: Select Payment Method */}
                <Text style={styles.modalSectionHeading}>STEP 1: SELECT PAYMENT METHOD *</Text>
                <View style={styles.payMethodGrid}>
                  {[
                    { id: 'Cash', label: 'Cash', icon: 'cash-outline', iconColor: '#059669' },
                    { id: 'UPI', label: 'UPI / QR', icon: 'qr-code-outline', iconColor: '#2563eb' },
                    { id: 'Card', label: 'Card / POS', icon: 'card-outline', iconColor: '#7c3aed' },
                  ].map(m => {
                    const isSel = selectedPaymentMethod === m.id;
                    return (
                      <TouchableOpacity
                        key={m.id}
                        style={[
                          styles.payMethodCard,
                          isSel && styles.payMethodCardSelected
                        ]}
                        onPress={() => setSelectedPaymentMethod(m.id)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name={m.icon} size={24} color={isSel ? COLORS.primary : m.iconColor} />
                        <Text style={[styles.payMethodTitle, isSel && styles.payMethodTitleSelected]}>
                          {m.label}
                        </Text>
                        {isSel && (
                          <View style={styles.payMethodCheckBadge}>
                            <Ionicons name="checkmark-circle" size={14} color={COLORS.primary} />
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {/* Step 2: Collector Staff Information (Auto Detected) */}
                <Text style={[styles.modalSectionHeading, { marginTop: 14 }]}>STEP 2: COLLECTED BY (AUTO-DETECTED)</Text>
                <View style={styles.payCollectorBox}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="person-circle-outline" size={24} color={COLORS.primary} style={{ marginRight: 8 }} />
                    <View>
                      <Text style={styles.payCollectorName}>
                        {profile?.full_name || profile?.name || (role === 'owner' ? 'Harsh Mehta' : 'Staff')}
                      </Text>
                      <Text style={styles.payCollectorRole}>
                        Role: {profile?.role ? (profile.role.charAt(0).toUpperCase() + profile.role.slice(1)) : 'Owner'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Confirm Button */}
                <TouchableOpacity
                  style={[
                    styles.payConfirmBtn,
                    (!selectedPaymentMethod || paymentProcessing) && { opacity: 0.5, backgroundColor: '#94a3b8' }
                  ]}
                  disabled={!selectedPaymentMethod || paymentProcessing}
                  onPress={handleConfirmPayment}
                >
                  {paymentProcessing ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.payConfirmBtnText}>
                      Confirm & Settle Payment ({formatCurrency(paymentTargetOrder.total || paymentTargetOrder.subtotal || 0)})
                    </Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

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
                style={[
                  styles.modalBtn,
                  {
                    backgroundColor: cancelReason.trim().length === 0 ? '#cbd5e1' : '#ef4444',
                    marginLeft: 10,
                    opacity: (actionLoading || cancelReason.trim().length === 0) ? 0.6 : 1
                  }
                ]}
                disabled={actionLoading || cancelReason.trim().length === 0}
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
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    elevation: 1,
  },
  chipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  chipTextActive: { color: '#ffffff', fontWeight: '700' },
  listContent: { padding: 16, paddingBottom: 100 },
  orderCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
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
  paidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#dcfce7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  paidBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#15803d',
    letterSpacing: 0.3,
  },
  assignedTablesBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ecfdf5',
    borderBottomWidth: 1,
    borderBottomColor: '#a7f3d0',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  assignedTablesLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  assignedTablesLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#047857',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  assignedTablesList: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065f46',
    flexShrink: 1,
    marginLeft: 8,
  },
  reasonInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, fontSize: 14, color: '#0f172a' },
  modalBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  timelineBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    marginTop: 6,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 40,
  },
  timelineLeftCol: {
    alignItems: 'center',
    width: 18,
    marginRight: 10,
    paddingTop: 4,
  },
  timelineNodeDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.primary,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    minHeight: 24,
    backgroundColor: '#cbd5e1',
    marginVertical: 3,
  },
  timelineRightCol: {
    flex: 1,
    paddingBottom: 10,
  },
  timelineHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timelineTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  timelineTimeText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  timelineDetailRow: {
    marginTop: 3,
    backgroundColor: '#ffffff',
    padding: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  timelineDetailText: {
    fontSize: 11.5,
    color: '#475569',
    marginTop: 1,
  },
  timelineDetailBold: {
    fontWeight: '700',
    color: '#0f172a',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    maxHeight: '80%',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 10,
  },
  modalHeaderTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  modalSectionHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  payTargetCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  payTargetTable: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  payTargetSub: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 2,
  },
  payTargetAmount: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.primary,
  },
  payMethodGrid: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  payMethodCard: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    position: 'relative',
  },
  payMethodCardSelected: {
    borderColor: COLORS.primary,
    backgroundColor: '#f0fdf4',
  },
  payMethodTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#475569',
    marginTop: 6,
  },
  payMethodTitleSelected: {
    color: COLORS.primary,
    fontWeight: '800',
  },
  payMethodCheckBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
  payCollectorBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  payCollectorName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  payCollectorRole: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 1,
  },
  payConfirmBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  payConfirmBtnText: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 14,
  },
});
