import { getFormattedOrderId } from '../lib/orderUtils';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Platform, Alert, Vibration, ScrollView,
  Modal, TextInput, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { CONFIG } from '../shared/config';
import { startAlarm, stopAlarm, stopAllAlarms } from '../lib/alarmManager';
import { sendLocalNotification, unregisterPushToken } from '../lib/notifications';
import { COLORS, FONTS, RADIUS, SHADOWS, formatCurrency, timeAgo, getStatusColor, getStatusLabel } from '../lib/theme';

import { getAssignedTableIdsForWaiter, fetchTableAssignments, fetchLiveTableStatus } from '../lib/tableAssignments';

const PENDING_ORDERS_STORAGE_KEY = '@smartdine_waiter_pending_orders';

export default function WaiterOrdersScreen({ route }) {
  const navigation = useNavigation();
  const profile = route?.params?.profile ?? {};
  const [restaurantId, setRestaurantId] = useState(
    profile?.restaurant_id || profile?.restaurants?.id || null
  );

  const [assignedTableIds, setAssignedTableIds] = useState([]);
  const [assignedTableNames, setAssignedTableNames] = useState([]);
  const [assignedTablesWithStatus, setAssignedTablesWithStatus] = useState([]);

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

  // Table Management & Transfer Modals
  const [selectedOrderForAction, setSelectedOrderForAction] = useState(null);
  const [allTables, setAllTables] = useState([]);
  const [transferModalVisible, setTransferModalVisible] = useState(false);
  const [guestModalVisible, setGuestModalVisible] = useState(false);
  const [newGuestCount, setNewGuestCount] = useState('2');
  const [actionProcessing, setActionProcessing] = useState(false);

  const knownReadyIds = useRef(new Set());

  // Load table assignments and live status for this waiter
  const loadAssignedTables = useCallback(async () => {
    if (!restaurantId || !profile?.id) return;
    try {
      const [assignments, { tables: liveTbls }] = await Promise.all([
        fetchTableAssignments(restaurantId),
        fetchLiveTableStatus(restaurantId)
      ]);
      setAllTables(liveTbls || []);
      const myAssigns = (assignments || []).filter(a => a.waiter_id === profile.id && a.active !== false);
      const ids = myAssigns.map(a => a.table_id);
      const names = myAssigns.map(a => a.table_name || 'Table');
      setAssignedTableIds(ids);
      setAssignedTableNames(names);

      const myLiveTables = (liveTbls || []).filter(t => ids.includes(t.id));
      setAssignedTablesWithStatus(myLiveTables);
    } catch (e) {
      console.log('[WaiterOrders] loadAssignedTables error:', e?.message);
    }
  }, [restaurantId, profile?.id]);

  useEffect(() => {
    loadAssignedTables();
  }, [loadAssignedTables]);

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
      let allOrders = data || [];

      // Filter by table assignments if assigned
      if (profile?.role === 'waiter' && assignedTableIds.length > 0) {
        allOrders = allOrders.filter(o => !o.table_id || assignedTableIds.includes(o.table_id));
      }

      setOrders(allOrders);

      // Bell for new ready orders scoped to this waiter's tables
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
  }, [restaurantId, assignedTableIds, profile?.role]);

  // Flush pending queue when online
  const flushPendingQueue = useCallback(async () => {
    if (pendingQueue.length === 0) return;
    console.log(`[WaiterOrders] Retrying ${pendingQueue.length} queued offline actions...`);
    const remaining = [];
    for (const item of pendingQueue) {
      try {
        if (item.type === 'mark_served') {
          const now = new Date().toISOString();
          await supabase.from('orders').update({ status: 'served', updated_at: now }).eq('id', item.orderId);
          await supabase.from('order_batches').update({ status: 'served', served_at: now }).eq('order_id', item.orderId).neq('status', 'cancelled');
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
      const now = new Date().toISOString();
      const staffName = profile?.full_name || 'Waiter';

      let apiSuccess = false;
      try {
        const apiRes = await fetch(`${CONFIG.API_BASE_URL}/api/staff/update-order-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderId,
            newStatus: 'served',
            staffName
          })
        }).then(r => r.json());

        if (apiRes && apiRes.success) {
          apiSuccess = true;
        }
      } catch (apiErr) {
        console.log('[WaiterOrders] Backend API update failed, falling back:', apiErr?.message);
      }

      if (!apiSuccess) {
        const { error } = await supabase
          .from('orders')
          .update({ status: 'served', updated_at: now })
          .eq('id', orderId);
        if (error) throw error;
        await supabase
          .from('order_batches')
          .update({ status: 'served', served_at: now, served_by: staffName })
          .eq('order_id', orderId)
          .neq('status', 'cancelled');
      }
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

  const getItemName = (item) => item.menu_item_name || item.name || item.item_name || item.menu_items?.name || 'Item';
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
            <View><Text style={styles.tableName}>{tableName}</Text><Text style={{ fontSize: 11, fontWeight: '700', color: '#64748b' }}>#{getFormattedOrderId(item, profile?.restaurant_name || '')}</Text></View>
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

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <TouchableOpacity
              style={[styles.manageTableBtn]}
              onPress={() => setSelectedOrderForAction(item)}
            >
              <Ionicons name="ellipsis-horizontal" size={16} color="#64748b" />
            </TouchableOpacity>

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
                <Text style={styles.servedBadgeText}>Served</Text>
              </View>
            )}
          </View>
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

        <TouchableOpacity
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' }}
          onPress={async () => {
            stopAllAlarms();
            if (profile?.id) await unregisterPushToken(profile.id);
            await supabase.auth.signOut().catch(() => {});
            navigation.replace('Login');
          }}
        >
          <Ionicons name="log-out-outline" size={18} color="#ef4444" />
        </TouchableOpacity>
      </View>

      {/* My Assigned Tables Section */}
      <View style={styles.assignedSectionWrapper}>
        <View style={styles.assignedHeaderRow}>
          <Text style={styles.assignedSectionHeading}>
            MY ASSIGNED TABLES ({assignedTablesWithStatus.length > 0 ? assignedTablesWithStatus.length : 'All'})
          </Text>
          <Text style={styles.liveSyncLabel}>● Live Status</Text>
        </View>
        {assignedTablesWithStatus.length === 0 ? (
          <View style={styles.unrestrictedBar}>
            <Ionicons name="restaurant-outline" size={14} color="#047857" style={{ marginRight: 6 }} />
            <Text style={styles.unrestrictedText}>No table constraints (Serving all tables)</Text>
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tablesScroll}>
            {assignedTablesWithStatus.map(tbl => {
              const isOcc = tbl.occupancy_status === 'occupied';
              const isInactive = tbl.occupancy_status === 'inactive';
              const statusBg = isInactive ? '#f1f5f9' : isOcc ? '#fee2e2' : '#dcfce7';
              const statusColor = isInactive ? '#64748b' : isOcc ? '#dc2626' : '#16a34a';
              const statusLabel = isInactive ? 'Inactive' : isOcc ? 'Occupied' : 'Available';

              return (
                <View key={tbl.id} style={[styles.assignedTableCard, isOcc && styles.assignedTableCardOccupied]}>
                  <View style={styles.tableCardTop}>
                    <Text style={styles.assignedCardTitle}>{tbl.name}</Text>
                    <View style={[styles.miniStatusBadge, { backgroundColor: statusBg }]}>
                      <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
                      <Text style={[styles.miniStatusText, { color: statusColor }]}>{statusLabel}</Text>
                    </View>
                  </View>

                  <View style={styles.tableCardDetails}>
                    <Text style={styles.tableDetailText}>
                      {tbl.active_order_count > 0 ? `📦 ${tbl.active_order_count} active orders` : 'No active orders'}
                    </Text>
                    {tbl.payment_pending && (
                      <View style={styles.payPendingBadge}>
                        <Ionicons name="time-outline" size={11} color="#b45309" />
                        <Text style={styles.payPendingText}>Pay Pending</Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
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
      {/* Table Actions Modal */}
      <Modal
        visible={Boolean(selectedOrderForAction) && !transferModalVisible && !guestModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedOrderForAction(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.actionModalCard}>
            <View style={styles.actionModalHeader}>
              <Text style={styles.actionModalTitle}>
                {selectedOrderForAction?.table_name || 'Takeaway'} Actions
              </Text>
              <TouchableOpacity onPress={() => setSelectedOrderForAction(null)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.actionItemRow}
              onPress={() => setTransferModalVisible(true)}
            >
              <View style={[styles.actionIconBg, { backgroundColor: '#eff6ff' }]}>
                <Ionicons name="swap-horizontal" size={20} color="#2563eb" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.actionItemTitle}>Transfer Table</Text>
                <Text style={styles.actionItemSub}>Move this order to another dining table</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionItemRow}
              onPress={() => {
                setNewGuestCount(String(selectedOrderForAction?.guest_count || '2'));
                setGuestModalVisible(true);
              }}
            >
              <View style={[styles.actionIconBg, { backgroundColor: '#f0fdf4' }]}>
                <Ionicons name="people-outline" size={20} color="#16a34a" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.actionItemTitle}>Update Guest Count</Text>
                <Text style={styles.actionItemSub}>Current: {selectedOrderForAction?.guest_count || 'Not set'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.actionItemRow}
              onPress={() => {
                const targetTable = allTables.find(t => t.id === selectedOrderForAction?.table_id);
                setSelectedOrderForAction(null);
                navigation.navigate('Punch', { profile, initialTable: targetTable });
              }}
            >
              <View style={[styles.actionIconBg, { backgroundColor: '#fdf4ff' }]}>
                <Ionicons name="add-circle-outline" size={20} color="#c026d3" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.actionItemTitle}>Modify / Add Items</Text>
                <Text style={styles.actionItemSub}>Punch additional items for this table</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Transfer Table Modal */}
      <Modal
        visible={transferModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setTransferModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.actionModalCard, { maxHeight: '80%' }]}>
            <View style={styles.actionModalHeader}>
              <Text style={styles.actionModalTitle}>Select Target Table</Text>
              <TouchableOpacity onPress={() => setTransferModalVisible(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>
            <Text style={styles.transferSub}>
              Move order from {selectedOrderForAction?.table_name} to:
            </Text>

            <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
              {allTables
                .filter(t => t.id !== selectedOrderForAction?.table_id)
                .map(tbl => (
                  <TouchableOpacity
                    key={tbl.id}
                    style={styles.targetTableItem}
                    disabled={actionProcessing}
                    onPress={async () => {
                      setActionProcessing(true);
                      try {
                        await supabase
                          .from('orders')
                          .update({ table_id: tbl.id, table_name: tbl.name, updated_at: new Date().toISOString() })
                          .eq('id', selectedOrderForAction.id);
                        Alert.alert('Transferred! 🎉', `Order transferred to ${tbl.name}`);
                        setTransferModalVisible(false);
                        setSelectedOrderForAction(null);
                        await loadOrders();
                        await loadAssignedTables();
                      } catch (e) {
                        Alert.alert('Transfer Error', e?.message || 'Could not transfer table');
                      } finally {
                        setActionProcessing(false);
                      }
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Ionicons name="restaurant-outline" size={18} color="#0f172a" style={{ marginRight: 8 }} />
                      <Text style={styles.targetTableName}>{tbl.name}</Text>
                    </View>
                    <Text style={styles.targetTableSelectText}>Select</Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Guest Count Modal */}
      <Modal
        visible={guestModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setGuestModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.actionModalCard}>
            <View style={styles.actionModalHeader}>
              <Text style={styles.actionModalTitle}>Update Guest Count</Text>
              <TouchableOpacity onPress={() => setGuestModalVisible(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.guestCountInput}
              keyboardType="number-pad"
              maxLength={2}
              value={newGuestCount}
              onChangeText={setNewGuestCount}
              placeholder="e.g. 4"
            />

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <TouchableOpacity onPress={() => setGuestModalVisible(false)} style={styles.cancelBtn}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveBtn}
                disabled={actionProcessing}
                onPress={async () => {
                  const cnt = parseInt(newGuestCount, 10);
                  if (isNaN(cnt) || cnt < 1) {
                    Alert.alert('Validation', 'Please enter a valid guest count (1-50)');
                    return;
                  }
                  setActionProcessing(true);
                  try {
                    await supabase.from('orders').update({ guest_count: cnt }).eq('id', selectedOrderForAction.id);
                    Alert.alert('Updated', `Guest count set to ${cnt}`);
                    setGuestModalVisible(false);
                    setSelectedOrderForAction(null);
                    await loadOrders();
                  } catch (e) {
                    Alert.alert('Error', e?.message || 'Could not update guest count');
                  } finally {
                    setActionProcessing(false);
                  }
                }}
              >
                {actionProcessing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  assignedSectionWrapper: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  assignedHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  assignedSectionHeading: {
    fontSize: 10,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.5,
  },
  liveSyncLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#16a34a',
  },
  unrestrictedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  unrestrictedText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#065f46',
  },
  tablesScroll: {
    gap: 8,
    paddingVertical: 2,
  },
  assignedTableCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    minWidth: 140,
  },
  assignedTableCardOccupied: {
    backgroundColor: '#fff1f2',
    borderColor: '#fecdd3',
  },
  tableCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  assignedCardTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  miniStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 4,
  },
  miniStatusText: {
    fontSize: 9,
    fontWeight: '700',
  },
  tableCardDetails: {
    gap: 3,
  },
  tableDetailText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  payPendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 5,
    paddingVertical: 2,
    backgroundColor: '#fef3c7',
    borderRadius: 4,
    gap: 2,
    alignSelf: 'flex-start',
  },
  payPendingText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#b45309',
  },
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
  manageTableBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  actionModalCard: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '85%',
  },
  actionModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  actionModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  actionItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  actionIconBg: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionItemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  actionItemSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  transferSub: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 12,
  },
  targetTableItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 8,
  },
  targetTableName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  targetTableSelectText: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  guestCountInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  saveBtn: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 10,
  },
  saveBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
  },
});

