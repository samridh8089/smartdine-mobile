import React, { useEffect, useState, useRef } from 'react';
import { 
  View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet, Vibration, ActivityIndicator, Modal, TextInput 
} from 'react-native';
import { supabase } from '../lib/supabase';
import { sendSystemAlert, registerPushToken } from '../lib/notifications';
import { getFormattedOrderId } from '../lib/orderUtils';
import { startAlarm, stopAlarm, isAlarmActive } from '../lib/alarmManager';

export default function KitchenScreen({ route }) {
  const profile = route?.params?.profile || {};
  const [restaurantId, setRestaurantId] = useState(profile?.restaurant_id || null);
  const [restaurantName, setRestaurantName] = useState('Kitchen Display');
  const [orders, setOrders] = useState([]);
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'ready' | 'history' | 'all'
  const [loading, setLoading] = useState(true);
  const knownOrderIdsRef = useRef(new Set());

  // Cancellation Modal state
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [cancellationReason, setCancellationReason] = useState('');

  useEffect(() => {
    let isMounted = true;

    const initUserAndPush = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          registerPushToken(session.user.id).catch(() => {});

          const { data: profile } = await supabase
            .from('profiles')
            .select('restaurant_id')
            .eq('id', session.user.id)
            .single();

          if (profile?.restaurant_id && isMounted) {
            setRestaurantId(profile.restaurant_id);
          }
        }
      } catch (err) {
        console.log('Error initializing kitchen session:', err);
      }
    };

    initUserAndPush();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (profile?.id) {
      registerPushToken(profile.id).catch(() => {});
    }
    fetchRestaurantInfo();
    fetchOrders();

    // 1. WebSocket Realtime Subscription
    let channel;
    try {
      channel = supabase
        .channel('kitchen-live-orders')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'orders' },
          (payload) => {
            if (payload?.new && payload.new.status === 'new') {
              if (!restaurantId || payload.new.restaurant_id === restaurantId) {
                Vibration.vibrate([0, 1000, 500, 1000]);
                startAlarm(
                  'new_order',
                  'NEW KITCHEN ORDER',
                  `Table ${payload.new.table_name || 'N/A'} - Total: ₹${payload.new.total || 0}`
                );
                sendSystemAlert(
                  'NEW KITCHEN ORDER',
                  `Table ${payload.new.table_name || 'N/A'} - Total: ₹${payload.new.total || 0}`
                );
              }
            }
            fetchOrders();
          }
        )
        .subscribe();
    } catch (e) {
      console.log('Kitchen realtime error:', e);
    }

    // 2. High-Frequency 3-Second Polling
    const interval = setInterval(() => {
      fetchOrders(true);
    }, 3000);

    return () => {
      if (channel) {
        try { supabase.removeChannel(channel); } catch (_) {}
      }
      if (interval) clearInterval(interval);
      try { stopAlarm(); } catch (_) {}
    };
  }, [restaurantId]);

  const fetchRestaurantInfo = async () => {
    if (!restaurantId) return;
    try {
      const { data } = await supabase
        .from('restaurants')
        .select('name')
        .eq('id', restaurantId)
        .single();
      if (data?.name) {
        setRestaurantName(`${data.name} - Kitchen KDS`);
      }
    } catch (e) {
      console.log('Error fetching restaurant info:', e);
    }
  };

  const fetchOrders = async (isBackgroundPoll = false) => {
    try {
      let query = supabase
        .from('orders')
        .select('*, order_items(*)')
        .order('created_at', { ascending: false });

      if (restaurantId) {
        query = query.eq('restaurant_id', restaurantId);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        if (isBackgroundPoll) {
          data.forEach(ord => {
            if (ord?.id && !knownOrderIdsRef.current.has(ord.id)) {
              knownOrderIdsRef.current.add(ord.id);
              if (ord.status === 'new' && (!restaurantId || ord.restaurant_id === restaurantId)) {
                startAlarm(
                  'new_order',
                  'NEW KITCHEN ORDER',
                  `Table ${ord.table_name || 'N/A'} - Total: ₹${ord.total || 0}`
                );
                sendSystemAlert(
                  'NEW KITCHEN ORDER',
                  `Table ${ord.table_name || 'N/A'} - Total: ₹${ord.total || 0}`
                );
              }
            }
          });
        } else {
          data.forEach(ord => { if (ord?.id) knownOrderIdsRef.current.add(ord.id); });
        }

        setOrders(data);
      }
    } catch (e) {
      console.log('Error fetching kitchen orders:', e);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id, status) => {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (!error) {
        if (['accepted', 'preparing', 'ready', 'served', 'completed'].includes(status)) {
          stopAlarm();
        }
        fetchOrders();
      } else {
        Alert.alert('Error', error.message);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to update order status');
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancellingOrderId) return;

    try {
      const cancellerName = profile?.full_name || 'Kitchen Staff';
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          cancelled_by: cancellerName,
          cancellation_reason: cancellationReason || 'Cancelled by kitchen staff',
          updated_at: new Date().toISOString(),
        })
        .eq('id', cancellingOrderId);

      if (!error) {
        stopAlarm();
        setCancelModalVisible(false);
        setCancellingOrderId(null);
        setCancellationReason('');
        fetchOrders();
      } else {
        Alert.alert('Error', error.message);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to cancel order');
    }
  };

  const safeOrders = orders || [];
  const activeOrders = safeOrders.filter(o => ['new', 'accepted', 'preparing'].includes(o?.status));
  const readyOrders = safeOrders.filter(o => o?.status === 'ready');
  const historyOrders = safeOrders.filter(o => ['served', 'completed', 'cancelled'].includes(o?.status));

  const displayedOrders = 
    activeTab === 'active' ? activeOrders :
    activeTab === 'ready' ? readyOrders :
    activeTab === 'history' ? historyOrders : safeOrders;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{restaurantName}</Text>
          <Text style={styles.subtitle}>Kitchen Display System (KDS)</Text>
        </View>

        {isAlarmActive() && (
          <TouchableOpacity onPress={() => stopAlarm()} style={styles.stopAlarmBtn}>
            <Text style={styles.stopAlarmText}>STOP ALARM</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'active' && styles.activeTab]}
          onPress={() => setActiveTab('active')}
        >
          <Text style={[styles.tabText, activeTab === 'active' && styles.activeTabText]}>
            Preparing ({activeOrders.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'ready' && styles.activeTab]}
          onPress={() => setActiveTab('ready')}
        >
          <Text style={[styles.tabText, activeTab === 'ready' && styles.activeTabText]}>
            Ready ({readyOrders.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'history' && styles.activeTab]}
          onPress={() => setActiveTab('history')}
        >
          <Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>
            History ({historyOrders.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'all' && styles.activeTab]}
          onPress={() => setActiveTab('all')}
        >
          <Text style={[styles.tabText, activeTab === 'all' && styles.activeTabText]}>
            All ({safeOrders.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#0ea5e9" />
          <Text style={styles.loadingText}>Loading kitchen orders...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {displayedOrders.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No orders in this kitchen view.</Text>
            </View>
          ) : (
            displayedOrders.map((order) => {
              if (!order) return null;
              const itemList = order.order_items || [];

              return (
                <View key={order.id} style={styles.orderCard}>
                  {/* Order Top Header */}
                  <View style={styles.cardHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={styles.tableName}>Table: {order.table_name || 'N/A'}</Text>
                      {order.order_type === 'takeaway' && (
                        <View style={styles.takeawayBadge}>
                          <Text style={styles.takeawayText}>Takeaway</Text>
                        </View>
                      )}
                    </View>

                    <View style={[styles.statusBadge, { backgroundColor: getStatusColor(order.status) }]}>
                      <Text style={styles.statusText}>{(order.status || 'NEW').toUpperCase()}</Text>
                    </View>
                  </View>

                  <Text style={styles.metaText}>
                    Order {getFormattedOrderId(order, restaurantName, safeOrders)} • Time: {order.created_at ? new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                  </Text>

                  {/* Cancellation Banner */}
                  {order.status === 'cancelled' && (
                    <View style={styles.cancelledBanner}>
                      <Text style={styles.cancelledTitle}>Order Cancelled</Text>
                      {order.cancelled_by ? <Text style={styles.cancelledSub}>• Cancelled By: {order.cancelled_by}</Text> : null}
                      {order.cancellation_reason ? <Text style={styles.cancelledSub}>• Reason: "{order.cancellation_reason}"</Text> : null}
                    </View>
                  )}

                  {/* Items List */}
                  <View style={styles.itemsBox}>
                    <Text style={styles.itemsHeaderTitle}>ITEMS TO PREPARE ({itemList.reduce((s, i) => s + (i?.quantity || 1), 0)}):</Text>
                    {itemList.map((item, i) => (
                      <View key={i} style={styles.itemRow}>
                        <Text style={styles.itemQty}>{item?.quantity || 1}x</Text>
                        <Text style={styles.itemName}>{item?.menu_item_name || item?.name || 'Item'}</Text>
                      </View>
                    ))}
                  </View>

                  {/* Kitchen Action Buttons */}
                  <View style={styles.actions}>
                    {order.status === 'new' && (
                      <TouchableOpacity 
                        style={[styles.actionBtn, { backgroundColor: '#3b82f6' }]}
                        onPress={() => updateStatus(order.id, 'preparing')}
                      >
                        <Text style={styles.actionBtnText}>Start Preparing</Text>
                      </TouchableOpacity>
                    )}

                    {(order.status === 'new' || order.status === 'accepted' || order.status === 'preparing') && (
                      <TouchableOpacity 
                        style={[styles.actionBtn, { backgroundColor: '#8b5cf6' }]}
                        onPress={() => updateStatus(order.id, 'ready')}
                      >
                        <Text style={styles.actionBtnText}>Mark Ready</Text>
                      </TouchableOpacity>
                    )}

                    {order.status !== 'completed' && order.status !== 'cancelled' && (
                      <TouchableOpacity 
                        style={[styles.actionBtn, { backgroundColor: '#ef4444' }]}
                        onPress={() => {
                          setCancellingOrderId(order.id);
                          setCancellationReason('');
                          setCancelModalVisible(true);
                        }}
                      >
                        <Text style={styles.actionBtnText}>Cancel</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* Cancellation Modal */}
      <Modal visible={cancelModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Kitchen Cancellation Reason</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g., Item Out of Stock / Kitchen Busy"
              placeholderTextColor="#94a3b8"
              value={cancellationReason}
              onChangeText={setCancellationReason}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity 
                style={styles.modalCancelBtn} 
                onPress={() => setCancelModalVisible(false)}
              >
                <Text style={styles.modalCancelText}>Back</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.modalConfirmBtn} 
                onPress={handleConfirmCancel}
              >
                <Text style={styles.modalConfirmText}>Confirm Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function getStatusColor(status) {
  switch (status) {
    case 'new': return '#ef4444';
    case 'accepted': return '#f59e0b';
    case 'preparing': return '#3b82f6';
    case 'ready': return '#8b5cf6';
    case 'served': return '#10b981';
    case 'completed': return '#64748b';
    case 'cancelled': return '#94a3b8';
    default: return '#64748b';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', paddingTop: 50 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#e2e8f0', backgroundColor: '#ffffff' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b' },
  stopAlarmBtn: { backgroundColor: '#ef4444', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  stopAlarmText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  tabsContainer: { flexDirection: 'row', backgroundColor: '#e2e8f0', margin: 12, borderRadius: 8, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  activeTab: { backgroundColor: '#059669' },
  tabText: { color: '#64748b', fontWeight: 'bold', fontSize: 12 },
  activeTabText: { color: 'white' },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#64748b', marginTop: 12 },
  scrollContent: { padding: 12 },
  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#64748b', fontSize: 15 },
  orderCard: { backgroundColor: '#ffffff', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#0f172a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tableName: { fontSize: 18, fontWeight: 'bold', color: '#0f172a' },
  takeawayBadge: { backgroundColor: '#8b5cf6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginLeft: 8 },
  takeawayText: { color: 'white', fontSize: 10, fontWeight: 'bold' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  metaText: { color: '#64748b', fontSize: 12, marginVertical: 4 },
  cancelledBanner: { backgroundColor: '#fef2f2', borderColor: '#fca5a5', borderWidth: 1, borderRadius: 8, padding: 8, marginVertical: 6 },
  cancelledTitle: { color: '#dc2626', fontWeight: 'bold', fontSize: 12 },
  cancelledSub: { color: '#64748b', fontSize: 11, marginTop: 2 },
  itemsBox: { backgroundColor: '#f8fafc', borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 1, borderColor: '#f1f5f9' },
  itemsHeaderTitle: { color: '#64748b', fontSize: 11, fontWeight: 'bold', marginBottom: 6 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 4 },
  itemQty: { color: '#059669', fontWeight: 'bold', fontSize: 16, width: 32 },
  itemName: { color: '#0f172a', fontSize: 16, fontWeight: '500', flex: 1 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1, padding: 10, borderRadius: 8, alignItems: 'center' },
  actionBtnText: { color: 'white', fontWeight: 'bold', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalBox: { backgroundColor: '#ffffff', borderRadius: 12, padding: 20, borderWidth: 1, borderColor: '#e2e8f0' },
  modalTitle: { color: '#0f172a', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  modalInput: { backgroundColor: '#f8fafc', color: '#0f172a', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 12, marginBottom: 16 },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#e2e8f0', alignItems: 'center' },
  modalCancelText: { color: '#475569', fontWeight: 'bold' },
  modalConfirmBtn: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#ef4444', alignItems: 'center' },
  modalConfirmText: { color: 'white', fontWeight: 'bold' },
});
