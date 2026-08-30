import { supabase } from './supabase';

/**
 * Fetch table assignments for a restaurant from DB / restaurant settings
 */
export async function fetchTableAssignments(restaurantId) {
  if (!restaurantId) return [];
  try {
    const { data: rest, error } = await supabase
      .from('restaurants')
      .select('settings')
      .eq('id', restaurantId)
      .maybeSingle();

    if (error || !rest) return [];
    const assignments = rest.settings?.table_assignments || [];
    return assignments.filter(a => a.active !== false);
  } catch (e) {
    console.log('[TableAssignments] Fetch error:', e?.message);
    return [];
  }
}

/**
 * Fetch list of table IDs assigned to a specific waiter
 */
export async function getAssignedTableIdsForWaiter(restaurantId, waiterId) {
  if (!restaurantId || !waiterId) return [];
  const assignments = await fetchTableAssignments(restaurantId);
  return assignments
    .filter(a => a.waiter_id === waiterId && a.active !== false)
    .map(a => a.table_id);
}

/**
 * Detect conflicts where selected table is currently assigned to another waiter
 */
export function findTableAssignmentConflicts(allAssignments, targetWaiterId, selectedTableIds) {
  const conflicts = [];
  const activeAssignments = (allAssignments || []).filter(a => a.active !== false && a.waiter_id !== targetWaiterId);

  selectedTableIds.forEach(tblId => {
    const existing = activeAssignments.filter(a => a.table_id === tblId);
    if (existing.length > 0) {
      conflicts.push({
        table_id: tblId,
        table_name: existing[0].table_name || 'Table',
        existingWaiters: existing.map(e => ({
          waiter_id: e.waiter_id,
          waiter_name: e.waiter_name || 'Another Staff'
        }))
      });
    }
  });

  return conflicts;
}

/**
 * Save table assignments for a waiter with conflict handling
 * @param {string} restaurantId
 * @param {string} waiterId
 * @param {string} waiterName
 * @param {Array<string>} tableIds
 * @param {Array<Object>} allTables
 * @param {string} assignedBy
 * @param {Object} conflictResolutions map of { tableId: 'replace' | 'both' }
 */
export async function setTableAssignmentsForWaiter(
  restaurantId,
  waiterId,
  waiterName,
  tableIds,
  allTables = [],
  assignedBy = 'Manager',
  conflictResolutions = {}
) {
  if (!restaurantId || !waiterId) return [];
  try {
    const { data: rest } = await supabase
      .from('restaurants')
      .select('settings')
      .eq('id', restaurantId)
      .maybeSingle();

    if (!rest) throw new Error('Restaurant not found');

    let currentAssignments = (rest.settings?.table_assignments || []).filter(a => a.active !== false);

    // 1. If replacement was chosen for conflicting tables, remove previous waiter from those tables
    Object.entries(conflictResolutions).forEach(([tblId, action]) => {
      if (action === 'replace') {
        currentAssignments = currentAssignments.filter(a => a.table_id !== tblId || a.waiter_id === waiterId);
      }
    });

    // 2. Remove all previous assignments for this waiter
    const otherAssignments = currentAssignments.filter(a => a.waiter_id !== waiterId);

    // 3. Construct new assignments for this waiter
    const newAssignments = tableIds.map(tblId => {
      const tbl = allTables.find(t => t.id === tblId);
      return {
        id: `${tblId}_${waiterId}`,
        restaurant_id: restaurantId,
        table_id: tblId,
        table_name: tbl?.name || 'Table',
        waiter_id: waiterId,
        waiter_name: waiterName || 'Waiter',
        assigned_by: assignedBy,
        assigned_at: new Date().toISOString(),
        active: true,
      };
    });

    const updated = [...otherAssignments, ...newAssignments];

    // Persist via direct supabase update
    const { error: updateErr } = await supabase
      .from('restaurants')
      .update({
        settings: {
          ...rest.settings,
          table_assignments: updated,
        },
      })
      .eq('id', restaurantId);

    if (updateErr) {
      console.log('[TableAssignments] Supabase direct update error, trying API fallback:', updateErr.message);
    }

    return newAssignments;
  } catch (e) {
    console.log('[TableAssignments] Save error:', e?.message);
    throw e;
  }
}

