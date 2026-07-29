import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Modal, TextInput } from 'react-native';
import { supabase } from '../lib/supabase';
import { sendSystemAlert, registerPushToken } from '../lib/notifications';
import { getFormattedOrderId } from '../lib/orderUtils';
import { startAlarm, stopAlarm, isAlarmActive } from '../lib/alarmManager';

// Helper to consolidate items into NEW items to prepare vs PREVIOUSLY SERVED items
function consolidateItems(itemList = [], orderStatus = '') {
  try {
    if (!Array.isArray(itemList) || itemList.length === 0) {
      return { newItems: [], servedItems: [] };
    }

    const newMap = new Map();
    const servedMap = new Map();

    let latestTime = 0;
    itemList.forEach(item => {
      if (item?.created_at) {
        const t = new Date(item.created_at).getTime();
        if (!isNaN(t) && t > latestTime) latestTime = t;
      }
    });

    itemList.forEach(item => {
      if (!item) return;
      const name = String(item.menu_item_name || item.name || 'Item');
      const qty = Number(item.quantity) || 1;
      const price = Number(item.price) || 0;

      const itemTime = item.created_at ? new Date(item.created_at).getTime() : 0;
      const isOlderBatch = (latestTime > 0 && itemTime > 0 && (latestTime - itemTime > 3000));
      const isItemServed = Boolean(item.is_served || item.is_prepared || item.status === 'served' || item.status === 'ready' || isOlderBatch);

      if (isItemServed) {
        if (servedMap.has(name)) {
          servedMap.get(name).quantity += qty;
        } else {
          servedMap.set(name, { name, quantity: qty, price, isServed: true });
        }
      } else {
        if (newMap.has(name)) {
          newMap.get(name).quantity += qty;
        } else {
          newMap.set(name, { name, quantity: qty, price, isServed: false });
        }
      }
    });

    return {
      newItems: Array.from(newMap.values()),
      servedItems: Array.from(servedMap.values()),
    };
  } catch (e) {
    console.log('Error consolidating items:', e);
    return { newItems: [], servedItems: [] };
  }
}

// Calculate grand total excluding cancelled orders / items
function getCalculatedOrderTotal(order, newItems = [], servedItems = []) {
  if (!order || order.status === 'cancelled') return 0;

  let total = 0;

  // Always sum served items
  servedItems.forEach(item => {
    total += (Number(item.price) || 0) * (Number(item.quantity) || 1);
  });

  // Only sum new items if order is not cancelled
  if (!['cancelled', 'rejected'].includes(order.status)) {
    newItems.forEach(item => {
      total += (Number(item.price) || 0) * (Number(item.quantity) || 1);
    });
  }

  // Fallback to order.total if calculated total is 0
  return total > 0 ? total : Number(order.total || 0);
}

