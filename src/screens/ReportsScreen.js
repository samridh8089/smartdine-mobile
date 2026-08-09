import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { COLORS, FONTS, RADIUS, SHADOWS, formatCurrency } from '../lib/theme';

export default function ReportsScreen({ route }) {
  const profile = route?.params?.profile ?? {};
  const restaurantId = profile?.restaurant_id;

  const [range, setRange] = useState('daily'); // 'daily' | 'weekly' | 'monthly'
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
    topItems: [],
    chartData: [],
  });

  const loadReportData = useCallback(async () => {
    if (!restaurantId) { setLoading(false); setRefreshing(false); return; }
    try {
      let fromDate = new Date();
      if (range === 'daily') {
        fromDate.setHours(0, 0, 0, 0);
      } else if (range === 'weekly') {
        fromDate.setDate(fromDate.getDate() - 7);
      } else if (range === 'monthly') {
        fromDate.setDate(1);
        fromDate.setHours(0, 0, 0, 0);
      }

      const { data: ordersData, error: ordersErr } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('restaurant_id', restaurantId)
        .gte('created_at', fromDate.toISOString())
        .order('created_at', { ascending: true });

      if (ordersErr) {
        setIsOffline(true);
      } else {
        setIsOffline(false);
      }

      const allOrders = ordersData || [];
      const validOrders = allOrders.filter(o => o.status !== 'cancelled');
      const completedOrders = allOrders.filter(o => o.status === 'completed');

      const totalRevenue = validOrders.reduce((s, o) => s + (o.total || 0), 0);
      const completedCount = completedOrders.length;
      const avgOrderValue = completedCount > 0 ? totalRevenue / completedCount : 0;
      const paidCount = validOrders.filter(o => o.payment_status === 'paid').length;
      const pendingCount = validOrders.filter(o => o.payment_status === 'pending').length;

      const dineInOrders = validOrders.filter(o => o.order_type === 'dine_in');
      const takeawayOrders = validOrders.filter(o => o.order_type === 'takeaway');

      const dineInRevenue = dineInOrders.reduce((s, o) => s + (o.total || 0), 0);
      const takeawayRevenue = takeawayOrders.reduce((s, o) => s + (o.total || 0), 0);

      // Top selling items
      const itemMap = {};
      validOrders.forEach(o => {
        (o.order_items || []).forEach(i => {
          const name = i.name || i.item_name || 'Item';
          if (!itemMap[name]) itemMap[name] = { name, qty: 0, revenue: 0 };
          itemMap[name].qty += i.quantity || 1;
          itemMap[name].revenue += (i.price || 0) * (i.quantity || 1);
        });
      });

      const topItems = Object.values(itemMap).sort((a, b) => b.qty - a.qty).slice(0, 5);

      // Chart data buckets
      const hourBuckets = {};
      validOrders.forEach(o => {
        const dt = new Date(o.created_at);
        const label = range === 'daily' ? `${dt.getHours()}:00` : `${dt.getMonth() + 1}/${dt.getDate()}`;
        hourBuckets[label] = (hourBuckets[label] || 0) + (o.total || 0);
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
        topItems,
        chartData,
      });

    } catch (e) {
      console.log('Reports load error:', e?.message);
      setIsOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId, range]);

  useEffect(() => {
    loadReportData();
  }, [loadReportData]);

  const maxChartVal = Math.max(...metrics.chartData.map(c => c.val), 1);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Reports & Analytics</Text>

        {/* Range Tabs */}
        <View style={styles.rangeTabs}>
          {['daily', 'weekly', 'monthly'].map(r => (
            <TouchableOpacity
              key={r}
              style={[styles.rangeBtn, range === r && styles.rangeBtnActive]}
              onPress={() => setRange(r)}
            >
              <Text style={[styles.rangeBtnText, range === r && styles.rangeBtnTextActive]}>
                {r.charAt(0).toUpperCase() + r.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Offline Connectivity Banner */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="wifi-outline" size={16} color="#ffffff" style={{ marginRight: 8 }} />
          <Text style={styles.offlineBannerText}>
            ⚡ Offline mode — Changes will auto-sync on reconnect
          </Text>
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
          {/* Revenue Card */}
          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Ionicons name="stats-chart-outline" size={18} color={COLORS.primary} style={{ marginRight: 6 }} />
              <Text style={styles.cardHeaderTitle}>Revenue Trend</Text>
            </View>

            <Text style={styles.totalRevText}>{formatCurrency(metrics.totalRevenue)}</Text>
            <Text style={styles.revSubtext}>Total Revenue ({range})</Text>

            {/* Custom Bar Chart */}
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

          {/* Key Metrics 2-Grid */}
          <Text style={styles.sectionTitle}>Key Metrics</Text>
          <View style={styles.grid}>
            <View style={styles.metricTile}>
              <Ionicons name="document-text-outline" size={20} color={COLORS.primary} style={{ marginBottom: 6 }} />
              <Text style={styles.metricTileValue}>{metrics.completedOrdersCount}</Text>
              <Text style={styles.metricTileLabel}>Completed Orders</Text>
            </View>

            <View style={styles.metricTile}>
              <Ionicons name="calculator-outline" size={20} color="#2563eb" style={{ marginBottom: 6 }} />
              <Text style={styles.metricTileValue}>{formatCurrency(metrics.avgOrderValue)}</Text>
              <Text style={styles.metricTileLabel}>Avg Order Value</Text>
            </View>

            <View style={styles.metricTile}>
              <Ionicons name="checkmark-done-circle-outline" size={20} color="#16a34a" style={{ marginBottom: 6 }} />
              <Text style={styles.metricTileValue}>{metrics.paidCount}</Text>
              <Text style={styles.metricTileLabel}>Verified Paid</Text>
            </View>

            <View style={styles.metricTile}>
              <Ionicons name="time-outline" size={20} color="#d97706" style={{ marginBottom: 6 }} />
              <Text style={styles.metricTileValue}>{metrics.pendingCount}</Text>
              <Text style={styles.metricTileLabel}>Payment Pending</Text>
            </View>
          </View>

          {/* Dine-In vs Takeaway */}
          <Text style={styles.sectionTitle}>Dine-In vs Takeaway</Text>
          <View style={styles.card}>
            <View style={styles.splitRow}>
              <View style={styles.splitCol}>
                <Ionicons name="restaurant-outline" size={24} color={COLORS.primary} style={{ marginBottom: 4 }} />
                <Text style={styles.splitLabel}>Dine-In</Text>
                <Text style={styles.splitVal}>{formatCurrency(metrics.dineInRevenue)}</Text>
                <Text style={styles.splitSub}>{metrics.dineInCount} orders</Text>
              </View>

              <View style={styles.splitDivider} />

              <View style={styles.splitCol}>
                <Ionicons name="bag-handle-outline" size={24} color="#f59e0b" style={{ marginBottom: 4 }} />
                <Text style={styles.splitLabel}>Takeaway</Text>
                <Text style={styles.splitVal}>{formatCurrency(metrics.takeawayRevenue)}</Text>
                <Text style={styles.splitSub}>{metrics.takeawayCount} orders</Text>
              </View>
            </View>
          </View>

          {/* Top Selling Items */}
          {metrics.topItems.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Top Performing Items</Text>
              <View style={styles.card}>
                {metrics.topItems.map((item, idx) => (
                  <View key={idx} style={[styles.topRow, idx === metrics.topItems.length - 1 && { borderBottomWidth: 0 }]}>
                    <View style={styles.rankBadge}>
                      <Text style={styles.rankText}>#{idx + 1}</Text>
                    </View>
                    <Text style={styles.topName}>{item.name}</Text>
                    <Text style={styles.topQty}>{item.qty} sold</Text>
                    <Text style={styles.topRev}>{formatCurrency(item.revenue)}</Text>
                  </View>
                ))}
              </View>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a', marginBottom: 12 },
  offlineBanner: {
    backgroundColor: '#3b82f6',
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justify: 'center',
  },
  offlineBannerText: { color: '#ffffff', fontWeight: '600', fontSize: 12 },
  rangeTabs: { flexDirection: 'row', backgroundColor: '#f1f5f9', borderRadius: 10, padding: 4 },
  rangeBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  rangeBtnActive: { backgroundColor: COLORS.primary },
  rangeBtnText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  rangeBtnTextActive: { color: '#ffffff', fontWeight: '700' },
  scrollContent: { padding: 16 },
  card: { backgroundColor: '#ffffff', borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#f1f5f9', elevation: 2 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  cardHeaderTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  totalRevText: { fontSize: 28, fontWeight: '700', color: COLORS.primary },
  revSubtext: { fontSize: 12, color: '#64748b', marginBottom: 16 },
  chartContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 120, paddingTop: 16 },
  chartCol: { flex: 1, alignItems: 'center', height: '100%' },
  barTrack: { flex: 1, width: 24, backgroundColor: '#f1f5f9', borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', backgroundColor: COLORS.primary, borderRadius: 6 },
  barLabel: { fontSize: 10, color: '#64748b', marginTop: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 10, marginTop: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 16 },
  metricTile: { width: '48%', backgroundColor: '#ffffff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#f1f5f9', alignItems: 'center' },
  metricTileValue: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  metricTileLabel: { fontSize: 12, color: '#64748b', marginTop: 2 },
  splitRow: { flexDirection: 'row', alignItems: 'center' },
  splitCol: { flex: 1, alignItems: 'center' },
  splitDivider: { width: 1, height: 60, backgroundColor: '#f1f5f9' },
  splitLabel: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  splitVal: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginVertical: 2 },
  splitSub: { fontSize: 11, color: '#94a3b8' },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  rankBadge: { width: 24, height: 24, borderRadius: 6, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rankText: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
  topName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1e293b' },
  topQty: { fontSize: 12, color: '#64748b', marginRight: 10 },
  topRev: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
