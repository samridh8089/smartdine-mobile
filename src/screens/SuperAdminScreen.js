import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { COLORS, FONTS, RADIUS, SHADOWS, formatCurrency } from '../lib/theme';

export default function SuperAdminScreen({ navigation, route }) {
  const profile = route?.params?.profile ?? {};

  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRest, setEditingRest] = useState(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [plan, setPlan] = useState('PRO');
  const [saving, setSaving] = useState(false);

  const fetchRestaurants = useCallback(async () => {
    try {
      const [{ data: restData }, { data: ordersData }] = await Promise.all([
        supabase.from('restaurants').select('*').order('created_at', { ascending: false }),
        supabase.from('orders').select('restaurant_id, total, status'),
      ]);

      const restList = restData || [];
      const ordersList = ordersData || [];

      const statsMap = {};
      ordersList.forEach(o => {
        if (!statsMap[o.restaurant_id]) {
          statsMap[o.restaurant_id] = { count: 0, revenue: 0 };
        }
        statsMap[o.restaurant_id].count += 1;
        if (o.status !== 'cancelled') {
          statsMap[o.restaurant_id].revenue += o.total || 0;
        }
      });

      const combined = restList.map(r => ({
        ...r,
        orderCount: statsMap[r.id]?.count || 0,
        revenue: statsMap[r.id]?.revenue || 0,
      }));

      setRestaurants(combined);
    } catch (e) {
      console.log('SuperAdmin fetch error:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRestaurants();
  }, [fetchRestaurants]);

  function openCreateModal() {
    setEditingRest(null);
    setName('');
    setSlug('');
    setPlan('PRO');
    setModalVisible(true);
  }

  function openEditModal(rest) {
    setEditingRest(rest);
    setName(rest.name || '');
    setSlug(rest.slug || '');
    setPlan(rest.subscription_plan || 'PRO');
    setModalVisible(true);
  }

  async function handleSave() {
    if (!name.trim()) { Alert.alert('Error', 'Restaurant name is required'); return; }
    setSaving(true);
    try {
      if (editingRest) {
        await supabase
          .from('restaurants')
          .update({ name, slug: slug.trim().toLowerCase(), subscription_plan: plan })
          .eq('id', editingRest.id);
      } else {
        await supabase
          .from('restaurants')
          .insert({ name, slug: slug.trim().toLowerCase() || name.toLowerCase().replace(/\s+/g, '-'), subscription_plan: plan });
      }

      setModalVisible(false);
      await fetchRestaurants();
    } catch (e) {
      Alert.alert('Error', e.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(rest) {
    Alert.alert(
      'Delete Restaurant',
      `Are you sure you want to delete "${rest.name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await supabase.from('restaurants').delete().eq('id', rest.id);
              await fetchRestaurants();
            } catch (e) {
              Alert.alert('Error', 'Delete failed');
            }
          },
        },
      ]
    );
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    if (navigation?.replace) {
      navigation.replace('Login');
    }
  }

  const totalSystemRevenue = restaurants.reduce((s, r) => s + r.revenue, 0);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Super Admin</Text>
          <Text style={styles.subtitle}>System Overview & Restaurants</Text>
        </View>

        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={18} color="#ef4444" style={{ marginRight: 4 }} />
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* Stats Banner */}
      <View style={styles.statsBanner}>
        <View style={styles.statCol}>
          <Text style={styles.statLabel}>Total Restaurants</Text>
          <Text style={styles.statValue}>{restaurants.length}</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statCol}>
          <Text style={styles.statLabel}>System Revenue</Text>
          <Text style={styles.statValue}>{formatCurrency(totalSystemRevenue)}</Text>
        </View>
      </View>

      {/* Create Button */}
      <View style={styles.actionRow}>
        <TouchableOpacity style={styles.createBtn} onPress={openCreateModal}>
          <Ionicons name="add-circle-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
          <Text style={styles.createBtnText}>Add New Restaurant</Text>
        </TouchableOpacity>
      </View>

      {/* Restaurants List */}
      {loading && !refreshing ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={restaurants}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchRestaurants(); }} />
          }
          renderItem={({ item }) => (
            <View style={styles.restCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.restName}>{item.name}</Text>
                <View style={styles.planBadge}>
                  <Text style={styles.planBadgeText}>{item.subscription_plan || 'PRO'}</Text>
                </View>
              </View>

              <Text style={styles.slugText}>Slug: {item.slug || 'n/a'}</Text>

              <View style={styles.cardMetrics}>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>Orders</Text>
                  <Text style={styles.metricVal}>{item.orderCount}</Text>
                </View>
                <View style={styles.metricItem}>
                  <Text style={styles.metricLabel}>Revenue</Text>
                  <Text style={styles.metricVal}>{formatCurrency(item.revenue)}</Text>
                </View>
              </View>

              <View style={styles.cardActions}>
                <TouchableOpacity style={[styles.cardBtn, { backgroundColor: '#f1f5f9' }]} onPress={() => openEditModal(item)}>
                  <Ionicons name="pencil" size={14} color="#475569" style={{ marginRight: 4 }} />
                  <Text style={{ color: '#475569', fontWeight: '600', fontSize: 13 }}>Edit</Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.cardBtn, { backgroundColor: '#fef2f2', marginLeft: 8 }]} onPress={() => handleDelete(item)}>
                  <Ionicons name="trash-outline" size={14} color="#ef4444" style={{ marginRight: 4 }} />
                  <Text style={{ color: '#ef4444', fontWeight: '600', fontSize: 13 }}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* Create / Edit Modal */}
      <Modal visible={modalVisible} animationType="fade" transparent onRequestClose={() => setModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>{editingRest ? 'Edit Restaurant' : 'Create Restaurant'}</Text>

            <Text style={styles.inputLabel}>Restaurant Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Urban Cafe"
              placeholderTextColor="#94a3b8"
              value={name}
              onChangeText={setName}
            />

            <Text style={styles.inputLabel}>Slug (URL identifier)</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. urban-cafe"
              placeholderTextColor="#94a3b8"
              value={slug}
              onChangeText={setSlug}
            />

            <Text style={styles.inputLabel}>Subscription Plan</Text>
            <View style={styles.planRow}>
              {['STARTER', 'PRO', 'ENTERPRISE'].map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.planBtn, plan === p && styles.planBtnActive]}
                  onPress={() => setPlan(p)}
                >
                  <Text style={[styles.planBtnText, plan === p && styles.planBtnTextActive]}>{p}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: 20 }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: '#f1f5f9' }]} onPress={() => setModalVisible(false)}>
                <Text style={{ color: '#64748b', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: COLORS.primary, marginLeft: 10 }]} disabled={saving} onPress={handleSave}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fef2f2', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  signOutText: { color: '#ef4444', fontWeight: '700', fontSize: 12 },
  statsBanner: { flexDirection: 'row', backgroundColor: COLORS.primary, marginHorizontal: 16, marginTop: 12, borderRadius: 14, padding: 16, alignItems: 'center' },
  statCol: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, height: 40, backgroundColor: 'rgba(255, 255, 255, 0.2)' },
  statLabel: { color: '#ffffff', opacity: 0.8, fontSize: 12, marginBottom: 2 },
  statValue: { color: '#ffffff', fontWeight: '700', fontSize: 20 },
  actionRow: { paddingHorizontal: 16, marginTop: 12 },
  createBtn: { backgroundColor: COLORS.primary, paddingVertical: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  createBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
  listContent: { padding: 16 },
  restCard: { backgroundColor: '#ffffff', borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9', elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  restName: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  planBadge: { backgroundColor: COLORS.primaryLight, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  planBadgeText: { color: COLORS.primary, fontWeight: '700', fontSize: 11 },
  slugText: { fontSize: 12, color: '#94a3b8', marginBottom: 12 },
  cardMetrics: { flexDirection: 'row', backgroundColor: '#f8fafc', padding: 10, borderRadius: 8, marginBottom: 12 },
  metricItem: { flex: 1, alignItems: 'center' },
  metricLabel: { fontSize: 11, color: '#64748b' },
  metricVal: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginTop: 2 },
  cardActions: { flexDirection: 'row', justifyContent: 'flex-end' },
  cardBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.5)', justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: '#ffffff', borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 16 },
  inputLabel: { fontSize: 12, fontWeight: '600', color: '#334155', marginBottom: 4, marginTop: 8 },
  input: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 10, fontSize: 14, color: '#0f172a' },
  planRow: { flexDirection: 'row', marginTop: 6 },
  planBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8, backgroundColor: '#f1f5f9', marginHorizontal: 2 },
  planBtnActive: { backgroundColor: COLORS.primary },
  planBtnText: { fontSize: 11, fontWeight: '600', color: '#64748b' },
  planBtnTextActive: { color: '#ffffff', fontWeight: '700' },
  modalBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
});
