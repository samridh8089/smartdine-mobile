import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Vibration, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { sendSystemAlert } from '../lib/notifications';
import { startAlarm, stopAlarm, isAlarmActive } from '../lib/alarmManager';

export default function WaiterCallsScreen({ route }) {
  const profile = route?.params?.profile || {};
  const restaurantId = profile?.restaurant_id || null;

  const [calls, setCalls] = useState([]);
  const [activeTab, setActiveTab] = useState('pending'); // 'pending' | 'completed' | 'all'
  const [loading, setLoading] = useState(true);
  const knownCallIdsRef = useRef(new Set());

  useEffect(() => {
    fetchCalls();

    // 1. REALTIME WebSocket Subscription
    let channel;
    try {
      channel = supabase
        .channel('waiter-live-calls')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'customer_requests' },
          (payload) => {
            if (payload?.new) {
              if (!restaurantId || payload.new.restaurant_id === restaurantId) {
                Vibration.vibrate([0, 1000, 500, 1000]);
                startAlarm(
                  'waiter_call',
                  'WAITER CALL AT TABLE',
                  `Table ${payload.new.table_name || 'N/A'} - ${payload.new.type === 'request_bill' ? 'Bill Requested' : 'Staff Assistance'}`
                );
                sendSystemAlert(
                  'WAITER CALL AT TABLE',
                  `Table ${payload.new.table_name || 'N/A'} - ${payload.new.type === 'request_bill' ? 'Bill Requested' : 'Staff Assistance'}`
                );
              }
            }
            fetchCalls();
          }
        )
        .subscribe();
    } catch (e) {
      console.log('Calls realtime error:', e);
    }

    // 2. High-Frequency 4-Second Polling
    const interval = setInterval(() => {
      fetchCalls(true);
    }, 4000);

    return () => {
      if (channel) {
        try { supabase.removeChannel(channel); } catch (_) {}
      }
      if (interval) clearInterval(interval);
      try { stopAlarm(); } catch (_) {}
    };
  }, [restaurantId]);

  // Auto-trigger continuous alarm whenever there is a pending waiter call request
  useEffect(() => {
    if (!calls || calls.length === 0) {
      stopAlarm();
      return;
    }

    const hasPendingCall = calls.some(c => c.status === 'pending');

    if (hasPendingCall) {
      const firstPending = calls.find(c => c.status === 'pending');
      startAlarm(
        'waiter_call',
        'WAITER CALL AT TABLE',
        `Table ${firstPending?.table_name || 'N/A'} - ${firstPending?.type === 'request_bill' ? 'Bill Requested' : 'Staff Assistance'}`
      );
    } else {
      stopAlarm();
    }
  }, [calls]);

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
      if (!error && Array.isArray(data)) {
        if (isBackgroundPoll) {
          data.forEach(call => {
            if (call?.id && !knownCallIdsRef.current.has(call.id)) {
              if (call.status === 'pending' && (!restaurantId || call.restaurant_id === restaurantId)) {
                knownCallIdsRef.current.add(call.id);
                startAlarm(
                  'waiter_call',
                  'WAITER CALL AT TABLE',
                  `Table ${call.table_name || 'N/A'} - ${call.type === 'request_bill' ? 'Bill Requested' : 'Staff Assistance'}`
                );
                sendSystemAlert(
                  'WAITER CALL AT TABLE',
                  `Table ${call.table_name || 'N/A'} - ${call.type === 'request_bill' ? 'Bill Requested' : 'Staff Assistance'}`
                );
              }
            }
          });
        } else {
          data.forEach(call => {
            if (call?.status === 'pending' && call?.id) {
              knownCallIdsRef.current.add(call.id);
            }
          });
        }

        setCalls(data);
      }
    } catch (e) {
      console.log('Error fetching waiter calls:', e);
    } finally {
      setLoading(false);
    }
  };

  const resolveCall = async (id) => {
    try {
      const { error } = await supabase
        .from('customer_requests')
        .update({ status: 'completed' })
        .eq('id', id);

      if (!error) {
        stopAlarm();
        fetchCalls();
      }
    } catch (e) {
      console.log('Error resolving call:', e);
    }
  };

  const safeCalls = calls || [];
  const pendingCalls = safeCalls.filter(c => c?.status === 'pending');
  const completedCalls = safeCalls.filter(c => c?.status === 'completed');

  const displayedCalls = 
    activeTab === 'pending' ? pendingCalls :
    activeTab === 'completed' ? completedCalls : safeCalls;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Guest Call Alerts</Text>
          <Text style={styles.subtitle}>Realtime Table Assistance</Text>
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
          style={[styles.tab, activeTab === 'pending' && styles.activeTab]}
          onPress={() => setActiveTab('pending')}
        >
          <Text style={[styles.tabText, activeTab === 'pending' && styles.activeTabText]}>
            Active Calls ({pendingCalls.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'completed' && styles.activeTab]}
          onPress={() => setActiveTab('completed')}
        >
          <Text style={[styles.tabText, activeTab === 'completed' && styles.activeTabText]}>
            Resolved ({completedCalls.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.tab, activeTab === 'all' && styles.activeTab]}
          onPress={() => setActiveTab('all')}
        >
          <Text style={[styles.tabText, activeTab === 'all' && styles.activeTabText]}>
            All ({safeCalls.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* List */}
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#0ea5e9" />
          <Text style={styles.loadingText}>Loading guest calls...</Text>
        </View>
      ) : (
        <FlatList
          data={displayedCalls}
          keyExtractor={(item) => item?.id || Math.random().toString()}
          contentContainerStyle={styles.listContainer}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No guest calls at this moment.</Text>
            </View>
          }
          renderItem={({ item }) => {
            if (!item) return null;
            const isPending = item.status === 'pending';

            return (
              <View style={[styles.card, isPending && styles.pendingCard]}>
                <View style={styles.cardHeader}>
                  <Text style={styles.tableName}>Table: {item.table_name || 'N/A'}</Text>
                  <Text style={styles.requestType}>
                    {item.type === 'request_bill' ? 'Bill Request' : 'Call Waiter'}
                  </Text>
                </View>

                <Text style={styles.timeText}>
                  Called at: {item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                </Text>

                {isPending ? (
                  <TouchableOpacity 
                    style={styles.resolveBtn}
                    onPress={() => resolveCall(item.id)}
                  >
                    <Text style={styles.resolveBtnText}>Mark Attended / Resolved</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.resolvedBadge}>
                    <Text style={styles.resolvedText}>Resolved</Text>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
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
  activeTab: { backgroundColor: '#059669' },
  tabText: { color: '#64748b', fontWeight: 'bold', fontSize: 12 },
  activeTabText: { color: 'white' },
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#64748b', marginTop: 12 },
  listContainer: { padding: 12 },
  emptyState: { padding: 40, alignItems: 'center' },
  emptyText: { color: '#64748b', fontSize: 15 },
  card: { backgroundColor: '#ffffff', borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#0f172a', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 },
  pendingCard: { borderColor: '#fca5a5', backgroundColor: '#fef2f2' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  tableName: { fontSize: 18, fontWeight: 'bold', color: '#0f172a' },
  requestType: { color: '#ef4444', fontWeight: 'bold', fontSize: 14 },
  timeText: { color: '#64748b', fontSize: 12, marginVertical: 6 },
  resolveBtn: { backgroundColor: '#10b981', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  resolveBtnText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
  resolvedBadge: { backgroundColor: '#e2e8f0', padding: 8, borderRadius: 6, alignItems: 'center', marginTop: 4 },
  resolvedText: { color: '#64748b', fontWeight: 'bold', fontSize: 12 },
});
