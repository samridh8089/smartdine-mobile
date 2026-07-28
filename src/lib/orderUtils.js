/**
 * Formats order ID into daily sequential code e.g. #BIS-01, #BIS-02.
 * Resets back to 01 every day for each restaurant.
 */
export function getFormattedOrderId(order, restaurantName = '', allOrders = []) {
  if (!order) return '#00';

  // 1. Get 3-letter capital prefix from restaurant name
  const cleanName = (restaurantName || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const prefix = cleanName.length >= 3 ? cleanName.slice(0, 3) : (cleanName + 'ORD').slice(0, 3);

  // 2. Extract date of target order
  const orderDate = new Date(order.created_at || Date.now());
  const year = orderDate.getFullYear();
  const month = orderDate.getMonth();
  const date = orderDate.getDate();

  // 3. Filter all orders that fall on the SAME local calendar date and sort by created_at ascending
  const sameDayOrders = (allOrders || [])
    .filter(o => {
      const d = new Date(o.created_at);
      return d.getFullYear() === year && d.getMonth() === month && d.getDate() === date;
    })
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  // 4. Find index of target order in sameDayOrders
  const index = sameDayOrders.findIndex(o => o.id === order.id);
  const dailySeq = index >= 0 ? index + 1 : 1;
  const numStr = dailySeq < 10 ? `0${dailySeq}` : `${dailySeq}`;

  return `#${prefix}-${numStr}`;
}
