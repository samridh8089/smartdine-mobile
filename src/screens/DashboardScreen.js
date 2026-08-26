import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
  ActivityIndicator, TouchableOpacity, Platform, Modal,
  Alert, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import {
  COLORS, FONTS, RADIUS, SHADOWS,
  formatCurrency, timeAgo, getStatusColor, getStatusLabel,
} from '../lib/theme';

import { stopAllAlarms } from '../lib/alarmManager';
import { unregisterPushToken } from '../lib/notifications';
import { fetchLiveTableStatus } from '../lib/tableAssignments';

const INVENTORY_UNITS = [
  'kg',
  'g',
  'l',
  'ml',
  'pcs',
  'box',
  'can',
  'pack',
  'packet',
  'bottle',
  'tray',
  'tbsp',
  'tsp',
];

export default function DashboardScreen({ route }) {
  const navigation = useNavigation();
  const profile = route?.params?.profile ?? {};
  const [restaurantId, setRestaurantId] = useState(
    profile?.restaurant_id || profile?.restaurants?.id || null
  );

  useEffect(() => {
    async function resolveRestId() {
      if (!restaurantId) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user?.id) {
            const { data: p } = await supabase.from('profiles').select('restaurant_id, email').eq('id', user.id).maybeSingle();
            if (p?.restaurant_id) {
              setRestaurantId(p.restaurant_id);
            } else if (p?.email) {
              const { data: r } = await supabase.from('restaurants').select('id, name').limit(10);
              const matched = (r || []).find(item => item.settings?.owner_email === p.email);
              if (matched) {
                setRestaurantId(matched.id);
                await supabase.from('profiles').update({ restaurant_id: matched.id }).eq('id', user.id);
              }
            }
          }
        } catch (e) {
          console.log('[DashboardScreen] Auto-resolve restaurant_id error:', e?.message);
        }
      }
    }
    resolveRestId();
  }, [restaurantId]);

  const [restaurantName, setRestaurantName] = useState('SmartDine');
  const [todayOrders, setTodayOrders] = useState([]);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [outOfStockMenuItems, setOutOfStockMenuItems] = useState([]);
  const [liveTableStats, setLiveTableStats] = useState({
    total: 0,
    available: 0,
    occupied: 0,
    inactive: 0,
    occupancyRate: 0
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);

  // Modals for Alerts & Cancellations
  const [showAlertsModal, setShowAlertsModal] = useState(false);
  const [showCancellationsModal, setShowCancellationsModal] = useState(false);

  // Quick Stock Add Modal
  const [showQuickStockModal, setShowQuickStockModal] = useState(false);
  const [showQuickUnitPicker, setShowQuickUnitPicker] = useState(false);
  const [quickStockItem, setQuickStockItem] = useState(null);
  const [quickStockQty, setQuickStockQty] = useState('');
  const [quickStockUnit, setQuickStockUnit] = useState('kg');
  const [quickStockUnitCost, setQuickStockUnitCost] = useState('');
  const [quickStockSupplier, setQuickStockSupplier] = useState('');
  const [quickStockInvoice, setQuickStockInvoice] = useState('');
  const [savingQuickStock, setSavingQuickStock] = useState(false);

  // Why Unavailable Modal
  const [showWhyUnavailableModal, setShowWhyUnavailableModal] = useState(false);
  const [selectedUnavailableDish, setSelectedUnavailableDish] = useState(null);
  const [dishRecipeIngredients, setDishRecipeIngredients] = useState([]);
  const [loadingRecipe, setLoadingRecipe] = useState(false);

  const openQuickStockModal = (item) => {
    setQuickStockItem(item);
    setQuickStockQty('');
    setQuickStockUnit(item.unit || 'kg');
    setQuickStockUnitCost(item.cost_per_unit ? String(item.cost_per_unit) : '');
    setQuickStockSupplier('');
    setQuickStockInvoice('');
    setShowQuickStockModal(true);
  };

  const handleSaveQuickStock = async () => {
    if (!quickStockItem || !quickStockQty || Number(quickStockQty) <= 0) {
      Alert.alert('Validation', 'Please enter a valid stock quantity.');
      return;
    }
    setSavingQuickStock(true);
    try {
      const inputQty = Number(quickStockQty);
      const selectedUnit = quickStockUnit || quickStockItem.unit || 'kg';
      const baseUnit = quickStockItem.unit || selectedUnit;

      // Convert added quantity to item's base unit
      const convertedAddedQty = convertUnitToItemBase(inputQty, selectedUnit, baseUnit);
      const newStock = Number(quickStockItem.current_stock || 0) + convertedAddedQty;
      const unitCost = quickStockUnitCost && Number(quickStockUnitCost) > 0 ? Number(quickStockUnitCost) : Number(quickStockItem.cost_per_unit || 0);

      // 1. Update inventory_items table
      const updatePayload = {
        current_stock: newStock,
        updated_at: new Date().toISOString(),
      };
      if (unitCost > 0) {
        updatePayload.cost_per_unit = unitCost;
      }
      const { error: itemErr } = await supabase
        .from('inventory_items')
        .update(updatePayload)
        .eq('id', quickStockItem.id);

      if (itemErr) throw itemErr;

      // 2. Insert transaction ledger record with exact database schema
      const beforeStock = Number(quickStockItem.current_stock || 0);
      const noteDetails = [
        `Quick Restock: +${inputQty} ${selectedUnit}`,
        selectedUnit !== baseUnit ? `(${convertedAddedQty} ${baseUnit})` : '',
        quickStockSupplier.trim() ? `Supplier: ${quickStockSupplier.trim()}` : '',
        quickStockInvoice.trim() ? `Inv: ${quickStockInvoice.trim()}` : '',
      ].filter(Boolean).join(' | ');

      const { error: txErr } = await supabase.from('inventory_transactions').insert([{
        restaurant_id: restaurantId,
        inventory_item_id: quickStockItem.id,
        quantity: convertedAddedQty,
        unit: baseUnit,
        before_stock: beforeStock,
        after_stock: newStock,
        transaction_type: 'PURCHASE',
        reference_type: 'purchase',
        user_name: profile?.full_name || 'Owner',
        notes: noteDetails,
        created_at: new Date().toISOString(),
      }]);

      if (txErr) {
        console.log('Ledger insert error:', txErr);
      }

      const addedDisplay = selectedUnit === baseUnit ? `${inputQty} ${baseUnit}` : `${inputQty} ${selectedUnit} (${convertedAddedQty} ${baseUnit})`;
      Alert.alert('Success', `Added ${addedDisplay} to ${quickStockItem.name}. New Stock: ${newStock} ${baseUnit}`);
      setShowQuickStockModal(false);
      const activeDish = selectedUnavailableDish;
      setQuickStockItem(null);
      await loadDashboardData();
      if (activeDish?.id) {
        await fetchRecipeIngredientsForDish(activeDish.id);
        setShowWhyUnavailableModal(true);
      }
    } catch (e) {
      console.log('Quick stock in error:', e?.message);
      Alert.alert('Error', e?.message || 'Failed to update stock');
    } finally {
      setSavingQuickStock(false);
    }
  };

function convertUnitToItemBase(reqQty, reqUnit, baseUnit) {
  const q = Number(reqQty) || 0;
  const ru = (reqUnit || '').toLowerCase().trim();
  const bu = (baseUnit || '').toLowerCase().trim();

  if (!ru || !bu || ru === bu) return q;

  // Weight conversions: g/gram/grams/gm/gms -> kg/kilogram/kgs
  if (['g', 'gram', 'grams', 'gm', 'gms'].includes(ru) && ['kg', 'kilogram', 'kilograms', 'kgs'].includes(bu)) {
    return q / 1000;
  }
  // Weight conversions: kg/kilogram -> g/gram
  if (['kg', 'kilogram', 'kilograms', 'kgs'].includes(ru) && ['g', 'gram', 'grams', 'gm', 'gms'].includes(bu)) {
    return q * 1000;
  }
  // Tbsp/Tsp approximations to kg
  if (ru === 'tbsp' && ['kg', 'kilogram', 'kilograms', 'kgs'].includes(bu)) {
    return (q * 15) / 1000;
  }
  if (ru === 'tsp' && ['kg', 'kilogram', 'kilograms', 'kgs'].includes(bu)) {
    return (q * 5) / 1000;
  }

  // Volume conversions: ml/millilitre/milliliter -> l/litre/liter/ltr
  if (['ml', 'millilitre', 'milliliter', 'mls'].includes(ru) && ['l', 'litre', 'liter', 'ltr', 'ltrs', 'litres'].includes(bu)) {
    return q / 1000;
  }
  // Volume conversions: l/litre -> ml
  if (['l', 'litre', 'liter', 'ltr', 'ltrs', 'litres'].includes(ru) && ['ml', 'millilitre', 'milliliter', 'mls'].includes(bu)) {
    return q * 1000;
  }

  return q;
}

  const fetchRecipeIngredientsForDish = async (dishId) => {
    setLoadingRecipe(true);
    try {
      // 1. Fetch recipe rows for this dish with recipe ingredients and items joined
      const { data: recipeData, error } = await supabase
        .from('inventory_recipes')
        .select('*, inventory_recipe_ingredients(*, inventory_items(*))')
        .eq('restaurant_id', restaurantId)
        .eq('menu_item_id', dishId);

      if (error) throw error;

      if (recipeData && recipeData.length > 0) {
        const ingredientsList = [];
        recipeData.forEach(r => {
          (r.inventory_recipe_ingredients || []).forEach(ing => {
            const currentStock = Number(ing.inventory_items?.current_stock ?? 0);
            const reqQty = Number(ing.quantity || 1);
            const reqUnit = ing.unit || ing.inventory_items?.unit || '';
            const itemUnit = ing.inventory_items?.unit || ing.unit || '';
            const convertedReq = convertUnitToItemBase(reqQty, reqUnit, itemUnit);

            const isMissing = currentStock <= 0;
            const isLow = currentStock < convertedReq;

            // Only include ingredients that are actually missing or low on stock
            if (isMissing || isLow) {
              ingredientsList.push({
                id: ing.id,
                recipe_id: ing.recipe_id,
                inventory_item_id: ing.inventory_item_id,
                quantity_needed: reqQty,
                unit: reqUnit,
                itemUnit: itemUnit,
                inventory_items: ing.inventory_items,
                ingredient_name: ing.inventory_items?.name || 'Ingredient',
                isMissing,
                isLow,
              });
            }
          });
        });
        // Sort missing first, then low stock
        ingredientsList.sort((a, b) => (b.isMissing ? 1 : 0) - (a.isMissing ? 1 : 0));
        setDishRecipeIngredients(ingredientsList);
      } else {
        setDishRecipeIngredients([]);
      }
    } catch (e) {
      console.log('Recipe lookup error:', e?.message);
      setDishRecipeIngredients([]);
    } finally {
      setLoadingRecipe(false);
    }
  };

  const openWhyUnavailableModal = async (dish) => {
    setSelectedUnavailableDish(dish);
    setShowWhyUnavailableModal(true);
    await fetchRecipeIngredientsForDish(dish.id);
  };

  const loadDashboardData = useCallback(async () => {
    if (!restaurantId) { setLoading(false); setRefreshing(false); return; }
    try {
      // 1. Fetch Restaurant Info & Live Subscription Plan
      const { data: restData, error: restErr } = await supabase
        .from('restaurants')
        .select('name, subscription_plan, subscription_status')
        .eq('id', restaurantId)
        .maybeSingle();

      if (restErr) {
        setIsOffline(true);
      } else if (restData) {
        setIsOffline(false);
        setRestaurantName(restData.name);
        // Synchronize live subscription plan from DB
        if (profile) {
          profile.subscription_plan = restData.subscription_plan || 'starter';
          profile.subscription_status = restData.subscription_status || 'active';
        }
      }

      // 2. Fetch Orders
      const { data: ordersData, error: ordersErr } = await supabase
        .from('orders')
        .select('*, order_items(*)')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (ordersErr) {
        setIsOffline(true);
      } else {
        setIsOffline(false);
      }

      const allOrders = ordersData || [];
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();

      const todayFiltered = allOrders.filter(o => {
        const t = new Date(o.created_at).getTime();
        return t >= startOfDay && t <= endOfDay;
      });
      setTodayOrders(todayFiltered);

      // 3. Fetch Stock Alerts
      const { data: invData } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true);

      if (invData) {
        const low = invData.filter(i => Number(i.current_stock) <= Number(i.minimum_stock));
        setLowStockItems(low);
      }

      // 4. Fetch Out-of-Stock Menu Items (86 status)
      const { data: menuData } = await supabase
        .from('menu_items')
        .select('*, categories(name)')
        .eq('restaurant_id', restaurantId)
        .eq('is_available', false);

      if (menuData) {
        setOutOfStockMenuItems(menuData);
      }

      // 5. Fetch Live Table Occupancy Stats
      const { stats } = await fetchLiveTableStatus(restaurantId);
      if (stats) {
        setLiveTableStats(stats);
      }

    } catch (e) {
      console.log('Dashboard load error:', e?.message);
      setIsOffline(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Real-time subscription to orders, tables, and restaurant settings
  useEffect(() => {
    if (!restaurantId) return;

    const sub = supabase
      .channel(`mobile_dash_${restaurantId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${restaurantId}` },
        () => loadDashboardData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        () => loadDashboardData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'menu_items', filter: `restaurant_id=eq.${restaurantId}` },
        () => loadDashboardData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'inventory_items', filter: `restaurant_id=eq.${restaurantId}` },
        () => loadDashboardData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tables', filter: `restaurant_id=eq.${restaurantId}` },
        () => loadDashboardData()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'restaurants', filter: `id=eq.${restaurantId}` },
        () => loadDashboardData()
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setIsOffline(false);
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setIsOffline(true);
        }
      });

    return () => {
      stopAllAlarms();
      supabase.removeChannel(sub);
    };
  }, [restaurantId, loadDashboardData]);

  // Calculated Metrics (Synced 100% with Web dashboard)
  const validTodayOrders = todayOrders.filter(o => o.status !== 'cancelled');
  const settledOrders = validTodayOrders.filter(o => o.status === 'completed' || (o.status === 'served' && o.payment_status === 'paid') || (o.order_type !== 'dine_in' && o.payment_status === 'paid'));
  const totalRevenue = settledOrders.reduce((s, o) => s + (Number(o.total) || Number(o.subtotal) || 0), 0);

  const cancelledOrdersToday = todayOrders.filter(o => o.status === 'cancelled');
  const unpaidCancelledOrdersToday = cancelledOrdersToday.filter(o => o.payment_status !== 'paid');
  const cancelledLostValue = unpaidCancelledOrdersToday.reduce((s, o) => s + (Number(o.total) || Number(o.subtotal) || 0), 0);

  const totalOrdersCount = validTodayOrders.length;
  const completedOrdersCount = settledOrders.length;
  const activeTablesCount = new Set(
    todayOrders.filter(o => !['completed', 'cancelled'].includes(o.status) && o.table_name).map(o => o.table_name)
  ).size;

  const recentOrdersSorted = [...todayOrders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

  const getGreeting = () => {
    const hr = new Date().getHours();
    if (hr < 12) return 'Good Morning';
    if (hr < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadDashboardData(); }} colors={[COLORS.primary]} />
        }
      >
        {/* Offline Connectivity Banner */}
        {isOffline && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={16} color="#ffffff" style={{ marginRight: 8 }} />
            <Text style={styles.offlineBannerText}>Offline Mode • Displaying cached dashboard data</Text>
          </View>
        )}

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>{getGreeting()},</Text>
            <Text style={styles.restaurantName}>{restaurantName}</Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={styles.roleBadge}>
              <Text style={styles.roleText}>{profile?.role?.toUpperCase() || 'OWNER'}</Text>
            </View>

            <TouchableOpacity
              style={styles.logoutBtn}
              onPress={async () => {
                stopAllAlarms();
                if (profile?.id) await unregisterPushToken(profile.id);
                await supabase.auth.signOut().catch(() => {});
                navigation.replace('Login');
              }}
            >
              <Ionicons name="log-out-outline" size={18} color="#ef4444" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Live Table Occupancy Section (Web Match) */}
        <TouchableOpacity
          style={styles.tableOccupancyCard}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('TableAssignment', { profile })}
        >
          <View style={styles.tableOccHeader}>
            <Text style={styles.tableOccTitle}>Live Table Occupancy</Text>
            <View style={styles.tableOccRateBadge}>
              <Text style={styles.tableOccRateText}>{liveTableStats.occupancyRate}% Occupied</Text>
            </View>
          </View>

          <View style={styles.tableOccGrid}>
            <View style={styles.occPillTotal}>
              <Text style={styles.occPillValTotal}>{liveTableStats.total}</Text>
              <Text style={styles.occPillLblTotal}>Total Tables</Text>
            </View>
            <View style={styles.occPillGreen}>
              <Text style={styles.occPillValGreen}>{liveTableStats.available}</Text>
              <Text style={styles.occPillLblGreen}>Available</Text>
            </View>
            <View style={styles.occPillRed}>
              <Text style={styles.occPillValRed}>{liveTableStats.occupied}</Text>
              <Text style={styles.occPillLblRed}>Occupied</Text>
            </View>
            <View style={styles.occPillGray}>
              <Text style={styles.occPillValGray}>{liveTableStats.inactive}</Text>
              <Text style={styles.occPillLblGray}>Inactive</Text>
            </View>
          </View>
        </TouchableOpacity>

        {/* 2x2 Metrics Grid */}
        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Today's Revenue</Text>
            <Text style={styles.metricValue}>{formatCurrency(totalRevenue)}</Text>
            <Text style={styles.metricSub}>{todayOrders.filter(o => o.status !== 'cancelled').length} valid orders</Text>
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Active Tables</Text>
            <Text style={styles.metricValue}>{activeTablesCount}</Text>
            <Text style={styles.metricSub}>{liveTableStats.occupied} dining now</Text>
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Total Orders</Text>
            <Text style={styles.metricValue}>{totalOrdersCount}</Text>
            <Text style={styles.metricSub}>{completedOrdersCount} completed</Text>
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricLabel}>Avg Order Value</Text>
            <Text style={styles.metricValue}>
              {completedOrdersCount > 0 ? formatCurrency(totalRevenue / completedOrdersCount) : '₹0'}
            </Text>
            <Text style={styles.metricSub}>Per closed ticket</Text>
          </View>
        </View>

        {/* Operations Hub 2x2 Responsive Grid */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Operations Hub</Text>
        </View>

        <View style={styles.opsGrid}>
          <TouchableOpacity style={styles.opsTile} activeOpacity={0.7} onPress={() => navigation.navigate('MenuManagement', { profile })}>
            <Text style={styles.opsTileTitle}>Smart Menu</Text>
            <Text style={styles.opsTileSub}>AI OCR & Dishes</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.opsTile} activeOpacity={0.7} onPress={() => navigation.navigate('InventoryMobile', { profile })}>
            <Text style={styles.opsTileTitle}>Inventory</Text>
            <Text style={styles.opsTileSub}>Stock & Recipes</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.opsTile} activeOpacity={0.7} onPress={() => navigation.navigate('StaffManagement', { profile })}>
            <Text style={styles.opsTileTitle}>Staff</Text>
            <Text style={styles.opsTileSub}>Roles & Shifts</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.opsTile} activeOpacity={0.7} onPress={() => navigation.navigate('TableAssignment', { profile })}>
            <Text style={styles.opsTileTitle}>Tables</Text>
            <Text style={styles.opsTileSub}>Assignment</Text>
          </TouchableOpacity>
        </View>

        {/* Dedicated Support & Help Card */}
        <View style={{ backgroundColor: '#ffffff', borderRadius: 16, padding: 16, marginTop: 16, borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, elevation: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#eff6ff', alignItems: 'center', justify: 'center', marginRight: 10 }}>
              <Ionicons name="call-outline" size={18} color="#2563eb" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a' }}>CleverOps Dedicated Support</Text>
              <Text style={{ fontSize: 11, color: '#64748b', fontWeight: '500' }}>Deepak Kumar Soni · 24x7 Onboarding & Technical Help</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1, borderTopColor: '#f1f5f9' }}>
            <Text style={{ fontSize: 13, fontWeight: '800', color: '#059669' }}>+91 89492 66064</Text>
            <Text style={{ fontSize: 11, fontWeight: '600', color: '#64748b' }}>dsoni1281@gmail.com</Text>
          </View>
        </View>

        {/* Priority 2: Real-time Stock & Menu Alerts (Clean Professional List) */}
        {(lowStockItems.length > 0 || outOfStockMenuItems.length > 0) && (
          <View style={styles.alertCardContainer}>
            <View style={styles.alertCardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="warning-outline" size={18} color="#f59e0b" style={{ marginRight: 6 }} />
                <Text style={styles.alertCardTitle}>Stock & Menu Alerts</Text>
              </View>
              <TouchableOpacity style={styles.viewAllBtn} onPress={() => setShowAlertsModal(true)}>
                <Text style={styles.viewAllBtnText}>View All ({lowStockItems.length + outOfStockMenuItems.length})</Text>
              </TouchableOpacity>
            </View>

            {outOfStockMenuItems.length > 0 && (
              <View style={styles.alertSectionBlock}>
                <View style={styles.alertHeaderRow}>
                  <Text style={styles.alertSectionHeading}>86 OUT OF STOCK ({outOfStockMenuItems.length})</Text>
                  <TouchableOpacity onPress={() => setShowAlertsModal(true)}>
                    <Text style={styles.viewAllMiniText}>View All</Text>
                  </TouchableOpacity>
                </View>
                {outOfStockMenuItems.slice(0, 3).map(dish => (
                  <TouchableOpacity
                    key={dish.id}
                    style={styles.alertListItemRow}
                    onPress={() => openWhyUnavailableModal(dish)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={styles.alertItemName} numberOfLines={1}>{dish.name}</Text>
                      <Text style={styles.alertItemSubText}>{dish.categories?.name || 'Unavailable dish'}</Text>
                    </View>
                    <View style={styles.alertItemBadgeAmber}>
                      <Text style={styles.alertItemBadgeAmberText}>Why Unavailable?</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {lowStockItems.length > 0 && (
              <View style={[styles.alertSectionBlock, { marginTop: 10 }]}>
                <View style={styles.alertHeaderRow}>
                  <Text style={styles.alertSectionHeading}>LOW STOCK INGREDIENTS ({lowStockItems.length})</Text>
                  <TouchableOpacity onPress={() => setShowAlertsModal(true)}>
                    <Text style={styles.viewAllMiniText}>View All</Text>
                  </TouchableOpacity>
                </View>
                {lowStockItems.slice(0, 3).map(item => (
                  <View key={item.id} style={styles.alertListItemRow}>
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={styles.alertItemName} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.alertItemSubText}>
                        {item.current_stock} / min {item.minimum_stock} {item.unit}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.quickAddBtn}
                      onPress={() => openQuickStockModal(item)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.quickAddBtnText}>+ Add</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Priority 1 & 2: Cancellation & Waste */}
        {cancelledOrdersToday.length > 0 && (
          <View style={styles.cancellationCard}>
            <View style={styles.cancellationHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="alert-circle-outline" size={18} color="#ef4444" style={{ marginRight: 6 }} />
                <Text style={styles.cancellationTitle}>Today Cancellations & Waste</Text>
              </View>
              <TouchableOpacity style={styles.viewDetailsBtn} onPress={() => setShowCancellationsModal(true)}>
                <Text style={styles.viewDetailsBtnText}>View Details</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.cancellationRow}>
              <View>
                <Text style={styles.cancellationCount}>{cancelledOrdersToday.length} cancelled order(s)</Text>
                <Text style={styles.unpaidSubtitle}>{unpaidCancelledOrdersToday.length} unpaid • {cancelledOrdersToday.length - unpaidCancelledOrdersToday.length} paid/settled</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.cancellationLost}>- {formatCurrency(cancelledLostValue)}</Text>
                <Text style={styles.lossLabel}>Unpaid Loss</Text>
              </View>
            </View>
          </View>
        )}

        {/* Recent Orders Section */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Orders</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={COLORS.primary} size="large" style={{ marginVertical: 20 }} />
        ) : recentOrdersSorted.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="receipt-outline" size={32} color="#cbd5e1" style={{ marginBottom: 6 }} />
            <Text style={styles.emptyText}>No orders received today yet</Text>
          </View>
        ) : (
          recentOrdersSorted.map(order => {
            const statusColor = getStatusColor(order.status);
            const items = order.order_items || [];
            const summary = items.map(i => `${i.menu_item_name || i.name || i.item_name || i.menu_items?.name || 'Item'} x${i.quantity || 1}`).join(', ');

            return (
              <View key={order.id} style={styles.recentCard}>
                <View style={styles.recentCardTop}>
                  <Text style={styles.recentTableName}>{order.table_name || `Order #${order.id.slice(0, 4)}`}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
                    <Text style={[styles.statusBadgeText, { color: statusColor }]}>
                      {getStatusLabel(order.status)}
                    </Text>
                  </View>
                </View>

                <Text style={styles.recentSummary} numberOfLines={1}>{summary || 'No items'}</Text>

                <View style={styles.recentCardBottom}>
                  <Text style={styles.recentTime}>{timeAgo(order.created_at)}</Text>
                  <Text style={styles.recentTotal}>{formatCurrency(order.total || 0)}</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {/* Priority 2 Modal: Stock & Menu Alerts View All */}
      <Modal
        visible={showAlertsModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAlertsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="warning" size={20} color="#ea580c" style={{ marginRight: 8 }} />
                <Text style={styles.modalHeaderTitle}>Stock & Menu Alerts</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAlertsModal(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 450 }} showsVerticalScrollIndicator={false}>
              {outOfStockMenuItems.length > 0 && (
                <View style={{ marginBottom: 16 }}>
                  <Text style={styles.modalSectionHeading}>
                    86 OUT OF STOCK DISHES ({outOfStockMenuItems.length})
                  </Text>
                  {outOfStockMenuItems.map(dish => (
                    <TouchableOpacity
                      key={dish.id}
                      style={styles.modalListItem}
                      onPress={() => {
                        setShowAlertsModal(false);
                        openWhyUnavailableModal(dish);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={styles.modalItemTitle}>{dish.name}</Text>
                        <Text style={styles.modalItemSubtitle}>{dish.categories?.name || 'Menu Item'}</Text>
                      </View>
                      <View style={styles.modalBadgeAmber}>
                        <Text style={styles.modalBadgeAmberText}>Why Unavailable?</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {lowStockItems.length > 0 && (
                <View style={{ marginBottom: 10 }}>
                  <Text style={styles.modalSectionHeading}>
                    LOW STOCK INGREDIENTS ({lowStockItems.length})
                  </Text>
                  {lowStockItems.map(item => (
                    <View key={item.id} style={styles.modalListItem}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={styles.modalItemTitle}>{item.name}</Text>
                        <Text style={styles.modalItemSubtitle}>Min Stock: {item.minimum_stock} {item.unit} • Current: {item.current_stock} {item.unit}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.quickAddBtn}
                        onPress={() => {
                          setShowAlertsModal(false);
                          openQuickStockModal(item);
                        }}
                      >
                        <Text style={styles.quickAddBtnText}>+ Add</Text>
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>

            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowAlertsModal(false)}>
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Quick Stock Add Modal */}
      <Modal
        visible={showQuickStockModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowQuickStockModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="cube" size={20} color={COLORS.primary} style={{ marginRight: 8 }} />
                <Text style={styles.modalHeaderTitle}>Quick Stock In</Text>
              </View>
              <TouchableOpacity onPress={() => setShowQuickStockModal(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            {quickStockItem && (
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 450 }}>
                <View style={styles.quickStockTargetCard}>
                  <Text style={styles.quickStockTargetName}>{quickStockItem.name}</Text>
                  <Text style={styles.quickStockTargetStock}>
                    Current: {quickStockItem.current_stock} {quickStockItem.unit} • Min: {quickStockItem.minimum_stock} {quickStockItem.unit}
                  </Text>
                </View>

                <Text style={styles.inputLabel}>ADD QUANTITY & UNIT *</Text>
                <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                  <TextInput
                    style={[styles.formInput, { flex: 1, marginBottom: 0 }]}
                    placeholder="e.g. 5"
                    placeholderTextColor="#94a3b8"
                    keyboardType="numeric"
                    value={quickStockQty}
                    onChangeText={setQuickStockQty}
                  />
                  <TouchableOpacity
                    style={styles.quickUnitPickerBtn}
                    onPress={() => setShowQuickUnitPicker(true)}
                  >
                    <Text style={styles.quickUnitPickerBtnText}>{quickStockUnit || 'unit'}</Text>
                    <Ionicons name="chevron-down" size={16} color="#4f46e5" />
                  </TouchableOpacity>
                </View>

                <Text style={styles.inputLabel}>UNIT COST / PURCHASE PRICE (₹)</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder={`Current: ₹${quickStockItem.cost_per_unit || 0}`}
                  placeholderTextColor="#94a3b8"
                  keyboardType="numeric"
                  value={quickStockUnitCost}
                  onChangeText={setQuickStockUnitCost}
                />

                <Text style={styles.inputLabel}>SUPPLIER NAME (OPTIONAL)</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. Metro / Local Vendor"
                  placeholderTextColor="#94a3b8"
                  value={quickStockSupplier}
                  onChangeText={setQuickStockSupplier}
                />

                <Text style={styles.inputLabel}>INVOICE # (OPTIONAL)</Text>
                <TextInput
                  style={styles.formInput}
                  placeholder="e.g. INV-1049"
                  placeholderTextColor="#94a3b8"
                  value={quickStockInvoice}
                  onChangeText={setQuickStockInvoice}
                />

                <TouchableOpacity
                  style={[styles.saveStockBtn, savingQuickStock && { opacity: 0.6 }]}
                  disabled={savingQuickStock}
                  onPress={handleSaveQuickStock}
                >
                  {savingQuickStock ? (
                    <ActivityIndicator color="#ffffff" size="small" />
                  ) : (
                    <Text style={styles.saveStockBtnText}>Save & Update Stock</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Unit Selector Modal for Quick Stock */}
      <Modal
        visible={showQuickUnitPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowQuickUnitPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowQuickUnitPicker(false)}
        >
          <View style={[styles.modalSheet, { maxHeight: 420 }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalHeaderTitle}>Select Unit of Measure</Text>
              <TouchableOpacity onPress={() => setShowQuickUnitPicker(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{ marginTop: 10 }}>
              {(() => {
                const base = (quickStockItem?.unit || 'kg').toLowerCase().trim();
                let availableUnits = ['kg', 'g'];
                if (['l', 'litre', 'liter', 'ltr', 'ml'].includes(base)) {
                  availableUnits = ['L', 'ml'];
                } else if (['kg', 'kilogram', 'kgs', 'g', 'gram'].includes(base)) {
                  availableUnits = ['kg', 'g'];
                } else {
                  availableUnits = Array.from(new Set([quickStockItem?.unit || 'pcs', 'pcs', 'box', 'pack']));
                }
                return availableUnits.map(u => {
                  const isSelected = quickStockUnit?.toLowerCase() === u.toLowerCase();
                  return (
                    <TouchableOpacity
                      key={u}
                      style={[styles.unitOptionRow, isSelected && styles.unitOptionRowSelected]}
                      onPress={() => {
                        setQuickStockUnit(u);
                        setShowQuickUnitPicker(false);
                      }}
                    >
                      <Text style={[styles.unitOptionText, isSelected && styles.unitOptionTextSelected]}>
                        {u}
                      </Text>
                      {isSelected && (
                        <Ionicons name="checkmark-circle" size={18} color="#4f46e5" />
                      )}
                    </TouchableOpacity>
                  );
                });
              })()}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Why Unavailable Modal */}
      <Modal
        visible={showWhyUnavailableModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowWhyUnavailableModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="information-circle" size={20} color="#f59e0b" style={{ marginRight: 8 }} />
                <Text style={styles.modalHeaderTitle}>Why Unavailable?</Text>
              </View>
              <TouchableOpacity onPress={() => { setShowWhyUnavailableModal(false); setSelectedUnavailableDish(null); }}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            {selectedUnavailableDish && (
              <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 450 }}>
                <View style={styles.whyDishCard}>
                  <Text style={styles.whyDishName}>{selectedUnavailableDish.name}</Text>
                  <Text style={styles.whyDishCategory}>{selectedUnavailableDish.categories?.name || 'Menu Dish'} • Status: 86 Unavailable</Text>
                </View>

                <Text style={styles.modalSectionHeading}>
                  RECIPE INGREDIENTS STATUS
                </Text>

                {loadingRecipe ? (
                  <ActivityIndicator color={COLORS.primary} size="small" style={{ marginVertical: 20 }} />
                ) : dishRecipeIngredients.length === 0 ? (
                  <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                    <Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center' }}>
                      No recipe ingredients mapped or dish was manually toggled off.
                    </Text>
                  </View>
                ) : (
                  dishRecipeIngredients.map((rec, idx) => {
                    const inv = rec.inventory_items;
                    const name = inv?.name || rec.ingredient_name || 'Ingredient';
                    const currentStock = inv?.current_stock ?? 0;
                    const currentUnit = rec.itemUnit || inv?.unit || '';
                    const reqStock = rec.quantity_needed;
                    const reqUnit = rec.unit || currentUnit;

                    return (
                      <View key={rec.id || idx} style={styles.recipeIngRow}>
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text style={styles.recipeIngName}>{name}</Text>
                          <Text style={styles.recipeIngStock}>
                            Current: <Text style={{ color: '#dc2626', fontWeight: '700' }}>{currentStock} {currentUnit}</Text> • Needed: {reqStock} {reqUnit}
                          </Text>
                        </View>
                        {inv && (
                          <TouchableOpacity
                            style={styles.restockBtn}
                            onPress={() => {
                              setShowWhyUnavailableModal(false);
                              setTimeout(() => {
                                openQuickStockModal(inv);
                              }, 300);
                            }}
                          >
                            <Text style={styles.restockBtnText}>+ Restock</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })
                )}
              </ScrollView>
            )}

            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => { setShowWhyUnavailableModal(false); setSelectedUnavailableDish(null); }}>
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Priority 2 Modal: Today Cancellations & Waste View Details */}
      <Modal
        visible={showCancellationsModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCancellationsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="alert-circle" size={20} color="#ef4444" style={{ marginRight: 8 }} />
                <Text style={styles.modalHeaderTitle}>Today's Cancelled Orders</Text>
              </View>
              <TouchableOpacity onPress={() => setShowCancellationsModal(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <View style={styles.summaryBar}>
              <View>
                <Text style={styles.summaryBarLabel}>Unpaid Loss (True Impact)</Text>
                <Text style={styles.summaryBarValue}>- {formatCurrency(cancelledLostValue)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.summaryBarLabel}>Total Cancelled</Text>
                <Text style={styles.summaryBarCount}>{cancelledOrdersToday.length} orders</Text>
              </View>
            </View>

            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              {cancelledOrdersToday.map((order, idx) => {
                const isPaid = order.payment_status === 'paid';
                const reason = order.cancellation_reason || order.cancel_reason || 'Staff Cancelled';

                return (
                  <View key={order.id || idx} style={styles.cancelOrderItem}>
                    <View style={styles.cancelOrderTop}>
                      <Text style={styles.cancelOrderTable}>{order.table_name || `Order #${(order.id || '').slice(0, 4)}`}</Text>
                      <View style={[styles.cancelPayBadge, isPaid ? styles.cancelPayBadgePaid : styles.cancelPayBadgeUnpaid]}>
                        <Text style={[styles.cancelPayBadgeText, isPaid ? styles.cancelPayBadgeTextPaid : styles.cancelPayBadgeTextUnpaid]}>
                          {isPaid ? 'PAID (Covered)' : 'UNPAID (Loss)'}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.cancelOrderReason}>Reason: "{reason}"</Text>

                    <View style={styles.cancelOrderBottom}>
                      <Text style={styles.cancelOrderTime}>{timeAgo(order.cancelled_at || order.created_at)}</Text>
                      <Text style={styles.cancelOrderTotal}>{formatCurrency(order.total || 0)}</Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>

            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowCancellationsModal(false)}>
              <Text style={styles.modalCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  greeting: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  restaurantName: { fontSize: 22, fontWeight: '700', color: '#0f172a' },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justify: 'center',
  },
  avatarText: { color: '#ffffff', fontWeight: '700', fontSize: 18 },
  offlineBanner: {
    backgroundColor: '#3b82f6',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justify: 'center',
    marginBottom: 16,
  },
  offlineBannerText: { color: '#ffffff', fontWeight: '600', fontSize: 12 },
  dateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 16,
    selfAlign: 'flex-start',
  },
  dateBannerText: { color: COLORS.primary, fontWeight: '700', fontSize: 13 },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  metricCard: {
    width: '48.5%',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    elevation: 1.5,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    minHeight: 82,
    justifyContent: 'space-between',
  },
  metricHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  metricIconBg: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  metricValue: { fontSize: 18, fontWeight: '800', color: '#0f172a', marginVertical: 1 },
  metricLabel: { fontSize: 11.5, color: '#64748b', fontWeight: '700' },
  metricSub: { fontSize: 10.5, color: '#94a3b8', fontWeight: '600' },
  sectionHeader: { marginTop: 4, marginBottom: 8 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  emptyCard: { backgroundColor: '#ffffff', borderRadius: 14, padding: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#f1f5f9' },
  emptyText: { fontSize: 13, color: '#94a3b8', fontWeight: '600' },
  recentCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    elevation: 1,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  recentCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  recentTableName: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  recentSummary: { fontSize: 13, color: '#475569', marginBottom: 8 },
  recentCardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  recentTime: { fontSize: 12, color: '#94a3b8' },
  recentTotal: { fontSize: 14, fontWeight: '700', color: COLORS.primary },
  topItemsCard: { backgroundColor: '#ffffff', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#f1f5f9', marginBottom: 20 },
  topItemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  rankBadge: { width: 26, height: 26, borderRadius: 6, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  rankBadgeText: { fontSize: 11, fontWeight: '700', color: COLORS.primary },
  topItemName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1e293b' },
  topItemQty: { fontSize: 13, color: '#64748b', marginRight: 12 },
  topItemRev: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  alertCardContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderLeftWidth: 4,
    borderLeftColor: '#f59e0b',
    elevation: 1.5,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
  },
  alertCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  alertCardTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0f172a',
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 3,
    flexWrap: 'wrap',
  },
  alertBadgeRed: {
    fontSize: 10,
    fontWeight: '800',
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 6,
  },
  alertBadgeAmber: {
    fontSize: 10,
    fontWeight: '800',
    backgroundColor: '#fef3c7',
    color: '#d97706',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginRight: 6,
  },
  alertText: {
    fontSize: 12,
    color: '#475569',
    flex: 1,
  },
  alertItemSubText: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 1,
    fontWeight: '600',
  },
  quickAddBtn: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  quickAddBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#059669',
  },
  quickStockTargetCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  quickStockTargetName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  quickStockTargetStock: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 3,
    fontWeight: '600',
  },
  inputLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 6,
    marginTop: 10,
  },
  formInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
  },
  saveStockBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 10,
  },
  saveStockBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  whyDishCard: {
    backgroundColor: '#fffbeb',
    borderRadius: 10,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#fed7aa',
  },
  whyDishName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#9a3412',
  },
  whyDishCategory: {
    fontSize: 12,
    color: '#b45309',
    marginTop: 2,
    fontWeight: '600',
  },
  recipeIngRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  recipeIngName: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0f172a',
  },
  recipeIngStock: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 2,
  },
  restockBtn: {
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  restockBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#2563eb',
  },
  cancellationCard: {
    backgroundColor: '#fef2f2',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  cancellationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  cancellationTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#991b1b',
  },
  cancellationRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cancellationCount: {
    fontSize: 13,
    fontWeight: '600',
    color: '#b91c1c',
  },
  cancellationLost: {
    fontSize: 14,
    fontWeight: '700',
    color: '#dc2626',
  },
  opsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  opsTile: {
    width: '48.5%',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    elevation: 1.5,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
    minHeight: 88,
    justifyContent: 'space-between',
  },
  opsTileIconBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  opsTileTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0f172a',
  },
  opsTileSub: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  tableOccupancyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    elevation: 1.5,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4,
  },
  tableOccHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  tableOccTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0f172a',
  },
  tableOccRateBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    backgroundColor: '#eef2ff',
    borderRadius: 6,
  },
  tableOccRateText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4f46e5',
  },
  tableOccGrid: {
    flexDirection: 'row',
    gap: 6,
  },
  occPillTotal: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  occPillValTotal: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
  },
  occPillLblTotal: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#64748b',
    marginTop: 1,
  },
  occPillGreen: {
    flex: 1,
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#dcfce7',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  occPillValGreen: {
    fontSize: 15,
    fontWeight: '800',
    color: '#16a34a',
  },
  occPillLblGreen: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#15803d',
    marginTop: 1,
  },
  occPillRed: {
    flex: 1,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fee2e2',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  occPillValRed: {
    fontSize: 15,
    fontWeight: '800',
    color: '#dc2626',
  },
  occPillLblRed: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#b91c1c',
    marginTop: 1,
  },
  occPillGray: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#f1f5f9',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  occPillValGray: {
    fontSize: 15,
    fontWeight: '800',
    color: '#64748b',
  },
  occPillLblGray: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#475569',
    marginTop: 1,
  },
  viewAllBtn: {
    backgroundColor: '#ffedd5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  viewAllBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#c2410c',
  },
  alertSectionBlock: {
    marginTop: 4,
  },
  alertHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  alertSectionHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.5,
  },
  viewAllMiniText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0284c7',
  },
  alertListItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 5,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  alertItemName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
    flex: 1,
    marginRight: 8,
  },
  alertItemBadgeAmber: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  alertItemBadgeAmberText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#b45309',
  },
  alertItemBadgeRed: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  alertItemBadgeRedText: {
    fontSize: 10.5,
    fontWeight: '700',
    color: '#dc2626',
  },
  viewDetailsBtn: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  viewDetailsBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#b91c1c',
  },
  unpaidSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  lossLabel: {
    fontSize: 10,
    color: '#ef4444',
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    maxHeight: '80%',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 10,
  },
  modalHeaderTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0f172a',
  },
  modalSectionHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  modalListItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  modalItemTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  modalItemSubtitle: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  modalBadgeAmber: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  modalBadgeAmberText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#b45309',
  },
  modalBadgeRed: {
    backgroundColor: '#fee2e2',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  modalBadgeRedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#dc2626',
  },
  modalCloseBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 14,
  },
  modalCloseBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  summaryBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#fee2e2',
  },
  summaryBarLabel: {
    fontSize: 11,
    color: '#991b1b',
    fontWeight: '600',
  },
  summaryBarValue: {
    fontSize: 16,
    fontWeight: '800',
    color: '#dc2626',
    marginTop: 2,
  },
  summaryBarCount: {
    fontSize: 14,
    fontWeight: '800',
    color: '#991b1b',
    marginTop: 2,
  },
  cancelOrderItem: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cancelOrderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  cancelOrderTable: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0f172a',
  },
  cancelPayBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  cancelPayBadgePaid: {
    backgroundColor: '#dcfce7',
  },
  cancelPayBadgeUnpaid: {
    backgroundColor: '#fee2e2',
  },
  cancelPayBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  cancelPayBadgeTextPaid: {
    color: '#15803d',
  },
  cancelPayBadgeTextUnpaid: {
    color: '#b91c1c',
  },
  cancelOrderReason: {
    fontSize: 12,
    color: '#475569',
    fontStyle: 'italic',
    marginBottom: 6,
  },
  cancelOrderBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingTop: 6,
  },
  cancelOrderTime: {
    fontSize: 11,
    color: '#94a3b8',
  },
  cancelOrderTotal: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0f172a',
  },
  quickUnitPickerBtn: {
    height: 44,
    paddingHorizontal: 12,
    backgroundColor: '#f5f3ff',
    borderWidth: 1,
    borderColor: '#c7d2fe',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  quickUnitPickerBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4f46e5',
  },
  unitOptionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 6,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  unitOptionRowSelected: {
    backgroundColor: '#eef2ff',
    borderColor: '#6366f1',
  },
  unitOptionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#334155',
  },
  unitOptionTextSelected: {
    color: '#4f46e5',
    fontWeight: '800',
  },
});
