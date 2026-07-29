import React, { useEffect, useState, useRef } from 'react';
import { 
  View, Text, StyleSheet, FlatList, TouchableOpacity, Vibration, ActivityIndicator 
} from 'react-native';
import { supabase } from '../lib/supabase';
import { sendSystemAlert, registerPushToken } from '../lib/notifications';
import { getFormattedOrderId } from '../lib/orderUtils';
import { startAlarm, stopAlarm, isAlarmActive } from '../lib/alarmManager';

export default function WaiterOrdersScreen({ route }) {
  const profile = route?.params?.profile || {};
  const restaurantId = profile?.restaurant_id || null;

  const [orders, setOrders] = useState([]);
  const [activeTab, setActiveTab] = useState('ready'); // 'ready' | 'served' | 'all'
  const [loading, setLoading] = useState(true);
  const knownReadyOrderIdsRef = useRef(new Set());

  useEffect(() => {
    if (profile?.id) {
      registerPushToken(profile.id).catch(() => {});
    }
    fetchOrders();

    // 1. WebSocket Realtime Subscription
    let channel;
    try {
      channel = supabase
        .channel('waiter-live-deliveries')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'orders' },
          (payload) => {
            if (payload?.new && payload.new.status === 'ready') {
              if (!restaurantId || payload.new.restaurant_id === restaurantId) {
                Vibration.vibrate([0, 800, 400, 800]);
                startAlarm(
                  'food_ready',
                  'FOOD READY TO SERVE',
                  `Table ${payload.new.table_name || 'N/A'} - Deliver to table now!`
                );
                sendSystemAlert(
                  'FOOD READY TO SERVE',
                  `Table ${payload.new.table_name || 'N/A'} order is ready for pickup!`
                );
              }
            }
            fetchOrders();
          }
        )
        .subscribe();
    } catch (e) {
      console.log('Waiter realtime error:', e);
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
            if (ord?.id && !knownReadyOrderIdsRef.current.has(ord.id)) {
              if (ord.status === 'ready' && (!restaurantId || ord.restaurant_id === restaurantId)) {
                knownReadyOrderIdsRef.current.add(ord.id);
                startAlarm(
                  'food_ready',
                  'FOOD READY TO SERVE',
                  `Table ${ord.table_name || 'N/A'} - Deliver to table now!`
                );
                sendSystemAlert(
                  'FOOD READY TO SERVE',
                  `Table ${ord.table_name || 'N/A'} order is ready for pickup!`
                );
              }
            }
          });
        } else {
          data.forEach(ord => {
            if (ord?.status === 'ready' && ord?.id) {
              knownReadyOrderIdsRef.current.add(ord.id);
            }
          });
        }

        setOrders(data);
      }
    } catch (e) {
      console.log('Error fetching waiter orders:', e);
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
        stopAlarm();
        fetchOrders();
      } else {
        Alert.alert('Error', error.message);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to update order status');
    }
  };

  const safeOrders = orders || [];
  const readyOrders = safeOrders.filter(o => o?.status === 'ready');
  const servedOrders = safeOrders.filter(o => ['served', 'completed'].includes(o?.status));
  
  const displayedOrders = 
    activeTab === 'ready' ? readyOrders :
    activeTab === 'served' ? servedOrders : safeOrders;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Food Deliveries</Text>
          <Text style={styles.subtitle}>Waiter Delivery Portal</Text>
        </View>

        {isAlarmActive() && (
          <TouchableOpacity onPress={() => stopAlarm()} style={styles.stopAlarmBtn}>
            <Text style={styles.stopAlarmText}>STOP ALARM</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'ready' && styles.activeTab]}
          onPress={() => setActiveTab('ready')}
        >
          <Text style={[styles.tabText, activeTab === 'ready' && styles.activeTabText]}>
            Ready to Serve ({readyOrders.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'served' && styles.activeTab]}
          onPress={() => setActiveTab('served')}
        >
          <Text style={[styles.tabText, activeTab === 'served' && styles.activeTabText]}>
            Served ({servedOrders.length})
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

      {/* Orders List */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#0ea5e9" />
          <Text style={styles.loadingText}>Loading delivery orders...</Text>
        </View>
      ) : (
        <FlatList
          data={displayedOrders}
          keyExtractor={(item) => item?.id || Math.random().toString()}
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No orders in this delivery section.</Text>
            </View>
          }
          renderItem={({ item }) => {
            if (!item) return null;
            const items = item.order_items || [];

            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.tableName}>Table: {item.table_name || 'N/A'}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(item.status) }]}>
                    <Text style={styles.statusText}>{(item.status || 'NEW').toUpperCase()}</Text>
                  </View>
                </View>

                <Text style={styles.metaText}>
                  Order {getFormattedOrderId(item, '', safeOrders)} • {item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                </Text>

                <View style={styles.itemsBox}>
                  {items.map((it, idx) => (
                    <Text key={idx} style={styles.itemText}>
                      • {it?.quantity || 1}x {it?.menu_item_name || it?.name || 'Item'}
                    </Text>
                  ))}
                </View>

                {item.status === 'ready' && (
                  <TouchableOpacity 
                    style={styles.serveBtn}
                    onPress={() => updateStatus(item.id, 'served')}
                  >
                    <Text style={styles.serveBtnText}>Mark as Served to Table</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

function getStatusColor(status) {
  switch (status) {
    case 'ready': return '#8b5cf6';
    case 'served': return '#10b981';
    case 'completed': return '#64748b';
    default: return '#0ea5e9';
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
  activeTab: { backgroundColor: '#0ea5e9' },
  tabText: { color: '#64748b', fontWeight: 'bold', fontSize: 12 },
  activeTabText: { color: 'white' },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#64748b', marginTop: 12 },
  listContainer: { padding: 12 },
  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#64748b', fontSize: 15 },
  card: { backgroundColor: '#ffffff', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#0f172a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tableName: { fontSize: 18, fontWeight: 'bold', color: '#0f172a' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText: { color: 'white', fontSize: 11, fontWeight: 'bold' },
  metaText: { color: '#64748b', fontSize: 12, marginVertical: 4 },
  itemsBox: { backgroundColor: '#f8fafc', borderRadius: 8, padding: 10, marginVertical: 8, borderWidth: 1, borderColor: '#f1f5f9' },
  itemText: { color: '#0f172a', fontSize: 14, marginVertical: 2 },
  serveBtn: { backgroundColor: '#10b981', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  serveBtnText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
});
