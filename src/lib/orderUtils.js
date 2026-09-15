/**
 * SmartDine Mobile Order Utilities
 * Mirrors the unified logic of packages/core/orders.ts for React Native Expo.
 * Ensures identical order ID formatting, transitions, and customer parsing across platforms.
 */

export const VALID_ORDER_TRANSITIONS = {
  new: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['served', 'completed', 'cancelled'],
  served: ['completed'],
  completed: [],
  cancelled: []
};

export const ALLOWED_PRIOR_STATUSES = {
  new: [],
  accepted: ['new'],
  preparing: ['accepted'],
  ready: ['preparing'],
  served: ['ready'],
  completed: ['served', 'ready'],
  cancelled: ['new', 'accepted', 'preparing', 'ready']
};

export function getOrderStatusLabel(status, orderType) {
  if (orderType === 'takeaway') {
    switch (status) {
      case 'new': return 'New';
      case 'accepted': return 'Accepted';
      case 'preparing': return 'Preparing';
      case 'ready': return 'Ready for Pickup';
      case 'served': return 'Handed Over';
      case 'completed': return 'Completed';
      case 'cancelled': return 'Cancelled';
      default: return status;
    }
  }
  switch (status) {
    case 'new': return 'New';
    case 'accepted': return 'Accepted';
    case 'preparing': return 'Preparing';
    case 'ready': return 'Ready';
    case 'served': return 'Served';
    case 'completed': return 'Completed';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
}

export function getDeterministicRestaurantCode(restaurantIdOrName = '') {
  const clean = String(restaurantIdOrName).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (clean === 'THEFOODYHUBJAIPUR' || clean === 'FOODYHUBJAIPUR') return 'Q4M';
  if (clean === 'THEFOODYHUBDELHI' || clean === 'FOODYHUBDELHI') return 'X9R';
  if (clean.includes('81FA8201') || clean === 'THEFOODYHUBUDAIPUR' || clean === 'FOODYHUBUDAIPUR' || clean === 'FOODYHUB' || clean === 'THEFOODYHUB') {
    return 'A7K';
  }
  if (!clean) return 'A7K';
  
  const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let hash = 5381;
  for (let i = 0; i < clean.length; i++) {
    hash = ((hash << 5) + hash) ^ clean.charCodeAt(i);
  }
  const h1 = Math.abs(hash) % CHARSET.length;
  const h2 = Math.abs(Math.floor(hash / CHARSET.length)) % CHARSET.length;
  const h3 = Math.abs(Math.floor(hash / (CHARSET.length * CHARSET.length))) % CHARSET.length;
  return `${CHARSET[h1]}${CHARSET[h2]}${CHARSET[h3]}`;
}

export function getFormattedOrderId(order, restaurantName = '', allOrders = [], isCustomerFacing = false) {
  try {
    if (!order) {
      return isCustomerFacing ? 'Order #26D0001' : 'A7K-26D0001';
    }

    const existingCode = order.display_order_id || order.order_number;
    const match = existingCode && String(existingCode).match(/^([A-Z0-9]{3,4})-(\d{2}[DTRP]\d{4,})$/);
    if (match) {
      return isCustomerFacing ? `Order #${match[2]}` : `${match[1]}-${match[2]}`;
    }

    let restCode = order.restaurant_code 
      || order.restaurant?.settings?.restaurant_code 
      || order.restaurant?.restaurant_code;

    if (!restCode) {
      const restKey = order.restaurant_id || order.restaurant?.id || restaurantName || 'The Foody Hub';
      restCode = getDeterministicRestaurantCode(restKey);
    }
    restCode = String(restCode).toUpperCase().slice(0, 4);

    const orderDate = new Date(order.created_at || Date.now());
    const validDate = isNaN(orderDate.getTime()) ? new Date() : orderDate;
    const yy = String(validDate.getFullYear()).slice(-2);

    let typeChar = 'D';
    const rawType = String(order.order_type || '').toLowerCase();
    const rawTable = String(order.table_name || order.table?.name || '').toLowerCase();

    if (rawType === 'takeaway' || rawTable.includes('takeaway')) {
      typeChar = 'T';
    } else if (rawType === 'reservation' || rawTable.includes('reservation')) {
      typeChar = 'R';
    } else if (rawType === 'punch') {
      typeChar = 'P';
    } else {
      typeChar = 'D';
    }

    let sequence = 1;
    if (order.daily_sequence || order.order_sequence || order.order_number) {
      sequence = Number(order.daily_sequence || order.order_sequence || order.order_number);
    } else if (Array.isArray(allOrders) && allOrders.length > 0) {
      const index = allOrders.findIndex(o => o?.id === order.id || o?.order_id === order.id);
      if (index >= 0) {
        sequence = index + 1;
      }
    } else if (order.id) {
      const numOnly = String(order.id).replace(/\D/g, '');
      sequence = numOnly ? (parseInt(numOnly.slice(-4), 10) || 1) : 1;
    }
    const seqStr = String(sequence).padStart(4, '0');
    const suffix = `${yy}${typeChar}${seqStr}`;

    if (isCustomerFacing) {
      return `Order #${suffix}`;
    }

    return `${restCode}-${suffix}`;
  } catch (err) {
    return isCustomerFacing ? 'Order #26D0001' : 'A7K-26D0001';
  }
}

export function getCustomerFacingOrderId(order, restaurantName = '', allOrders = []) {
  return getFormattedOrderId(order, restaurantName, allOrders, true);
}

export function parseCustomerDetailsFromOrder(order) {
  if (!order) return { name: '', phone: '', notes: '' };

  let name = order.customer_name || order.customerName || '';
  let phone = order.customer_phone || order.customerPhone || order.phone || '';
  let notes = order.takeaway_notes || order.customer_note || order.customerNote || '';
  let arrivalMinutes = order.customer_arrival_minutes || order.arrivalMinutes;

  const textBlob = `${order.special_instructions || ''} | ${order.customer_notes || ''} | ${order.notes || ''}`;

  if (!name) {
    const nameMatch = textBlob.match(/(?:CUSTOMER|Name|Guest):\s*([^|]+)/i);
    if (nameMatch) name = nameMatch[1].trim();
  }
  if (!phone) {
    const phoneMatch = textBlob.match(/(?:PHONE|Contact|Mobile):\s*([^|]+)/i);
    if (phoneMatch) phone = phoneMatch[1].trim();
  }
  if (!notes) {
    const notesMatch = textBlob.match(/(?:NOTES|Notes):\s*([^|]+)/i);
    if (notesMatch) notes = notesMatch[1].trim();
  }
  if (!arrivalMinutes) {
    const arrivalMatch = textBlob.match(/ARRIVAL:\s*(\d+)/i);
    if (arrivalMatch) arrivalMinutes = parseInt(arrivalMatch[1], 10);
  }

  return { name, phone, notes, arrivalMinutes };
}

export function matchesOrderSearchQuery(order, query, restaurantName = '', allOrders = []) {
  if (!query || !query.trim()) return true;
  const q = query.trim().toLowerCase();
  const qClean = q.replace(/^#/, '');

  const fullId = getFormattedOrderId(order, restaurantName, allOrders, false).toLowerCase();
  const shortId = fullId.split('-')[1] || fullId;
  const seqOnly = shortId.replace(/^[0-9]{2}[A-Z]/i, '');

  if (fullId.includes(q) || fullId.includes(qClean)) return true;
  if (shortId.includes(q) || shortId.includes(qClean)) return true;
  if (seqOnly && (seqOnly.includes(qClean) || parseInt(seqOnly, 10) === parseInt(qClean, 10))) return true;

  if (order.id && String(order.id).toLowerCase().includes(q)) return true;

  const cust = parseCustomerDetailsFromOrder(order);
  if (cust.name && cust.name.toLowerCase().includes(q)) return true;
  if (cust.phone && cust.phone.replace(/\s+/g, '').includes(q.replace(/\s+/g, ''))) return true;

  const tblNum = order.table_number || order.table?.table_number;
  const tblName = String(order.table_name || order.table?.name || '').toLowerCase();
  const tblDisplay = tblNum ? `table ${tblNum}` : '';
  if (tblName) {
    if (tblName.includes(q)) return true;
    try {
      const escaped = tblName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}\\b`, 'i').test(q)) return true;
    } catch (e) {}
  }
  if (tblNum) {
    if (String(tblNum) === qClean) return true;
    if (tblDisplay && tblDisplay.includes(q)) return true;
    try {
      if (tblDisplay && new RegExp(`\\b${tblDisplay.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(q)) return true;
    } catch (e) {}
  }

  if (Array.isArray(order.items)) {
    if (order.items.some(it => (it.menu_item_name || it.name || '').toLowerCase().includes(q))) {
      return true;
    }
  }

  return false;
}