const PRESET_CANCEL_REASONS = [
  'Item Out of Stock',
  'Kitchen Busy / Overflow',
  'Customer Cancelled',
  'Closing Soon',
  'Incorrect Order',
];

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
              try {
                if (payload?.eventType === 'INSERT') {
                  startAlarm(
                    'new_order',
                    'NEW CUSTOMER ORDER',
                    `Table ${payload.new?.table_name || 'N/A'} - Total: ₹${payload.new?.total || 0}`
                  ).catch(() => {});
                  sendSystemAlert(
                    'NEW CUSTOMER ORDER',
                    `Table ${payload.new?.table_name || 'N/A'} - Total: ₹${payload.new?.total || 0}`
                  ).catch(() => {});
                }
              } catch (_) {}
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
        try { supabase.removeChannel(channel); } catch (_) {}
      }
      if (interval) clearInterval(interval);
      try { stopAlarm(); } catch (_) {}
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
                  'NEW CUSTOMER ORDER',
                  `Table ${ord.table_name || 'N/A'} - Total: ₹${ord.total || 0}`
                ).catch(() => {});
                sendSystemAlert(
                  'NEW CUSTOMER ORDER',
                  `Table ${ord.table_name || 'N/A'} - Total: ₹${ord.total || 0}`
                ).catch(() => {});
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
        if (status === 'ready' || status === 'served' || status === 'completed') {
          try {
            await supabase
              .from('order_items')
              .update({ is_served: true, status: 'served' })
              .eq('order_id', id);
          } catch (_) {}
        }

        if (['accepted', 'preparing', 'completed', 'served'].includes(status)) {
          stopAlarm().catch(() => {});
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
        stopAlarm().catch(() => {});
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
          <TouchableOpacity onPress={() => stopAlarm().catch(() => {})} style={styles.stopAlarmBtn}>
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
              if (!order || !order.id) return null;

              let newItems = [];
              let servedItems = [];
              let newCount = 0;
              let servedCount = 0;
              let grandTotal = 0;

              try {
                const res = consolidateItems(order.order_items || [], order.status);
                newItems = res.newItems || [];
                servedItems = res.servedItems || [];
                newCount = newItems.reduce((s, i) => s + i.quantity, 0);
                servedCount = servedItems.reduce((s, i) => s + i.quantity, 0);
                grandTotal = getCalculatedOrderTotal(order, newItems, servedItems);
              } catch (_) {}

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
                      <Text style={styles.cancelledTitle}>Order Cancelled</Text>
                      {order.cancelled_by ? <Text style={styles.cancelledSub}>• Cancelled By: {order.cancelled_by}</Text> : null}
                      {order.cancellation_reason ? <Text style={styles.cancelledSub}>• Reason: "{order.cancellation_reason}"</Text> : null}
                    </View>
                  )}

                  {/* Payment Verification Banner */}
                  {order.payment_status === 'customer_marked_paid' && order.status !== 'cancelled' && (
                    <View style={styles.paymentAlert}>
                      <Text style={styles.paymentAlertText}>Customer marked payment as complete!</Text>
                      <TouchableOpacity 
                        style={styles.verifyBtn}
                        onPress={() => updatePaymentStatus(order.id, 'paid')}
                      >
                        <Text style={styles.verifyBtnText}>Verify & Confirm Paid</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Items Breakdown Box */}
                  <View style={styles.itemsBox}>
                    {/* 1. TOP SECTION: NEW ITEMS TO PREPARE */}
                    {newItems.length > 0 ? (
                      <View style={{ marginBottom: servedItems.length > 0 ? 10 : 0 }}>
                        <View style={styles.newHeaderRow}>
                          <Text style={styles.itemsHeaderTitle}>ITEMS TO PREPARE ({newCount}):</Text>
                          <View style={styles.newTagBadge}>
                            <Text style={styles.newTagText}>NEW ITEMS</Text>
                          </View>
                        </View>

                        {newItems.map((item, i) => (
                          <View key={`new_${i}`} style={styles.itemRow}>
                            <Text style={styles.itemQty}>{item.quantity}x</Text>
                            <Text style={styles.itemName}>{item.name}</Text>
                            <Text style={styles.itemPrice}>₹{(item.price * item.quantity).toFixed(2)}</Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.itemsHeaderTitle}>ALL ITEMS PREPARED ({servedCount}):</Text>
                    )}

                    {/* 2. BOTTOM SECTION: PREVIOUSLY SERVED ITEMS */}
                    {servedItems.length > 0 && (
                      <View style={styles.servedSection}>
                        <Text style={styles.servedHeaderTitle}>PREVIOUSLY SERVED ({servedCount}):</Text>
                        {servedItems.map((item, i) => (
                          <View key={`served_${i}`} style={styles.itemRowServed}>
                            <Text style={styles.itemQtyServed}>{item.quantity}x</Text>
                            <Text style={styles.itemNameServed}>{item.name}</Text>
                            <View style={styles.servedCheckBadge}>
                              <Text style={styles.servedCheckText}>✓ Served</Text>
                            </View>
                            <Text style={styles.itemPriceServed}>₹{(item.price * item.quantity).toFixed(2)}</Text>
                          </View>
                        ))}
                      </View>
                    )}

                    <View style={styles.divider} />
                    <View style={styles.summaryRow}>
                      <Text style={styles.grandTotalLabel}>Grand Total (Served Items):</Text>
                      <Text style={styles.grandTotalValue}>₹{grandTotal.toFixed(2)}</Text>
                    </View>
                  </View>

                  {/* Action Buttons */}
                  <View style={styles.actions}>
                    {/* NEW ORDER FLOW: Only Accept and Reject */}
                    {order.status === 'new' && (
                      <>
                        <TouchableOpacity 
                          style={[styles.actionBtn, { backgroundColor: '#059669' }]}
                          onPress={() => updateStatus(order.id, 'accepted')}
                        >
                          <Text style={styles.actionBtnText}>Accept Order</Text>
                        </TouchableOpacity>
                        <TouchableOpacity 
                          style={[styles.actionBtn, { backgroundColor: '#ef4444' }]}
                          onPress={() => {
                            setCancellingOrderId(order.id);
                            setCancellationReason('');
                            setCancelModalVisible(true);
                          }}
                        >
                          <Text style={styles.actionBtnText}>Reject</Text>
                        </TouchableOpacity>
                      </>
                    )}

                    {/* ACCEPTED FLOW: Only Start Preparing and Cancel */}
                    {order.status === 'accepted' && (
                      <>
                        <TouchableOpacity 
                          style={[styles.actionBtn, { backgroundColor: '#3b82f6' }]}
                          onPress={() => updateStatus(order.id, 'preparing')}
                        >
                          <Text style={styles.actionBtnText}>Start Preparing</Text>
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

                    {/* PREPARING FLOW: Only Complete & Close and Cancel */}
                    {order.status === 'preparing' && (
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

                    {/* READY, SERVED: Only Complete button, NO Cancel */}
                    {(order.status === 'ready' || order.status === 'served') && (
                      <TouchableOpacity 
                        style={[styles.actionBtn, { backgroundColor: '#10b981' }]}
                        onPress={() => updateStatus(order.id, 'completed')}
                      >
                        <Text style={styles.actionBtnText}>Complete & Close</Text>
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
            <Text style={styles.modalTitle}>Select Cancellation Reason</Text>
            
            <Text style={styles.presetLabel}>QUICK REASONS:</Text>
            <View style={styles.presetContainer}>
              {PRESET_CANCEL_REASONS.map((preset, idx) => (
                <TouchableOpacity
                  key={idx}
                  style={[
                    styles.presetChip,
                    cancellationReason === preset && styles.presetChipActive
                  ]}
                  onPress={() => setCancellationReason(preset)}
                >
                  <Text style={[
                    styles.presetChipText,
                    cancellationReason === preset && styles.presetChipTextActive
                  ]}>
                    {preset}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={styles.modalInput}
              placeholder="Or type custom reason..."
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
  tabText: { color: '#64748b', fontWeight: 'bold', fontSize: 13 },
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
  paymentAlert: { backgroundColor: '#fffbeb', borderColor: '#fde68a', borderWidth: 1, borderRadius: 8, padding: 10, marginVertical: 6 },
  paymentAlertText: { color: '#d97706', fontWeight: 'bold', fontSize: 12, marginBottom: 6 },
  verifyBtn: { backgroundColor: '#f59e0b', padding: 8, borderRadius: 6, alignItems: 'center' },
  verifyBtnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 12 },
  itemsBox: { backgroundColor: '#f8fafc', borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 1, borderColor: '#f1f5f9' },
  newHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  itemsHeaderTitle: { color: '#0f172a', fontSize: 12, fontWeight: 'bold' },
  newTagBadge: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#10b981', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  newTagText: { color: '#059669', fontSize: 10, fontWeight: 'bold' },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  itemQty: { color: '#059669', fontWeight: 'bold', width: 32 },
  itemName: { color: '#0f172a', flex: 1, fontWeight: 'bold' },
  itemPrice: { color: '#0f172a', fontWeight: 'bold' },
  servedSection: { borderTopWidth: 1, borderTopColor: '#cbd5e1', paddingTop: 8, marginTop: 6 },
  servedHeaderTitle: { color: '#64748b', fontSize: 11, fontWeight: 'bold', marginBottom: 4 },
  itemRowServed: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  itemQtyServed: { color: '#64748b', fontWeight: 'bold', width: 32 },
  itemNameServed: { color: '#64748b', flex: 1 },
  servedCheckBadge: { backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginRight: 8 },
  servedCheckText: { color: '#64748b', fontSize: 10, fontWeight: 'bold' },
  itemPriceServed: { color: '#64748b' },
  divider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 6 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginVertical: 2 },
  summaryLabel: { color: '#64748b', fontSize: 12 },
  summaryValue: { color: '#475569', fontSize: 12 },
  grandTotalLabel: { color: '#0f172a', fontWeight: 'bold', fontSize: 14 },
  grandTotalValue: { color: '#10b981', fontWeight: 'bold', fontSize: 16 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  actionBtn: { flex: 1, padding: 10, borderRadius: 8, alignItems: 'center' },
  actionBtnText: { color: 'white', fontWeight: 'bold', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 20 },
  modalBox: { backgroundColor: '#ffffff', borderRadius: 12, padding: 20, borderWidth: 1, borderColor: '#e2e8f0' },
  modalTitle: { color: '#0f172a', fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  presetLabel: { color: '#64748b', fontSize: 10, fontWeight: 'bold', marginBottom: 6 },
  presetContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  presetChip: { backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#cbd5e1', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  presetChipActive: { backgroundColor: '#ef4444', borderColor: '#ef4444' },
  presetChipText: { color: '#475569', fontSize: 12, fontWeight: '500' },
  presetChipTextActive: { color: 'white', fontWeight: 'bold' },
  modalInput: { backgroundColor: '#f8fafc', color: '#0f172a', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, padding: 12, marginBottom: 16 },
  modalActions: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#e2e8f0', alignItems: 'center' },
  modalCancelText: { color: '#475569', fontWeight: 'bold' },
  modalConfirmBtn: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#ef4444', alignItems: 'center' },
  modalConfirmText: { color: 'white', fontWeight: 'bold' },
});