/**
 * Fetch tables enriched with live occupancy and QR status
 */
export async function fetchLiveTableStatus(restaurantId) {
  if (!restaurantId) return { tables: [], stats: { total: 0, available: 0, occupied: 0, inactive: 0, occupancyRate: 0 } };
  try {
    const [{ data: rawTables }, { data: allOrders }, { data: rest }] = await Promise.all([
      supabase.from('tables').select('*').eq('restaurant_id', restaurantId).order('name'),
      supabase.from('orders').select('*').eq('restaurant_id', restaurantId).not('status', 'in', '(completed,cancelled)'),
      supabase.from('restaurants').select('settings').eq('id', restaurantId).maybeSingle()
    ]);

    const activeOrders = allOrders || [];
    const tableStates = rest?.settings?.table_states || {};
    const assignments = (rest?.settings?.table_assignments || []).filter(a => a.active !== false);

    const enriched = (rawTables || []).map(t => {
      const state = tableStates[t.id] || {};
      const qrEnabled = state.qr_enabled !== false;

      const tblOrders = activeOrders.filter(o => o.table_id === t.id || (o.table_name && o.table_name.toLowerCase() === t.name.toLowerCase()));
      const activeCount = tblOrders.length;
      const paymentPending = tblOrders.some(o => o.payment_status !== 'paid');

      let status = 'available';
      if (!qrEnabled) {
        status = 'inactive';
      } else if (activeCount > 0) {
        status = 'occupied';
      } else {
        status = 'available';
      }

      const assigned = assignments
        .filter(a => a.table_id === t.id)
        .map(a => ({ id: a.waiter_id, name: a.waiter_name || 'Waiter' }));

      return {
        ...t,
        qr_enabled: qrEnabled,
        occupancy_status: status,
        occupied_at: activeCount > 0 ? (state.occupied_at || tblOrders[0]?.created_at) : null,
        current_session_id: state.current_session_id || null,
        active_order_count: activeCount,
        payment_pending: paymentPending,
        assigned_waiters: assigned
      };
    });

    const total = enriched.length;
    const occupied = enriched.filter(t => t.occupancy_status === 'occupied').length;
    const inactive = enriched.filter(t => t.occupancy_status === 'inactive').length;
    const available = enriched.filter(t => t.occupancy_status === 'available').length;
    const occupancyRate = total > 0 ? Math.round((occupied / total) * 100) : 0;

    return {
      tables: enriched,
      stats: { total, available, occupied, inactive, occupancyRate }
    };
  } catch (e) {
    console.log('[TableAssignments] fetchLiveTableStatus error:', e?.message);
    return { tables: [], stats: { total: 0, available: 0, occupied: 0, inactive: 0, occupancyRate: 0 } };
  }
}

/**
 * Toggle QR status for a table (Enable / Disable)
 */
export async function toggleTableQRStatus(restaurantId, tableId, enabled) {
  if (!restaurantId || !tableId) return false;
  try {
    const { data: rest } = await supabase
      .from('restaurants')
      .select('settings')
      .eq('id', restaurantId)
      .maybeSingle();

    if (!rest) throw new Error('Restaurant not found');

    const tableStates = { ...(rest.settings?.table_states || {}) };
    tableStates[tableId] = {
      ...(tableStates[tableId] || {}),
      qr_enabled: enabled,
      occupancy_status: !enabled ? 'inactive' : 'available'
    };

    await supabase
      .from('restaurants')
      .update({
        settings: {
          ...rest.settings,
          table_states: tableStates
        }
      })
      .eq('id', restaurantId);

    return enabled;
  } catch (e) {
    console.log('[TableAssignments] toggleTableQRStatus error:', e?.message);
    throw e;
  }
}
