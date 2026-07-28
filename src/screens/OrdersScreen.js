import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Vibration, Modal, TextInput } from 'react-native';
import { supabase } from '../lib/supabase';
import { sendSystemAlert, registerPushToken } from '../lib/notifications';
import { getFormattedOrderId } from '../lib/orderUtils';
import { startAlarm, stopAlarm } from '../lib/alarmManager';
import { checkAndPromptBatteryOptimization, openBatteryOptimizationSettings } from '../lib/batteryManager';

export default function OrdersScreen({ route }) {
  const profile = route?.params?.profile || {};
  const restaurantId = profile.restaurant_id || null;

  const [restaurantName, setRestaurantName] = useState('Live Orders');
  const [orders, setOrders] = useState([]);
  const [activeTab, setActiveTab] = useState('active'); // 'active' | 'completed' | 'all'
  const [loading, setLoading] = useState(true);
  const knownOrderIdsRef = useRef(new Set());

  // Cancellation Modal state
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [cancellationReason, setCancellationReason] = useState('');

  useEffect(() => {
    if (profile?.id) {
      registerPushToken(profile.id);
    }
    checkAndPromptBatteryOptimization();
    fetchRestaurantName();
    fetchOrders();

    // 1. WebSocket Realtime Subscription
    let channel;
    if (restaurantId) {
      channel = supabase
        .channel(`live-orders-${restaurantId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
          (payload) => {
                if (payload.eventType === 'INSERT') {
              Vibration.vibrate([0, 1000, 500, 1000]);
              // Start continuous alarm for new order
              startAlarm(
                'new_order',
                '🛒 NEW CUSTOMER ORDER!',
                `Table ${payload.new.table_name || 'N/A'} • Total: ₹${payload.new.total || 0}`
              );
              sendSystemAlert(
                'NEW CUSTOMER ORDER!',
                `Table ${payload.new.table_name || 'N/A'} • Total: ₹${payload.new.total || 0}`
              );
            }
            fetchOrders();
          }
        )
        .subscribe();
    }

    // 2. High-Frequency 3-Second Polling
    const interval = setInterval(() => {
      fetchOrders(true);
    }, 3000);

    return () => {
      if (channel) supabase.removeChannel(channel);
      clearInterval(interval);
      stopAlarm(); // Stop alarm when screen unmounts
    };
  }, [restaurantId]);

  const fetchRestaurantName = async () => {
    if (!restaurantId) return;
    try {
      const { data } = await supabase
        .from('restaurants')
        .select('name')
        .eq('id', restaurantId)
        .single();
      if (data?.name) {
        setRestaurantName(`${data.name} - Orders`);
      }
    } catch (e) {
      console.log('Error fetching restaurant name:', e);
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
          data.forEach(ord => {
            if (!knownOrderIdsRef.current.has(ord.id)) {
              knownOrderIdsRef.current.add(ord.id);
              if (ord.status === 'new') {
                // Trigger continuous alarm
                startAlarm(
                  'new_order',
                  'NEW CUSTOMER ORDER!',
                  `Table ${ord.table_name || 'N/A'} • Total: ₹${ord.total || 0}`
                );
                sendSystemAlert(
                  'NEW CUSTOMER ORDER!',
                  `Table ${ord.table_name || 'N/A'} • Total: ₹${ord.total || 0}`
                );
              }
            }
          });
        } else {
          data.forEach(ord => knownOrderIdsRef.current.add(ord.id));
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
      // Stop alarm when order is accepted/processed
      if (['accepted', 'preparing', 'completed', 'served'].includes(status)) {
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

    const staffName = profile?.full_name || (profile?.role ? profile.role.toUpperCase() : 'Staff Member');
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

  const updatePaymentStatus = async (id, payment_status) => {
    const { error } = await supabase
      .from('orders')
      .update({ payment_status })
      .eq('id', id);

    if (!error) {
      fetchOrders();
    } else {
      Alert.alert('Error', error.message);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const filteredOrders = orders.filter(o => {
    if (activeTab === 'active') return ['new', 'accepted', 'preparing', 'ready', 'served'].includes(o.status);
    if (activeTab === 'completed') return ['completed', 'cancelled'].includes(o.status);
    return true; // 'all'
  });

  const getStatusColor = (status) => {
    switch (status) {
      case 'new': return '#ef4444';
      case 'accepted': return '#f59e0b';
      case 'preparing': return '#3b82f6';
      case 'ready': return '#10b981';
      case 'served': return '#8b5cf6';
      case 'completed': return '#22c55e';
      case 'cancelled': return '#64748b';
      default: return '#64748b';
    }
  };

  const getTimeElapsed = (createdAt) => {
    const diffMs = new Date() - new Date(createdAt);
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    return `${Math.floor(diffMins / 60)}h ${diffMins % 60}m ago`;
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.restaurantTitle}>{restaurantName}</Text>
          <Text style={styles.subTitle}>Live Orders & Revenue Control</Text>
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
            ⚡ Active ({orders.filter(o => ['new', 'accepted', 'preparing', 'ready', 'served'].includes(o.status)).length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'completed' && styles.tabActive]} 
          onPress={() => setActiveTab('completed')}
        >
          <Text style={[styles.tabText, activeTab === 'completed' && styles.tabTextActive]}>
            ✅ Completed ({orders.filter(o => ['completed', 'cancelled'].includes(o.status)).length})
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

      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <ActivityIndicator size="large" color="#0ea5e9" style={{ marginTop: 40 }} />
        ) : filteredOrders.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📋</Text>
            <Text style={styles.emptyText}>No orders in this tab</Text>
            <Text style={styles.emptySubText}>Orders placed by guests will update here live with full receipt details.</Text>
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
                    <View style={[styles.badge, { backgroundColor: getStatusColor(order.status) }]}>
                      <Text style={styles.badgeText}>{order.status?.toUpperCase()}</Text>
                    </View>
                    <Text style={styles.timeElapsedText}>⏱️ {getTimeElapsed(order.created_at)}</Text>
                  </View>
                </View>

                <Text style={styles.metaText}>
                  Order {getFormattedOrderId(order, restaurantName, orders)} • Time: {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>

                {/* Cancellation Details Banner */}
                {order.status === 'cancelled' && (
                  <View style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: '#ef4444', borderWidth: 1, borderRadius: 8, padding: 8, marginVertical: 6 }}>
                    <Text style={{ color: '#ef4444', fontWait: 'bold', fontWeight: 'bold', fontSize: 12 }}>🚫 Order Cancelled</Text>
                    {order.cancelled_by ? <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>• Cancelled By: {order.cancelled_by}</Text> : null}
                    {order.cancellation_reason ? <Text style={{ color: '#cbd5e1', fontSize: 11, marginTop: 2 }}>• Reason: "{order.cancellation_reason}"</Text> : null}
                  </View>
                )}

                {/* Payment Verification Banner */}
                {order.payment_status === 'customer_marked_paid' && order.status !== 'cancelled' && (
                  <View style={styles.paymentAlert}>
                    <Text style={styles.paymentAlertText}>⚠️ Customer marked payment as complete!</Text>
                    <TouchableOpacity 
                      style={styles.verifyBtn}
                      onPress={() => updatePaymentStatus(order.id, 'paid')}
                    >
                      <Text style={styles.verifyBtnText}>Verify & Confirm Paid ✅</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Full Detailed Items Breakdown */}
                <View style={styles.itemsBox}>
                  <Text style={styles.itemsHeaderTitle}>ORDER ITEMS ({itemList.reduce((s, i) => s + (i.quantity || 1), 0)}):</Text>
                  {itemList.map((item, i) => (
                    <View key={i} style={styles.itemRow}>
                      <Text style={styles.itemQty}>{item.quantity || 1}x</Text>
                      <Text style={styles.itemName}>{item.menu_item_name || item.name || 'Item'}</Text>
                      <Text style={styles.itemPrice}>₹{((item.price || 0) * (item.quantity || 1)).toFixed(2)}</Text>
                    </View>
                  ))}

                  {/* Subtotal & Taxes breakdown */}
                  <View style={styles.divider} />
                  {order.subtotal ? (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>Subtotal:</Text>
                      <Text style={styles.summaryValue}>₹{Number(order.subtotal).toFixed(2)}</Text>
                    </View>
                  ) : null}
                  {order.gst ? (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryLabel}>GST Tax:</Text>
                      <Text style={styles.summaryValue}>₹{Number(order.gst).toFixed(2)}</Text>
                    </View>
                  ) : null}
                  <View style={styles.summaryRow}>
                    <Text style={styles.grandTotalLabel}>Grand Total:</Text>
                    <Text style={styles.grandTotalValue}>₹{Number(order.total || 0).toFixed(2)}</Text>
                  </View>
                </View>

                {/* Action Buttons */}
                <View style={styles.actions}>
                  {order.status !== 'completed' && order.status !== 'cancelled' && (
                    <>
                      <TouchableOpacity 
                        style={[styles.actionBtn, { backgroundColor: '#10b981' }]}
                        onPress={() => updateStatus(order.id, 'completed')}
                      >
                        <Text style={styles.actionBtnText}>Complete & Close</Text>
                      </TouchableOpacity>
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
                    </>
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
  restaurantTitle: { fontSize: 20, fontWeight: 'bold', color: '#0ea5e9' },
  subTitle: { fontSize: 12, color: '#94a3b8' },
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
  tabText: { color: '#94a3b8', fontSize: 12, fontWeight: 'bold' },
  tabTextActive: { color: 'white' },
  content: { padding: 16 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { color: '#f8fafc', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  emptySubText: { color: '#64748b', fontSize: 13, textAlign: 'center' },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  tableName: { fontSize: 20, fontWeight: 'bold', color: '#f8fafc' },
  orderType: { color: '#94a3b8', fontSize: 12 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginBottom: 4 },
  badgeText: { color: 'white', fontSize: 10, fontWeight: 'bold' },
  timeElapsedText: { color: '#f59e0b', fontSize: 11, fontWeight: 'bold' },
  metaText: { color: '#64748b', fontSize: 12, marginBottom: 12 },
  paymentAlert: { backgroundColor: '#f59e0b22', borderColor: '#f59e0b66', borderWidth: 1, padding: 12, borderRadius: 8, marginBottom: 12 },
  paymentAlertText: { color: '#fbbf24', fontSize: 13, fontWeight: 'bold', marginBottom: 8 },
  verifyBtn: { backgroundColor: '#f59e0b', paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  verifyBtnText: { color: '#0f172a', fontWeight: 'bold', fontSize: 13 },
  itemsBox: { backgroundColor: '#0f172a', padding: 12, borderRadius: 10, marginBottom: 12 },
  itemsHeaderTitle: { color: '#64748b', fontSize: 10, fontWeight: 'bold', marginBottom: 8 },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  itemQty: { color: '#0ea5e9', fontSize: 14, fontWeight: 'bold', width: 28 },
  itemName: { color: '#f8fafc', fontSize: 14, flex: 1 },
  itemPrice: { color: '#94a3b8', fontSize: 13, fontWeight: 'bold' },
  divider: { height: 1, backgroundColor: '#334155', marginVertical: 8 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  summaryLabel: { color: '#94a3b8', fontSize: 12 },
  summaryValue: { color: '#cbd5e1', fontSize: 12, fontWeight: 'bold' },
  grandTotalLabel: { color: '#f8fafc', fontSize: 14, fontWeight: 'bold' },
  grandTotalValue: { color: '#10b981', fontSize: 16, fontWeight: 'bold' },
  actions: { flexDirection: 'row', gap: 8 },
  actionBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  actionBtnText: { color: 'white', fontWeight: 'bold', fontSize: 13 },
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
