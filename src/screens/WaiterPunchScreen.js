import React, { useState, useEffect } from 'react';
import { 
  View, Text, StyleSheet, FlatList, TouchableOpacity, 
  TextInput, ScrollView, Alert, ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';
import { supabase } from '../lib/supabase';
import { sendPushToRestaurantStaff } from '../lib/notifications';

export default function WaiterPunchScreen({ route }) {
  const profile = route?.params?.profile || {};
  const [restaurantId, setRestaurantId] = useState(profile.restaurant_id || null);
  const [restaurant, setRestaurant] = useState(null);

  const [tables, setTables] = useState([]);
  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [orderType, setOrderType] = useState('dine_in'); // 'dine_in' | 'takeaway'
  const [selectedTable, setSelectedTable] = useState(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [cart, setCart] = useState([]);
  
  // Payment Options
  const [markPaid, setMarkPaid] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash');

  useEffect(() => {
    initData();
  }, []);

  const initData = async () => {
    setLoading(true);
    try {
      let restId = restaurantId;
      let userProfile = profile;

      if (!restId || !userProfile.full_name) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const { data: prof } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();
          if (prof) {
            userProfile = prof;
            restId = prof.restaurant_id;
            setRestaurantId(restId);
          }
        }
      }

      if (!restId) {
        setLoading(false);
        return;
      }

      // 1. Fetch Restaurant Info
      const { data: restData } = await supabase
        .from('restaurants')
        .select('*')
        .eq('id', restId)
        .single();
      if (restData) setRestaurant(restData);

      // 2. Fetch Tables
      const { data: tablesData } = await supabase
        .from('tables')
        .select('*')
        .eq('restaurant_id', restId)
        .order('name');
      if (Array.isArray(tablesData)) {
        setTables(tablesData);
        if (tablesData.length > 0) setSelectedTable(tablesData[0]);
      }

      // 3. Fetch Categories
      const { data: catData } = await supabase
        .from('categories')
        .select('*')
        .eq('restaurant_id', restId)
        .order('display_order');
      if (Array.isArray(catData)) setCategories(catData);

      // 4. Fetch Available Menu Items
      const { data: menuData } = await supabase
        .from('menu_items')
        .select('*')
        .eq('restaurant_id', restId)
        .eq('is_available', true)
        .order('name');
      if (Array.isArray(menuData)) setMenuItems(menuData);

    } catch (err) {
      console.log('Error initializing Punch POS:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCart = (item) => {
    const existingIndex = cart.findIndex(c => c.menuItem.id === item.id);
    if (existingIndex > -1) {
      const updated = [...cart];
      updated[existingIndex].quantity += 1;
      setCart(updated);
    } else {
      setCart([...cart, { menuItem: item, quantity: 1 }]);
    }
  };

  const handleUpdateQuantity = (menuItemId, delta) => {
    const updated = cart.map(item => {
      if (item.menuItem.id === menuItemId) {
        const newQty = item.quantity + delta;
        return newQty > 0 ? { ...item, quantity: newQty } : null;
      }
      return item;
    }).filter(Boolean);
    setCart(updated);
  };

  const calculateSubtotal = () => {
    return cart.reduce((sum, c) => sum + (c.menuItem.price * c.quantity), 0);
  };

  const calculateGST = (subtotal) => {
    if (!restaurant?.gst_enabled) return 0;
    const rate = Number(restaurant?.gst_percentage) || 5;
    return (subtotal * rate) / 100;
  };

  const subtotal = calculateSubtotal();
  const gst = calculateGST(subtotal);
  const grandTotal = subtotal + gst;

  const handleSubmitOrder = async () => {
    if (cart.length === 0) {
      Alert.alert('Cart Empty', 'Please select at least 1 item to punch order.');
      return;
    }

    if (orderType === 'dine_in' && !selectedTable) {
      Alert.alert('Select Table', 'Please select a table for Dine-in order.');
      return;
    }

    setSubmitting(true);
    try {
      const orderPayload = {
        restaurant_id: restaurantId,
        table_id: orderType === 'dine_in' ? selectedTable?.id : null,
        table_name: orderType === 'dine_in' ? selectedTable?.name : 'Takeaway',
        order_type: orderType,
        status: 'new',
        payment_status: markPaid ? 'paid' : 'pending',
        payment_method: markPaid ? paymentMethod : null,
        subtotal: Number(subtotal.toFixed(2)),
        gst: Number(gst.toFixed(2)),
        total: Number(grandTotal.toFixed(2)),
      };

      const { data: createdOrder, error: orderError } = await supabase
        .from('orders')
        .insert(orderPayload)
        .select()
        .single();

      if (orderError) throw orderError;

      // Create Batch #1 for the order
      const { data: createdBatch } = await supabase
        .from('order_batches')
        .insert({
          order_id: createdOrder.id,
          batch_number: 1,
          status: 'new'
        })
        .select()
        .single();

      // Insert Items
      const itemsPayload = cart.map(c => ({
        order_id: createdOrder.id,
        batch_id: createdBatch?.id,
        menu_item_id: c.menuItem.id,
        menu_item_name: c.menuItem.name,
        quantity: c.quantity,
        price: c.menuItem.price,
      }));

      const { error: itemsError } = await supabase
        .from('order_items')
        .insert(itemsPayload);

      if (itemsError) throw itemsError;

      sendPushToRestaurantStaff(
        restaurantId,
        'NEW STAFF ORDER PUNCHED',
        `Table ${orderPayload.table_name} - Total: ₹${grandTotal.toFixed(2)}`,
        { orderId: createdOrder.id }
      ).catch(() => {});

      Alert.alert(
        'Order Placed Successfully',
        `Order #${createdOrder.id.slice(0, 8)} sent to Kitchen KDS.`,
        [{ text: 'OK', onPress: () => setCart([]) }]
      );

    } catch (err) {
      Alert.alert('Punch Failed', err.message || 'Failed to place order.');
    } finally {
      setSubmitting(false);
    }
  };

  const safeMenuItems = menuItems || [];
  const safeCategories = categories || [];
  const safeTables = tables || [];

  const filteredMenuItems = safeMenuItems.filter(item => {
    if (!item) return false;
    const matchesCategory = selectedCategoryId === 'all' || item.category_id === selectedCategoryId;
    const matchesSearch = item.name?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0ea5e9" />
        <Text style={styles.loadingText}>Loading menu catalog & tables...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Punch New Order (POS)</Text>
        <Text style={styles.subtitle}>{restaurant?.name || 'SmartDine Staff POS'}</Text>
      </View>

      {/* Top Options: Order Type & Table Selection */}
      <View style={styles.topSection}>
        <View style={styles.rowBetween}>
          {/* Order Type Buttons */}
          <View style={styles.orderTypeContainer}>
            <TouchableOpacity 
              style={[styles.typeBtn, orderType === 'dine_in' && styles.typeBtnActiveDine]} 
              onPress={() => setOrderType('dine_in')}
            >
              <Text style={[styles.typeBtnText, orderType === 'dine_in' && styles.typeBtnTextActive]}>
                Dine-in
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.typeBtn, orderType === 'takeaway' && styles.typeBtnActiveTakeaway]} 
              onPress={() => setOrderType('takeaway')}
            >
              <Text style={[styles.typeBtnText, orderType === 'takeaway' && styles.typeBtnTextActive]}>
                Takeaway
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Table Selector */}
        {orderType === 'dine_in' && (
          <View style={{ marginTop: 10 }}>
            <Text style={styles.sectionLabel}>SELECT TABLE:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
              {safeTables.map(tbl => (
                <TouchableOpacity
                  key={tbl.id}
                  style={[
                    styles.tablePill,
                    selectedTable?.id === tbl.id && styles.tablePillActive
                  ]}
                  onPress={() => setSelectedTable(tbl)}
                >
                  <Text style={[
                    styles.tablePillText,
                    selectedTable?.id === tbl.id && styles.tablePillTextActive
                  ]}>
                    {tbl.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {/* Category Pills & Search Bar */}
      <View style={styles.menuFilterSection}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search food item..."
          placeholderTextColor="#94a3b8"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
          <TouchableOpacity
            style={[styles.catPill, selectedCategoryId === 'all' && styles.catPillActive]}
            onPress={() => setSelectedCategoryId('all')}
          >
            <Text style={[styles.catPillText, selectedCategoryId === 'all' && styles.catPillTextActive]}>
              All Items
            </Text>
          </TouchableOpacity>
          {safeCategories.map(cat => (
            <TouchableOpacity
              key={cat.id}
              style={[styles.catPill, selectedCategoryId === cat.id && styles.catPillActive]}
              onPress={() => setSelectedCategoryId(cat.id)}
            >
              <Text style={[styles.catPillText, selectedCategoryId === cat.id && styles.catPillTextActive]}>
                {cat.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Main Grid: Menu Catalog */}
      <FlatList
        data={filteredMenuItems}
        keyExtractor={(item) => item?.id || Math.random().toString()}
        renderItem={({ item }) => {
          if (!item) return null;
          const cartItem = cart.find(c => c.menuItem.id === item.id);
          const qty = cartItem ? cartItem.quantity : 0;

          return (
            <View style={styles.menuCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuItemName}>{item.name}</Text>
                <Text style={styles.menuItemPrice}>₹{Number(item.price || 0).toFixed(2)}</Text>
              </View>

              {qty > 0 ? (
                <View style={styles.qtyContainer}>
                  <TouchableOpacity style={styles.qtyMinusBtn} onPress={() => handleUpdateQuantity(item.id, -1)}>
                    <Text style={styles.qtyBtnText}>-</Text>
                  </TouchableOpacity>
                  <Text style={styles.qtyText}>{qty}</Text>
                  <TouchableOpacity style={styles.qtyPlusBtn} onPress={() => handleUpdateQuantity(item.id, 1)}>
                    <Text style={styles.qtyBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity style={styles.addBtn} onPress={() => handleAddToCart(item)}>
                  <Text style={styles.addBtnText}>+ Add</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No available menu items found.</Text>
        }
      />

      {/* Cart Summary Drawer */}
      {cart.length > 0 && (
        <View style={styles.cartFooter}>
          <ScrollView style={styles.cartItemsScroll}>
            {cart.map(c => (
              <View key={c.menuItem.id} style={styles.cartRow}>
                <Text style={styles.cartQty}>{c.quantity}x</Text>
                <Text style={styles.cartItemName}>{c.menuItem.name}</Text>
                <Text style={styles.cartItemPrice}>₹{(c.menuItem.price * c.quantity).toFixed(2)}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>
              Total ({cart.reduce((s, c) => s + c.quantity, 0)} items):
            </Text>
            <Text style={styles.totalValue}>₹{grandTotal.toFixed(2)}</Text>
          </View>

          {/* Quick Mark Paid Toggle */}
          <TouchableOpacity 
            style={[styles.paidToggle, markPaid && styles.paidToggleActive]}
            onPress={() => setMarkPaid(!markPaid)}
          >
            <Text style={[styles.paidToggleText, markPaid && { color: '#10b981' }]}>
              {markPaid ? 'Marking as PAID (Cash/UPI)' : 'Mark Paid Immediately?'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.punchSubmitBtn, submitting && { opacity: 0.6 }]}
            onPress={handleSubmitOrder}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.punchSubmitText}>
                Punch Order to Kitchen (₹{grandTotal.toFixed(2)})
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
    paddingTop: 45,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { color: '#64748b', marginTop: 12, fontSize: 14 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#ffffff',
  },
  title: { fontSize: 20, fontWeight: 'bold', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b' },
  topSection: {
    backgroundColor: '#ffffff',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderTypeContainer: { flexDirection: 'row', gap: 8, flex: 1 },
  typeBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  typeBtnActiveDine: { backgroundColor: '#10b981', borderColor: '#10b981' },
  typeBtnActiveTakeaway: { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' },
  typeBtnText: { color: '#64748b', fontSize: 13, fontWeight: 'bold' },
  typeBtnTextActive: { color: 'white' },
  sectionLabel: { color: '#64748b', fontSize: 10, fontWeight: 'bold' },
  tablePill: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 8,
  },
  tablePillActive: { backgroundColor: '#059669', borderColor: '#059669' },
  tablePillText: { color: '#64748b', fontSize: 12, fontWeight: 'bold' },
  tablePillTextActive: { color: 'white' },
  menuFilterSection: { paddingHorizontal: 16, marginVertical: 10 },
  searchInput: {
    backgroundColor: '#ffffff',
    color: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  catPill: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  catPillActive: { backgroundColor: '#059669', borderColor: '#059669' },
  catPillText: { color: '#64748b', fontSize: 11, fontWeight: 'bold' },
  catPillTextActive: { color: 'white' },
  menuCard: {
    backgroundColor: '#ffffff',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  menuItemName: { color: '#0f172a', fontSize: 14, fontWeight: 'bold' },
  menuItemPrice: { color: '#10b981', fontSize: 12, fontWeight: 'bold', marginTop: 2 },
  addBtn: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#10b981', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 },
  addBtnText: { color: '#10b981', fontWeight: 'bold', fontSize: 12 },
  qtyContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 6, padding: 2 },
  qtyMinusBtn: { backgroundColor: '#e2e8f0', width: 26, height: 26, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  qtyPlusBtn: { backgroundColor: '#10b981', width: 26, height: 26, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  qtyBtnText: { color: '#0f172a', fontWeight: 'bold', fontSize: 14 },
  qtyText: { color: '#0f172a', fontWeight: 'bold', fontSize: 13, paddingHorizontal: 8 },
  emptyText: { color: '#64748b', textAlign: 'center', marginTop: 40, fontSize: 13 },
  cartFooter: {
    backgroundColor: '#ffffff',
    borderTopWidth: 2,
    borderTopColor: '#059669',
    padding: 14,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 8,
  },
  cartItemsScroll: { maxHeight: 80, marginBottom: 8 },
  cartRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  cartQty: { color: '#059669', fontWeight: 'bold', fontSize: 12, width: 24 },
  cartItemName: { color: '#0f172a', fontSize: 12, flex: 1 },
  cartItemPrice: { color: '#64748b', fontSize: 12, fontWeight: 'bold' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 6, marginBottom: 8 },
  totalLabel: { color: '#0f172a', fontSize: 13, fontWeight: 'bold' },
  totalValue: { color: '#10b981', fontSize: 18, fontWeight: 'bold' },
  paidToggle: { backgroundColor: '#f8fafc', padding: 8, borderRadius: 6, alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: '#cbd5e1' },
  paidToggleActive: { borderColor: '#10b981', backgroundColor: '#f0fdf4' },
  paidToggleText: { color: '#059669', fontSize: 11, fontWeight: 'bold' },
  punchSubmitBtn: { backgroundColor: '#059669', padding: 12, borderRadius: 10, alignItems: 'center' },
  punchSubmitText: { color: 'white', fontSize: 14, fontWeight: 'bold' },
});
