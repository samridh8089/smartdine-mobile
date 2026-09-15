import { getFormattedOrderId } from '../lib/orderUtils';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Platform, Alert,
  Modal, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { COLORS, FONTS, RADIUS, SHADOWS, formatCurrency, timeAgo, getStatusColor, getStatusLabel } from '../lib/theme';

export default function CashierScreen({ route }) {
  const profile = route?.params?.profile ?? {};
  const restaurantId = profile?.restaurant_id;

  const [tab, setTab] = useState('all'); // 'all' | 'unpaid' | 'marked' | 'paid'
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState({});

  // Bill & Settle / Split Bill Modal
  const [selectedOrderForBill, setSelectedOrderForBill] = useState(null);
  const [splitGuests, setSplitGuests] = useState(2);
  const [isSplitting, setIsSplitting] = useState(false);
  const [paymentMode, setPaymentMode] = useState('cash'); // 'cash' | 'upi' | 'card'
  const [settling, setSettling] = useState(false);

  const loadOrders = useCallback(async () => {
    if (!restaurantId) { setLoading(false); return; }
    try {
      const { data } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('restaurant_id', restaurantId)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(100);

      setOrders(data || []);
    } catch (e) {
      console.log('Cashier load error:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    loadOrders();

    if (!restaurantId) return;
    const sub = supabase.channel('cashier-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` }, loadOrders)
      .subscribe();

    const timer = setInterval(loadOrders, 8000);
    return () => { clearInterval(timer); supabase.removeChannel(sub); };
  }, [restaurantId, loadOrders]);

  const billDetails = useMemo(() => {
    if (!selectedOrderForBill) return null;
    const total = Number(selectedOrderForBill.total) || 0;
    const subtotal = Number(selectedOrderForBill.subtotal) || (total > 0 ? total / 1.05 : 0);
    const totalTax = Number(selectedOrderForBill.tax) || (total - subtotal);
    const cgst = Number((totalTax / 2).toFixed(2));
    const sgst = Number((totalTax / 2).toFixed(2));
    const roundOff = Number((Math.round(total) - total).toFixed(2));
    const grandTotal = Math.round(total);

    const splitPortions = [];
    const basePortion = Math.floor(grandTotal / splitGuests);
    const remainder = Math.round(grandTotal - basePortion * splitGuests);
    for (let i = 0; i < splitGuests; i++) {
      splitPortions.push({
        guest: i + 1,
        amount: i < remainder ? basePortion + 1 : basePortion,
      });
    }

    return {
      subtotal: Math.round(subtotal),
      cgst,
      sgst,
      totalTax: Math.round(totalTax),
      roundOff,
      grandTotal,
      splitPortions,
    };
  }, [selectedOrderForBill, splitGuests]);

  async function verifyPayment(orderId) {
    setActionLoading(p => ({ ...p, [orderId]: true }));
    try {
      const { error } = await supabase
        .from('orders')
        .update({ payment_status: 'paid' })
        .eq('id', orderId);
      if (error) throw error;
      await loadOrders();
    } catch (e) {
      Alert.alert('Error', e.message || 'Payment verification failed');
    } finally {
      setActionLoading(p => ({ ...p, [orderId]: false }));
    }
  }

  async function completeOrder(orderId) {
    setActionLoading(p => ({ ...p, [orderId]: true }));
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'completed', payment_status: 'paid' })
        .eq('id', orderId);
      if (error) throw error;

      await supabase
        .from('order_batches')
        .update({ status: 'completed' })
        .eq('order_id', orderId);

      await loadOrders();
    } catch (e) {
      Alert.alert('Error', e.message || 'Could not complete order');
    } finally {
      setActionLoading(p => ({ ...p, [orderId]: false }));
    }
  }

  async function handleSettleOrder(orderId, mode = 'cash') {
    setSettling(true);
    try {
      const now = new Date().toISOString();
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'completed',
          payment_status: 'paid',
          payment_method: mode,
          updated_at: now,
        })
        .eq('id', orderId);
      if (error) throw error;

      await supabase
        .from('order_batches')
        .update({ status: 'completed' })
        .eq('order_id', orderId)
        .neq('status', 'cancelled');

      Alert.alert('Payment Settled 🎉', `Order #${orderId.slice(0, 6)} settled successfully via ${mode.toUpperCase()}. Receipt ready.`);
      setSelectedOrderForBill(null);
      setIsSplitting(false);
      await loadOrders();
    } catch (e) {
      Alert.alert('Settlement Failed', e?.message || 'Could not complete settlement.');
    } finally {
      setSettling(false);
    }
  }

  const getItemName = (item) => item.menu_item_name || item.name || item.item_name || item.menu_items?.name || 'Item';
  const getItemsSummaryText = (items) => {
    if (!items || !items.length) return 'No items';
    return items.map(i => `${getItemName(i)} x${i.quantity || 1}`).join(', ');
  };

  const markedCount = orders.filter(o => o.payment_status === 'customer_marked_paid').length;
  const unpaidCount = orders.filter(o => o.payment_status === 'pending').length;

  const filteredOrders = orders.filter(o => {
    if (tab === 'unpaid') return o.payment_status === 'pending';
    if (tab === 'marked') return o.payment_status === 'customer_marked_paid';
    if (tab === 'paid') return o.payment_status === 'paid';
    return true;
  });

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Cashier Panel</Text>
          <Text style={styles.subtitle}>Billing, GST & Split Payment settlements</Text>
        </View>

        {markedCount > 0 && (
          <View style={styles.alertBadge}>
            <Ionicons name="alert-circle" size={14} color="#fff" style={{ marginRight: 4 }} />
            <Text style={styles.alertBadgeText}>{markedCount} to verify</Text>
          </View>
        )}
      </View>

      {/* Filter Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity style={[styles.tabBtn, tab === 'all' && styles.tabBtnActive]} onPress={() => setTab('all')}>
          <Text style={[styles.tabText, tab === 'all' && styles.tabTextActive]}>All ({orders.length})</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tabBtn, tab === 'unpaid' && styles.tabBtnActive]} onPress={() => setTab('unpaid')}>
          <Text style={[styles.tabText, tab === 'unpaid' && styles.tabTextActive]}>Unpaid ({unpaidCount})</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tabBtn, tab === 'marked' && styles.tabBtnActive]} onPress={() => setTab('marked')}>
          <Text style={[styles.tabText, tab === 'marked' && styles.tabTextActive]}>To Verify ({markedCount})</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tabBtn, tab === 'paid' && styles.tabBtnActive]} onPress={() => setTab('paid')}>
          <Text style={[styles.tabText, tab === 'paid' && styles.tabTextActive]}>Paid</Text>
        </TouchableOpacity>
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
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadOrders(); }} />
          }
          renderItem={({ item }) => {
            const isBusy = actionLoading[item.id];
            const statusColor = getStatusColor(item.status);
            const tableName = item.table_name || (item.order_type === 'takeaway' ? 'Takeaway' : `Table ${item.table_id || ''}`);
            const items = item.order_items || [];

            return (
              <TouchableOpacity
                style={styles.orderCard}
                activeOpacity={0.85}
                onPress={() => setSelectedOrderForBill(item)}
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

                  <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
                    <Text style={[styles.statusBadgeText, { color: statusColor }]}>{getStatusLabel(item.status)}</Text>
                  </View>
                </View>

                <Text style={styles.itemsSummary} numberOfLines={2}>{getItemsSummaryText(items)}</Text>

                <View style={styles.cardFooter}>
                  <View>
                    <Text style={styles.timeAgo}>{timeAgo(item.created_at)}</Text>
                    <Text style={styles.totalText}>{formatCurrency(item.total || 0)}</Text>
                  </View>

                  {/* Payment Status & Actions */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: '#0284c7' }]}
                      onPress={() => setSelectedOrderForBill(item)}
                    >
                      <Ionicons name="receipt-outline" size={15} color="#fff" style={{ marginRight: 4 }} />
                      <Text style={styles.actionBtnText}>Bill & Settle</Text>
                    </TouchableOpacity>

                    {item.payment_status === 'customer_marked_paid' && (
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: '#f59e0b' }]}
                        disabled={isBusy}
                        onPress={() => verifyPayment(item.id)}
                      >
                        <Ionicons name="checkmark-circle-outline" size={16} color="#fff" style={{ marginRight: 4 }} />
                        <Text style={styles.actionBtnText}>Verify</Text>
                      </TouchableOpacity>
                    )}

                    {['ready', 'served'].includes(item.status) && item.payment_status === 'paid' && (
                      <TouchableOpacity
                        style={[styles.actionBtn, { backgroundColor: COLORS.primary }]}
                        disabled={isBusy}
                        onPress={() => completeOrder(item.id)}
                      >
                        <Ionicons name="cash-outline" size={16} color="#fff" style={{ marginRight: 4 }} />
                        <Text style={styles.actionBtnText}>Complete</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="card-outline" size={48} color="#cbd5e1" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>No orders in this cashier view</Text>
            </View>
          }
        />
      )}

      {/* Bill, Split Payment & GST Receipt Modal */}
      <Modal
        visible={Boolean(selectedOrderForBill)}
        transparent
        animationType="slide"
        onRequestClose={() => { setSelectedOrderForBill(null); setIsSplitting(false); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.billModalContent}>
            <View style={styles.billModalHeader}>
              <View>
                <Text style={styles.billModalTitle}>
                  {isSplitting ? 'Split Bill Calculator' : 'Bill & Itemized Receipt'}
                </Text>
                <Text style={styles.billModalSub}>
                  {selectedOrderForBill?.table_name || 'Takeaway'} • #{getFormattedOrderId(selectedOrderForBill, profile?.restaurant_name || '')}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => { setSelectedOrderForBill(null); setIsSplitting(false); }}
              >
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Modal Mode Selector */}
            <View style={styles.modalModeRow}>
              <TouchableOpacity
                style={[styles.modalModeTab, !isSplitting && styles.modalModeTabActive]}
                onPress={() => setIsSplitting(false)}
              >
                <Ionicons name="receipt-outline" size={16} color={!isSplitting ? '#fff' : '#64748b'} style={{ marginRight: 6 }} />
                <Text style={[styles.modalModeText, !isSplitting && styles.modalModeTextActive]}>Receipt & GST</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalModeTab, isSplitting && styles.modalModeTabActive]}
                onPress={() => setIsSplitting(true)}
              >
                <Ionicons name="people-outline" size={16} color={isSplitting ? '#fff' : '#64748b'} style={{ marginRight: 6 }} />
                <Text style={[styles.modalModeText, isSplitting && styles.modalModeTextActive]}>Split Bill ({splitGuests})</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              {!isSplitting ? (
                /* Itemized Receipt & GST breakdown */
                <View>
                  <Text style={styles.receiptSectionHeader}>ORDER ITEMS</Text>
                  {(selectedOrderForBill?.order_items || []).map((it, idx) => (
                    <View key={idx} style={styles.receiptItemRow}>
                      <Text style={styles.receiptItemQty}>{it.quantity}x</Text>
                      <Text style={styles.receiptItemName} numberOfLines={1}>{getItemName(it)}</Text>
                      <Text style={styles.receiptItemPrice}>{formatCurrency((it.price || 0) * (it.quantity || 1))}</Text>
                    </View>
                  ))}

                  <View style={styles.divider} />

                  <View style={styles.summaryLine}>
                    <Text style={styles.summaryLabel}>Subtotal</Text>
                    <Text style={styles.summaryVal}>{formatCurrency(billDetails?.subtotal || 0)}</Text>
                  </View>
                  <View style={styles.summaryLine}>
                    <Text style={styles.summaryLabel}>CGST (2.5%)</Text>
                    <Text style={styles.summaryVal}>{formatCurrency(billDetails?.cgst || 0)}</Text>
                  </View>
                  <View style={styles.summaryLine}>
                    <Text style={styles.summaryLabel}>SGST (2.5%)</Text>
                    <Text style={styles.summaryVal}>{formatCurrency(billDetails?.sgst || 0)}</Text>
                  </View>
                  {billDetails?.roundOff !== 0 && (
                    <View style={styles.summaryLine}>
                      <Text style={styles.summaryLabel}>Round Off</Text>
                      <Text style={styles.summaryVal}>{billDetails?.roundOff > 0 ? `+${billDetails?.roundOff}` : billDetails?.roundOff}</Text>
                    </View>
                  )}
                  <View style={[styles.summaryLine, { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#e2e8f0' }]}>
                    <Text style={styles.grandTotalLabel}>Grand Total</Text>
                    <Text style={styles.grandTotalVal}>{formatCurrency(billDetails?.grandTotal || 0)}</Text>
                  </View>
                </View>
              ) : (
                /* Split Bill Calculator */
                <View>
                  <Text style={styles.receiptSectionHeader}>SPLIT AMONG GUESTS</Text>
                  <View style={styles.guestSelectorRow}>
                    {[2, 3, 4, 5, 6].map(num => (
                      <TouchableOpacity
                        key={num}
                        style={[styles.guestPill, splitGuests === num && styles.guestPillActive]}
                        onPress={() => setSplitGuests(num)}
                      >
                        <Text style={[styles.guestPillText, splitGuests === num && styles.guestPillTextActive]}>
                          {num} Guests
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={styles.splitCardsContainer}>
                    {billDetails?.splitPortions.map(portion => (
                      <View key={portion.guest} style={styles.splitPortionCard}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <View style={styles.guestAvatar}>
                            <Text style={styles.guestAvatarText}>{portion.guest}</Text>
                          </View>
                          <Text style={styles.guestTitle}>Guest {portion.guest}</Text>
                        </View>
                        <Text style={styles.guestAmount}>{formatCurrency(portion.amount)}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {/* Payment Mode Selector */}
              <Text style={[styles.receiptSectionHeader, { marginTop: 16 }]}>PAYMENT METHOD</Text>
              <View style={styles.paymentMethodsRow}>
                {['cash', 'upi', 'card'].map(mode => (
                  <TouchableOpacity
                    key={mode}
                    style={[styles.payMethodPill, paymentMode === mode && styles.payMethodPillActive]}
                    onPress={() => setPaymentMode(mode)}
                  >
                    <Ionicons
                      name={mode === 'cash' ? 'cash-outline' : mode === 'upi' ? 'qr-code-outline' : 'card-outline'}
                      size={16}
                      color={paymentMode === mode ? '#fff' : '#64748b'}
                      style={{ marginRight: 6 }}
                    />
                    <Text style={[styles.payMethodText, paymentMode === mode && styles.payMethodTextActive]}>
                      {mode.toUpperCase()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Settle Action Button */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={styles.settleBtn}
                disabled={settling}
                onPress={() => handleSettleOrder(selectedOrderForBill?.id, paymentMode)}
              >
                {settling ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-done-circle-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={styles.settleBtnText}>
                      Settle & Complete ({formatCurrency(billDetails?.grandTotal || 0)})
                    </Text>
                  </>
                )}
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
  alertBadge: { backgroundColor: '#f59e0b', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, flexDirection: 'row', alignItems: 'center' },
  alertBadgeText: { color: '#ffffff', fontWeight: '700', fontSize: 12 },
  tabsContainer: { flexDirection: 'row', backgroundColor: '#ffffff', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  tabBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8, backgroundColor: '#f1f5f9', marginHorizontal: 3 },
  tabBtnActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  tabTextActive: { color: '#ffffff', fontWeight: '700' },
  listContent: { padding: 16 },
  orderCard: { backgroundColor: '#ffffff', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9', elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  tableName: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  itemsSummary: { fontSize: 13, color: '#475569', marginBottom: 12 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  timeAgo: { fontSize: 11, color: '#94a3b8' },
  totalText: { fontSize: 18, fontWeight: '700', color: COLORS.primary },
  actionBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, flexDirection: 'row', alignItems: 'center' },
  actionBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 12 },
  paidBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0fdf4', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  paidBadgeText: { color: '#15803d', fontWeight: '700', fontSize: 12 },
  unpaidBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fef3c7', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  unpaidBadgeText: { color: '#b45309', fontWeight: '700', fontSize: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },

  /* Modal Styles */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  billModalContent: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '85%',
  },
  billModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  billModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  billModalSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  closeBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  modalModeRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 3,
    marginBottom: 14,
  },
  modalModeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  modalModeTabActive: {
    backgroundColor: COLORS.primary,
  },
  modalModeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  modalModeTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  receiptSectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  receiptItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  receiptItemQty: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
    width: 32,
  },
  receiptItemName: {
    flex: 1,
    fontSize: 13,
    color: '#0f172a',
  },
  receiptItemPrice: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  divider: {
    height: 1,
    backgroundColor: '#e2e8f0',
    marginVertical: 10,
  },
  summaryLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  summaryLabel: {
    fontSize: 13,
    color: '#64748b',
  },
  summaryVal: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  grandTotalLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  grandTotalVal: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.primary,
  },
  guestSelectorRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  guestPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  guestPillActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  guestPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  guestPillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
  splitCardsContainer: {
    gap: 8,
  },
  splitPortionCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  guestAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  guestAvatarText: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.primary,
  },
  guestTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
  },
  guestAmount: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.primary,
  },
  paymentMethodsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  payMethodPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  payMethodPillActive: {
    backgroundColor: '#059669',
    borderColor: '#059669',
  },
  payMethodText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  payMethodTextActive: {
    color: '#ffffff',
  },
  modalFooter: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  settleBtn: {
    backgroundColor: '#059669',
    paddingVertical: 14,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settleBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});

