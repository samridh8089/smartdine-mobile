import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, Alert, Modal, ScrollView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { COLORS } from '../lib/theme';
import {
  fetchTableAssignments,
  setTableAssignmentsForWaiter,
  findTableAssignmentConflicts,
  fetchLiveTableStatus,
  toggleTableQRStatus,
} from '../lib/tableAssignments';

export default function TableAssignmentScreen({ route, navigation }) {
  const profile = route?.params?.profile;
  const restaurantId = profile?.restaurant_id;
  const userRole = profile?.role || 'owner';
  const userDept = profile?.department || '';

  const canControl = ['owner', 'manager', 'super_admin'].includes(userRole) || 
                     (userRole === 'supervisor' && (userDept === 'waiter' || !userDept));

  const [activeTab, setActiveTab] = useState('roster'); // 'roster' | 'waiters'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [waiters, setWaiters] = useState([]);
  const [tables, setTables] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [tableStats, setTableStats] = useState({
    total: 0,
    available: 0,
    occupied: 0,
    inactive: 0,
    occupancyRate: 0,
  });

  // Assignment Modal State
  const [selectedWaiter, setSelectedWaiter] = useState(null);
  const [selectedTableIds, setSelectedTableIds] = useState([]);
  const [saving, setSaving] = useState(false);

  // Conflict Modal State
  const [conflicts, setConflicts] = useState([]);
  const [conflictModalVisible, setConflictModalVisible] = useState(false);

  // QR Action Loading
  const [qrActionLoading, setQrActionLoading] = useState({});

  useEffect(() => {
    loadData();

    if (!restaurantId) return;
    const channel = supabase
      .channel(`table_assign_realtime_${restaurantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurants', filter: `id=eq.${restaurantId}` }, () => {
        loadDataSilently();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` }, () => {
        loadDataSilently();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurantId]);

  async function loadData() {
    if (!restaurantId) return;
    setLoading(true);
    try {
      const { tables: liveTbls, stats } = await fetchLiveTableStatus(restaurantId);
      setTables(liveTbls || []);
      if (stats) setTableStats(stats);

      const { data: profData } = await supabase
        .from('profiles')
        .select('*')
        .eq('restaurant_id', restaurantId);

      const staffList = (profData || []).filter(p => 
        p.role !== 'deleted' && p.role !== 'inactive' && !p.deleted_at &&
        (p.role === 'waiter' || (p.role === 'supervisor' && (p.department === 'waiter' || !p.department)))
      );
      setWaiters(staffList);

      const assigns = await fetchTableAssignments(restaurantId);
      setAssignments(assigns || []);
    } catch (e) {
      console.log('[TableAssignmentScreen] Error loading data:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadDataSilently() {
    if (!restaurantId) return;
    try {
      const [{ tables: liveTbls, stats }, assigns] = await Promise.all([
        fetchLiveTableStatus(restaurantId),
        fetchTableAssignments(restaurantId),
      ]);
      setTables(liveTbls || []);
      if (stats) setTableStats(stats);
      setAssignments(assigns || []);
    } catch (e) {
      console.log('[TableAssignmentScreen] Error syncing data:', e?.message);
    }
  }

  async function handleToggleQR(table) {
    if (!canControl) {
      Alert.alert('Permission Denied', 'Only Owners, Managers, and Waiter Supervisors can control QR codes.');
      return;
    }
    const newStatus = table.qr_enabled === false;
    setQrActionLoading(prev => ({ ...prev, [table.id]: true }));
    try {
      await toggleTableQRStatus(restaurantId, table.id, newStatus);
      await loadDataSilently();
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to update QR status');
    } finally {
      setQrActionLoading(prev => ({ ...prev, [table.id]: false }));
    }
  }

  function handleOpenAssignModal(waiter) {
    if (!canControl) {
      Alert.alert('Permission Denied', 'Only Owners, Managers, and Waiter Supervisors can assign tables.');
      return;
    }
    setSelectedWaiter(waiter);
    const assigned = assignments
      .filter(a => a.waiter_id === waiter.id && a.active !== false)
      .map(a => a.table_id);
    setSelectedTableIds(assigned);
  }

  function toggleTableSelection(tableId) {
    setSelectedTableIds(prev => 
      prev.includes(tableId) ? prev.filter(id => id !== tableId) : [...prev, tableId]
    );
  }

  async function handleCheckConflictsAndSave() {
    if (!restaurantId || !selectedWaiter) return;
    const detectedConflicts = findTableAssignmentConflicts(assignments, selectedWaiter.id, selectedTableIds);
    if (detectedConflicts.length > 0) {
      setConflicts(detectedConflicts);
      setConflictModalVisible(true);
      return;
    }
    await executeSaveAssignments({});
  }

  async function executeSaveAssignments(resolutions = {}) {
    setSaving(true);
    try {
      await setTableAssignmentsForWaiter(
        restaurantId,
        selectedWaiter.id,
        selectedWaiter.full_name || 'Waiter',
        selectedTableIds,
        tables,
        profile?.full_name || profile?.role || 'Manager',
        resolutions
      );
      Alert.alert('Success', `Table assignments updated for ${selectedWaiter.full_name}!`);
      setSelectedWaiter(null);
      setConflictModalVisible(false);
      setConflicts([]);
      await loadDataSilently();
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to update table assignments.');
    } finally {
      setSaving(false);
    }
  }

  function handleResolveConflict(action) {
    const resolutions = {};
    conflicts.forEach(c => {
      resolutions[c.table_id] = action;
    });
    executeSaveAssignments(resolutions);
  }

  function renderTableRosterCard({ item: table }) {
    const isOcc = table.occupancy_status === 'occupied';
    const isInactive = table.occupancy_status === 'inactive';
    const statusBg = isInactive ? '#f1f5f9' : isOcc ? '#fee2e2' : '#dcfce7';
    const statusColor = isInactive ? '#64748b' : isOcc ? '#dc2626' : '#16a34a';
    const statusLabel = isInactive ? 'QR Disabled' : isOcc ? 'Occupied' : 'Available';

    const isBusy = qrActionLoading[table.id];

    return (
      <View style={[styles.rosterCard, isOcc && styles.rosterCardOccupied]}>
        <View style={styles.rosterCardHeader}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={[styles.tableIconBg, { backgroundColor: isOcc ? '#fee2e2' : '#f0fdf4' }]}>
              <MaterialCommunityIcons
                name="table-chair"
                size={22}
                color={isOcc ? '#dc2626' : COLORS.primary}
              />
            </View>
            <View style={{ marginLeft: 10 }}>
              <Text style={styles.rosterTableName}>{table.name}</Text>
              <Text style={styles.rosterWaiterText}>
                {table.assigned_waiters && table.assigned_waiters.length > 0
                  ? `Staff: ${table.assigned_waiters.map(w => w.name).join(', ')}`
                  : 'Staff: Unassigned'}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <View style={[styles.rosterStatusBadge, { backgroundColor: statusBg }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.rosterStatusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
            {table.payment_pending && (
              <View style={styles.payPendingBadge}>
                <Ionicons name="time-outline" size={12} color="#b45309" />
                <Text style={styles.payPendingText}>Pay Pending</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.rosterCardBody}>
          <View style={styles.rosterStatItem}>
            <Text style={styles.rosterStatLabel}>Active Orders</Text>
            <Text style={[styles.rosterStatValue, isOcc && { color: '#dc2626' }]}>
              {table.active_order_count || 0}
            </Text>
          </View>
          <View style={styles.rosterStatDivider} />
          <View style={styles.rosterStatItem}>
            <Text style={styles.rosterStatLabel}>QR Ordering</Text>
            <Text style={[styles.rosterStatValue, { color: table.qr_enabled !== false ? '#16a34a' : '#64748b' }]}>
              {table.qr_enabled !== false ? 'Active' : 'Disabled'}
            </Text>
          </View>
          <View style={styles.rosterStatDivider} />
          <View style={styles.rosterStatItem}>
            <Text style={styles.rosterStatLabel}>Occupied Since</Text>
            <Text style={styles.rosterStatValue}>
              {table.occupied_at ? new Date(table.occupied_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
            </Text>
          </View>
        </View>

        <View style={styles.rosterActionRow}>
          {canControl && (
            <TouchableOpacity
              style={[styles.rosterBtn, table.qr_enabled !== false ? styles.rosterBtnDisable : styles.rosterBtnEnable]}
              onPress={() => handleToggleQR(table)}
              disabled={isBusy}
              activeOpacity={0.8}
            >
              {isBusy ? (
                <ActivityIndicator size="small" color={table.qr_enabled !== false ? '#64748b' : '#ffffff'} />
              ) : (
                <>
                  <Ionicons
                    name={table.qr_enabled !== false ? 'eye-off-outline' : 'qr-code-outline'}
                    size={15}
                    color={table.qr_enabled !== false ? '#475569' : '#ffffff'}
                    style={{ marginRight: 4 }}
                  />
                  <Text style={[styles.rosterBtnText, table.qr_enabled !== false ? styles.rosterBtnDisableText : styles.rosterBtnEnableText]}>
                    {table.qr_enabled !== false ? 'Disable QR' : 'Enable QR'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          {isOcc && (
            <TouchableOpacity
              style={[styles.rosterBtn, styles.rosterBtnLiveOrders]}
              onPress={() => navigation.navigate('Orders', { profile, filterTable: table.name })}
              activeOpacity={0.8}
            >
              <Ionicons name="receipt-outline" size={15} color="#dc2626" style={{ marginRight: 4 }} />
              <Text style={styles.rosterBtnLiveOrdersText}>Live Orders</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  function renderWaiterCard({ item: waiter }) {
    const assignedToThisWaiter = assignments.filter(a => a.waiter_id === waiter.id && a.active !== false);
    return (
      <View style={styles.waiterCard}>
        <View style={styles.cardHeader}>
          <View style={styles.waiterAvatar}>
            <MaterialCommunityIcons name="account-tie" size={24} color={COLORS.primary} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.waiterName}>{waiter.full_name || 'Staff'}</Text>
            <Text style={styles.waiterRole}>
              {waiter.role === 'supervisor' ? 'Waiter Supervisor' : 'Waiter'} · {waiter.email}
            </Text>
          </View>
          {canControl && (
            <TouchableOpacity
              style={styles.assignBtn}
              onPress={() => handleOpenAssignModal(waiter)}
              activeOpacity={0.8}
            >
              <Ionicons name="create-outline" size={16} color="#ffffff" style={{ marginRight: 4 }} />
              <Text style={styles.assignBtnText}>Assign</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.assignedSection}>
          <Text style={styles.assignedSectionTitle}>
            ASSIGNED TABLES ({assignedToThisWaiter.length})
          </Text>
          {assignedToThisWaiter.length === 0 ? (
            <Text style={styles.noTablesText}>No tables assigned yet.</Text>
          ) : (
            <View style={styles.badgeContainer}>
              {assignedToThisWaiter.map(a => (
                <View key={a.table_id} style={styles.tableBadge}>
                  <Text style={styles.tableBadgeText}>{a.table_name || 'Table'}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color="#0f172a" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.headerTitle}>Table Control & Roster</Text>
          <Text style={styles.headerSubtitle}>Live occupancy, QR states & staff allocation</Text>
        </View>
        <TouchableOpacity onPress={loadData} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={20} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.occupancyWidget}>
        <View style={styles.occItem}>
          <Text style={styles.occValue}>{tableStats.total}</Text>
          <Text style={styles.occLabel}>Total Tables</Text>
        </View>
        <View style={[styles.occItem, styles.occItemGreen]}>
          <Text style={[styles.occValue, { color: '#16a34a' }]}>{tableStats.available}</Text>
          <Text style={[styles.occLabel, { color: '#15803d' }]}>🟢 Available</Text>
        </View>
        <View style={[styles.occItem, styles.occItemRed]}>
          <Text style={[styles.occValue, { color: '#dc2626' }]}>{tableStats.occupied}</Text>
          <Text style={[styles.occLabel, { color: '#b91c1c' }]}>🔴 Occupied</Text>
        </View>
        <View style={[styles.occItem, styles.occItemGray]}>
          <Text style={[styles.occValue, { color: '#64748b' }]}>{tableStats.inactive}</Text>
          <Text style={[styles.occLabel, { color: '#475569' }]}>⚪ QR Off</Text>
        </View>
        <View style={[styles.occItem, styles.occItemIndigo]}>
          <Text style={[styles.occValue, { color: '#4f46e5' }]}>{tableStats.occupancyRate}%</Text>
          <Text style={[styles.occLabel, { color: '#4338ca' }]}>Occupancy</Text>
        </View>
      </View>

      <View style={styles.segmentContainer}>
        <TouchableOpacity
          style={[styles.segmentBtn, activeTab === 'roster' && styles.segmentBtnActive]}
          onPress={() => setActiveTab('roster')}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons
            name="table-chair"
            size={18}
            color={activeTab === 'roster' ? '#ffffff' : '#64748b'}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.segmentBtnText, activeTab === 'roster' && styles.segmentBtnTextActive]}>
            Live Table Roster ({tables.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.segmentBtn, activeTab === 'waiters' && styles.segmentBtnActive]}
          onPress={() => setActiveTab('waiters')}
          activeOpacity={0.8}
        >
          <Ionicons
            name="people"
            size={18}
            color={activeTab === 'waiters' ? '#ffffff' : '#64748b'}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.segmentBtnText, activeTab === 'waiters' && styles.segmentBtnTextActive]}>
            Staff Assignments ({waiters.length})
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading live table status...</Text>
        </View>
      ) : activeTab === 'roster' ? (
        <FlatList
          data={tables}
          keyExtractor={item => item.id}
          renderItem={renderTableRosterCard}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} />}
          ListEmptyComponent={
            <View style={styles.centerBox}>
              <MaterialCommunityIcons name="table-chair" size={48} color="#94a3b8" />
              <Text style={styles.emptyTitle}>No Tables Configured</Text>
              <Text style={styles.emptySub}>Create dining tables in the web dashboard to enable QR ordering.</Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={waiters}
          keyExtractor={item => item.id}
          renderItem={renderWaiterCard}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadData(); }} />}
          ListEmptyComponent={
            <View style={styles.centerBox}>
              <MaterialCommunityIcons name="account-group-outline" size={48} color="#94a3b8" />
              <Text style={styles.emptyTitle}>No Waiter Staff Found</Text>
              <Text style={styles.emptySub}>Register waiter staff members in Staff Management to assign tables.</Text>
            </View>
          }
        />
      )}

      <Modal
        visible={Boolean(selectedWaiter)}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedWaiter(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Assign Tables</Text>
                <Text style={styles.modalSub}>{selectedWaiter?.full_name}</Text>
              </View>
              <TouchableOpacity onPress={() => setSelectedWaiter(null)} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalInstruction}>
              Select the tables this staff member is responsible for:
            </Text>

            <ScrollView style={styles.tableGridScroll} contentContainerStyle={styles.tableGrid}>
              {tables.map(tbl => {
                const isSelected = selectedTableIds.includes(tbl.id);
                return (
                  <TouchableOpacity
                    key={tbl.id}
                    style={[styles.tableChoiceBtn, isSelected && styles.tableChoiceBtnSelected]}
                    onPress={() => toggleTableSelection(tbl.id)}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons
                      name="table-chair"
                      size={20}
                      color={isSelected ? '#ffffff' : '#64748b'}
                    />
                    <Text style={[styles.tableChoiceText, isSelected && styles.tableChoiceTextSelected]}>
                      {tbl.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.modalFooter}>
              <Text style={styles.countText}>{selectedTableIds.length} table(s) selected</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity onPress={() => setSelectedWaiter(null)} style={styles.cancelBtn}>
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleCheckConflictsAndSave}
                  disabled={saving}
                  style={styles.saveBtn}
                >
                  {saving ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.saveBtnText}>Save</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={conflictModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConflictModalVisible(false)}
      >
        <View style={styles.modalOverlayCenter}>
          <View style={styles.conflictCard}>
            <View style={styles.conflictHeader}>
              <Ionicons name="alert-circle" size={24} color="#ea580c" />
              <Text style={styles.conflictTitle}>Table Already Assigned</Text>
            </View>
            <Text style={styles.conflictSub}>The following tables are already linked to other staff:</Text>
            <View style={styles.conflictList}>
              {conflicts.map(c => (
                <View key={c.table_id} style={styles.conflictRow}>
                  <Text style={styles.conflictTableName}>• {c.table_name}</Text>
                  <Text style={styles.conflictWaiterNames}>Assigned to: {c.existingWaiters.map(w => w.waiter_name).join(', ')}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.conflictActionTitle}>Choose action:</Text>
            <View style={styles.conflictActions}>
              <TouchableOpacity style={[styles.conflictBtn, styles.conflictBtnBoth]} onPress={() => handleResolveConflict('both')}>
                <Text style={styles.conflictBtnBothText}>Assign to Both</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.conflictBtn, styles.conflictBtnReplace]} onPress={() => handleResolveConflict('replace')}>
                <Text style={styles.conflictBtnReplaceText}>Replace Existing</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.conflictBtn, styles.conflictBtnCancel]} onPress={() => setConflictModalVisible(false)}>
                <Text style={styles.conflictBtnCancelText}>Cancel</Text>
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
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#ffffff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  backBtn: { padding: 6, borderRadius: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  headerSubtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  refreshBtn: { padding: 8, borderRadius: 8, backgroundColor: '#f1f5f9' },
  occupancyWidget: { flexDirection: 'row', backgroundColor: '#ffffff', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', gap: 6 },
  occItem: { flex: 1, backgroundColor: '#f8fafc', borderRadius: 10, paddingVertical: 8, alignItems: 'center', borderWidth: 1, borderColor: '#f1f5f9' },
  occItemGreen: { backgroundColor: '#f0fdf4', borderColor: '#dcfce7' },
  occItemRed: { backgroundColor: '#fef2f2', borderColor: '#fee2e2' },
  occItemGray: { backgroundColor: '#f8fafc', borderColor: '#f1f5f9' },
  occItemIndigo: { backgroundColor: '#eef2ff', borderColor: '#e0e7ff' },
  occValue: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  occLabel: { fontSize: 9, fontWeight: '700', color: '#64748b', marginTop: 2 },
  segmentContainer: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#f8fafc', gap: 8 },
  segmentBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 12, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0' },
  segmentBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  segmentBtnText: { fontSize: 12, fontWeight: '700', color: '#64748b' },
  segmentBtnTextActive: { color: '#ffffff' },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  loadingText: { fontSize: 13, color: '#64748b', marginTop: 12, fontWeight: '600' },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', marginTop: 12 },
  emptySub: { fontSize: 13, color: '#64748b', textAlign: 'center', marginTop: 6, lineHeight: 18 },
  listContent: { padding: 16, gap: 12 },
  rosterCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#f1f5f9', elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6 },
  rosterCardOccupied: { borderColor: '#fecaca' },
  rosterCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  tableIconBg: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rosterTableName: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  rosterWaiterText: { fontSize: 11, color: '#64748b', marginTop: 1, fontWeight: '500' },
  rosterStatusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  rosterStatusText: { fontSize: 11, fontWeight: '700' },
  payPendingBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingVertical: 2, backgroundColor: '#fef3c7', borderRadius: 4, gap: 3 },
  payPendingText: { fontSize: 10, fontWeight: '700', color: '#b45309' },
  rosterCardBody: { flexDirection: 'row', backgroundColor: '#f8fafc', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, marginBottom: 12 },
  rosterStatItem: { flex: 1, alignItems: 'center' },
  rosterStatDivider: { width: 1, backgroundColor: '#e2e8f0', marginVertical: 2 },
  rosterStatLabel: { fontSize: 10, color: '#64748b', fontWeight: '600', marginBottom: 2 },
  rosterStatValue: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  rosterActionRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10 },
  rosterBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  rosterBtnEnable: { backgroundColor: '#16a34a' },
  rosterBtnEnableText: { color: '#ffffff', fontSize: 12, fontWeight: '700' },
  rosterBtnDisable: { backgroundColor: '#f1f5f9' },
  rosterBtnDisableText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  rosterBtnLiveOrders: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' },
  rosterBtnLiveOrdersText: { color: '#dc2626', fontSize: 12, fontWeight: '700' },
  waiterCard: { backgroundColor: '#ffffff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#f1f5f9', elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  waiterAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#ecfdf5', alignItems: 'center', justifyContent: 'center' },
  waiterName: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  waiterRole: { fontSize: 12, color: '#64748b', marginTop: 2 },
  assignBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  assignBtnText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  assignedSection: { borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 10 },
  assignedSectionTitle: { fontSize: 11, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.5, marginBottom: 8 },
  noTablesText: { fontSize: 13, color: '#94a3b8', fontStyle: 'italic' },
  badgeContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tableBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  tableBadgeText: { fontSize: 12, fontWeight: '700', color: '#15803d' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  modalSub: { fontSize: 13, color: COLORS.primary, fontWeight: '600', marginTop: 2 },
  closeBtn: { padding: 6, borderRadius: 8, backgroundColor: '#f1f5f9' },
  modalInstruction: { fontSize: 13, color: '#64748b', marginBottom: 14 },
  tableGridScroll: { maxHeight: 260 },
  tableGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 8 },
  tableChoiceBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', minWidth: '47%' },
  tableChoiceBtnSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tableChoiceText: { fontSize: 13, fontWeight: '700', color: '#334155', marginLeft: 8, flex: 1 },
  tableChoiceTextSelected: { color: '#ffffff' },
  modalFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#f1f5f9', paddingTop: 14, marginTop: 10 },
  countText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f1f5f9' },
  cancelBtnText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
  saveBtn: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.primary },
  saveBtnText: { fontSize: 13, fontWeight: '700', color: '#ffffff' },
  modalOverlayCenter: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  conflictCard: { backgroundColor: '#ffffff', borderRadius: 20, padding: 20, width: '100%', maxWidth: 380, elevation: 5 },
  conflictHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  conflictTitle: { fontSize: 16, fontWeight: '800', color: '#9a3412', marginLeft: 8 },
  conflictSub: { fontSize: 12, color: '#475569', marginBottom: 10 },
  conflictList: { backgroundColor: '#fff7ed', borderRadius: 10, padding: 10, marginBottom: 14 },
  conflictRow: { marginBottom: 4 },
  conflictTableName: { fontSize: 13, fontWeight: '700', color: '#c2410c' },
  conflictWaiterNames: { fontSize: 11, color: '#7c2d12', marginLeft: 10 },
  conflictActionTitle: { fontSize: 12, fontWeight: '700', color: '#0f172a', marginBottom: 10 },
  conflictActions: { gap: 8 },
  conflictBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 10 },
  conflictBtnBoth: { backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0' },
  conflictBtnBothText: { fontSize: 13, fontWeight: '700', color: '#047857' },
  conflictBtnReplace: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe' },
  conflictBtnReplaceText: { fontSize: 13, fontWeight: '700', color: '#1d4ed8' },
  conflictBtnCancel: { backgroundColor: '#f1f5f9' },
  conflictBtnCancelText: { fontSize: 13, fontWeight: '600', color: '#64748b' },
});
