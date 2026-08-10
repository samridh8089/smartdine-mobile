import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Platform, Vibration, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { startAlarm, stopAlarm, stopAllAlarms } from '../lib/alarmManager';
import { sendLocalNotification } from '../lib/notifications';
import { COLORS, FONTS, RADIUS, SHADOWS, timeAgo } from '../lib/theme';

const PENDING_CALLS_STORAGE_KEY = '@smartdine_waiter_pending_calls';

export default function WaiterCallsScreen({ route }) {
  const navigation = useNavigation();
  const profile = route?.params?.profile ?? {};
  const [restaurantId, setRestaurantId] = useState(
    profile?.restaurant_id || profile?.restaurants?.id || null
  );

  useEffect(() => {
    async function fetchMissingRestaurantId() {
      if (!restaurantId) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: p } = await supabase
              .from('profiles')
              .select('restaurant_id')
              .eq('id', user.id)
              .maybeSingle();
            if (p?.restaurant_id) setRestaurantId(p.restaurant_id);
          }
        } catch (e) {
          console.log('[WaiterCalls] fetch restaurant_id error:', e?.message);
        }
      }
    }
    fetchMissingRestaurantId();
  }, [restaurantId]);

  const [tabFilter, setTabFilter] = useState('pending'); // 'pending' | 'accepted' | 'completed' | 'all'
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [isOffline, setIsOffline] = useState(false);
  const [pendingQueue, setPendingQueue] = useState([]);

  const knownCallIds = useRef(new Set());

  // Load offline queue on init
  useEffect(() => {
    async function loadPendingQueue() {
      try {
        const stored = await AsyncStorage.getItem(PENDING_CALLS_STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setPendingQueue(parsed);
          }
        }
      } catch (e) {
        console.log('[WaiterCalls] Load pending queue error:', e?.message);
      }
    }
    loadPendingQueue();
  }, []);

  const savePendingQueue = async (queue) => {
    setPendingQueue(queue);
    try {
      await AsyncStorage.setItem(PENDING_CALLS_STORAGE_KEY, JSON.stringify(queue));
    } catch (e) {
      console.log('[WaiterCalls] Save pending queue error:', e?.message);
    }
  };

  const loadCalls = useCallback(async () => {
    if (!restaurantId) { setLoading(false); setRefreshing(false); return; }
    try {
      const { data, error } = await supabase
        .from('customer_requests')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false });

      if (error) {
        console.log('[WaiterCalls] fetch error:', error.message);
        setIsOffline(true);
        return;
      }

      setIsOffline(false);
      const allCalls = data || [];
      setCalls(allCalls);

      // Trigger alarm for pending calls
      const pendingCalls = allCalls.filter(c => c.status === 'pending');
      let hasNew = false;
      pendingCalls.forEach(c => {
        if (!knownCallIds.current.has(c.id)) {
          knownCallIds.current.add(c.id);
          hasNew = true;
        }
      });
      if (hasNew) {
        startAlarm('waiter_call', '🔔 Customer Call', 'A customer needs assistance');
        sendLocalNotification('🔔 Customer Call', 'A customer at a table needs assistance');
        Vibration.vibrate([0, 400, 200, 400]);
      }
      if (pendingCalls.length === 0) {
        stopAlarm('waiter_call');
        Vibration.cancel();
      }
    } catch (e) {
      console.log('[WaiterCalls] load error:', e?.message);
      setIsOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId]);

  // Flush pending queue when online
  const flushPendingQueue = useCallback(async () => {
    if (pendingQueue.length === 0) return;
    console.log(`[WaiterCalls] Retrying ${pendingQueue.length} queued offline actions...`);
    const remaining = [];
    for (const item of pendingQueue) {
      try {
        await supabase
          .from('customer_requests')
          .update({ status: item.status })
          .eq('id', item.callId);
      } catch (err) {
        console.log('[WaiterCalls] Failed retrying pending action:', err?.message);
        remaining.push(item);
      }
    }
    await savePendingQueue(remaining);
    await loadCalls();
  }, [pendingQueue, loadCalls]);

  useEffect(() => {
    if (!isOffline && pendingQueue.length > 0) {
      flushPendingQueue();
    }
  }, [isOffline, pendingQueue, flushPendingQueue]);

  useEffect(() => {
    loadCalls();

    if (!restaurantId) return;
    const sub = supabase.channel(`waiter-calls-realtime-${restaurantId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public',
        table: 'customer_requests',
        filter: `restaurant_id=eq.${restaurantId}`,
      }, loadCalls)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsOffline(false);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setIsOffline(true);
        }
      });

    const poll = setInterval(loadCalls, 4000);
    return () => {
      stopAllAlarms();
      Vibration.cancel();
      supabase.removeChannel(sub);
      clearInterval(poll);
    };
  }, [restaurantId, loadCalls]);

  async function updateCallStatus(callId, targetStatus) {
    // Instantly stop alarm & vibration
    stopAlarm('waiter_call');
    Vibration.cancel();

    // Optimistic UI update immediately
    setCalls(prev => prev.map(c => c.id === callId ? { ...c, status: targetStatus } : c));
    setActionLoading(p => ({ ...p, [callId]: true }));
    try {
      const { error } = await supabase
        .from('customer_requests')
        .update({ status: targetStatus })
        .eq('id', callId);

      if (error) throw error;
      setIsOffline(false);
      await loadCalls();
    } catch (e) {
      console.log('[WaiterCalls] Update call status error (queueing for retry):', e?.message);
      setIsOffline(true);
      const actionItem = {
        type: 'update_call',
        callId,
        status: targetStatus,
        timestamp: Date.now(),
      };
      await savePendingQueue([...pendingQueue, actionItem]);
    } finally {
      setActionLoading(p => ({ ...p, [callId]: false }));
    }
  }

  const resolveCall = (callId) => updateCallStatus(callId, 'completed');
  const acceptCall = (callId) => updateCallStatus(callId, 'completed');

  const pendingCount = calls.filter(c => c.status === 'pending').length;
  const acceptedCount = calls.filter(c => c.status === 'accepted').length;

  const filteredCalls = calls.filter(c => {
    if (tabFilter === 'pending') return c.status === 'pending';
    if (tabFilter === 'accepted') return c.status === 'accepted';
    if (tabFilter === 'completed') return c.status === 'completed';
    return true;
  });

  const renderCallCard = useCallback(({ item }) => {
    const isBusy = actionLoading[item.id];
    const isBill = item.type === 'request_bill' || item.request_type === 'bill';

    return (
      <View style={styles.callCard}>
        <View style={styles.cardMain}>
          <View style={[styles.iconBg, { backgroundColor: isBill ? '#fef3c7' : COLORS.primaryLight }]}>
            <Ionicons
              name={isBill ? 'card-outline' : 'notifications-outline'}
              size={22}
              color={isBill ? '#b45309' : COLORS.primary}
            />
          </View>

          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.tableName}>
              {item.table_name || `Table ${item.table_id || ''}`}
            </Text>

            <Text style={styles.requestTypeText}>
              {isBill ? 'Requested Bill Payment' : 'Called Waiter for Assistance'}
            </Text>

            <Text style={styles.timeAgo}>{timeAgo(item.created_at)}</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actionRow}>
          {item.status === 'pending' && (
            <>
              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: '#3b82f6', marginRight: 8 }]}
                disabled={isBusy}
                onPress={() => acceptCall(item.id)}
              >
                {isBusy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="hand-left-outline" size={16} color="#fff" style={{ marginRight: 4 }} />
                    <Text style={styles.actionBtnText}>Accept</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, { backgroundColor: COLORS.primary }]}
                disabled={isBusy}
                onPress={() => resolveCall(item.id)}
              >
                {isBusy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-done" size={16} color="#fff" style={{ marginRight: 4 }} />
                    <Text style={styles.actionBtnText}>Done</Text>
                  </>
                )}
              </TouchableOpacity>
            </>
          )}

          {item.status === 'accepted' && (
            <TouchableOpacity
              style={[styles.actionBtn, { backgroundColor: COLORS.primary, flex: 1 }]}
              disabled={isBusy}
              onPress={() => resolveCall(item.id)}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-done" size={16} color="#fff" style={{ marginRight: 4 }} />
                  <Text style={styles.actionBtnText}>Mark Resolved</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {item.status === 'completed' && (
            <View style={styles.resolvedBadge}>
              <Ionicons name="checkmark-circle" size={16} color="#22c55e" style={{ marginRight: 4 }} />
              <Text style={styles.resolvedBadgeText}>Resolved</Text>
            </View>
          )}
        </View>
      </View>
    );
  }, [actionLoading]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Guest Calls</Text>
          <Text style={styles.subtitle}>{pendingCount} pending customer requests</Text>
        </View>

        {pendingCount > 0 && (
          <View style={[styles.alertBadge, { marginRight: 8 }]}>
            <Text style={styles.alertBadgeText}>{pendingCount} NEW</Text>
          </View>
        )}

        <TouchableOpacity
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#fee2e2', alignItems: 'center', justifyContent: 'center' }}
          onPress={async () => {
            stopAllAlarms();
            await supabase.auth.signOut().catch(() => {});
            navigation.replace('Login');
          }}
        >
          <Ionicons name="log-out-outline" size={18} color="#ef4444" />
        </TouchableOpacity>
      </View>

      {/* Offline Connectivity Banner */}
      {isOffline && (
        <View style={styles.offlineBanner}>
          <Ionicons name="wifi-outline" size={16} color="#ffffff" style={{ marginRight: 8 }} />
          <Text style={styles.offlineBannerText}>
            ⚡ Offline mode — Changes will auto-sync on reconnect {pendingQueue.length > 0 ? `(${pendingQueue.length} pending)` : ''}
          </Text>
        </View>
      )}

      {/* Tabs */}
      <View style={styles.tabsContainer}>
        <TouchableOpacity
          style={[styles.tabBtn, tabFilter === 'pending' && styles.tabBtnActive]}
          onPress={() => setTabFilter('pending')}
        >
          <Text style={[styles.tabText, tabFilter === 'pending' && styles.tabTextActive]}>
            Pending ({pendingCount})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, tabFilter === 'accepted' && styles.tabBtnActive]}
          onPress={() => setTabFilter('accepted')}
        >
          <Text style={[styles.tabText, tabFilter === 'accepted' && styles.tabTextActive]}>
            Accepted ({acceptedCount})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, tabFilter === 'completed' && styles.tabBtnActive]}
          onPress={() => setTabFilter('completed')}
        >
          <Text style={[styles.tabText, tabFilter === 'completed' && styles.tabTextActive]}>
            Done
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, tabFilter === 'all' && styles.tabBtnActive]}
          onPress={() => setTabFilter('all')}
        >
          <Text style={[styles.tabText, tabFilter === 'all' && styles.tabTextActive]}>
            All
          </Text>
        </TouchableOpacity>
      </View>

      {/* Calls List */}
      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredCalls}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          initialNumToRender={8}
          maxToRenderPerBatch={10}
          windowSize={5}
          removeClippedSubviews={Platform.OS === 'android'}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadCalls(); }} />
          }
          renderItem={renderCallCard}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="checkmark-circle-outline" size={48} color="#cbd5e1" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>No customer requests in this view</Text>
            </View>
          }
        />
      )}
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
  alertBadge: { backgroundColor: '#ef4444', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  alertBadgeText: { color: '#ffffff', fontWeight: '700', fontSize: 12 },
  offlineBanner: {
    backgroundColor: '#3b82f6',
    paddingVertical: 8,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineBannerText: { color: '#ffffff', fontWeight: '600', fontSize: 12 },
  tabsContainer: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    marginHorizontal: 3,
  },
  tabBtnActive: { backgroundColor: COLORS.primary },
  tabText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  tabTextActive: { color: '#ffffff', fontWeight: '700' },
  listContent: { padding: 16 },
  callCard: {
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
  cardMain: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  iconBg: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  tableName: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  requestTypeText: { fontSize: 13, color: '#475569', marginVertical: 2 },
  timeAgo: { fontSize: 12, color: '#94a3b8' },
  actionRow: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  actionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  resolvedBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0fdf4', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  resolvedBadgeText: { color: '#15803d', fontWeight: '700', fontSize: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },
});
