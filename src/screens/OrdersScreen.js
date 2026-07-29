import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Vibration, Modal, TextInput } from 'react-native';
import { supabase } from '../lib/supabase';
import { sendSystemAlert, registerPushToken } from '../lib/notifications';
import { getFormattedOrderId } from '../lib/orderUtils';
import { startAlarm, stopAlarm } from '../lib/alarmManager';
import { checkAndPromptBatteryOptimization } from '../lib/batteryManager';

export default function OrdersScreen({ route }) {
  const profile = route?.params?.profile || {};
  const restaurantId = profile?.restaurant_id || null;

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
      registerPushToken(profile.id).catch(() => {});
    }
    checkAndPromptBatteryOptimization().catch(() => {});
    fetchRestaurantName();
    fetchOrders();

    // 1. WebSocket Realtime Subscription
    let channel;
    if (restaurantId) {
      try {
        channel = supabase
          .channel(`live-orders-${restaurantId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
            (payload) => {
              if (payload?.eventType === 'INSERT') {
                Vibration.vibrate([0, 1000, 500, 1000]);
                startAlarm(
                  'new_order',
                  '🛒 NEW CUSTOMER ORDER!',
                  `Table ${payload.new?.table_name || 'N/A'} • Total: ₹${payload.new?.total || 0}`
                );
                sendSystemAlert(
                  'NEW CUSTOMER ORDER!',
                  `Table ${payload.new?.table_name || 'N/A'} • Total: ₹${payload.new?.total || 0}`
                );
              }
              fetchOrders();
            }
          )
          .subscribe();
      } catch (e) {
        console.log('Realtime subscribe error:', e);
      }
    }

    // 2. High-Frequency 3-Second Polling
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
      if (!error && Array.isArray(data)) {
        if (isBackgroundPoll) {
          data.forEach(ord => {
            if (ord?.id && !knownOrderIdsRef.current.has(ord.id)) {
              knownOrderIdsRef.current.add(ord.id);
              if (ord.status === 'new') {
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
          data.forEach(ord => { if (ord?.id) knownOrderIdsRef.current.add(ord.id); });
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
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (!error) {
        if (['accepted', 'preparing', 'completed', 'served'].includes(status)) {
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
      const cancellerName = profile?.full_name || profile?.role || 'Staff';
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          cancelled_by: cancellerName,
          cancellation_reason: cancellationReason || 'Cancelled by staff',
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

  const updatePaymentStatus = async (id, paymentStatus) => {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ payment_status: paymentStatus, updated_at: new Date().toISOString() })
        .eq('id', id);

      if (!error) {
        fetchOrders();
      } else {
        Alert.alert('Error', error.message);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to update payment status');
    }
  };

  const safeOrders = orders || [];
  const activeOrders = safeOrders.filter(o => ['new', 'accepted', 'preparing', 'ready', 'served'].includes(o?.status));
  const completedOrders = safeOrders.filter(o => ['completed', 'cancelled'].includes(o?.status));

  const displayedOrders = 
    activeTab === 'active' ? activeOrders :
    activeTab === 'completed' ? completedOrders : safeOrders;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{restaurantName}</Text>
          <Text style={styles.subtitle}>Owner & Management Portal</Text>
        </View>

        {isAlarmActive() && (
          <TouchableOpacity onPress={() => stopAlarm()} style={styles.stopAlarmBtn}>
            <Text style={styles.stopAlarmText}>🔕 STOP ALARM</Text>
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
            Active ({activeOrders.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'completed' && styles.activeTab]}
          onPress={() => setActiveTab('completed')}
        >
          <Text style={[styles.tabText, activeTab === 'completed' && styles.activeTabText]}>
            History ({completedOrders.length})
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
          <Text style={styles.loadingText}>Loading live orders...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {displayedOrders.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No orders found in this section.</Text>
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

                  {/* Cancellation Details Banner */}
                  {order.status === 'cancelled' && (
                    <View style={styles.cancelledBanner}>
                      <Text style={styles.cancelledTitle}>🚫 Order Cancelled</Text>
                      {order.cancelled_by ? <Text style={styles.cancelledSub}>• Cancelled By: {order.cancelled_by}</Text> : null}
                      {order.cancellation_reason ? <Text style={styles.cancelledSub}>• Reason: "{order.cancellation_reason}"</Text> : null}
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

                  {/* Detailed Items Breakdown */}
                  <View style={styles.itemsBox}>
                    <Text style={styles.itemsHeaderTitle}>ORDER ITEMS ({itemList.reduce((s, i) => s + (i?.quantity || 1), 0)}):</Text>
                    {itemList.map((item, i) => (
                      <View key={i} style={styles.itemRow}>
                        <Text style={styles.itemQty}>{item?.quantity || 1}x</Text>
                        <Text style={styles.itemName}>{item?.menu_item_name || item?.name || 'Item'}</Text>
                        <Text style={styles.itemPrice}>₹{((item?.price || 0) * (item?.quantity || 1)).toFixed(2)}</Text>
                      </View>
                    ))}

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
      )}

      {/* Cancellation Modal */}
      <Modal visible={cancelModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Reason for Order Cancellation</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="e.g., Item Out of Stock / Customer Changed Mind"
              placeholderTextColor="#64748b"
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
    case 'completed': return '#475569';
    case 'cancelled': return '#991b1b';
    default: return '#64748b';
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a', paddingTop: 50 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  title: { fontSize: 20, fontWeight: 'bold', color: '#f8fafc' },
  subtitle: { fontSize: 12, color: '#94a3b8' },
  stopAlarmBtn: { backgroundColor: '#ef4444', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  stopAlarmText: { color: 'white', fontWeight: 'bold', fontSize: 12 },
  tabsContainer: { flexDirection: 'row', backgroundColor: '#1e293b', margin: 12, borderRadius: 8, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 6 },
  activeTab: { backgroundColor: '#0ea5e9' },
  tabText: { color: '#94a3b8', fontWeight: 'bold', fontSize: 13 },
  activeTabText: { color: 'white' },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#94a3b8', marginTop: 12 },
  scrollContent: { padding: 12 },
  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#64748b', fontSize: 15 },
  orderCard: { backgroundColor: '#1e293b', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#334155' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tableName: { fontSize: 18, fontWeight: 'bold', color: '#f8fafc' },
  takeawayBadge: { backgroundColor: '#8b5cf6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginLeft: 8 },
  takeawayText: { color: 'white', fontSize: 10, fontWeight: 'bold' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  metaText: { color: '#94a3b8', fontSize: 12, marginVertical: 4 },
  cancelledBanner: { backgroundColor: 'rgba(239, 68, 68, 0.1)', borderColor: '#ef4444', borderWidth: 1, borderRadius: 8, padding: 8, marginVertical: 6 },
  cancelledTitle: { color: '#ef4444', fontWeight: 'bold', fontSize: 12 },
  cancelledSub: { color: '#94a3b8', fontSize: 11, marginTop: 2 },
  paymentAlert: { backgroundColor: 'rgba(245, 158, 11, 0.15)', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 8, padding: 10, marginVertical: 6 },
  paymentAlertText: { color: '#fbbf24', fontWeight: 'bold', fontSize: 12, marginBottom: 6 },
  verifyBtn: { backgroundColor: '#f59e0b', padding: 8, borderRadius: 6, alignItems: 'center' },
  verifyBtnText: { color: '#0f172a', fontWeight: 'bold', fontSize: 12 },
  itemsBox: { backgroundColor: '#0f172a', borderRadius: 8, padding: 10, marginTop: 8 },
  itemsHeaderTitle: { color: '#64748b', fontSize: 11, fontWeight: 'bold', marginBottom: 6 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 2 },
  itemQty: { color: '#0ea5e9', fontWeight: 'bold', width: 28 },
  itemName: { color: '#f8fafc', flex: 1 },
  itemPrice: { color: '#94a3b8' },
  divider: { height: 1, backgroundColor: '#1e293b', marginVertical: 6 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 2 },
  summaryLabel: { color: '#64748b', fontSize: 12 },
  summaryValue: { color: '#94a3b8', fontSize: 12 },
  grandTotalLabel: { color: '#f8fafc', fontWeight: 'bold', fontSize: 14 },
  grandTotalValue: { color: '#10b981', fontWeight: 'bold', fontSize: 16 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: { flex: 1, padding: 10, borderRadius: 8, alignItems: 'center' },
  actionBtnText: { color: 'white', fontWeight: 'bold', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 20 },
  modalBox: { backgroundColor: '#1e293b', borderRadius: 12, padding: 20, borderWidth: 1, borderColor: '#334155' },
  modalTitle: { color: '#f8fafc', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  modalInput: { backgroundColor: '#0f172a', color: '#f8fafc', borderWidth: 1, borderColor: '#334155', borderRadius: 8, padding: 12, marginBottom: 16 },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#334155', alignItems: 'center' },
  modalCancelText: { color: '#94a3b8', fontWeight: 'bold' },
  modalConfirmBtn: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#ef4444', alignItems: 'center' },
  modalConfirmText: { color: 'white', fontWeight: 'bold' },
});
