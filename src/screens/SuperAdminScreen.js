import React, { useEffect, useState } from 'react';
import { 
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Modal, TextInput, ScrollView, ActivityIndicator 
} from 'react-native';
import { supabase } from '../lib/supabase';

export default function SuperAdminScreen() {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [systemStats, setSystemStats] = useState({ totalRevenue: 0, totalOrders: 0 });

  // Modal States
  const [modalVisible, setModalVisible] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [plan, setPlan] = useState('starter');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchRestaurantsAndStats();

    let channel;
    try {
      channel = supabase
        .channel('super-admin-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurants' }, () => fetchRestaurantsAndStats())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchRestaurantsAndStats())
        .subscribe();
    } catch (e) {
      console.log('SuperAdmin channel error:', e);
    }

    return () => {
      if (channel) {
        try { supabase.removeChannel(channel); } catch (_) {}
      }
    };
  }, []);

  const fetchRestaurantsAndStats = async () => {
    try {
      const { data: restData, error: restErr } = await supabase
        .from('restaurants')
        .select('*')
        .order('created_at', { ascending: false });

      if (restErr) throw restErr;

      const { data: ordersData } = await supabase
        .from('orders')
        .select('id, restaurant_id, total, status');

      const restWithStats = (restData || []).map((rest) => {
        const restOrders = (ordersData || []).filter(o => o.restaurant_id === rest.id);
        const restRev = restOrders
          .filter(o => o.status !== 'cancelled')
          .reduce((sum, o) => sum + (Number(o.total) || 0), 0);
        return {
          ...rest,
          orderCount: restOrders.length,
          revenue: restRev,
        };
      });

      const totalRev = (ordersData || [])
        .filter(o => o.status !== 'cancelled')
        .reduce((sum, o) => sum + (Number(o.total) || 0), 0);

      setRestaurants(restWithStats);
      setSystemStats({
        totalRevenue: totalRev,
        totalOrders: (ordersData || []).length,
      });

    } catch (err) {
      console.log('Error fetching super admin stats:', err);
    } finally {
      setLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingItem(null);
    setName('');
    setSlug('');
    setPlan('starter');
    setModalVisible(true);
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setName(item.name || '');
    setSlug(item.slug || '');
    setPlan(item.plan || 'starter');
    setModalVisible(true);
  };

  const handleSaveRestaurant = async () => {
    if (!name || !slug) {
      Alert.alert('Error', 'Please fill in Name and Slug');
      return;
    }

    setSubmitting(true);
    try {
      if (editingItem) {
        const { error } = await supabase
          .from('restaurants')
          .update({ name, slug, plan, updated_at: new Date().toISOString() })
          .eq('id', editingItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('restaurants')
          .insert({ name, slug, plan });
        if (error) throw error;
      }

      setModalVisible(false);
      fetchRestaurantsAndStats();
    } catch (err) {
      Alert.alert('Error', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRestaurant = async (id, restName) => {
    Alert.alert(
      'Delete Restaurant',
      `Are you sure you want to delete ${restName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('restaurants')
                .delete()
                .eq('id', id);
              if (!error) fetchRestaurantsAndStats();
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          }
        }
      ]
    );
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  const renderItem = ({ item }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{item.name}</Text>
        <View style={styles.planBadge}>
          <Text style={styles.planBadgeText}>{item.plan?.toUpperCase() || 'STARTER'}</Text>
        </View>
      </View>
      <Text style={styles.cardSub}>
        Slug: <Text style={styles.highlight}>{item.slug}</Text>
      </Text>

      <View style={styles.metricsRow}>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Total Orders</Text>
          <Text style={styles.metricValue}>{item.orderCount || 0}</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Revenue</Text>
          <Text style={[styles.metricValue, { color: '#10b981' }]}>
            ₹{(item.revenue || 0).toFixed(2)}
          </Text>
        </View>
      </View>

      <View style={styles.cardActions}>
        <TouchableOpacity 
          style={styles.editBtn} 
          onPress={() => openEditModal(item)}
        >
          <Text style={styles.editBtnText}>Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity 
          style={styles.deleteBtn} 
          onPress={() => handleDeleteRestaurant(item.id, item.name)}
        >
          <Text style={styles.deleteBtnText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Super Admin Panel</Text>
          <Text style={styles.subtitle}>Manage All Restaurants & System Stats</Text>
        </View>
        <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      {/* System Overall Revenue Stats Banner */}
      <View style={styles.statsBanner}>
        <View style={styles.statCol}>
          <Text style={styles.statColLabel}>TOTAL SYSTEM REVENUE</Text>
          <Text style={styles.statColValue}>₹{systemStats.totalRevenue.toFixed(2)}</Text>
        </View>
        <View style={styles.statCol}>
          <Text style={styles.statColLabel}>TOTAL RESTAURANTS</Text>
          <Text style={styles.statColValue}>{restaurants.length}</Text>
        </View>
      </View>

      {/* Create Button */}
      <TouchableOpacity style={styles.addButton} onPress={openCreateModal}>
        <Text style={styles.addButtonText}>+ Create New Restaurant</Text>
      </TouchableOpacity>

      {/* Restaurant List */}
      {loading ? (
        <ActivityIndicator size="large" color="#0ea5e9" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={restaurants}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 30 }}
          refreshing={loading}
          onRefresh={fetchRestaurantsAndStats}
        />
      )}

      {/* Create / Edit Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {editingItem ? 'Edit Restaurant' : 'Create New Restaurant'}
            </Text>

            <Text style={styles.label}>Restaurant Name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. A2Z Items"
              placeholderTextColor="#94a3b8"
              value={name}
              onChangeText={setName}
            />

            <Text style={styles.label}>URL Slug</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. a2z-items"
              placeholderTextColor="#94a3b8"
              value={slug}
              onChangeText={setSlug}
              autoCapitalize="none"
            />

            <Text style={styles.label}>Subscription Plan</Text>
            <View style={styles.planSelector}>
              {['starter', 'pro', 'enterprise'].map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.planOption, plan === p && styles.planOptionActive]}
                  onPress={() => setPlan(p)}
                >
                  <Text style={[styles.planOptionText, plan === p && styles.planOptionTextActive]}>
                    {p.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalButtons}>
              <TouchableOpacity 
                style={styles.cancelBtn} 
                onPress={() => setModalVisible(false)}
                disabled={submitting}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.saveBtn} 
                onPress={handleSaveRestaurant}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.saveBtnText}>{editingItem ? 'Save Changes' : 'Create'}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    padding: 16,
    paddingTop: 50,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0ea5e9',
  },
  subtitle: {
    fontSize: 12,
    color: '#64748b',
  },
  signOutBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 12,
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
  statsBanner: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
  },
  statColLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#64748b',
    marginBottom: 4,
  },
  statColValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#10b981',
  },
  addButton: {
    backgroundColor: '#0ea5e9',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 16,
  },
  addButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  card: {
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitle: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: 'bold',
  },
  planBadge: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  planBadgeText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
  cardSub: {
    color: '#64748b',
    fontSize: 13,
    marginBottom: 12,
  },
  highlight: {
    color: '#0ea5e9',
  },
  metricsRow: {
    flexDirection: 'row',
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  metricBox: {
    flex: 1,
    alignItems: 'center',
  },
  metricLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: 'bold',
  },
  metricValue: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 2,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 8,
  },
  editBtn: {
    flex: 1,
    backgroundColor: '#e2e8f0',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  editBtnText: {
    color: '#0f172a',
    fontWeight: 'bold',
  },
  deleteBtn: {
    flex: 1,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  deleteBtnText: {
    color: '#dc2626',
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#ffffff',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0f172a',
    marginBottom: 16,
  },
  label: {
    color: '#0f172a',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: '#f8fafc',
    color: '#0f172a',
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  planSelector: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  planOption: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  planOptionActive: {
    backgroundColor: '#0ea5e9',
    borderColor: '#0ea5e9',
  },
  planOptionText: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: 'bold',
  },
  planOptionTextActive: {
    color: 'white',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 20,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#e2e8f0',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#475569',
    fontWeight: 'bold',
  },
  saveBtn: {
    flex: 1,
    backgroundColor: '#0ea5e9',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtnText: {
    color: 'white',
    fontWeight: 'bold',
  },
});
