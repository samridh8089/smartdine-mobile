import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Vibration, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { sendSystemAlert } from '../lib/notifications';

export default function WaiterCallsScreen({ route }) {
  const profile = route.params?.profile || {};
  const restaurantId = profile.restaurant_id || null;

  const [calls, setCalls] = useState([]);
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'completed' | 'all'
  const [loading, setLoading] = useState(true);
  const knownCallIdsRef = useRef(new Set());

  useEffect(() => {
    fetchCalls();

    // 1. REALTIME WebSocket Subscription
    const channel = supabase
      .channel('waiter-live-calls')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'customer_requests' },
        (payload) => {
          if (payload.new && payload.new.status === 'pending') {
            Vibration.vibrate([0, 1000, 500, 1000, 500, 1000]);
            sendSystemAlert(
              payload.new.type === 'request_bill' ? '💳 BILL REQUESTED!' : '🔔 WAITER CALLED!',
              `Table ${payload.new.table_name || 'N/A'} is requesting assistance!`
            );
          }
          fetchCalls();
        }
      )
      .subscribe();

    // 2. High-Frequency 4-Second Polling
    const interval = setInterval(() => {
      fetchCalls(true);
    }, 4000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [restaurantId]);

  const fetchCalls = async (isBackgroundPoll = false) => {
    try {
      let query = supabase
        .from('customer_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (restaurantId) {
        query = query.eq('restaurant_id', restaurantId);
      }

      const { data, error } = await query;
      if (!error && data) {
        if (isBackgroundPoll) {
          data.filter(c => c.status === 'pending').forEach(req => {
            if (!knownCallIdsRef.current.has(req.id)) {
              knownCallIdsRef.current.add(req.id);
              Vibration.vibrate([0, 1000, 500, 1000, 500, 1000]);
              sendSystemAlert(
                req.type === 'request_bill' ? '💳 BILL REQUESTED!' : '🔔 WAITER CALLED!',
                `Table ${req.table_name || 'N/A'} is requesting assistance!`
              );
            }
          });
        } else {
          data.filter(c => c.status === 'pending').forEach(req => knownCallIdsRef.current.add(req.id));
        }

        setCalls(data);
      }
    } catch (e) {
      console.log('Error fetching customer requests:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleAttend = async (callId) => {
    await supabase.from('customer_requests').update({ status: 'completed' }).eq('id', callId);
    fetchCalls();
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const filteredCalls = calls.filter(c => {
    if (activeTab === 'pending') return c.status === 'pending';
    if (activeTab === 'completed') return c.status === 'completed';
    return true; // 'all'
  });

  const getTimeElapsed = (createdAt) => {
    const diffMs = new Date() - new Date(createdAt);
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    return `${Math.floor(diffMins / 60)}h ${diffMins % 60}m ago`;
  };

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.cardTitle}>Table {item.table_name || 'N/A'}</Text>
          <Text style={styles.timeElapsedText}>⏱️ {getTimeElapsed(item.created_at)}</Text>
        </View>

        <View style={[
          styles.typeBadge, 
          { backgroundColor: item.type === 'request_bill' ? '#f59e0b22' : '#ef444422' }
        ]}>
          <Text style={[
            styles.typeBadgeText, 
            { color: item.type === 'request_bill' ? '#f59e0b' : '#ef4444' }
          ]}>
            {item.type === 'request_bill' ? '💳 BILL REQUEST' : '🔔 CALL WAITER'}
          </Text>
        </View>
      </View>

      <Text style={styles.cardSub}>
        Received: {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>

      {item.status === 'pending' ? (
        <TouchableOpacity style={styles.actionBtn} onPress={() => handleAttend(item.id)}>
          <Text style={styles.actionText}>Mark Attended ✅</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.attendedDoneBox}>
          <Text style={styles.attendedDoneText}>Request Completed ✅</Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Guest Calls & Bills</Text>
          <Text style={styles.subtitle}>Live Real-time Table Assistance</Text>
        </View>
        <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity 
          style={[styles.tab, activeTab === 'pending' && styles.tabActive]} 
          onPress={() => setActiveTab('pending')}
        >
          <Text style={[styles.tabText, activeTab === 'pending' && styles.tabTextActive]}>
            🔔 Active ({calls.filter(c => c.status === 'pending').length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'completed' && styles.tabActive]} 
          onPress={() => setActiveTab('completed')}
        >
          <Text style={[styles.tabText, activeTab === 'completed' && styles.tabTextActive]}>
            ✅ Attended ({calls.filter(c => c.status === 'completed').length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'all' && styles.tabActive]} 
          onPress={() => setActiveTab('all')}
        >
          <Text style={[styles.tabText, activeTab === 'all' && styles.tabTextActive]}>
            📋 All ({calls.length})
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filteredCalls}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator size="large" color="#ef4444" style={{ marginTop: 40 }} />
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🔔</Text>
              <Text style={styles.emptyText}>No active table requests</Text>
              <Text style={styles.emptySub}>Guest calls and bill requests will ring system notifications even when phone is locked.</Text>
            </View>
          )
        }
        onRefresh={fetchCalls}
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
  title: { fontSize: 22, fontWeight: 'bold', color: '#ef4444' },
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
  tabActive: { backgroundColor: '#ef4444' },
  tabText: { color: '#94a3b8', fontSize: 12, fontWeight: 'bold' },
  tabTextActive: { color: 'white' },
  card: {
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  cardTitle: { color: 'white', fontSize: 22, fontWeight: 'bold' },
  timeElapsedText: { color: '#f59e0b', fontSize: 11, fontWeight: 'bold', marginTop: 2 },
  typeBadge: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  typeBadgeText: { fontSize: 11, fontWeight: 'bold' },
  cardSub: { color: '#94a3b8', fontSize: 13, marginBottom: 14 },
  actionBtn: { backgroundColor: '#3b82f6', padding: 14, borderRadius: 10, alignItems: 'center' },
  actionText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
  attendedDoneBox: { backgroundColor: '#334155', padding: 10, borderRadius: 8, alignItems: 'center' },
  attendedDoneText: { color: '#94a3b8', fontWeight: 'bold', fontSize: 13 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 60 },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyText: { color: '#f8fafc', fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  emptySub: { color: '#64748b', fontSize: 13, textAlign: 'center', paddingHorizontal: 32 },
});
