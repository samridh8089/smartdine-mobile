import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  ActivityIndicator, TouchableOpacity, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import {
  COLORS, FONTS, RADIUS, SHADOWS,
  formatCurrency, timeAgo, getStatusColor, getStatusLabel,
} from '../lib/theme';

import { stopAllAlarms } from '../lib/alarmManager';
import OTAUpdateBtn from '../components/OTAUpdateBtn';

export default function DashboardScreen({ route }) {
  const navigation = useNavigation();
  const profile = route?.params?.profile ?? {};
  const restaurantId = profile?.restaurant_id;

  const [restaurantName, setRestaurantName] = useState('');
  const [todayOrders, setTodayOrders] = useState([]);
  const [topItems, setTopItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  const loadDashboardData = useCallback(async () => {
    if (!restaurantId) { setLoading(false); setRefreshing(false); return; }
    try {
      // 1. Fetch Restaurant Info
      const { data: restData, error: restErr } = await supabase
        .from('restaurants')
        .select('name')
        .eq('id', restaurantId)
        .maybeSingle();

      if (restErr) {
        setIsOffline(true);
      } else if (restData) {
        setIsOffline(false);
        setRestaurantName(restData.name);
      }

      // 2. Fetch Orders
      const { data: ordersData, error: ordersErr } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (ordersErr) {
        setIsOffline(true);
      } else {
        setIsOffline(false);
      }

      const allOrders = ordersData || [];
      const now = new Date();
      const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      const todayFiltered = allOrders.filter(o => new Date(o.created_at) >= twentyFourHoursAgo);
      setTodayOrders(todayFiltered.length > 0 ? todayFiltered : allOrders);

      // 3. Aggregate Top Selling Items
      const itemMap = {};
      allOrders.forEach(order => {
        (order.order_items || []).forEach(item => {
          const name = item.name || item.item_name || 'Item';
          if (!itemMap[name]) itemMap[name] = { name, qty: 0, revenue: 0 };
          itemMap[name].qty += item.quantity || 1;
          itemMap[name].revenue += (item.price || 0) * (item.quantity || 1);
        });
      });

      const sortedTop = Object.values(itemMap)
        .sort((a, b) => b.qty - a.qty)
        .slice(0, 5);
      setTopItems(sortedTop);

    } catch (e) {
      console.log('Dashboard load error:', e?.message);
      setIsOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    loadDashboardData();

    if (!restaurantId) return;
    const sub = supabase.channel(`dashboard-orders-${restaurantId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public',
        table: 'orders',
        filter: `restaurant_id=eq.${restaurantId}`,
      }, loadDashboardData)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsOffline(false);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setIsOffline(true);
        }
      });

    return () => {
      stopAllAlarms();
      supabase.removeChannel(sub);
    };
  }, [restaurantId, loadDashboardData]);

  // Calculated Metrics
  const totalRevenue = todayOrders
    .filter(o => o.status !== 'cancelled')
    .reduce((s, o) => s + (Number(o.total) || Number(o.subtotal) || 0), 0);

  const totalOrdersCount = todayOrders.length;
  const completedOrdersCount = todayOrders.filter(o => o.status === 'completed').length;
  const activeTablesCount = new Set(
    todayOrders.filter(o => !['completed', 'cancelled'].includes(o.status) && o.table_name).map(o => o.table_name)
  ).size;

  const recentOrdersSorted = [...todayOrders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

  const getGreeting = () => {
    const hr = new Date().getHours();
    if (hr < 12) return 'Good Morning';
    if (hr < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadDashboardData(); }} />
        }
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greeting}>{getGreeting()}</Text>
            <Text style={styles.restaurantName} numberOfLines={1}>{restaurantName || 'SmartDine Restaurant'}</Text>
          </View>

          <OTAUpdateBtn style={{ marginRight: 8 }} />

          <TouchableOpacity
            style={[styles.avatarCircle, { marginRight: 8 }]}
            onPress={async () => {
              stopAllAlarms();
              await supabase.auth.signOut().catch(() => {});
              navigation.replace('Login');
            }}
          >
            <Text style={styles.avatarText}>{profile.full_name?.[0]?.toUpperCase() || 'O'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' }}
            onPress={async () => {
              stopAllAlarms();
              await supabase.auth.signOut().catch(() => {});
              navigation.replace('Login');
            }}
          >
            <Ionicons name="log-out-outline" size={20} color="#ef4444" />
          </TouchableOpacity>
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

        {/* Date Banner */}
        <View style={styles.dateBanner}>
          <Ionicons name="calendar-outline" size={16} color={COLORS.primary} style={{ marginRight: 6 }} />
          <Text style={styles.dateBannerText}>
            {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
        </View>

        {/* 2x2 Metric Grid */}
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <View style={[styles.metricIconBg, { backgroundColor: COLORS.primaryLight }]}>
              <Ionicons name="cash-outline" size={22} color={COLORS.primary} />
            </View>
            <Text style={styles.metricValue}>{formatCurrency(totalRevenue)}</Text>
            <Text style={styles.metricLabel}>Today Revenue</Text>
          </View>

          <View style={styles.metricCard}>
            <View style={[styles.metricIconBg, { backgroundColor: '#dbeafe' }]}>
              <Ionicons name="receipt-outline" size={22} color="#2563eb" />
            </View>
            <Text style={styles.metricValue}>{totalOrdersCount}</Text>
            <Text style={styles.metricLabel}>Total Orders</Text>
          </View>

          <View style={styles.metricCard}>
            <View style={[styles.metricIconBg, { backgroundColor: '#fef3c7' }]}>
              <Ionicons name="restaurant-outline" size={22} color="#d97706" />
            </View>
            <Text style={styles.metricValue}>{activeTablesCount}</Text>
            <Text style={styles.metricLabel}>Active Tables</Text>
          </View>

          <View style={styles.metricCard}>
            <View style={[styles.metricIconBg, { backgroundColor: '#dcfce7' }]}>
              <Ionicons name="checkmark-circle-outline" size={22} color="#16a34a" />
            </View>
            <Text style={styles.metricValue}>{completedOrdersCount}</Text>
            <Text style={styles.metricLabel}>Completed</Text>
          </View>
        </View>

        {/* Recent Orders Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Orders</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={COLORS.primary} size="medium" style={{ marginVertical: 20 }} />
        ) : recentOrdersSorted.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="receipt-outline" size={32} color="#cbd5e1" style={{ marginBottom: 6 }} />
            <Text style={styles.emptyText}>No orders received today yet</Text>
          </View>
        ) : (
          recentOrdersSorted.map(order => {
            const statusColor = getStatusColor(order.status);
            const items = order.order_items || [];
            const summary = items.map(i => `${i.name || i.item_name || 'Item'} x${i.quantity || 1}`).join(', ');

            return (
              <View key={order.id} style={styles.recentCard}>
                <View style={styles.recentCardTop}>
                  <Text style={styles.recentTableName}>{order.table_name || `Order #${order.id.slice(0, 4)}`}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
                    <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                      {getStatusLabel(order.status)}
                    </Text>
                  </View>
                </View>

                <Text style={styles.recentSummary} numberOfLines={1}>{summary || 'No items'}</Text>

                <View style={styles.recentCardBottom}>
                  <Text style={styles.recentTime}>{timeAgo(order.created_at)}</Text>
                  <Text style={styles.recentTotal}>{formatCurrency(order.total || 0)}</Text>
                </View>
              </View>
            );
          })
        )}

        {/* Top Selling Items Section */}
        {topItems.length > 0 && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Top Selling Items Today</Text>
            </View>

            <View style={styles.topItemsCard}>
              {topItems.map((item, idx) => (
                <View key={idx} style={[styles.topItemRow, idx === topItems.length - 1 && { borderBottomWidth: 0 }]}>
                  <View style={styles.rankBadge}>
                    <Text style={styles.rankBadgeText}>#{idx + 1}</Text>
                  </View>

                  <Text style={styles.topItemName}>{item.name}</Text>
                  <Text style={styles.topItemQty}>{item.qty} sold</Text>
                  <Text style={styles.topItemRev}>{formatCurrency(item.revenue)}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  greeting: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  restaurantName: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justify: 'center',
  },
  avatarText: { color: '#ffffff', fontWeight: '700', fontSize: 18 },
  offlineBanner: {
    backgroundColor: '#3b82f6',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justify: 'center',
    marginBottom: 16,
  },
  offlineBannerText: { color: '#ffffff', fontWeight: '600', fontSize: 12 },
  dateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 16,
    selfAlign: 'flex-start',
  },
  dateBannerText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 16 },
  metricCard: {
    width: '48%',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  metricIconBg: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  metricValue: { fontSize: 20, fontWeight: '700', color: '#0f172a', marginBottom: 2 },
  metricLabel: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  sectionHeader: { marginTop: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  emptyCard: { backgroundColor: '#ffffff', borderRadius: 14, padding: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#f1f5f9' },
  emptyText: { fontSize: 13, color: '#94a3b8', fontWeight: '600' },
  recentCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    elevation: 1,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  recentCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  recentTableName: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  recentSummary: { fontSize: 13, color: '#475569', marginBottom: 8 },
  recentCardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  recentTime: { fontSize: 12, color: '#94a3b8' },
  recentTotal: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  topItemsCard: { backgroundColor: '#ffffff', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#f1f5f9', marginBottom: 20 },
  topItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  rankBadge: { width: 26, height: 26, borderRadius: 6, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rankBadgeText: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
  topItemName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1e293b' },
  topItemQty: { fontSize: 13, color: '#64748b', marginRight: 12 },
  topItemRev: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
});
