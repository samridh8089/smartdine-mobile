import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Platform,
  Alert, Modal, TextInput, Animated, Vibration, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { startAlarm, stopAlarm, stopAllAlarms } from '../lib/alarmManager';
import { sendLocalNotification } from '../lib/notifications';
import {
  COLORS, FONTS, RADIUS, SHADOWS, timeAgo, formatCurrency,
} from '../lib/theme';
import OTAUpdateBtn from '../components/OTAUpdateBtn';

const CANCEL_REASONS = [
  'Item Out of Stock',
  'Kitchen Busy / Overflow',
  'Wrong Order Placed',
  'Customer Request',
  'Other',
];

const PENDING_QUEUE_STORAGE_KEY = '@smartdine_kitchen_pending_actions';

export default function KitchenScreen({ route }) {
  const navigation = useNavigation();
  const profile = route?.params?.profile ?? {};
  const [restaurantId, setRestaurantId] = useState(
    profile?.restaurant_id || profile?.restaurants?.id || null
  );

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
            if (p?.restaurant_id) {
              setRestaurantId(p.restaurant_id);
            }
          }
        } catch (e) {
          console.log('KDS restaurant_id fetch error:', e?.message);
        }
      }
    }
    fetchMissingRestaurantId();
  }, [restaurantId]);

  const [activeTab, setActiveTab] = useState('new'); // 'new' | 'preparing' | 'ready'
  const [newOrders, setNewOrders] = useState([]);
  const [preparingOrders, setPreparingOrders] = useState([]);
  const [readyOrders, setReadyOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [bellOn, setBellOn] = useState(true);
  const [actionLoading, setActionLoading] = useState({});
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');
  const [hasNewOrder, setHasNewOrder] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [pendingQueue, setPendingQueue] = useState([]);
  
  const knownNewIds = useRef(new Set());
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for new order alert banner
  useEffect(() => {
    if (hasNewOrder) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.03, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [hasNewOrder]);

  // Load offline queue on init
  useEffect(() => {
    async function loadPendingQueue() {
      try {
        const stored = await AsyncStorage.getItem(PENDING_QUEUE_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setPendingQueue(parsed);
          }
        }
      } catch (e) {
        console.log('[KDS] Pending queue load error:', e?.message);
      }
    }
    loadPendingQueue();
  }, []);

  // Save offline queue whenever it changes
  const savePendingQueue = async (queue) => {
    setPendingQueue(queue);
    try {
      await AsyncStorage.setItem(PENDING_QUEUE_STORAGE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.log('[KDS] Save pending queue error:', e?.message);
    }
  };

  const loadOrders = useCallback(async () => {
    if (!restaurantId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      // order_batches does NOT have restaurant_id — filter via orders join & include order_items
      const { data, error } = await supabase
        .from('order_batches')
        .select('*, order_items(*), orders!inner(table_name, order_type, payment_status, restaurant_id, status)')
        .eq('orders.restaurant_id', restaurantId)
        .not('status', 'in', '(served,completed,cancelled)')
        .order('created_at', { ascending: true });

      if (error) {
        console.log('KDS fetch error:', error.message);
        setIsOffline(true);
        return;
      }

      setIsOffline(false);

      // Filter out batches whose parent order is already completed or cancelled
      const rawBatches = data || [];
      const batches = rawBatches.filter(b => b.orders && !['completed', 'cancelled'].includes(b.orders.status));
      const newB = batches.filter(b => b.status === 'new' || b.status === 'pending');
      const prepB = batches.filter(b => ['accepted', 'preparing'].includes(b.status));
      const readyB = batches.filter(b => b.status === 'ready');

      setNewOrders(newB);
      setPreparingOrders(prepB);
      setReadyOrders(readyB);

      // Check for new orders to trigger bell
      let hasNew = false;
      newB.forEach(b => {
        if (!knownNewIds.current.has(b.id)) {
          knownNewIds.current.add(b.id);
          hasNew = true;
        }
      });
      if (hasNew && bellOn) {
        setHasNewOrder(true);
        startAlarm('new_order', '🔔 New Kitchen Order!', 'A new order needs kitchen attention');
        sendLocalNotification('🔔 New Kitchen Order!', 'A new order needs kitchen attention', 'smartdine-urgent-v3');
        Vibration.vibrate([0, 1000, 500, 1000]);
      }
      if (newB.length === 0) {
        setHasNewOrder(false);
        stopAlarm('new_order');
      }
    } catch (e) {
      console.log('KDS load error:', e?.message);
      setIsOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId, bellOn]);

  // Flush pending offline queue when online
  const flushPendingQueue = useCallback(async () => {
    if (pendingQueue.length === 0) return;
    console.log(`[KDS] Retrying ${pendingQueue.length} queued offline actions...`);
    const remaining = [];
    for (const item of pendingQueue) {
      try {
        if (item.type === 'status_update') {
          const updates = { status: item.newStatus };
          if (item.newStatus === 'accepted') updates.accepted_by = item.staffName;
          if (item.newStatus === 'preparing') updates.preparing_by = item.staffName;
          if (item.newStatus === 'ready') updates.ready_by = item.staffName;

          await supabase.from('order_batches').update(updates).eq('id', item.targetId);
          if (item.orderId) {
            await supabase.from('orders').update({ status: item.newStatus }).eq('id', item.orderId);
          }
        } else if (item.type === 'cancel_batch') {
          const cancelTag = `[CANCELLED] ${item.reason}`;
          await supabase.from('order_batches').update({ special_instructions: cancelTag, status: 'ready' }).eq('id', item.targetId);
          await supabase.from('order_items').update({ notes: cancelTag }).eq('batch_id', item.targetId);
        }
      } catch (err) {
        console.log('[KDS] Failed retrying pending action:', err?.message);
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

    if (!restaurantId) return;

    // Subscribe to order_batches changes — filter via orders.restaurant_id at app level
    const channel = supabase
      .channel(`kds-realtime-${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_batches' }, loadOrders)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'orders',
        filter: `restaurant_id=eq.${restaurantId}`,
      }, loadOrders)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsOffline(false);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setIsOffline(true);
        }
      });

    const timer = setInterval(loadOrders, 6000);

    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
      stopAllAlarms();
    };
  }, [loadOrders, restaurantId]);

  const updateBatchStatus = async (batch, newStatus) => {
    const targetId = batch.id;
    stopAlarm('new_order');
    Vibration.cancel();

    const staffName = profile?.full_name || 'Kitchen';

    // Optimistic UI updates
    if (newStatus === 'accepted' || newStatus === 'preparing') {
      const updated = { ...batch, status: newStatus, accepted_by: staffName };
      setNewOrders(prev => prev.filter(b => b.id !== targetId));
      setPreparingOrders(prev => [...prev.filter(b => b.id !== targetId), updated]);
      if (activeTab === 'new') {
        setActiveTab('preparing');
      }
    } else if (newStatus === 'ready') {
      const updated = { ...batch, status: 'ready', ready_by: staffName };
      setPreparingOrders(prev => prev.filter(b => b.id !== targetId));
      setReadyOrders(prev => [...prev.filter(b => b.id !== targetId), updated]);
    }

    setActionLoading(prev => ({ ...prev, [targetId]: true }));
    try {
      const updates = { status: newStatus };
      if (newStatus === 'accepted') updates.accepted_by = staffName;
      if (newStatus === 'preparing') updates.preparing_by = staffName;
      if (newStatus === 'ready') updates.ready_by = staffName;

      const { error: batchErr } = await supabase.from('order_batches').update(updates).eq('id', targetId);
      if (batchErr) throw batchErr;

      if (batch.order_id) {
        await supabase.from('orders').update({ status: newStatus }).eq('id', batch.order_id);
      }
      setIsOffline(false);
      await loadOrders();
    } catch (e) {
      console.log('Update batch error (queueing for retry):', e?.message);
      setIsOffline(true);
      // Queue action for retry
      const actionItem = {
        type: 'status_update',
        targetId,
        orderId: batch.order_id,
        newStatus,
        staffName,
        timestamp: Date.now(),
      };
      await savePendingQueue([...pendingQueue, actionItem]);
    } finally {
      setActionLoading(prev => ({ ...prev, [targetId]: false }));
    }
  };

  const cancelBatch = async (targetOverride, reasonOverride) => {
    const target = (targetOverride && typeof targetOverride === 'object' && targetOverride.id) ? targetOverride : cancelTarget;
    if (!target || !target.id) return;
    const targetId = target.id;
    const orderId = target.order_id || target.orders?.id;
    const finalReason = (typeof reasonOverride === 'string' && reasonOverride) ? reasonOverride : cancelReason || 'Declined by kitchen';

    stopAlarm('new_order');
    Vibration.cancel();

    // Optimistic remove from local list instantly
    setNewOrders(prev => prev.filter(b => b.id !== targetId));
    setPreparingOrders(prev => prev.filter(b => b.id !== targetId));
    setReadyOrders(prev => prev.filter(b => b.id !== targetId));
    setShowCancelModal(false);
    setCancelTarget(null);

    setActionLoading(prev => ({ ...prev, [targetId]: true }));
    try {
      // 1. Mark batch as cancelled with [CANCELLED] tag in special_instructions
      const cancelTag = `[CANCELLED] ${finalReason}`;
      await supabase.from('order_batches').update({
        special_instructions: cancelTag,
        status: 'ready'
      }).eq('id', targetId);

      // 2. Mark order_items in this batch with [CANCELLED] tag in notes
      await supabase.from('order_items').update({
        notes: cancelTag
      }).eq('batch_id', targetId);

      if (orderId) {
        // 3. Fetch all batches for this order to check if any active batches remain
        const { data: allBatches } = await supabase
          .from('order_batches')
          .select('id, status, special_instructions')
          .eq('order_id', orderId);

        const activeRemaining = (allBatches || []).filter(b =>
          b.id !== targetId &&
          !b.special_instructions?.includes('[CANCELLED]')
        );

        if (activeRemaining.length === 0) {
          // ALL batches are cancelled -> Cancel parent order
          await supabase.from('orders').update({
            status: 'cancelled',
            cancellation_reason: finalReason,
            cancelled_at: new Date().toISOString(),
            cancelled_by: profile?.full_name || 'Kitchen',
          }).eq('id', orderId);
        } else {
          // Other batches are active or served -> Preserve parent order status & recalculate totals!
          let parentStatus = 'new';
          if (activeRemaining.some(b => b.status === 'served')) parentStatus = 'served';
          else if (activeRemaining.some(b => b.status === 'ready')) parentStatus = 'ready';
          else if (activeRemaining.some(b => b.status === 'preparing')) parentStatus = 'preparing';
          else if (activeRemaining.some(b => b.status === 'accepted')) parentStatus = 'accepted';

          // Recalculate active items subtotal & total
          const activeBatchIds = new Set(activeRemaining.map(b => b.id));
          const { data: allItems } = await supabase
            .from('order_items')
            .select('price, quantity, batch_id, notes')
            .eq('order_id', orderId);

          const validItems = (allItems || []).filter(i =>
            activeBatchIds.has(i.batch_id) && !i.notes?.includes('[CANCELLED]')
          );

          const newSubtotal = validItems.reduce((sum, i) => sum + (Number(i.price) * Number(i.quantity)), 0);
          const newGst = parseFloat((newSubtotal * 0.05).toFixed(2));
          const newTotal = parseFloat((newSubtotal + newGst).toFixed(2));

          await supabase.from('orders').update({
            status: parentStatus,
            subtotal: newSubtotal,
            gst: newGst,
            total: newTotal,
            cancelled_by: null,
            cancellation_reason: null,
            cancelled_at: null
          }).eq('id', orderId);
        }
      }

      setCancelReason('');
      setIsOffline(false);
      await loadOrders();
    } catch (e) {
      console.log('Cancel batch error (queueing for retry):', e?.message);
      setIsOffline(true);
      const actionItem = {
        type: 'cancel_batch',
        targetId,
        orderId,
        reason: finalReason,
        timestamp: Date.now(),
      };
      await savePendingQueue([...pendingQueue, actionItem]);
    } finally {
      setActionLoading(prev => ({ ...prev, [targetId]: false }));
    }
  };

  const activeBatches =
    activeTab === 'new' ? newOrders :
    activeTab === 'preparing' ? preparingOrders : readyOrders;

  const totalActive = newOrders.length + preparingOrders.length + readyOrders.length;

  const renderBatchCard = useCallback(({ item: batch }) => {
    const isBusy = actionLoading[batch.id];
    const order = batch.orders || {};
    const tableName = order.table_name || (order.order_type === 'takeaway' ? 'Takeaway' : `Table ${batch.table_id || ''}`);
    const items = Array.isArray(batch.order_items) && batch.order_items.length > 0
      ? batch.order_items
      : (Array.isArray(batch.items) ? batch.items : []);

    return (
      <View style={styles.batchCard}>
        {/* Card Header */}
        <View style={styles.cardHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons
              name={order.order_type === 'takeaway' ? 'bag-handle-outline' : 'restaurant-outline'}
              size={18}
              color={COLORS.textDark}
              style={{ marginRight: 6 }}
            />
            <Text style={styles.cardTableName}>{tableName}</Text>
          </View>

          <View style={styles.cardHeaderRight}>
            <Ionicons name="time-outline" size={14} color="#94a3b8" style={{ marginRight: 4 }} />
            <Text style={styles.timeAgo}>{timeAgo(batch.created_at)}</Text>
          </View>
        </View>

        {/* Item List */}
        <View style={styles.itemsContainer}>
          {items.map((it, idx) => (
            <View key={idx} style={styles.itemRow}>
              <View style={[styles.vegDot, { backgroundColor: it.is_veg === false ? '#ef4444' : '#22c55e' }]} />
              <Text style={styles.itemQty}>{it.quantity || 1}x</Text>
              <Text style={styles.itemName}>{it.menu_item_name || it.name || it.item_name || 'Item'}</Text>
              {it.notes ? <Text style={styles.itemNotes}>({it.notes})</Text> : null}
            </View>
          ))}
        </View>

        {/* Staff Tag */}
        {batch.accepted_by ? (
          <Text style={styles.staffTag}>Accepted by: {batch.accepted_by}</Text>
        ) : null}

        {/* Action Buttons */}
        <View style={styles.actionRow}>
          {(batch.status === 'new' || batch.status === 'pending') && (
            <>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#ef4444', flex: 1, marginRight: 8 }]}
                disabled={isBusy}
                onPress={() => { setCancelTarget(batch); setShowCancelModal(true); }}
              >
                <Text style={styles.btnText}>Decline</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#059669', flex: 2 }]}
                disabled={isBusy}
                onPress={() => updateBatchStatus(batch, 'accepted')}
              >
                {isBusy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={styles.btnText}>Accept Order</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}

          {batch.status === 'accepted' && (
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: COLORS.primary, flex: 1 }]}
              disabled={isBusy}
              onPress={() => updateBatchStatus(batch, 'preparing')}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="restaurant-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.btnText}>Start Cooking</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {batch.status === 'preparing' && (
            <TouchableOpacity
              style={[styles.btn, { backgroundColor: '#22c55e', flex: 1 }]}
              disabled={isBusy}
              onPress={() => updateBatchStatus(batch, 'ready')}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-done-circle-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
                  <Text style={styles.btnText}>Mark Ready</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {batch.status === 'ready' && (
            <View style={styles.waitingNotice}>
              <Ionicons name="checkmark-circle" size={18} color="#22c55e" style={{ marginRight: 6 }} />
              <Text style={styles.waitingText}>Ready for Waiter Pickup</Text>
            </View>
          )}
        </View>
      </View>
    );
  }, [actionLoading, activeTab, updateBatchStatus]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Kitchen Display</Text>
          <Text style={styles.subtitle}>{totalActive} active orders in kitchen</Text>
        </View>

        <OTAUpdateBtn style={{ marginRight: 8 }} />

        <TouchableOpacity
          style={[styles.bellBtn, bellOn ? styles.bellBtnOn : styles.bellBtnOff, { marginRight: 8 }]}
          onPress={() => setBellOn(!bellOn)}
        >
          <Ionicons
            name={bellOn ? 'notifications' : 'notifications-off-outline'}
            size={20}
            color={bellOn ? '#ffffff' : '#64748b'}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bellBtn, { backgroundColor: '#fee2e2' }]}
          onPress={async () => {
            stopAllAlarms();
            await supabase.auth.signOut().catch(() => {});
            navigation.replace('Login');
          }}
        >
          <Ionicons name="log-out-outline" size={20} color="#ef4444" />
        </TouchableOpacity>
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

      {/* New Order Alert Banner */}
      {hasNewOrder && (
        <Animated.View style={[styles.alertBanner, { transform: [{ scale: pulseAnim }] }]}>
          <Ionicons name="alert-circle" size={20} color="#ffffff" style={{ marginRight: 8 }} />
          <Text style={styles.alertBannerText}>NEW ORDER RECEIVED - Action Required!</Text>
        </Animated.View>
      )}

      {/* Top Segmented Tab Slider */}
      <View style={styles.tabSliderContainer}>
        <TouchableOpacity
          style={[styles.tabSliderBtn, activeTab === 'new' && styles.tabBtnNewActive]}
          onPress={() => setActiveTab('new')}
        >
          <Text style={[styles.tabSliderText, activeTab === 'new' && styles.tabTextActive]}>
            New ({newOrders.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabSliderBtn, activeTab === 'preparing' && styles.tabBtnPrepActive]}
          onPress={() => setActiveTab('preparing')}
        >
          <Text style={[styles.tabSliderText, activeTab === 'preparing' && styles.tabTextActive]}>
            Preparing ({preparingOrders.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabSliderBtn, activeTab === 'ready' && styles.tabBtnReadyActive]}
          onPress={() => setActiveTab('ready')}
        >
          <Text style={[styles.tabSliderText, activeTab === 'ready' && styles.tabTextActive]}>
            Ready ({readyOrders.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Main Order List */}
      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : !restaurantId ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="chef-hat" size={54} color="#cbd5e1" style={{ marginBottom: 16 }} />
          <Text style={[styles.emptyTitle, { textAlign: 'center', paddingHorizontal: 32 }]}>
            Restaurant Not Linked
          </Text>
          <Text style={[styles.emptySubtitle, { textAlign: 'center', paddingHorizontal: 32, marginTop: 8 }]}>
            Your kitchen account is not linked to a restaurant.{`\n`}Contact your restaurant owner to link your account.
          </Text>
        </View>
      ) : (
        <FlatList
          data={activeBatches}
          keyExtractor={item => item.id}
          renderItem={renderBatchCard}
          contentContainerStyle={styles.listContent}
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadOrders(); }} />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="chef-hat" size={54} color="#cbd5e1" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyTitle}>
                {activeTab === 'new' ? 'No New Orders' : activeTab === 'preparing' ? 'No Orders Preparing' : 'No Ready Orders'}
              </Text>
              <Text style={styles.emptySubtitle}>Orders will appear here automatically in real-time</Text>
            </View>
          }
        />
      )}

      {/* Cancel/Decline Modal */}
      <Modal
        visible={showCancelModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowCancelModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Decline Order Batch</Text>
            <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>Select a reason for declining:</Text>

            {CANCEL_REASONS.map(r => (
              <TouchableOpacity
                key={r}
                style={[styles.reasonOption, cancelReason === r && styles.reasonOptionSelected]}
                onPress={() => {
                  setCancelReason(r);
                  cancelBatch(cancelTarget, r);
                }}
              >
                <Ionicons
                  name={cancelReason === r ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={cancelReason === r ? COLORS.primary : '#94a3b8'}
                  style={{ marginRight: 10 }}
                />
                <Text style={[styles.reasonText, cancelReason === r && { color: COLORS.primary, fontWeight: '700' }]}>{r}</Text>
              </TouchableOpacity>
            ))}

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 16 }}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#f1f5f9' }]}
                onPress={() => setShowCancelModal(false)}
              >
                <Text style={{ color: '#64748b', fontWeight: '600' }}>Back</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#ef4444', marginLeft: 10 }]}
                onPress={() => cancelBatch(cancelTarget, cancelReason)}
              >
                <Text style={{ color: '#ffffff', fontWeight: '700' }}>Confirm Decline</Text>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
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
  bellBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  bellBtnOn: { backgroundColor: COLORS.primary },
  bellBtnOff: { backgroundColor: '#f1f5f9' },
  offlineBanner: {
    backgroundColor: '#3b82f6',
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineBannerText: { color: '#ffffff', fontWeight: '600', fontSize: 12 },
  alertBanner: {
    backgroundColor: '#ef4444',
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justify: 'center',
  },
  alertBannerText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  tabSliderContainer: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tabSliderBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    marginHorizontal: 4,
  },
  tabBtnNewActive: { backgroundColor: '#ef4444' },
  tabBtnPrepActive: { backgroundColor: '#3b82f6' },
  tabBtnReadyActive: { backgroundColor: '#22c55e' },
  tabSliderText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  tabTextActive: { color: '#ffffff', fontWeight: '700' },
  listContent: { padding: 16 },
  batchCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  cardTableName: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  cardHeaderRight: { flexDirection: 'row', alignItems: 'center' },
  timeAgo: { fontSize: 12, color: '#94a3b8' },
  itemsContainer: { marginBottom: 14 },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  vegDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  itemQty: { fontSize: 15, fontWeight: '700', color: '#0f172a', width: 28 },
  itemName: { fontSize: 15, fontWeight: '600', color: '#1e293b', flex: 1 },
  itemNotes: { fontSize: 12, color: '#f59e0b', fontStyle: 'italic', marginLeft: 6 },
  staffTag: { fontSize: 11, color: '#64748b', fontStyle: 'italic', marginBottom: 12 },
  actionRow: { flexDirection: 'row', alignItems: 'center' },
  btn: { paddingVertical: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
  waitingNotice: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8, backgroundColor: '#f0fdf4', borderRadius: 10 },
  waitingText: { color: '#15803d', fontWeight: '700', fontSize: 13 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  emptySubtitle: { fontSize: 13, color: '#94a3b8' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#ffffff', borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  reasonOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  reasonText: { fontSize: 14, color: '#334155' },
  modalBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
});
