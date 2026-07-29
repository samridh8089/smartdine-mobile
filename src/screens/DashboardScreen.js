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
    const channel = supabase
      .channel(`dashboard-metrics-${restaurantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
        () => {
          fetchMetrics();
        }
      )
      .subscribe();

    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch (_) {}
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
      // Start of today (00:00:00)
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data: orders, error } = await supabase
        .from('orders')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('created_at', today.toISOString());

      if (!error && orders) {
        const totalCount = orders.length;
        const totalRev = orders
          .filter(o => o.status !== 'cancelled')
          .reduce((sum, o) => sum + (Number(o.total) || 0), 0);
        
        // Count unique active tables
        const activeTablesSet = new Set(
          orders
            .filter(o => ['new', 'accepted', 'preparing', 'ready', 'served'].includes(o.status))
            .map(o => o.table_name || o.table_id)
        );

        setStats({
          todayOrders: totalCount,
          todayRevenue: totalRev,
          activeTables: activeTablesSet.size,
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
          <Text style={styles.restaurantTitle}>{restaurantName}</Text>
          <Text style={styles.subTitle}>Owner Dashboard</Text>
        </View>
        <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <ActivityIndicator size="large" color="#0ea5e9" style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Stat Cards */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>REVENUE TODAY</Text>
              <Text style={styles.cardValue}>₹{stats.todayRevenue.toFixed(2)}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardLabel}>TOTAL ORDERS TODAY</Text>
              <Text style={styles.cardValue}>{stats.todayOrders}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardLabel}>ACTIVE TABLES</Text>
              <Text style={styles.cardValue}>{stats.activeTables}</Text>
            </View>

            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>⚡ Live Real-Time Dashboard</Text>
              <Text style={styles.infoDesc}>
                Any orders placed via QR codes on tables will update these statistics automatically in real-time.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
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
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  restaurantTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0ea5e9',
  },
  subTitle: {
    fontSize: 12,
    color: '#94a3b8',
  },
  signOutBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  signOutText: {
    color: '#ef4444',
    fontWeight: 'bold',
    fontSize: 14,
  },
  content: {
    padding: 16,
  },
  card: {
    backgroundColor: '#1e293b',
    padding: 20,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#94a3b8',
    marginBottom: 6,
    letterSpacing: 1,
  },
  cardValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  infoCard: {
    backgroundColor: '#0369a122',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#0284c744',
    marginTop: 8,
  },
  infoTitle: {
    color: '#38bdf8',
    fontWeight: 'bold',
    fontSize: 14,
    marginBottom: 4,
  },
  infoDesc: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 18,
  },
});
