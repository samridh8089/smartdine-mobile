import React, { useEffect, useState, useRef } from 'react';
import { 
  View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet, Vibration, ActivityIndicator, Modal, TextInput 
} from 'react-native';
import { supabase } from '../lib/supabase';
import { sendSystemAlert, registerPushToken } from '../lib/notifications';
import { getFormattedOrderId } from '../lib/orderUtils';
import { startAlarm, stopAlarm } from '../lib/alarmManager';
import { checkAndPromptBatteryOptimization, openBatteryOptimizationSettings } from '../lib/batteryManager';

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
          // Register Push Token for active user
          registerPushToken(session.user.id);

          // Get profile restaurant_id if not set
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
      registerPushToken(profile.id);
    }
    checkAndPromptBatteryOptimization();
    fetchRestaurantInfo();
    fetchOrders();

    // 1. WebSocket Realtime Subscription (mirrors Waiter Screen)
    const channel = supabase
      .channel('kitchen-live-orders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          if (payload.new && payload.new.status === 'new') {
            if (!restaurantId || payload.new.restaurant_id === restaurantId) {
              Vibration.vibrate([0, 1000, 500, 1000]);
              // Continuous alarm for kitchen
              startAlarm(
                'new_order',
                'NEW KITCHEN ORDER!',
                `Table ${payload.new.table_name || 'N/A'} • Total: ₹${payload.new.total || 0}`
              );
              sendSystemAlert(
                'NEW KITCHEN ORDER!',
                `Table ${payload.new.table_name || 'N/A'} • Total: ₹${payload.new.total || 0}`
              );
            }
          }
          fetchOrders();
        }
      )
      .subscribe();

    // 2. High-Frequency 3-Second Polling (mirrors Waiter Screen)
    const interval = setInterval(() => {
      fetchOrders(true);
    }, 3000);

    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch (_) {}
      }
      if (interval) clearInterval(interval);
      try {
        stopAlarm();
      } catch (_) {}
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
        setRestaurantName(`${data.name} - Kitchen`);
      }
    } catch (e) {
      console.log('Error fetching restaurant info', e);
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
      if (!error && data) {
        if (isBackgroundPoll) {
          data.filter(o => o.status === 'new').forEach(ord => {
            if (!knownOrderIdsRef.current.has(ord.id)) {
              knownOrderIdsRef.current.add(ord.id);
              Vibration.vibrate([0, 1000, 500, 1000]);
              // Continuous alarm for new orders
              startAlarm(
                'new_order',
                'NEW KITCHEN ORDER!',
                `Table ${ord.table_name || 'N/A'} • Total: ₹${ord.total || 0}`
              );
              sendSystemAlert(
                'NEW KITCHEN ORDER!',
                `Table ${ord.table_name || 'N/A'} • Total: ₹${ord.total || 0}`
              );
            }
          });
        } else {
          data.filter(o => o.status === 'new').forEach(ord => knownOrderIdsRef.current.add(ord.id));
        }

        setOrders(data);
      }
    } catch (e) {
      console.log('Error fetching orders:', e);
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id, status) => {
    const { error } = await supabase
      .from('orders')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (!error) {
      // Stop alarm when kitchen staff starts preparing or marks ready
      if (['accepted', 'preparing', 'ready', 'completed'].includes(status)) {
        stopAlarm();
      }
      fetchOrders();
    } else {
      Alert.alert('Error', error.message);
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancellingOrderId) return;
    if (!cancellationReason.trim()) {
      Alert.alert('Reason Required', 'Please select or type a cancellation reason.');
      return;
    }

    const staffName = profile?.full_name || (profile?.role ? profile.role.toUpperCase() : 'Kitchen Staff');
    const reasonText = cancellationReason.trim();

    const { error } = await supabase
      .from('orders')
      .update({ 
        status: 'cancelled',
        cancelled_by: staffName,
        cancellation_reason: reasonText,
        cancelled_at: new Date().toISOString(),
        updated_at: new Date().toISOString() 
      })
      .eq('id', cancellingOrderId);

    if (!error) {
      setCancelModalVisible(false);
      setCancellingOrderId(null);
      setCancellationReason('');
      fetchOrders();
    } else {
      Alert.alert('Error', error.message);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const filteredOrders = orders.filter(o => {
    if (activeTab === 'active') return ['new', 'accepted', 'preparing'].includes(o.status);
    if (activeTab === 'ready') return o.status === 'ready';
    if (activeTab === 'history') return ['served', 'completed', 'cancelled'].includes(o.status);
    return true; // 'all'
  });

  const getStatusBadgeColor = (status) => {
    switch (status) {
      case 'new': return '#ef4444';
      case 'accepted': return '#f59e0b';
      case 'preparing': return '#3b82f6';
      case 'ready': return '#10b981';
      case 'served': return '#8b5cf6';
      case 'completed': return '#059669';
      case 'cancelled': return '#64748b';
      default: return '#64748b';
    }
  };

  const getTimeElapsed = (createdAt) => {
    const diffMs = new Date() - new Date(createdAt);
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    return `${diffHours}h ${diffMins % 60}m ago`;
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.restaurantTitle}>{restaurantName}</Text>
          <Text style={styles.subTitle}>Live KDS • Kitchen Display System</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => openBatteryOptimizationSettings()} style={[styles.signOutBtn, { backgroundColor: 'rgba(234, 179, 8, 0.15)', borderColor: '#eab308', borderWidth: 1, marginRight: 8 }]}>
            <Text style={[styles.signOutText, { color: '#eab308' }]}>🔋 Battery</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'active' && styles.tabActive]} 
          onPress={() => setActiveTab('active')}
        >
          <Text style={[styles.tabText, activeTab === 'active' && styles.tabTextActive]}>
            🍳 Cooking ({orders.filter(o => ['new', 'accepted', 'preparing'].includes(o.status)).length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'ready' && styles.tabActive]} 
          onPress={() => setActiveTab('ready')}
        >
          <Text style={[styles.tabText, activeTab === 'ready' && styles.tabTextActive]}>
            🔔 Ready ({orders.filter(o => o.status === 'ready').length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'history' && styles.tabActive]} 
          onPress={() => setActiveTab('history')}
        >
          <Text style={[styles.tabText, activeTab === 'history' && styles.tabTextActive]}>
            ✅ History ({orders.filter(o => ['served', 'completed'].includes(o.status)).length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'all' && styles.tabActive]} 
          onPress={() => setActiveTab('all')}
        >
          <Text style={[styles.tabText, activeTab === 'all' && styles.tabTextActive]}>
            📋 All ({orders.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Orders List */}
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {loading ? (
          <ActivityIndicator size="large" color="#0ea5e9" style={{ marginTop: 40 }} />
        ) : filteredOrders.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>👨‍🍳</Text>
            <Text style={styles.emptyText}>No orders in this tab</Text>
            <Text style={styles.emptySubText}>New orders placed via QR code will appear here live with full item breakdown and timing.</Text>
          </View>
        ) : (
          filteredOrders.map((order) => {
            const itemList = order.order_items || order.items || [];
            return (
              <View key={order.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View>
                    <Text style={styles.tableName}>Table {order.table_name || 'N/A'}</Text>
                    <Text style={styles.orderType}>
                      {order.order_type === 'takeaway' ? '📦 Takeaway Order' : '🍽️ Dine-In Order'}
                    </Text>
                  </View>

                  <View style={{ alignItems: 'flex-end' }}>
                    <View style={[styles.statusBadge, { backgroundColor: getStatusBadgeColor(order.status) }]}>
                      <Text style={styles.statusBadgeText}>{order.status?.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.timeElapsedText}>⏱️ {getTimeElapsed(order.created_at)}</Text>
                  </View>
                </View>

                <Text style={styles.timeText}>
                  Order {getFormattedOrderId(order, restaurantName, orders)} • Time: {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>

                {/* Complete Items Breakdown */}
                <View style={styles.itemsList}>
                  <Text style={styles.itemsHeaderTitle}>
                    ITEMS ORDERED ({itemList.reduce((s, i) => s + (i.quantity || 1), 0)}):
                  </Text>
                  {itemList.map((item, idx) => (
                    <View key={idx} style={styles.itemRow}>
                      <Text style={styles.itemQty}>{item.quantity || 1}x</Text>
                      <Text style={styles.itemName}>{item.menu_item_name || item.name || 'Menu Item'}</Text>
                      <Text style={styles.itemPrice}>₹{((item.price || 0) * (item.quantity || 1)).toFixed(2)}</Text>
                    </View>
                  ))}
                </View>

                {/* Special Instructions */}
                {order.special_instructions ? (
                  <View style={styles.instructionBox}>
                    <Text style={styles.instructionTitle}>⚠️ Customer Note:</Text>
                    <Text style={styles.instructionText}>{order.special_instructions}</Text>
                  </View>
                ) : null}

                {/* Total & Payment Summary */}
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Total Amount:</Text>
                  <Text style={styles.totalValue}>₹{Number(order.total || 0).toFixed(2)}</Text>
                  <View style={[
                    styles.paymentBadge, 
                    { backgroundColor: order.payment_status === 'paid' ? '#10b98122' : '#f59e0b22' }
                  ]}>
                    <Text style={[
                      styles.paymentBadgeText, 
                      { color: order.payment_status === 'paid' ? '#10b981' : '#f59e0b' }
                    ]}>
                      {order.payment_status === 'paid' ? 'PAID ✅' : 'PAYMENT PENDING ⏳'}
                    </Text>
                  </View>
                </View>

                {/* Kitchen Action Buttons */}
                <View style={styles.actions}>
                  {order.status === 'new' && (
                    <>
                      <TouchableOpacity 
                        style={[styles.btn, styles.acceptBtn]} 
                        onPress={() => updateStatus(order.id, 'accepted')}
                      >
                        <Text style={styles.btnText}>Accept Order 👍</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.btn, styles.rejectBtn]} 
                        onPress={() => {
                          setCancellingOrderId(order.id);
                          setCancellationReason('');
                          setCancelModalVisible(true);
                        }}
                      >
                        <Text style={styles.btnText}>Reject</Text>
                      </TouchableOpacity>
                    </>
                  )}

                  {order.status === 'accepted' && (
                    <TouchableOpacity 
                      style={[styles.btn, styles.preparingBtn]} 
                      onPress={() => updateStatus(order.id, 'preparing')}
                    >
                      <Text style={styles.btnText}>Start Cooking 👨‍🍳</Text>
                    </TouchableOpacity>
                  )}

                  {order.status === 'preparing' && (
                    <TouchableOpacity 
                      style={[styles.btn, styles.readyBtn]} 
                      onPress={() => updateStatus(order.id, 'ready')}
                    >
                      <Text style={styles.btnText}>Mark Ready for Serve 🔔</Text>
                    </TouchableOpacity>
                  )}

                  {order.status === 'ready' && (
                    <TouchableOpacity 
                      style={[styles.btn, styles.servedBtn]} 
                      onPress={() => updateStatus(order.id, 'served')}
                    >
                      <Text style={styles.btnText}>Mark Served ✅</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Cancellation Reason Modal */}
      <Modal
        visible={cancelModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setCancelModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🚫 Cancel Order #{cancellingOrderId?.slice(-5).toUpperCase()}</Text>
            <Text style={styles.modalSubtitle}>Select or type cancellation reason:</Text>

            <View style={styles.chipRow}>
              {['Customer Changed Mind', 'Item Out of Stock', 'Duplicate Order', 'Customer Left'].map((preset) => (
                <TouchableOpacity
                  key={preset}
                  style={[
                    styles.chip,
                    cancellationReason === preset && styles.chipActive
                  ]}
                  onPress={() => setCancellationReason(preset)}
                >
                  <Text style={[
                    styles.chipText,
                    cancellationReason === preset && styles.chipTextActive
                  ]}>{preset}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.reasonInput}
              placeholder="Or type custom reason..."
              placeholderTextColor="#64748b"
              value={cancellationReason}
              onChangeText={setCancellationReason}
              multiline={true}
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setCancelModalVisible(false)}
              >
                <Text style={styles.modalCancelBtnText}>Back</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleConfirmCancel}
              >
                <Text style={styles.modalConfirmBtnText}>Confirm Cancel 🚫</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    paddingTop: 50,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerLeft: { flex: 1 },
  restaurantTitle: { fontSize: 20, fontWeight: 'bold', color: '#f8fafc', marginBottom: 2 },
  liveBadge: { flexDirection: 'row', alignItems: 'center' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22c55e', marginRight: 6 },
  liveText: { color: '#22c55e', fontSize: 11, fontWeight: 'bold' },
  signOutBtn: { backgroundColor: '#334155', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  signOutText: { color: '#ef4444', fontWeight: 'bold', fontSize: 13 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    padding: 6,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: '#0ea5e9' },
  tabText: { color: '#94a3b8', fontSize: 11, fontWeight: 'bold' },
  tabTextActive: { color: 'white' },
  scrollContent: { padding: 16 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { color: '#f8fafc', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  emptySubText: { color: '#64748b', fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  tableName: { fontSize: 22, fontWeight: 'bold', color: '#38bdf8' },
  orderType: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginBottom: 4 },
  statusBadgeText: { color: 'white', fontSize: 10, fontWeight: 'bold' },
  timeElapsedText: { color: '#f59e0b', fontSize: 11, fontWeight: 'bold' },
  timeText: { color: '#64748b', fontSize: 12, marginBottom: 12 },
  itemsList: { backgroundColor: '#0f172a', padding: 12, borderRadius: 10, marginBottom: 12 },
  itemsHeaderTitle: { color: '#64748b', fontSize: 10, fontWeight: 'bold', marginBottom: 8, letterSpacing: 0.5 },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  itemQty: { color: '#0ea5e9', fontSize: 15, fontWeight: 'bold', width: 32 },
  itemName: { color: '#f8fafc', fontSize: 15, flex: 1, fontWeight: '500' },
  itemPrice: { color: '#94a3b8', fontSize: 14, fontWeight: 'bold' },
  instructionBox: { backgroundColor: '#451a03', padding: 10, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#78350f' },
  instructionTitle: { color: '#f59e0b', fontWeight: 'bold', fontSize: 12, marginBottom: 2 },
  instructionText: { color: '#fef3c7', fontSize: 13 },
  totalRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  totalLabel: { color: '#94a3b8', fontSize: 14, marginRight: 8 },
  totalValue: { color: '#10b981', fontSize: 18, fontWeight: 'bold', flex: 1 },
  paymentBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  paymentBadgeText: { fontSize: 10, fontWeight: 'bold' },
  actions: { flexDirection: 'row', gap: 8 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  acceptBtn: { backgroundColor: '#10b981' },
  rejectBtn: { backgroundColor: '#ef4444' },
  preparingBtn: { backgroundColor: '#3b82f6' },
  readyBtn: { backgroundColor: '#8b5cf6' },
  servedBtn: { backgroundColor: '#059669' },
  btnText: { color: 'white', fontWeight: 'bold', fontSize: 13 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#f8fafc', marginBottom: 6 },
  modalSubtitle: { fontSize: 12, color: '#94a3b8', marginBottom: 14 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  chip: { backgroundColor: '#0f172a', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#334155' },
  chipActive: { backgroundColor: 'rgba(239, 68, 68, 0.2)', borderColor: '#ef4444' },
  chipText: { color: '#94a3b8', fontSize: 11, fontWeight: '600' },
  chipTextActive: { color: '#ef4444', fontWeight: 'bold' },
  reasonInput: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#f8fafc',
    padding: 12,
    fontSize: 13,
    minHeight: 60,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  modalBtnRow: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: { flex: 1, backgroundColor: '#334155', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  modalCancelBtnText: { color: '#cbd5e1', fontWeight: 'bold', fontSize: 13 },
  modalConfirmBtn: { flex: 1, backgroundColor: '#ef4444', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  modalConfirmBtnText: { color: 'white', fontWeight: 'bold', fontSize: 13 },
});
