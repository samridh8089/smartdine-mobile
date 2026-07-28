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

    const channel = supabase
      .channel('super-admin-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurants' }, () => fetchRestaurantsAndStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchRestaurantsAndStats())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchRestaurantsAndStats = async () => {
    try {
      // Fetch restaurants
      const { data: restData, error: restErr } = await supabase
        .from('restaurants')
        .select('*')
        .order('created_at', { ascending: false });

      if (restErr) throw restErr;

      // Fetch overall orders for revenue calc
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

      const sysRev = restWithStats.reduce((sum, r) => sum + r.revenue, 0);
      const sysOrders = restWithStats.reduce((sum, r) => sum + r.orderCount, 0);

      setRestaurants(restWithStats);
      setSystemStats({ totalRevenue: sysRev, totalOrders: sysOrders });
    } catch (e) {
      console.log('Error fetching restaurants:', e);
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
    setPlan(item.subscription_plan || 'starter');
    setModalVisible(true);
  };

  const handleSaveRestaurant = async () => {
    if (!name || !slug) {
      Alert.alert('Error', 'Please enter both Restaurant Name and Slug');
      return;
    }

    setSubmitting(true);
    try {
      if (editingItem) {
        // Edit existing
        const { error } = await supabase
          .from('restaurants')
          .update({
            name,
            slug: slug.toLowerCase().replace(/\s+/g, '-'),
            subscription_plan: plan,
          })
          .eq('id', editingItem.id);

        if (error) throw error;
        Alert.alert('Success', 'Restaurant updated successfully!');
      } else {
        // Create new
        const { error } = await supabase
          .from('restaurants')
          .insert([
            {
              name,
              slug: slug.toLowerCase().replace(/\s+/g, '-'),
              subscription_plan: plan,
              is_active: true,
            }
          ]);

        if (error) throw error;
        Alert.alert('Success', 'New Restaurant created successfully!');
      }

      setModalVisible(false);
      fetchRestaurantsAndStats();
    } catch (e) {
      Alert.alert('Error', e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRestaurant = (item) => {
    Alert.alert(
      'Delete Restaurant',
      `Are you sure you want to delete "${item.name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Delete', 
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase.from('restaurants').delete().eq('id', item.id);
              if (error) throw error;
              fetchRestaurantsAndStats();
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
          <Text style={styles.planBadgeText}>{item.subscription_plan?.toUpperCase() || 'STARTER'}</Text>
        </View>
      </View>

      <Text style={styles.cardSub}>Slug: <Text style={styles.highlight}>{item.slug}</Text></Text>
      
      <View style={styles.metricsRow}>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Orders</Text>
          <Text style={styles.metricValue}>{item.orderCount}</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Revenue</Text>
          <Text style={styles.metricValue}>₹{item.revenue.toFixed(2)}</Text>
        </View>
      </View>

      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.editBtn} onPress={() => openEditModal(item)}>
          <Text style={styles.editBtnText}>✏️ Edit</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeleteRestaurant(item)}>
          <Text style={styles.deleteBtnText}>🗑️ Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Top Header */}
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
              placeholderTextColor="#64748b"
              value={name}
              onChangeText={setName}
            />

            <Text style={styles.label}>URL Slug</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. a2z-items"
              placeholderTextColor="#64748b"
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
    backgroundColor: '#0f172a',
    padding: 16,
    paddingTop: 50,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#0ea5e9',
  },
  subtitle: {
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
  statsBanner: {
    flexDirection: 'row',
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
  },
  statColLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#94a3b8',
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
    backgroundColor: '#1e293b',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitle: {
    color: 'white',
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
    color: '#94a3b8',
    fontSize: 13,
    marginBottom: 12,
  },
  highlight: {
    color: '#38bdf8',
  },
  metricsRow: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
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
    color: '#f8fafc',
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
    backgroundColor: '#334155',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  editBtnText: {
    color: '#f8fafc',
    fontWeight: 'bold',
    fontSize: 13,
  },
  deleteBtn: {
    backgroundColor: '#991b1b',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  deleteBtnText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 13,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#f8fafc',
    marginBottom: 16,
  },
  label: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    padding: 12,
    color: '#f8fafc',
    fontSize: 15,
    marginBottom: 16,
  },
  planSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 24,
  },
  planOption: {
    flex: 1,
    paddingVertical: 10,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    alignItems: 'center',
  },
  planOptionActive: {
    backgroundColor: '#0ea5e9',
    borderColor: '#38bdf8',
  },
  planOptionText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 'bold',
  },
  planOptionTextActive: {
    color: 'white',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#334155',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  cancelBtnText: {
    color: '#94a3b8',
    fontWeight: 'bold',
  },
  saveBtn: {
    flex: 1,
    backgroundColor: '#0ea5e9',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  saveBtnText: {
    color: 'white',
    fontWeight: 'bold',
  },
});
