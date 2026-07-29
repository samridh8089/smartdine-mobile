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
  const [specialInstructions, setSpecialInstructions] = useState('');
  
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

      // Fetch restaurant settings, tables, categories & menu items
      const [restRes, tblsRes, catsRes, itemsRes] = await Promise.all([
        supabase.from('restaurants').select('*').eq('id', restId).single(),
        supabase.from('tables').select('*').eq('restaurant_id', restId),
        supabase.from('categories').select('*').eq('restaurant_id', restId).order('sort_order', { ascending: true }),
        supabase.from('menu_items').select('*').eq('restaurant_id', restId).eq('is_available', true)
      ]);

      if (restRes.data) setRestaurant(restRes.data);
      if (tblsRes.data) {
        setTables(tblsRes.data);
        if (tblsRes.data.length > 0) {
          setSelectedTable(tblsRes.data[0]);
        }
      }
      if (catsRes.data) setCategories(catsRes.data);
      if (itemsRes.data) setMenuItems(itemsRes.data);

    } catch (e) {
      console.log('Error initializing Waiter Punch screen:', e);
      Alert.alert('Error', 'Failed to load menu catalog or tables.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddToCart = (item) => {
    setCart(prev => {
      const idx = prev.findIndex(c => c.menuItem.id === item.id);
      if (idx > -1) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], quantity: updated[idx].quantity + 1 };
        return updated;
      }
      return [...prev, { menuItem: item, quantity: 1, notes: '' }];
    });
  };

  const handleUpdateQuantity = (itemId, delta) => {
    setCart(prev => {
      return prev.map(c => {
        if (c.menuItem.id === itemId) {
          const newQty = c.quantity + delta;
          return newQty > 0 ? { ...c, quantity: newQty } : null;
        }
        return c;
      }).filter(Boolean);
    });
  };

  const handleUpdateItemNote = (itemId, notes) => {
    setCart(prev => prev.map(c => c.menuItem.id === itemId ? { ...c, notes } : c));
  };

  // Calculations
  const subtotal = cart.reduce((sum, c) => sum + (c.menuItem.price * c.quantity), 0);
  
  const settings = restaurant?.settings || {};
  const gstEnabled = settings.gst_enabled !== false;
  const gstPercentage = gstEnabled ? (settings.gst_percentage || 0) : 0;
  const gstAmount = parseFloat(((subtotal * gstPercentage) / 100).toFixed(2));

  const serviceChargeEnabled = settings.service_charge_enabled !== false;
  const serviceChargePercentage = serviceChargeEnabled ? (settings.service_charge_percentage || 0) : 0;
  const serviceChargeAmount = parseFloat(((subtotal * serviceChargePercentage) / 100).toFixed(2));

  const grandTotal = parseFloat((subtotal + gstAmount + serviceChargeAmount).toFixed(2));

  const handleSubmitOrder = async () => {
    if (cart.length === 0) {
      Alert.alert('Empty Cart', 'Please select at least 1 menu item to punch order.');
      return;
    }

    if (orderType === 'dine_in' && !selectedTable) {
      Alert.alert('Table Required', 'Please select a table for Dine-In orders.');
      return;
    }

    setSubmitting(true);
    try {
      const targetTableId = orderType === 'takeaway' ? null : (selectedTable?.id || null);
      const targetTableName = orderType === 'takeaway' ? 'Takeaway Counter' : (selectedTable?.name || 'Table');

      // 1. Insert into orders
      const orderPayload = {
        restaurant_id: restaurantId,
        table_id: targetTableId,
        table_name: targetTableName,
        status: 'new',
        special_instructions: specialInstructions.trim() || null,
        subtotal,
        gst: gstAmount,
        service_charge: serviceChargeAmount,
        total: grandTotal,
        order_type: orderType,
        payment_status: markPaid ? 'paid' : 'pending',
        payment_method: markPaid ? paymentMethod : null,
        marked_paid_by: markPaid ? (profile.full_name || 'Waiter') : null,
        paid_at: markPaid ? new Date().toISOString() : null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data: ordData, error: ordErr } = await supabase
        .from('orders')
        .insert([orderPayload])
        .select();

      if (ordErr || !ordData || ordData.length === 0) {
        throw new Error(ordErr?.message || 'Failed to insert order.');
      }

      const newOrder = ordData[0];

      // 2. Insert batch #1 into order_batches
      const { data: batchData, error: batchErr } = await supabase
        .from('order_batches')
        .insert([{
          order_id: newOrder.id,
          batch_number: 1,
          status: 'new',
          special_instructions: specialInstructions.trim() || null,
          created_at: new Date().toISOString()
        }])
        .select();

      const batchId = batchData?.[0]?.id || null;

      // 3. Insert items into order_items
      const itemsPayload = cart.map(c => ({
        order_id: newOrder.id,
        batch_id: batchId,
        menu_item_id: c.menuItem.id,
        menu_item_name: c.menuItem.name,
        quantity: c.quantity,
        price: c.menuItem.price,
        notes: c.notes || null,
        created_at: new Date().toISOString()
      }));

      const { error: itemsErr } = await supabase
        .from('order_items')
        .insert(itemsPayload);

      if (itemsErr) {
        console.log('Error inserting order items:', itemsErr);
      }

      // 4. Send Realtime Notification to Kitchen / KDS
      sendPushToRestaurantStaff(
        restaurantId,
        '🔔 NEW KITCHEN ORDER!',
        `${targetTableName} • ${orderType === 'takeaway' ? '📦 Takeaway' : '🍽️ Dine-in'} • Total: ₹${grandTotal.toFixed(2)}`,
        { orderId: newOrder.id }
      );

      Alert.alert(
        'Order Punched! 🚀',
        `Order for ${targetTableName} has been sent directly to the kitchen.`,
        [{ text: 'OK', onPress: () => {
          setCart([]);
          setSpecialInstructions('');
          setMarkPaid(false);
        }}]
      );

    } catch (e) {
      console.log('Error punching order:', e);
      Alert.alert('Punch Error', e.message || 'Failed to submit order.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredMenuItems = menuItems.filter(item => {
    const matchesCat = selectedCategoryId === 'all' || item.category_id === selectedCategoryId;
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
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
        <Text style={styles.title}>➕ Punch New Order (POS)</Text>
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
                🍽️ Dine-in
              </Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.typeBtn, orderType === 'takeaway' && styles.typeBtnActiveTakeaway]} 
              onPress={() => setOrderType('takeaway')}
            >
              <Text style={[styles.typeBtnText, orderType === 'takeaway' && styles.typeBtnTextActive]}>
                📦 Takeaway
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Horizontal Table Selector (For Dine-in) */}
        {orderType === 'dine_in' && (
          <View style={{ marginTop: 10 }}>
            <Text style={styles.sectionLabel}>SELECT TABLE:</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }}>
              {tables.map(tbl => (
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
          placeholder="🔍 Search food item..."
          placeholderTextColor="#64748b"
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
          {categories.map(cat => (
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

      {/* Main Grid: Menu Item Catalog List */}
      <FlatList
        data={filteredMenuItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const cartItem = cart.find(c => c.menuItem.id === item.id);
          const qty = cartItem ? cartItem.quantity : 0;

          return (
            <View style={styles.menuCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.menuItemName}>{item.name}</Text>
                <Text style={styles.menuItemPrice}>₹{Number(item.price).toFixed(2)}</Text>
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

      {/* Cart Summary Drawer at Bottom */}
      {cart.length > 0 && (
        <View style={styles.cartFooter}>
          <ScrollView maxH={140} style={styles.cartItemsScroll}>
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

          {/* Quick Mark Paid Switch */}
          <TouchableOpacity 
            style={[styles.paidToggle, markPaid && styles.paidToggleActive]}
            onPress={() => setMarkPaid(!markPaid)}
          >
            <Text style={styles.paidToggleText}>
              {markPaid ? '✅ Marking as PAID (Cash/UPI)' : '⭕ Mark Paid Immediately?'}
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
                🚀 Punch Order to Kitchen (₹{grandTotal.toFixed(2)})
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
    backgroundColor: '#0f172a',
    paddingTop: 45,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: { color: '#94a3b8', marginTop: 12, fontSize: 14 },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  title: { fontSize: 20, fontWeight: 'bold', color: '#0ea5e9' },
  subtitle: { fontSize: 12, color: '#64748b' },
  topSection: {
    backgroundColor: '#1e293b',
    padding: 12,
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
  },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderTypeContainer: { flexDirection: 'row', gap: 8, flex: 1 },
  typeBtn: {
    flex: 1,
    backgroundColor: '#334155',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  typeBtnActiveDine: { backgroundColor: '#10b981' },
  typeBtnActiveTakeaway: { backgroundColor: '#8b5cf6' },
  typeBtnText: { color: '#94a3b8', fontSize: 13, fontWeight: 'bold' },
  typeBtnTextActive: { color: 'white' },
  sectionLabel: { color: '#64748b', fontSize: 10, fontWeight: 'bold', tracking: 1 },
  tablePill: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 8,
  },
  tablePillActive: { backgroundColor: '#0ea5e9', borderColor: '#0ea5e9' },
  tablePillText: { color: '#94a3b8', fontSize: 12, fontWeight: 'bold' },
  tablePillTextActive: { color: 'white' },
  menuFilterSection: { paddingHorizontal: 16, marginVertical: 10 },
  searchInput: {
    backgroundColor: '#1e293b',
    color: 'white',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#334155',
  },
  catPill: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 6,
  },
  catPillActive: { backgroundColor: '#38bdf8' },
  catPillText: { color: '#94a3b8', fontSize: 11, fontWeight: 'bold' },
  catPillTextActive: { color: '#0f172a' },
  menuCard: {
    backgroundColor: '#1e293b',
    padding: 12,
    borderRadius: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#334155',
  },
  menuItemName: { color: 'white', fontSize: 14, fontWeight: 'bold' },
  menuItemPrice: { color: '#10b981', fontSize: 12, fontWeight: 'bold', marginTop: 2 },
  addBtn: { backgroundColor: '#10b98122', borderWidth: 1, borderColor: '#10b981', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 },
  addBtnText: { color: '#10b981', fontWeight: 'bold', fontSize: 12 },
  qtyContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0f172a', borderRadius: 6, padding: 2 },
  qtyMinusBtn: { backgroundColor: '#334155', width: 26, height: 26, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  qtyPlusBtn: { backgroundColor: '#10b981', width: 26, height: 26, borderRadius: 4, justifyContent: 'center', alignItems: 'center' },
  qtyBtnText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
  qtyText: { color: 'white', fontWeight: 'bold', fontSize: 13, paddingHorizontal: 8 },
  emptyText: { color: '#64748b', textAlign: 'center', marginTop: 40, fontSize: 13 },
  cartFooter: {
    backgroundColor: '#1e293b',
    borderTopWidth: 2,
    borderTopColor: '#0ea5e9',
    padding: 14,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  cartItemsScroll: { maxHeight: 80, marginBottom: 8 },
  cartRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  cartQty: { color: '#0ea5e9', fontWeight: 'bold', fontSize: 12, width: 24 },
  cartItemName: { color: '#f8fafc', fontSize: 12, flex: 1 },
  cartItemPrice: { color: '#94a3b8', fontSize: 12, fontWeight: 'bold' },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#334155', paddingTop: 6, marginBottom: 8 },
  totalLabel: { color: 'white', fontSize: 13, fontWeight: 'bold' },
  totalValue: { color: '#10b981', fontSize: 18, fontWeight: 'bold' },
  paidToggle: { backgroundColor: '#0f172a', padding: 8, borderRadius: 6, alignItems: 'center', marginBottom: 8, borderWidth: 1, borderColor: '#334155' },
  paidToggleActive: { borderColor: '#10b981', backgroundColor: '#10b98115' },
  paidToggleText: { color: '#38bdf8', fontSize: 11, fontWeight: 'bold' },
  punchSubmitBtn: { backgroundColor: '#0ea5e9', padding: 12, borderRadius: 10, alignItems: 'center' },
  punchSubmitText: { color: 'white', fontSize: 14, fontWeight: 'bold' },
});
