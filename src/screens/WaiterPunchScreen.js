import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput,
  ActivityIndicator, ScrollView, Modal, Platform,
  Alert, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { COLORS, FONTS, RADIUS, SHADOWS, formatCurrency } from '../lib/theme';

export default function WaiterPunchScreen({ route }) {
  const profile = route?.params?.profile ?? {};
  const restaurantId = profile?.restaurant_id;

  const [orderType, setOrderType] = useState('dine_in');
  const [tables, setTables] = useState([]);
  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [selectedTable, setSelectedTable] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState('');
  const [markPaid, setMarkPaid] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showCart, setShowCart] = useState(false);

  useEffect(() => { loadData(); }, [restaurantId]);

  const loadData = useCallback(async () => {
    if (!restaurantId) { setLoading(false); return; }
    try {
      const [{ data: t }, { data: c }, { data: m }] = await Promise.all([
        supabase.from('tables').select('*').eq('restaurant_id', restaurantId).order('name'),
        supabase.from('categories').select('*').eq('restaurant_id', restaurantId).order('sort_order'),
        supabase.from('menu_items').select('*').eq('restaurant_id', restaurantId).eq('is_available', true).order('name'),
      ]);
      const tableList = t || [];
      setTables(tableList);
      setCategories(c || []);
      setMenuItems(m || []);
      if (tableList.length > 0) setSelectedTable(tableList[0]);
    } catch (e) {
      console.log('WaiterPunch load error:', e?.message);
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  function addToCart(item) {
    setCart(prev => {
      const existing = prev.find(c => c.id === item.id);
      if (existing) return prev.map(c => c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      return [...prev, { ...item, quantity: 1, notes: '' }];
    });
  }

  function removeFromCart(itemId) {
    setCart(prev => {
      const existing = prev.find(c => c.id === itemId);
      if (existing?.quantity === 1) return prev.filter(c => c.id !== itemId);
      return prev.map(c => c.id === itemId ? { ...c, quantity: c.quantity - 1 } : c);
    });
  }

  function getQuantity(itemId) {
    return cart.find(c => c.id === itemId)?.quantity || 0;
  }

  const cartTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  const filteredItems = menuItems.filter(item => {
    const matchCat = selectedCategory === 'all' || item.category_id === selectedCategory;
    const matchSearch = !search || item.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  async function submitOrder() {
    if (cart.length === 0) { Alert.alert('Empty Cart', 'Please add at least one item'); return; }
    if (orderType === 'dine_in' && !selectedTable) { Alert.alert('Select Table', 'Please select a table'); return; }
    setSubmitting(true);

    const tableNameStr = orderType === 'dine_in'
      ? (selectedTable?.name || `Table ${selectedTable?.table_number || selectedTable?.id}`)
      : 'Takeaway';

    try {
      // 1. Create the order
      const orderData = {
        restaurant_id: restaurantId,
        order_type: orderType,
        status: 'new',
        payment_status: markPaid ? 'paid' : 'pending',
        table_name: tableNameStr,
        table_id: orderType === 'dine_in' ? selectedTable?.id : null,
        total: cartTotal,
        special_instructions: notes,
        created_by: profile.id,
      };

      const { data: order, error: orderErr } = await supabase
        .from('orders').insert(orderData).select().single();
      if (orderErr) throw orderErr;

      // 2. Create order items
      const itemsData = cart.map(item => ({
        order_id: order.id,
        item_id: item.id,
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        notes: item.notes || '',
      }));
      const { error: itemsErr } = await supabase.from('order_items').insert(itemsData);
      if (itemsErr) console.log('order_items insert warning:', itemsErr.message);

      // 3. Create kitchen batch for real-time kitchen display
      const batchData = {
        order_id: order.id,
        restaurant_id: restaurantId,
        table_id: orderType === 'dine_in' ? selectedTable?.id : null,
        status: 'new',
        items: cart.map(item => ({
          id: item.id,
          name: item.name,
          item_name: item.name,
          quantity: item.quantity,
          price: item.price,
          is_veg: item.is_veg !== false,
          notes: item.notes || '',
        })),
      };

      const { error: batchErr } = await supabase.from('order_batches').insert(batchData);
      if (batchErr) console.log('order_batches insert warning:', batchErr.message);

      Alert.alert('Order Placed!', `Order for ${tableNameStr} submitted successfully`);
      setCart([]);
      setNotes('');
      setMarkPaid(false);
      setShowCart(false);
    } catch (e) {
      Alert.alert('Error', e.message || 'Failed to place order');
    } finally {
      setSubmitting(false);
    }
  }

  const renderMenuItem = ({ item }) => {
    const qty = getQuantity(item.id);

    return (
      <View style={styles.menuCard}>
        <View style={styles.menuCardHeader}>
          <View style={[styles.vegIndicator, { borderColor: item.is_veg === false ? '#ef4444' : '#22c55e' }]}>
            <View style={[styles.vegIndicatorInner, { backgroundColor: item.is_veg === false ? '#ef4444' : '#22c55e' }]} />
          </View>
          <Text style={styles.menuPrice}>{formatCurrency(item.price)}</Text>
        </View>

        <Text style={styles.menuTitle} numberOfLines={2}>{item.name}</Text>

        <View style={styles.menuCardFooter}>
          {qty === 0 ? (
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => addToCart(item)}
            >
              <Ionicons name="add" size={16} color={COLORS.primary} style={{ marginRight: 4 }} />
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.qtyStepper}>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => removeFromCart(item.id)}>
                <Ionicons name="remove" size={16} color="#0f172a" />
              </TouchableOpacity>
              <Text style={styles.stepperQty}>{qty}</Text>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => addToCart(item)}>
                <Ionicons name="add" size={16} color="#0f172a" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Punch Order</Text>

        {/* View Cart Button */}
        <TouchableOpacity
          style={styles.cartHeaderBtn}
          onPress={() => setShowCart(true)}
        >
          <Ionicons name="cart-outline" size={20} color="#ffffff" />
          {cartCount > 0 && (
            <View style={styles.cartBadge}>
              <Text style={styles.cartBadgeText}>{cartCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Order Type Selector */}
      <View style={styles.typeSelectorContainer}>
        <TouchableOpacity
          style={[styles.typeBtn, orderType === 'dine_in' && styles.typeBtnActive]}
          onPress={() => setOrderType('dine_in')}
        >
          <Ionicons
            name="restaurant-outline"
            size={18}
            color={orderType === 'dine_in' ? '#ffffff' : '#64748b'}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.typeBtnText, orderType === 'dine_in' && styles.typeBtnTextActive]}>
            Dine-In
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.typeBtn, orderType === 'takeaway' && styles.typeBtnActive]}
          onPress={() => setOrderType('takeaway')}
        >
          <Ionicons
            name="bag-handle-outline"
            size={18}
            color={orderType === 'takeaway' ? '#ffffff' : '#64748b'}
            style={{ marginRight: 6 }}
          />
          <Text style={[styles.typeBtnText, orderType === 'takeaway' && styles.typeBtnTextActive]}>
            Takeaway
          </Text>
        </TouchableOpacity>
      </View>

      {/* Table Selector Pills (Dine-In only) */}
      {orderType === 'dine_in' && (
        <View style={styles.tableSection}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tableScrollContent}
          >
            {tables.map((t, idx) => {
              const selected = selectedTable?.id === t.id;
              const tableNameDisplay = t.name || t.table_number || `Table ${idx + 1}`;
              return (
                <TouchableOpacity
                  key={t.id || idx}
                  style={[styles.tablePill, selected && styles.tablePillSelected]}
                  onPress={() => setSelectedTable(t)}
                >
                  <Text style={[styles.tablePillText, selected && styles.tablePillTextSelected]}>
                    {tableNameDisplay}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Search Input */}
      <View style={styles.searchBox}>
        <Ionicons name="search-outline" size={18} color="#94a3b8" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search menu items..."
          placeholderTextColor="#94a3b8"
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={18} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </View>

      {/* Category Horizontal Chips */}
      <View style={styles.categorySection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16 }}
        >
          <TouchableOpacity
            style={[styles.catChip, selectedCategory === 'all' && styles.catChipActive]}
            onPress={() => setSelectedCategory('all')}
          >
            <Text style={[styles.catChipText, selectedCategory === 'all' && styles.catChipTextActive]}>
              All Items
            </Text>
          </TouchableOpacity>

          {categories.map(c => {
            const active = selectedCategory === c.id;
            return (
              <TouchableOpacity
                key={c.id}
                style={[styles.catChip, active && styles.catChipActive]}
                onPress={() => setSelectedCategory(c.id)}
              >
                <Text style={[styles.catChipText, active && styles.catChipTextActive]}>
                  {c.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Menu Grid */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={item => item.id}
          numColumns={2}
          renderItem={renderMenuItem}
          contentContainerStyle={styles.menuGridContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="fast-food-outline" size={48} color="#cbd5e1" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>No menu items found</Text>
            </View>
          }
        />
      )}

      {/* Sticky Bottom Cart Bar */}
      {cartCount > 0 && (
        <View style={styles.bottomCartBar}>
          <View>
            <Text style={styles.cartBarItemsCount}>{cartCount} items selected</Text>
            <Text style={styles.cartBarTotal}>{formatCurrency(cartTotal)}</Text>
          </View>

          <TouchableOpacity
            style={styles.cartBarBtn}
            onPress={() => setShowCart(true)}
          >
            <Text style={styles.cartBarBtnText}>Review Cart</Text>
            <Ionicons name="arrow-forward" size={18} color="#ffffff" style={{ marginLeft: 6 }} />
          </TouchableOpacity>
        </View>
      )}

      {/* Cart Modal */}
      <Modal
        visible={showCart}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCart(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContent}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Order Summary</Text>
              <TouchableOpacity onPress={() => setShowCart(false)}>
                <Ionicons name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            {/* Target Info */}
            <View style={styles.targetInfoBanner}>
              <Ionicons
                name={orderType === 'dine_in' ? 'restaurant-outline' : 'bag-handle-outline'}
                size={18}
                color={COLORS.primary}
                style={{ marginRight: 8 }}
              />
              <Text style={styles.targetInfoText}>
                {orderType === 'dine_in'
                  ? (selectedTable?.name || `Table ${selectedTable?.table_number || selectedTable?.id || '1'}`)
                  : 'Takeaway Order'}
              </Text>
            </View>

            {/* Cart Items List */}
            <ScrollView style={{ maxHeight: 250, marginVertical: 12 }}>
              {cart.map(item => (
                <View key={item.id} style={styles.cartItemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cartItemTitle}>{item.name}</Text>
                    <Text style={styles.cartItemSubtotal}>{formatCurrency(item.price * item.quantity)}</Text>
                  </View>

                  <View style={styles.qtyStepper}>
                    <TouchableOpacity style={styles.stepperBtn} onPress={() => removeFromCart(item.id)}>
                      <Ionicons name="remove" size={16} color="#0f172a" />
                    </TouchableOpacity>
                    <Text style={styles.stepperQty}>{item.quantity}</Text>
                    <TouchableOpacity style={styles.stepperBtn} onPress={() => addToCart(item)}>
                      <Ionicons name="add" size={16} color="#0f172a" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>

            {/* Special Notes Input */}
            <TextInput
              style={styles.notesInput}
              placeholder="Special instructions (e.g. less spicy)..."
              placeholderTextColor="#94a3b8"
              value={notes}
              onChangeText={setNotes}
            />

            {/* Mark as Paid Checkbox */}
            <TouchableOpacity
              style={styles.paidCheckboxRow}
              onPress={() => setMarkPaid(!markPaid)}
            >
              <Ionicons
                name={markPaid ? 'checkbox' : 'square-outline'}
                size={22}
                color={markPaid ? COLORS.primary : '#94a3b8'}
                style={{ marginRight: 10 }}
              />
              <Text style={styles.paidCheckboxText}>Mark as Paid (Cash)</Text>
            </TouchableOpacity>

            {/* Total Row & Submit Button */}
            <View style={styles.cartModalFooter}>
              <View>
                <Text style={{ fontSize: 12, color: '#64748b' }}>Total</Text>
                <Text style={styles.modalTotalText}>{formatCurrency(cartTotal)}</Text>
              </View>

              <TouchableOpacity
                style={styles.submitBtn}
                disabled={submitting}
                onPress={submitOrder}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={20} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={styles.submitBtnText}>Place Order</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row',
    justify: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  cartHeaderBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justify: 'center',
  },
  cartBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#ef4444',
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justify: 'center',
  },
  cartBadgeText: { color: '#ffffff', fontSize: 11, fontWeight: '700' },
  typeSelectorContainer: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  typeBtn: {
    flex: 1,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justify: 'center',
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    marginHorizontal: 4,
  },
  typeBtnActive: { backgroundColor: COLORS.primary },
  typeBtnText: { fontSize: 14, fontWeight: '600', color: '#64748b' },
  typeBtnTextActive: { color: '#ffffff', fontWeight: '700' },
  tableSection: {
    backgroundColor: '#ffffff',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  tableScrollContent: { paddingHorizontal: 16, alignItems: 'center' },
  tablePill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  tablePillSelected: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  tablePillText: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  tablePillTextSelected: { color: '#ffffff' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  searchInput: { flex: 1, fontSize: 14, color: '#0f172a' },
  categorySection: { height: 40, marginBottom: 8 },
  catChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#ffffff',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  catChipActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  catChipText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  catChipTextActive: { color: '#ffffff', fontWeight: '700' },
  menuGridContent: { paddingHorizontal: 12, paddingBottom: 90 },
  menuCard: {
    flex: 1,
    margin: 4,
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  menuCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  vegIndicator: { width: 14, height: 14, borderRadius: 2, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  vegIndicatorInner: { width: 6, height: 6, borderRadius: 3 },
  menuPrice: { fontSize: 15, fontWeight: '700', color: COLORS.primary },
  menuTitle: { fontSize: 14, fontWeight: '600', color: '#0f172a', height: 38, marginBottom: 8 },
  menuCardFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  addBtn: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  addBtnText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  qtyStepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 8, paddingHorizontal: 4 },
  stepperBtn: { padding: 6 },
  stepperQty: { fontSize: 14, fontWeight: '700', color: '#0f172a', paddingHorizontal: 8 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  emptyText: { fontSize: 14, color: '#94a3b8', fontWeight: '600' },
  bottomCartBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0f172a',
    paddingHorizontal: 20,
    paddingVertical: 12,
    flexDirection: 'row',
    justify: 'space-between',
    alignItems: 'center',
    elevation: 10,
  },
  cartBarItemsCount: { color: '#94a3b8', fontSize: 12 },
  cartBarTotal: { color: '#ffffff', fontSize: 18, fontWeight: '700' },
  cartBarBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, flexDirection: 'row', alignItems: 'center' },
  cartBarBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#ffffff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  targetInfoBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primaryLight, padding: 10, borderRadius: 8 },
  targetInfoText: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  cartItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  cartItemTitle: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  cartItemSubtotal: { fontSize: 13, fontWeight: '700', color: COLORS.primary, marginTop: 2 },
  notesInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 10, fontSize: 13, color: '#0f172a', marginVertical: 8 },
  paidCheckboxRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 8 },
  paidCheckboxText: { fontSize: 14, fontWeight: '600', color: '#334155' },
  cartModalFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f1f5f9', marginTop: 8 },
  modalTotalText: { fontSize: 20, fontWeight: '700', color: COLORS.primary },
  submitBtn: { backgroundColor: COLORS.primary, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center' },
  submitBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 15 },
});
