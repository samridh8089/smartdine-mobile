import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  ActivityIndicator, TouchableOpacity, TextInput, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { COLORS, formatCurrency } from '../lib/theme';

export default function ReportsScreen({ route }) {
  const profile = route?.params?.profile ?? {};
  const restaurantId = profile?.restaurant_id;

  const [timeRange, setTimeRange] = useState('today'); // 'today' | 'yesterday' | 'weekly' | 'monthly' | 'custom'
  const [customStartDate, setCustomStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [customEndDate, setCustomEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [showCustomModal, setShowCustomModal] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  const [metrics, setMetrics] = useState({
    totalRevenue: 0,
    completedOrdersCount: 0,
    avgOrderValue: 0,
    paidCount: 0,
    pendingCount: 0,
    dineInRevenue: 0,
    dineInCount: 0,
    takeawayRevenue: 0,
    takeawayCount: 0,
    cashRevenue: 0,
    upiRevenue: 0,
    cardRevenue: 0,
    otherRevenue: 0,
    staffCollections: [],
    topItems: [],
    chartData: [],
    cancelledCount: 0,
    totalCancelledLost: 0,
    cancellationReasons: [],
  });

  const loadReportData = useCallback(async () => {
    if (!restaurantId) { setLoading(false); setRefreshing(false); return; }
    try {
      let fromDate = new Date();
      let toDate = new Date();

      if (timeRange === 'today') {
        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(23, 59, 59, 999);
      } else if (timeRange === 'yesterday') {
        fromDate.setDate(fromDate.getDate() - 1);
        fromDate.setHours(0, 0, 0, 0);
        toDate.setDate(toDate.getDate() - 1);
        toDate.setHours(23, 59, 59, 999);
      } else if (timeRange === 'weekly') {
        fromDate.setDate(fromDate.getDate() - 7);
        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(23, 59, 59, 999);
      } else if (timeRange === 'monthly') {
        fromDate.setDate(1);
        fromDate.setHours(0, 0, 0, 0);
        toDate.setHours(23, 59, 59, 999);
      } else if (timeRange === 'custom') {
        fromDate = new Date(customStartDate + 'T00:00:00.000Z');
        toDate = new Date(customEndDate + 'T23:59:59.999Z');
      }

      const { data: ordersData, error: ordersErr } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('restaurant_id', restaurantId)
        .gte('created_at', fromDate.toISOString())
        .lte('created_at', toDate.toISOString())
        .order('created_at', { ascending: true });

      if (ordersErr) {
        setIsOffline(true);
      } else {
        setIsOffline(false);
      }

      const allOrders = ordersData || [];
      const validOrders = allOrders.filter(o => o.status !== 'cancelled');
      const settledOrders = allOrders.filter(o => o.status === 'completed' || (o.status === 'served' && o.payment_status === 'paid') || o.payment_status === 'paid');
      const cancelledOrders = allOrders.filter(o => o.status === 'cancelled');

      const totalRevenue = settledOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
      const completedCount = settledOrders.length;
      const avgOrderValue = completedCount > 0 ? totalRevenue / completedCount : 0;
      const paidCount = validOrders.filter(o => o.payment_status === 'paid').length;
      const pendingCount = validOrders.filter(o => o.payment_status === 'pending').length;

      const dineInOrders = validOrders.filter(o => o.order_type === 'dine_in');
      const takeawayOrders = validOrders.filter(o => o.order_type === 'takeaway');

      const dineInRevenue = dineInOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
      const takeawayRevenue = takeawayOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);

      // Payment Split Breakdown
      let cashRevenue = 0;
      let upiRevenue = 0;
      let cardRevenue = 0;
      let otherRevenue = 0;
      const staffMap = {};

      settledOrders.forEach(o => {
        const amt = Number(o.total) || 0;
        const method = (o.payment_method || o.payment_mode || 'cash').toLowerCase();
        const staff = o.server_name || o.waiter_name || o.staff_name || 'Staff / Counter';

        if (!staffMap[staff]) {
          staffMap[staff] = { name: staff, cash: 0, upi: 0, card: 0, total: 0 };
        }

        if (method.includes('upi') || method.includes('online') || method.includes('qr') || method.includes('gpay') || method.includes('phonepe') || method.includes('paytm')) {
          upiRevenue += amt;
          staffMap[staff].upi += amt;
        } else if (method.includes('card') || method.includes('pos')) {
          cardRevenue += amt;
          staffMap[staff].card += amt;
        } else if (method.includes('cash')) {
          cashRevenue += amt;
          staffMap[staff].cash += amt;
        } else {
          otherRevenue += amt;
          staffMap[staff].cash += amt;
        }
        staffMap[staff].total += amt;
      });

      const staffCollections = Object.values(staffMap).sort((a, b) => b.total - a.total);

      // Cancellation Analysis
      const cancelMap = {};
      let totalCancelledLost = 0;
      cancelledOrders.forEach(o => {
        const reason = o.cancellation_reason || o.cancel_reason || 'No reason provided';
        if (!cancelMap[reason]) {
          cancelMap[reason] = { reason, count: 0, lostAmount: 0 };
        }
        const isPaid = o.payment_status === 'paid';
        const lost = isPaid ? 0 : Number(o.total || o.subtotal || 0);
        cancelMap[reason].count += 1;
        cancelMap[reason].lostAmount += lost;
        totalCancelledLost += lost;
      });
      const cancellationReasons = Object.values(cancelMap).sort((a, b) => b.count - a.count);

      // Top selling items
      const itemMap = {};
      validOrders.forEach(o => {
        (o.order_items || []).forEach(i => {
          const name = i.menu_item_name || i.name || i.item_name || i.menu_items?.name || 'Item';
          if (!itemMap[name]) itemMap[name] = { name, qty: 0, revenue: 0 };
          itemMap[name].qty += i.quantity || 1;
          itemMap[name].revenue += (Number(i.price) || 0) * (Number(i.quantity) || 1);
        });
      });

      const topItems = Object.values(itemMap).sort((a, b) => b.qty - a.qty).slice(0, 5);

      // Chart data
      const hourBuckets = {};
      validOrders.forEach(o => {
        const dt = new Date(o.created_at);
        const label = (timeRange === 'today' || timeRange === 'yesterday') ? `${dt.getHours()}:00` : `${dt.getMonth() + 1}/${dt.getDate()}`;
        hourBuckets[label] = (hourBuckets[label] || 0) + (Number(o.total) || 0);
      });

      const chartData = Object.entries(hourBuckets).map(([label, val]) => ({ label, val })).slice(-8);

      setMetrics({
        totalRevenue,
        completedOrdersCount: completedCount,
        avgOrderValue,
        paidCount,
        pendingCount,
        dineInRevenue,
        dineInCount: dineInOrders.length,
        takeawayRevenue,
        takeawayCount: takeawayOrders.length,
        cashRevenue,
        upiRevenue,
        cardRevenue,
        otherRevenue,
        staffCollections,
        topItems,
        chartData,
        cancelledCount: cancelledOrders.length,
        totalCancelledLost,
        cancellationReasons,
      });

    } catch (e) {
      console.log('Reports load error:', e?.message);
      setIsOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId, timeRange, customStartDate, customEndDate]);

  useEffect(() => {
    loadReportData();
  }, [loadReportData]);

  const maxChartVal = Math.max(...metrics.chartData.map(c => c.val), 1);

  const getRangeLabel = () => {
    switch (timeRange) {
      case 'today': return 'Today';
      case 'yesterday': return 'Yesterday';
      case 'weekly': return 'This Week';
      case 'monthly': return 'This Month';
      case 'custom': return `${customStartDate} to ${customEndDate}`;
      default: return 'Period';
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Reports & Analytics</Text>
          <Text style={styles.subTitle}>Business overview & financial performance</Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rangeScroll}>
          {[
            { id: 'today', label: 'Today' },
            { id: 'yesterday', label: 'Yesterday' },
            { id: 'weekly', label: 'This Week' },
            { id: 'monthly', label: 'This Month' },
            { id: 'custom', label: 'Custom Range 📅' },
          ].map(tab => (
            <TouchableOpacity
              key={tab.id}
              style={[styles.rangeBtn, timeRange === tab.id && styles.rangeBtnActive]}
              onPress={() => {
                setTimeRange(tab.id);
                if (tab.id === 'custom') setShowCustomModal(true);
              }}
            >
              <Text style={[styles.rangeBtnText, timeRange === tab.id && styles.rangeBtnTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="wifi-outline" size={16} color="#ffffff" style={{ marginRight: 8 }} />
          <Text style={styles.offlineBannerText}>⚡ Offline mode — Changes will auto-sync on reconnect</Text>
        </View>
      )}

      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadReportData(); }} />
          }
        >
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardHeaderTitle}>Sales & Revenue</Text>
            </View>

            <Text style={styles.totalRevText}>{formatCurrency(metrics.totalRevenue)}</Text>
            <Text style={styles.revSubtext}>Total Revenue ({getRangeLabel()})</Text>

            {metrics.chartData.length > 0 ? (
              <View style={styles.chartContainer}>
                {metrics.chartData.map((bar, idx) => {
                  const heightPct = Math.max((bar.val / maxChartVal) * 100, 10);
                  return (
                    <View key={idx} style={styles.chartCol}>
                      <View style={styles.barTrack}>
                        <View style={[styles.barFill, { height: `${heightPct}%` }]} />
                      </View>
                      <Text style={styles.barLabel}>{bar.label}</Text>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </View>

          {/* Payment Breakdown Card */}
          <Text style={styles.sectionTitle}>Payment Breakdown</Text>
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardHeaderTitle}>Today's Payment Breakdown ({getRangeLabel()})</Text>
            </View>

            <View style={styles.paymentMethodGrid}>
              <View style={styles.paymentMethodPill}>
                <Text style={styles.paymentMethodLabel}>Cash</Text>
                <Text style={styles.paymentMethodValue}>{formatCurrency(metrics.cashRevenue || 0)}</Text>
              </View>

              <View style={styles.paymentMethodPill}>
                <Text style={styles.paymentMethodLabel}>UPI</Text>
                <Text style={styles.paymentMethodValue}>{formatCurrency(metrics.upiRevenue || 0)}</Text>
              </View>

              <View style={styles.paymentMethodPill}>
                <Text style={styles.paymentMethodLabel}>Card</Text>
                <Text style={styles.paymentMethodValue}>{formatCurrency(metrics.cardRevenue || 0)}</Text>
              </View>
            </View>

            <View style={styles.paymentTotalRow}>
              <Text style={styles.paymentTotalLabel}>Total Settled</Text>
              <Text style={styles.paymentTotalValue}>{formatCurrency(metrics.totalRevenue || 0)}</Text>
            </View>
          </View>

          {/* Staff Payment Collections Card */}
          {metrics.staffCollections && metrics.staffCollections.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Staff Payment Collections</Text>
              <View style={styles.card}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardHeaderTitle}>Collected by Staff ({getRangeLabel()})</Text>
                </View>

                {metrics.staffCollections.map((sc, idx) => (
                  <View key={idx} style={[styles.staffColRow, idx === metrics.staffCollections.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.staffColName}>{sc.name}</Text>
                      <Text style={styles.staffColBreakdown}>
                        Cash: {formatCurrency(sc.cash)} • UPI: {formatCurrency(sc.upi)}{sc.card > 0 ? ` • Card: ${formatCurrency(sc.card)}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.staffColTotal}>{formatCurrency(sc.total)}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={styles.sectionTitle}>Key Performance Metrics</Text>
          <View style={styles.grid}>
            <View style={styles.metricTile}>
              <Text style={styles.metricTileValue}>{metrics.completedOrdersCount}</Text>
              <Text style={styles.metricTileLabel}>Settled Orders</Text>
            </View>

            <View style={styles.metricTile}>
              <Text style={styles.metricTileValue}>{formatCurrency(metrics.avgOrderValue)}</Text>
              <Text style={styles.metricTileLabel}>Avg Order Value</Text>
            </View>

            <View style={styles.metricTile}>
              <Text style={styles.metricTileValue}>{metrics.paidCount}</Text>
              <Text style={styles.metricTileLabel}>Verified Paid</Text>
            </View>

            <View style={styles.metricTile}>
              <Text style={styles.metricTileValue}>{metrics.pendingCount}</Text>
              <Text style={styles.metricTileLabel}>Payment Pending</Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>Dining Channel Breakdown</Text>
          <View style={styles.card}>
            <View style={styles.splitRow}>
              <View style={styles.splitCol}>
                <Text style={styles.splitLabel}>Dine-In</Text>
                <Text style={styles.splitVal}>{formatCurrency(metrics.dineInRevenue)}</Text>
                <Text style={styles.splitSub}>{metrics.dineInCount} orders</Text>
              </View>

              <View style={styles.splitDivider} />

              <View style={styles.splitCol}>
                <Text style={styles.splitLabel}>Takeaway</Text>
                <Text style={styles.splitVal}>{formatCurrency(metrics.takeawayRevenue)}</Text>
                <Text style={styles.splitSub}>{metrics.takeawayCount} orders</Text>
              </View>
            </View>
          </View>

          {metrics.topItems && metrics.topItems.length > 0 && (
            <View style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.cardHeaderTitle}>Top Selling Dishes ({getRangeLabel()})</Text>
              </View>
              {metrics.topItems.map((item, idx) => (
                <View key={idx} style={[styles.topRow, idx === metrics.topItems.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={[styles.rankBadge, { backgroundColor: '#fef3c7' }]}>
                    <Text style={[styles.rankText, { color: '#d97706' }]}>#{idx + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.topName}>{item.name}</Text>
                    <Text style={styles.topSubtext}>{item.qty} units sold</Text>
                  </View>
                  <Text style={styles.topRev}>{formatCurrency(item.revenue)}</Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.sectionTitle}>Order Cancellations & Loss</Text>
          <View style={styles.card}>
            <View style={styles.splitRow}>
              <View style={styles.splitCol}>
                <Text style={styles.splitLabel}>Cancelled Orders</Text>
                <Text style={[styles.splitVal, { color: '#ef4444' }]}>{metrics.cancelledCount || 0}</Text>
              </View>

              <View style={styles.splitDivider} />

              <View style={styles.splitCol}>
                <Text style={styles.splitLabel}>Unpaid Loss</Text>
                <Text style={[styles.splitVal, { color: '#ea580c' }]}>{formatCurrency(metrics.totalCancelledLost || 0)}</Text>
              </View>
            </View>

            {metrics.cancellationReasons && metrics.cancellationReasons.length > 0 && (
              <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10 }}>
                <Text style={styles.subSectionTitle}>Cancellation Reasons</Text>
                {metrics.cancellationReasons.map((cr, idx) => (
                  <View key={idx} style={styles.cancelReasonRow}>
                    <Text style={styles.cancelReasonText}>• {cr.reason}</Text>
                    <Text style={styles.cancelReasonCount}>{cr.count} orders ({formatCurrency(cr.lostAmount)})</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      )}

      <Modal visible={showCustomModal} transparent animationType="fade" onRequestClose={() => setShowCustomModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Custom Date Range</Text>
              <TouchableOpacity onPress={() => setShowCustomModal(false)}>
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Start Date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.textInput}
              value={customStartDate}
              placeholder="e.g. 2026-08-01"
              onChangeText={setCustomStartDate}
            />

            <Text style={styles.inputLabel}>End Date (YYYY-MM-DD)</Text>
            <TextInput
              style={styles.textInput}
              value={customEndDate}
              placeholder="e.g. 2026-08-20"
              onChangeText={setCustomEndDate}
            />

            <View style={{ flexDirection: 'row', gap: 6, marginVertical: 12 }}>
              <TouchableOpacity
                style={styles.quickPresetChip}
                onPress={() => {
                  const d = new Date();
                  d.setDate(d.getDate() - 7);
                  setCustomStartDate(d.toISOString().split('T')[0]);
                  setCustomEndDate(new Date().toISOString().split('T')[0]);
                }}
              >
                <Text style={styles.quickPresetText}>Last 7 Days</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickPresetChip}
                onPress={() => {
                  const d = new Date();
                  d.setDate(d.getDate() - 30);
                  setCustomStartDate(d.toISOString().split('T')[0]);
                  setCustomEndDate(new Date().toISOString().split('T')[0]);
                }}
              >
                <Text style={styles.quickPresetText}>Last 30 Days</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.modalSubmitBtn}
              onPress={() => {
                setShowCustomModal(false);
                loadReportData();
              }}
            >
              <Text style={styles.modalSubmitBtnText}>Apply Date Range</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { backgroundColor: '#ffffff', paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  title: { fontSize: 20, fontWeight: '800', color: '#0f172a', paddingHorizontal: 16 },
  subTitle: { fontSize: 11, color: '#64748b', paddingHorizontal: 16, marginTop: 2, marginBottom: 10 },
  rangeScroll: { paddingHorizontal: 16, gap: 6, paddingBottom: 4 },
  rangeBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0' },
  rangeBtnActive: { backgroundColor: '#dbeafe', borderColor: '#3b82f6' },
  rangeBtnText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  rangeBtnTextActive: { color: '#3b82f6', fontWeight: '700' },
  offlineBanner: { backgroundColor: '#3b82f6', paddingVertical: 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  offlineBannerText: { color: '#ffffff', fontWeight: '600', fontSize: 12 },
  scrollContent: { padding: 16, paddingBottom: 60 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: '#ffffff', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#f1f5f9', elevation: 2 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  cardHeaderTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  totalRevText: { fontSize: 26, fontWeight: '800', color: COLORS.primary },
  revSubtext: { fontSize: 12, color: '#64748b', marginTop: 2, marginBottom: 16 },
  chartContainer: { flexDirection: 'row', alignItems: 'flex-end', height: 120, paddingTop: 10 },
  chartCol: { flex: 1, alignItems: 'center', height: '100%' },
  barTrack: { flex: 1, width: 14, backgroundColor: '#f1f5f9', borderRadius: 7, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', backgroundColor: COLORS.primary, borderRadius: 7 },
  barLabel: { fontSize: 10, color: '#94a3b8', marginTop: 6 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 10, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  metricTile: { flex: 1, minWidth: '45%', backgroundColor: '#ffffff', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#f1f5f9' },
  metricTileValue: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  metricTileLabel: { fontSize: 11, color: '#64748b', marginTop: 2, fontWeight: '600' },
  splitRow: { flexDirection: 'row', alignItems: 'center' },
  splitCol: { flex: 1, alignItems: 'center' },
  splitDivider: { width: 1, height: 40, backgroundColor: '#f1f5f9' },
  splitLabel: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  splitVal: { fontSize: 18, fontWeight: '800', color: '#0f172a', marginVertical: 2 },
  splitSub: { fontSize: 11, color: '#94a3b8' },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  rankBadge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rankText: { fontSize: 11, fontWeight: '700' },
  topName: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  topSubtext: { fontSize: 11, color: '#64748b', marginTop: 1 },
  topRev: { fontSize: 13, fontWeight: '700', color: '#059669' },
  subSectionTitle: { fontSize: 12, fontWeight: '700', color: '#64748b', marginBottom: 6 },
  cancelReasonRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  cancelReasonText: { fontSize: 12, color: '#475569', flex: 1 },
  cancelReasonCount: { fontSize: 12, fontWeight: '600', color: '#ef4444' },
  paymentMethodGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  paymentMethodPill: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
  },
  paymentMethodLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
  },
  paymentMethodValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 4,
  },
  paymentTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 10,
  },
  paymentTotalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  paymentTotalValue: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.primary,
  },
  staffColRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  staffColName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0f172a',
  },
  staffColBreakdown: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 2,
    fontWeight: '600',
  },
  staffColTotal: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', justifyContent: 'center', padding: 20 },
  modalCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  inputLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginTop: 10, marginBottom: 4 },
  textInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 13, color: '#0f172a' },
  quickPresetChip: { backgroundColor: '#f1f5f9', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  quickPresetText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  modalSubmitBtn: { backgroundColor: COLORS.primary, paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 14 },
  modalSubmitBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
});
