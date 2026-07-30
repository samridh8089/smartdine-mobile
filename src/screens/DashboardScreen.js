import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';

export default function DashboardScreen({ route }) {
  const profile = route?.params?.profile || {};
  const restaurantId = profile.restaurant_id || null;

  const [restaurantName, setRestaurantName] = useState('Overview');
  const [stats, setStats] = useState({
    todayOrders: 0,
    todayRevenue: 0,
    activeTables: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!restaurantId) {
      setLoading(false);
      return;
    }

    fetchRestaurantName();
    fetchMetrics();

    // Live subscription for metrics updates
    let channel;
    try {
      channel = supabase
        .channel(`dashboard-metrics-${restaurantId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
          () => {
            fetchMetrics();
          }
        )
        .subscribe();
    } catch (e) {
      console.log('Metrics channel error:', e);
    }

    return () => {
      if (channel) {
        try { supabase.removeChannel(channel); } catch (_) {}
      }
    };
  }, [restaurantId]);

  const fetchRestaurantName = async () => {
    try {
      const { data } = await supabase
        .from('restaurants')
        .select('name')
        .eq('id', restaurantId)
        .single();
      if (data?.name) {
        setRestaurantName(data.name);
      }
    } catch (e) {
      console.log('Error fetching restaurant name:', e);
    }
  };

  const fetchMetrics = async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data: orders, error } = await supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('created_at', today.toISOString());

      if (!error && Array.isArray(orders)) {
        const totalCount = orders.length;
        const totalRev = orders
          .filter(o => o?.status !== 'cancelled')
          .reduce((sum, o) => sum + (Number(o?.total) || 0), 0);
        
        const activeOrders = orders.filter(o => ['new', 'accepted', 'preparing', 'ready', 'served'].includes(o?.status));
        
        const activeTableMap = new Map();
        activeOrders.forEach(o => {
          const name = o?.table_name || o?.table_id;
          if (name && o?.order_type !== 'takeaway' && o?.order_type !== 'reservation') {
            activeTableMap.set(o.table_id || name, name);
          }
        });

        const activeTableNamesList = Array.from(activeTableMap.values())
          .map(name => String(name).replace(/^Table\s*/i, ''))
          .sort((a, b) => {
            const numA = parseInt(a, 10);
            const numB = parseInt(b, 10);
            if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
            return a.localeCompare(b);
          });

        setStats({
          todayOrders: totalCount,
          todayRevenue: totalRev,
          activeTables: activeTableMap.size,
          activeTableNames: activeTableNamesList
        });
      }
    } catch (e) {
      console.log('Error fetching metrics:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>{restaurantName}</Text>
          <Text style={styles.subtitle}>Owner & Management Dashboard</Text>
        </View>
        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#0ea5e9" />
          <Text style={styles.loadingText}>Loading metrics...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Metrics Grid */}
          <View style={styles.grid}>
            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Today's Orders</Text>
              <Text style={styles.metricValue}>{stats.todayOrders}</Text>
              <Text style={styles.metricSub}>Total orders placed today</Text>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Today's Revenue</Text>
              <Text style={[styles.metricValue, { color: '#10b981' }]}>
                ₹{stats.todayRevenue.toFixed(2)}
              </Text>
              <Text style={styles.metricSub}>Total sales collected today</Text>
            </View>

            <View style={styles.metricCard}>
              <Text style={styles.metricLabel}>Active Tables</Text>
              <Text style={[styles.metricValue, { color: '#0ea5e9' }]}>
                {stats.activeTables}
              </Text>
              <Text style={[styles.metricSub, stats.activeTableNames?.length > 0 && { color: '#059669', fontWeight: 'bold' }]}>
                {stats.activeTableNames?.length > 0 
                  ? `Active: Table ${stats.activeTableNames.join(', ')}`
                  : 'No active tables'
                }
              </Text>
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    paddingTop: 50,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  signOutBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  signOutText: {
    color: '#ef4444',
    fontWeight: 'bold',
    fontSize: 13,
  },
  loadingBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#64748b',
    marginTop: 12,
  },
  scrollContent: {
    padding: 20,
  },
  grid: {
    gap: 16,
  },
  metricCard: {
    backgroundColor: '#ffffff',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  metricLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 6,
  },
  metricValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 4,
  },
  metricSub: {
    fontSize: 12,
    color: '#94a3b8',
  },
});
