import React, { useEffect, useState, useRef } from 'react';
import { 
  View, Text, StyleSheet, FlatList, TouchableOpacity, Vibration, ActivityIndicator 
} from 'react-native';
import { supabase } from '../lib/supabase';
import { sendSystemAlert, registerPushToken } from '../lib/notifications';
import { getFormattedOrderId } from '../lib/orderUtils';
import { startAlarm, stopAlarm } from '../lib/alarmManager';
import { checkAndPromptBatteryOptimization, openBatteryOptimizationSettings } from '../lib/batteryManager';

export default function WaiterOrdersScreen({ route }) {
  const profile = route?.params?.profile || {};
  const restaurantId = profile.restaurant_id || null;

  const [orders, setOrders] = useState([]);
  const [activeTab, setActiveTab] = useState('ready'); // 'ready' | 'served' | 'all'
  const [loading, setLoading] = useState(true);
  const knownReadyOrderIdsRef = useRef(new Set());

  useEffect(() => {
    if (profile?.id) {
      registerPushToken(profile.id);
    }
    checkAndPromptBatteryOptimization();
    fetchOrders();

    // 1. WebSocket Realtime Subscription
    const channel = supabase
      .channel('waiter-live-deliveries')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          if (payload.new && payload.new.status === 'ready') {
            Vibration.vibrate([0, 1000, 500, 1000]);
            // Start continuous alarm when food is ready
            startAlarm(
              'food_ready',
              'FOOD READY TO SERVE!',
              `Table ${payload.new.table_name || 'N/A'} - Deliver to table now!`
            );
            sendSystemAlert(
              'FOOD READY TO SERVE!',
              `Table ${payload.new.table_name || 'N/A'} order is ready for pickup!`
            );
          }
          fetchOrders();
        }
      )
      .subscribe();

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

  const fetchOrders = async (isBackgroundPoll = false) => {
    try {
      let query = supabase
        .from('orders')
        .select('*, order_items(*)')
        .order('updated_at', { ascending: false });

      if (restaurantId) {
        query = query.eq('restaurant_id', restaurantId);
      }

      const { data, error } = await query;
      if (!error && data) {
        if (isBackgroundPoll) {
          data.filter(o => o.status === 'ready').forEach(ord => {
            if (!knownReadyOrderIdsRef.current.has(ord.id)) {
              knownReadyOrderIdsRef.current.add(ord.id);
              Vibration.vibrate([0, 1000, 500, 1000]);
              // Continuous alarm for food ready
              startAlarm(
                'food_ready',
                'FOOD READY TO SERVE!',
                `Table ${ord.table_name || 'N/A'} - Deliver to table now!`
              );
              sendSystemAlert(
                'FOOD READY TO SERVE!',
                `Table ${ord.table_name || 'N/A'} order is ready for pickup!`
              );
            }
          });
        } else {
          data.filter(o => o.status === 'ready').forEach(ord => knownReadyOrderIdsRef.current.add(ord.id));
        }

        setOrders(data);
      }
    } catch (e) {
      console.log('Error fetching waiter orders:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDeliver = async (orderId) => {
    await supabase
      .from('orders')
      .update({ status: 'served', updated_at: new Date().toISOString() })
      .eq('id', orderId);
    // Stop alarm when waiter delivers the food
    stopAlarm();
    fetchOrders();
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const filteredOrders = orders.filter(o => {
    if (activeTab === 'ready') return o.status === 'ready';
    if (activeTab === 'served') return ['served', 'completed'].includes(o.status);
    return ['ready', 'preparing', 'accepted', 'served'].includes(o.status); // 'all'
  });

  const getTimeElapsed = (createdAt) => {
    const diffMs = new Date() - new Date(createdAt);
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    return `${Math.floor(diffMins / 60)}h ${diffMins % 60}m ago`;
  };

  const renderItem = ({ item }) => {
    const itemList = item.order_items || item.items || [];
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardTitle}>Table {item.table_name || 'N/A'}</Text>
            <Text style={styles.orderType}>
              {item.order_type === 'takeaway' ? '📦 Takeaway' : '🍽️ Dine-In'}
            </Text>
          </View>

          <View style={{ alignItems: 'flex-end' }}>
            <View style={[
              styles.readyBadge,
              { backgroundColor: item.status === 'ready' ? '#10b98122' : '#8b5cf622' }
            ]}>
              <Text style={[
                styles.readyBadgeText,
                { color: item.status === 'ready' ? '#10b981' : '#8b5cf6' }
              ]}>
                {item.status === 'ready' ? 'FOOD READY 🔔' : item.status.toUpperCase()}
              </Text>
            </View>
            <Text style={styles.timeElapsedText}>⏱️ {getTimeElapsed(item.created_at)}</Text>
          </View>
        </View>

        <Text style={styles.cardSub}>
          Order {getFormattedOrderId(item, 'Bistro Cafe', orders)} • Time: {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>

        {/* Complete Items Breakdown */}
        <View style={styles.itemsBox}>
          <Text style={styles.itemsHeader}>ITEMS SUMMARY ({itemList.reduce((s, i) => s + (i.quantity || 1), 0)}):</Text>
          {itemList.map((it, idx) => (
            <View key={idx} style={styles.itemRow}>
              <Text style={styles.itemQty}>{it.quantity || 1}x</Text>
              <Text style={styles.itemName}>{it.menu_item_name || it.name || 'Item'}</Text>
              <Text style={styles.itemPrice}>₹{((it.price || 0) * (it.quantity || 1)).toFixed(2)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Bill Amount:</Text>
          <Text style={styles.totalValue}>₹{Number(item.total || 0).toFixed(2)}</Text>
        </View>

        {item.status === 'ready' ? (
          <TouchableOpacity style={styles.actionBtn} onPress={() => handleDeliver(item.id)}>
            <Text style={styles.actionText}>Mark Delivered to Table ✅</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.deliveredDoneBox}>
            <Text style={styles.deliveredDoneText}>Food Served to Table ✅</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Waiter Delivery Hub</Text>
          <Text style={styles.subtitle}>Food Pickups & Service Control</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <TouchableOpacity onPress={() => openBatteryOptimizationSettings()} style={[styles.signOutBtn, { backgroundColor: 'rgba(234, 179, 8, 0.15)', borderColor: '#eab308', borderWidth: 1, marginRight: 8 }]}>
            <Text style={[styles.signOutText, { color: '#eab308' }]}>🔋 Battery</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn}>
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'ready' && styles.tabActive]} 
          onPress={() => setActiveTab('ready')}
        >
          <Text style={[styles.tabText, activeTab === 'ready' && styles.tabTextActive]}>
            🔔 Ready ({orders.filter(o => o.status === 'ready').length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'served' && styles.tabActive]} 
          onPress={() => setActiveTab('served')}
        >
          <Text style={[styles.tabText, activeTab === 'served' && styles.tabTextActive]}>
            ✅ Delivered ({orders.filter(o => ['served', 'completed'].includes(o.status)).length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'all' && styles.tabActive]} 
          onPress={() => setActiveTab('all')}
        >
          <Text style={[styles.tabText, activeTab === 'all' && styles.tabTextActive]}>
            📋 All ({orders.length})
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredOrders}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator size="large" color="#0ea5e9" style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🍽️</Text>
              <Text style={styles.emptyText}>No food in this tab</Text>
              <Text style={styles.emptySub}>When kitchen marks an order 'Ready', lockscreen alerts and ringtones will trigger immediately.</Text>
            </View>
          )
        }
        onRefresh={fetchOrders}
        refreshing={loading}
      />
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
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: { fontSize: 22, fontWeight: 'bold', color: '#10b981' },
  subtitle: { fontSize: 12, color: '#94a3b8' },
  signOutBtn: { backgroundColor: '#334155', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  signOutText: { color: '#ef4444', fontWeight: 'bold', fontSize: 13 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    padding: 6,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
  },
  tab: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
  tabActive: { backgroundColor: '#10b981' },
  tabText: { color: '#94a3b8', fontSize: 12, fontWeight: 'bold' },
  tabTextActive: { color: 'white' },
  card: {
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 14,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  cardTitle: { color: 'white', fontSize: 22, fontWeight: 'bold' },
  orderType: { color: '#94a3b8', fontSize: 12 },
  readyBadge: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginBottom: 4 },
  readyBadgeText: { fontSize: 10, fontWeight: 'bold' },
  timeElapsedText: { color: '#f59e0b', fontSize: 11, fontWeight: 'bold' },
  cardSub: { color: '#64748b', fontSize: 12, marginBottom: 12 },
  itemsBox: { backgroundColor: '#0f172a', padding: 12, borderRadius: 10, marginBottom: 12 },
  itemsHeader: { color: '#64748b', fontSize: 10, fontWeight: 'bold', marginBottom: 6 },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  itemQty: { color: '#10b981', fontSize: 14, fontWeight: 'bold', width: 28 },
  itemName: { color: '#f8fafc', fontSize: 14, flex: 1 },
  itemPrice: { color: '#94a3b8', fontSize: 13, fontWeight: 'bold' },
  totalRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  totalLabel: { color: '#94a3b8', fontSize: 14, marginRight: 8 },
  totalValue: { color: '#10b981', fontSize: 18, fontWeight: 'bold' },
  actionBtn: { backgroundColor: '#10b981', padding: 14, borderRadius: 10, alignItems: 'center' },
  actionText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
  deliveredDoneBox: { backgroundColor: '#334155', padding: 10, borderRadius: 8, alignItems: 'center' },
  deliveredDoneText: { color: '#94a3b8', fontWeight: 'bold', fontSize: 13 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { color: '#f8fafc', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  emptySub: { color: '#64748b', fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
});
