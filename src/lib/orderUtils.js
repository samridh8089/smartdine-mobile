/**
 * Formats order ID into daily sequential code e.g. #BIS-01, #BIS-02.
 * Resets back to 01 every day for each restaurant.
 * Completely guarded against null/undefined order objects to prevent render crashes.
 */
export function getFormattedOrderId(order, restaurantName = '', allOrders = []) {
  try {
    if (!order) return '#00';

    const cleanName = (restaurantName || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const prefix = cleanName.length >= 3 ? cleanName.slice(0, 3) : (cleanName + 'ORD').slice(0, 3);

    const orderDate = new Date(order.created_at || Date.now());
    if (isNaN(orderDate.getTime())) return `#${prefix}-01`;

    const year = orderDate.getFullYear();
    const month = orderDate.getMonth();
    const date = orderDate.getDate();

    const sameDayOrders = (allOrders || [])
      .filter(o => {
        if (!o || !o.created_at) return false;
        const d = new Date(o.created_at);
        if (isNaN(d.getTime())) return false;
        return d.getFullYear() === year && d.getMonth() === month && d.getDate() === date;
      })
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const index = sameDayOrders.findIndex(o => o?.id === order.id);
    const dailySeq = index >= 0 ? index + 1 : 1;
    const numStr = dailySeq < 10 ? `0${dailySeq}` : `${dailySeq}`;

    return `#${prefix}-${numStr}`;
  } catch (e) {
    console.log('Error formatting order ID:', e);
    return '#ORD-01';
  }
}
