import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Platform, Alert, Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { startAlarm, stopAlarm, stopAllAlarms } from '../lib/alarmManager';
import { sendLocalNotification } from '../lib/notifications';
import { COLORS, FONTS, RADIUS, SHADOWS, formatCurrency, timeAgo, getStatusColor, getStatusLabel } from '../lib/theme';
import OTAUpdateBtn from '../components/OTAUpdateBtn';

const PENDING_ORDERS_STORAGE_KEY = '@smartdine_waiter_pending_orders';

export default function WaiterOrdersScreen({ route }) {
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
            if (p?.restaurant_id) setRestaurantId(p.restaurant_id);
          }
        } catch (e) {
          console.log('[WaiterOrders] fetch restaurant_id error:', e?.message);
        }
      }
    }
    fetchMissingRestaurantId();
  }, [restaurantId]);

  const [tab, setTab] = useState('ready'); // 'ready' | 'served' | 'all'
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [isOffline, setIsOffline] = useState(false);
  const [pendingQueue, setPendingQueue] = useState([]);

  const knownReadyIds = useRef(new Set());

  // Load offline queue on init
  useEffect(() => {
    async function loadPendingQueue() {
      try {
        const stored = await AsyncStorage.getItem(PENDING_ORDERS_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setPendingQueue(parsed);
          }
        }
      } catch (e) {
        console.log('[WaiterOrders] Load pending queue error:', e?.message);
      }
    }
    loadPendingQueue();
  }, []);

  const savePendingQueue = async (queue) => {
    setPendingQueue(queue);
    try {
      await AsyncStorage.setItem(PENDING_ORDERS_STORAGE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.log('[WaiterOrders] Save pending queue error:', e?.message);
    }
  };

  const loadOrders = useCallback(async () => {
    if (!restaurantId) { setLoading(false); setRefreshing(false); return; }
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('restaurant_id', restaurantId)
        .in('status', ['ready', 'served'])
        .order('created_at', { ascending: false });

      if (error) {
        console.log('WaiterOrders fetch error:', error.message);
        setIsOffline(true);
        return;
      }

      setIsOffline(false);
      const allOrders = data || [];
      setOrders(allOrders);

      // Bell for new ready orders
      const readyList = allOrders.filter(o => o.status === 'ready');
      let hasNew = false;
      readyList.forEach(o => {
        if (!knownReadyIds.current.has(o.id)) {
          knownReadyIds.current.add(o.id);
          hasNew = true;
        }
      });
      if (hasNew) {
        startAlarm('food_ready', 'Order Ready for Pickup', 'Food is ready to serve');
        sendLocalNotification('Order Ready for Pickup', 'Food is ready to serve to table');
        Vibration.vibrate([0, 500, 250, 500]);
      }
      if (readyList.length === 0) {
        stopAlarm('food_ready');
        Vibration.cancel();
      }
    } catch (e) {
      console.log('WaiterOrders load error:', e?.message);
      setIsOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId]);

  // Flush pending queue when online
  const flushPendingQueue = useCallback(async () => {
    if (pendingQueue.length === 0) return;
    console.log(`[WaiterOrders] Retrying ${pendingQueue.length} queued offline actions...`);
    const remaining = [];
    for (const item of pendingQueue) {
      try {
        if (item.type === 'mark_served') {
          await supabase.from('orders').update({ status: 'served' }).eq('id', item.orderId);
        }
      } catch (err) {
        console.log('[WaiterOrders] Failed retrying action:', err?.message);
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
    const sub = supabase.channel(`waiter-orders-realtime-${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` }, loadOrders)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsOffline(false);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setIsOffline(true);
        }
      });

    const timer = setInterval(loadOrders, 6000);
    return () => {
      stopAllAlarms();
      Vibration.cancel();
      clearInterval(timer);
      supabase.removeChannel(sub);
    };
  }, [restaurantId, loadOrders]);

  async function markServed(orderId) {
    stopAlarm('food_ready');
    Vibration.cancel();

    // Optimistic UI update
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'served' } : o));
    setActionLoading(p => ({ ...p, [orderId]: true }));
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'served' })
        .eq('id', orderId);
      if (error) throw error;
      setIsOffline(false);
      await loadOrders();
    } catch (e) {
      console.log('[WaiterOrders] markServed error (queueing for retry):', e?.message);
      setIsOffline(true);
      const actionItem = {
        type: 'mark_served',
        orderId,
        timestamp: Date.now(),
      };
      await savePendingQueue([...pendingQueue, actionItem]);
    } finally {
      setActionLoading(p => ({ ...p, [orderId]: false }));
    }
  }

  const getItemName = (item) => item.name || item.item_name || item.menu_items?.name || 'Item';
  const getItemsSummaryText = (items) => {
    if (!items || !items.length) return 'No items';
    return items.map(i => `${getItemName(i)} x${i.quantity || 1}`).join(', ');
  };

  const readyCount = orders.filter(o => o.status === 'ready').length;
  const servedCount = orders.filter(o => o.status === 'served').length;

  const filteredOrders = orders.filter(o => {
    if (tab === 'ready') return o.status === 'ready';
    if (tab === 'served') return o.status === 'served';
    return true;
  });

  const renderOrderItem = useCallback(({ item }) => {
    const isBusy = actionLoading[item.id];
    const isReady = item.status === 'ready';
    const tableName = item.table_name || (item.order_type === 'takeaway' ? 'Takeaway' : `Table ${item.table_id || ''}`);
    const items = item.order_items || [];

    return (
      <View style={[styles.orderCard, isReady && styles.orderCardReady]}>
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

          <View style={[styles.statusBadge, { backgroundColor: isReady ? '#8b5cf620' : '#06b6d420' }]}>
            <Text style={[styles.statusBadgeText, { color: isReady ? '#8b5cf6' : '#06b6d4' }]}>
              {getStatusLabel(item.status)}
            </Text>
          </View>
        </View>

        <Text style={styles.itemsSummary} numberOfLines={2}>{getItemsSummaryText(items)}</Text>

        <View style={styles.cardFooter}>
          <Text style={styles.timeAgo}>{timeAgo(item.created_at)}</Text>

          {isReady ? (
            <TouchableOpacity
              style={styles.serveBtn}
              disabled={isBusy}
              onPress={() => markServed(item.id)}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-done-outline" size={16} color="#fff" style={{ marginRight: 4 }} />
                  <Text style={styles.serveBtnText}>Mark Served</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <View style={styles.servedBadge}>
              <Ionicons name="checkmark-circle" size={16} color="#22c55e" style={{ marginRight: 4 }} />
              <Text style={styles.servedBadgeText}>Served to Table</Text>
            </View>
          )}
        </View>
      </View>
    );
  }, [actionLoading, markServed]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Delivery Orders</Text>
          <Text style={styles.subtitle}>{readyCount} orders ready for pickup</Text>
        </View>

        {readyCount > 0 && (
          <View style={[styles.alertPill, { marginRight: 8 }]}>
            <Text style={styles.alertPillText}>{readyCount} READY</Text>
          </View>
        )}

        <OTAUpdateBtn style={{ marginRight: 8 }} />

        <TouchableOpacity
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' }}
          onPress={async () => {
            stopAllAlarms();
            await supabase.auth.signOut().catch(() => {});
            navigation.replace('Login');
          }}
        >
          <Ionicons name="log-out-outline" size={18} color="#ef4444" />
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

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity style={[styles.tabBtn, tab === 'ready' && styles.tabBtnActive]} onPress={() => setTab('ready')}>
          <Text style={[styles.tabText, tab === 'ready' && styles.tabTextActive]}>Ready ({readyCount})</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tabBtn, tab === 'served' && styles.tabBtnActive]} onPress={() => setTab('served')}>
          <Text style={[styles.tabText, tab === 'served' && styles.tabTextActive]}>Served ({servedCount})</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tabBtn, tab === 'all' && styles.tabBtnActive]} onPress={() => setTab('all')}>
          <Text style={[styles.tabText, tab === 'all' && styles.tabTextActive]}>All ({orders.length})</Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredOrders}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadOrders(); }} />
          }
          renderItem={renderOrderItem}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <MaterialIcons name="delivery-dining" size={48} color="#cbd5e1" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>No delivery orders in this view</Text>
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
  alertPill: { backgroundColor: '#8b5cf6', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  alertPillText: { color: '#ffffff', fontWeight: '700', fontSize: 12 },
  offlineBanner: {
    backgroundColor: '#3b82f6',
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justify: 'center',
  },
  offlineBannerText: { color: '#ffffff', fontWeight: '600', fontSize: 12 },
  tabsContainer: { flexDirection: 'row', backgroundColor: '#ffffff', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8, backgroundColor: '#f1f5f9', marginHorizontal: 4 },
  tabBtnActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  tabTextActive: { color: '#ffffff', fontWeight: '700' },
  listContent: { padding: 16 },
  orderCard: { backgroundColor: '#ffffff', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9', elevation: 2 },
  orderCardReady: { borderColor: '#8b5cf6', borderWidth: 1.5 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  tableName: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  itemsSummary: { fontSize: 13, color: '#475569', marginBottom: 12 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  timeAgo: { fontSize: 12, color: '#94a3b8' },
  serveBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, flexDirection: 'row', alignItems: 'center' },
  serveBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  servedBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0fdf4', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  servedBadgeText: { color: '#15803d', fontWeight: '700', fontSize: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },
});
