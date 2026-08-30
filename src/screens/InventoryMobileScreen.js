import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, TextInput, ScrollView,
  Modal, Alert, Platform, Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { COLORS, FONTS, formatCurrency } from '../lib/theme';
import { generateDishRecipeAI } from '../lib/geminiRecipe';

const INVENTORY_CATEGORIES = [
  'Vegetables & Produce',
  'Dairy & Cheese',
  'Meat & Poultry',
  'Spices & Seasonings',
  'Grains & Oils',
  'Bakery & Breads',
  'Beverages & Syrups',
  'Packaging & Disposables',
  'General',
];

const INVENTORY_UNITS = [
  'kg',
  'g',
  'l',
  'ml',
  'pcs',
  'tbsp',
  'tsp',
  'box',
  'can',
  'pack',
  'bottle',
  'tray',
];

const API_BASE_URL = 'https://www.cleverops.in';

// Unit conversion helper to calculate ingredient cost accurately
function calculateIngredientCost(qty, unit, itemCostPerUnit, itemUnit) {
  const q = parseFloat(qty) || 0;
  const cost = parseFloat(itemCostPerUnit) || 0;
  if (q <= 0 || cost <= 0) return 0;

  const u = (unit || '').toLowerCase().trim();
  const iu = (itemUnit || '').toLowerCase().trim();

  if (u === iu) return q * cost;

  // Weight conversions
  if ((u === 'g' || u === 'gram') && (iu === 'kg' || iu === 'kilogram')) {
    return (q / 1000) * cost;
  }
  if ((u === 'kg' || u === 'kilogram') && (iu === 'g' || iu === 'gram')) {
    return q * 1000 * cost;
  }
  if (u === 'tbsp' && (iu === 'kg' || iu === 'kilogram')) {
    return (q * 15 / 1000) * cost; // ~15g per tbsp
  }
  if (u === 'tsp' && (iu === 'kg' || iu === 'kilogram')) {
    return (q * 5 / 1000) * cost; // ~5g per tsp
  }

  // Volume conversions
  if ((u === 'ml' || u === 'millilitre') && (iu === 'l' || iu === 'litre' || iu === 'liter')) {
    return (q / 1000) * cost;
  }
  if ((u === 'l' || u === 'litre' || u === 'liter') && (iu === 'ml' || iu === 'millilitre')) {
    return q * 1000 * cost;
  }
  if (u === 'tbsp' && (iu === 'l' || iu === 'litre')) {
    return (q * 15 / 1000) * cost; // ~15ml per tbsp
  }
  if (u === 'tsp' && (iu === 'l' || iu === 'litre')) {
    return (q * 5 / 1000) * cost; // ~5ml per tsp
  }

  return q * cost;
}

export default function InventoryMobileScreen({ route, navigation }) {
  const profile = route?.params?.profile || {};
  const [restaurantId, setRestaurantId] = useState(
    profile?.restaurant_id || profile?.restaurants?.id || null
  );

  const [activeTab, setActiveTab] = useState('stock'); // 'stock' | 'ledger' | 'recipes'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Item Modal (Add / Edit)
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [itemName, setItemName] = useState('');
  const [itemCategory, setItemCategory] = useState('');
  const [itemUnit, setItemUnit] = useState('kg');
  const [itemCurrentStock, setItemCurrentStock] = useState('0');
  const [itemMinStock, setItemMinStock] = useState('5');
  const [itemUnitCost, setItemUnitCost] = useState('0');
  const [itemPreviousCost, setItemPreviousCost] = useState('0');
  const [itemSupplier, setItemSupplier] = useState('');
  const [savingItem, setSavingItem] = useState(false);

  // 2. Purchase / Stock In Modal
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [selectedStockInItem, setSelectedStockInItem] = useState(null);
  const [purchaseQty, setPurchaseQty] = useState('');
  const [purchaseSupplier, setPurchaseSupplier] = useState('');
  const [purchaseInvoice, setPurchaseInvoice] = useState('');
  const [purchaseUnitCost, setPurchaseUnitCost] = useState('');
  const [purchaseNotes, setPurchaseNotes] = useState('');
  const [savingPurchase, setSavingPurchase] = useState(false);

  // 3. Waste Modal
  const [showWasteModal, setShowWasteModal] = useState(false);
  const [selectedWasteItem, setSelectedWasteItem] = useState(null);
  const [wasteQty, setWasteQty] = useState('');
  const [wasteReason, setWasteReason] = useState('Spoiled');
  const [wasteNotes, setWasteNotes] = useState('');
  const [savingWaste, setSavingWaste] = useState(false);

  // 4. Recipe Modal
  const [showRecipeModal, setShowRecipeModal] = useState(false);
  const [selectedMenuItemForRecipe, setSelectedMenuItemForRecipe] = useState(null);
  const [recipeServingSize, setRecipeServingSize] = useState('1 Portion');
  const [recipePreparationSteps, setRecipePreparationSteps] = useState('');
  const [recipeIngredientsList, setRecipeIngredientsList] = useState([]);
  const [savingRecipe, setSavingRecipe] = useState(false);

  // 5. Ingredient Picker Modal (Searchable Dropdown for Recipe)
  const [showIngredientPickerModal, setShowIngredientPickerModal] = useState(false);
  const [ingredientPickerTargetIndex, setIngredientPickerTargetIndex] = useState(null);
  const [ingredientPickerSearch, setIngredientPickerSearch] = useState('');

  // 6. Unit Picker Modal (for Recipe Ingredient Row)
  const [showUnitPickerModal, setShowUnitPickerModal] = useState(false);
  const [unitPickerTargetIndex, setUnitPickerTargetIndex] = useState(null);

  // 7. Smart Recipe AI Modal
  const [showAiRecipeModal, setShowAiRecipeModal] = useState(false);
  const [aiRecipeDishName, setAiRecipeDishName] = useState('');
  const [aiRecipeImageBase64, setAiRecipeImageBase64] = useState(null);
  const [aiRecipeImageUri, setAiRecipeImageUri] = useState(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiDraftRecipe, setAiDraftRecipe] = useState(null);

  const isOwnerOrManager = profile.role === 'owner' || profile.role === 'manager' || profile.role === 'super_admin';

  // Total Stock Value Calculations (Owner & Manager only)
  const totalStockValue = useMemo(() => {
    return inventoryItems.reduce((acc, item) => {
      const stock = Number(item.current_stock || 0);
      const cost = Number(item.cost_per_unit ?? item.unit_cost ?? 0);
      return acc + (stock > 0 && cost > 0 ? stock * cost : 0);
    }, 0);
  }, [inventoryItems]);

  const lowStockValue = useMemo(() => {
    return inventoryItems.reduce((acc, item) => {
      const stock = Number(item.current_stock || 0);
      const minStock = Number(item.minimum_stock ?? item.min_stock ?? 0);
      const cost = Number(item.cost_per_unit ?? item.unit_cost ?? 0);
      if (stock > 0 && stock <= minStock && cost > 0) {
        return acc + (stock * cost);
      }
      return acc;
    }, 0);
  }, [inventoryItems]);

  const outOfStockCount = useMemo(() => {
    return inventoryItems.filter(item => Number(item.current_stock || 0) <= 0).length;
  }, [inventoryItems]);

  // Fetch missing restaurant_id
  useEffect(() => {
    async function fetchMissingRestaurantId() {
      if (!restaurantId) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: p } = await supabase
              .from('profiles')
              .select('restaurant_id')
              .eq('id', user.id)
              .maybeSingle();
            if (p?.restaurant_id) setRestaurantId(p.restaurant_id);
          }
        } catch (e) {
          console.log('[InventoryMobile] fetch restaurant_id error:', e?.message);
        }
      }
    }
    fetchMissingRestaurantId();
  }, [restaurantId]);

  // Load Inventory Data from Production Schema
  const loadInventoryData = useCallback(async () => {
    if (!restaurantId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      // 1. Raw Inventory Items
      const { data: invData, error: invErr } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('name');
      if (invErr) console.log('inv error:', invErr);
      setInventoryItems(invData || []);

      // 2. Recent Transactions Ledger (with joined item details)
      const { data: txData, error: txErr } = await supabase
        .from('inventory_transactions')
        .select('*, inventory_items(id, name, unit, cost_per_unit)')
        .eq('restaurant_id', restaurantId)
        .order('created_at', { ascending: false })
        .limit(60);
      if (txErr) console.log('tx error:', txErr);
      setTransactions(txData || []);

      // 3. Inventory Recipes & Ingredients (Web parity production schema)
      const { data: recData, error: recErr } = await supabase
        .from('inventory_recipes')
        .select('*, menu_items(id, name, price, category_id), inventory_recipe_ingredients(*, inventory_items(id, name, unit, cost_per_unit))')
        .eq('restaurant_id', restaurantId);
      if (recErr) console.log('rec error:', recErr);
      setRecipes(recData || []);

      // 4. Menu Items
      const { data: mData, error: mErr } = await supabase
        .from('menu_items')
        .select('id, name, price, category_id, image_url')
        .eq('restaurant_id', restaurantId)
        .order('name');
      if (mErr) console.log('menu error:', mErr);
      setMenuItems(mData || []);

    } catch (e) {
      console.log('[InventoryMobileScreen] load error:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    loadInventoryData();
  }, [loadInventoryData]);

  // 1. ADD / EDIT ITEM HANDLER
  const handleOpenItemModal = (item = null) => {
    if (item) {
      setEditingItem(item);
      setItemName(item.name || '');
      setItemCategory(item.category || 'General');
      setItemUnit(item.unit || 'kg');
      setItemCurrentStock(String(item.current_stock ?? '0'));
      setItemMinStock(String(item.minimum_stock ?? item.min_stock ?? item.reorder_level ?? '5'));
      setItemUnitCost(String(item.cost_per_unit ?? item.unit_cost ?? '0'));
      const prev = item.cost_per_unit ?? item.unit_cost ?? '0';
      setItemPreviousCost(String(prev));
      setItemSupplier(item.supplier || '');
    } else {
      setEditingItem(null);
      setItemName('');
      setItemCategory('General');
      setItemUnit('kg');
      setItemCurrentStock('0');
      setItemMinStock('5');
      setItemUnitCost('0');
      setItemPreviousCost('0');
      setItemSupplier('');
    }
    setShowItemModal(true);
  };

  const handleSaveItem = async () => {
    if (!itemName.trim()) {
      Alert.alert('Validation Error', 'Please provide an ingredient / item name.');
      return;
    }

    setSavingItem(true);
    try {
      const currentStock = parseFloat(itemCurrentStock) || 0;
      const minStock = parseFloat(itemMinStock) || 0;
      const currentCost = parseFloat(itemUnitCost) || 0;

      // Exact valid database columns for inventory_items
      const payload = {
        name: itemName.trim(),
        category: itemCategory.trim() || 'General',
        unit: itemUnit.trim().toLowerCase(),
        current_stock: currentStock,
        minimum_stock: minStock,
        cost_per_unit: currentCost,
        supplier: itemSupplier.trim() || null,
        updated_at: new Date().toISOString()
      };

      if (editingItem?.id) {
        const beforeStock = Number(editingItem.current_stock || 0);
        const { error: updErr } = await supabase
          .from('inventory_items')
          .update(payload)
          .eq('id', editingItem.id)
          .eq('restaurant_id', restaurantId);
        if (updErr) throw updErr;

        // Log manual stock adjustment if stock changed
        if (beforeStock !== currentStock) {
          const diff = currentStock - beforeStock;
          await supabase.from('inventory_transactions').insert([{
            restaurant_id: restaurantId,
            inventory_item_id: editingItem.id,
            quantity: diff,
            unit: payload.unit,
            before_stock: beforeStock,
            after_stock: currentStock,
            transaction_type: 'MANUAL_ADJUSTMENT',
            reference_type: 'manual',
            user_name: 'Owner',
            notes: `Manual stock adjustment from ${beforeStock} to ${currentStock}`
          }]);
        }

        Alert.alert('Success', `Updated "${payload.name}" successfully!`);
      } else {
        const { data: created, error: insErr } = await supabase
          .from('inventory_items')
          .insert([{
            ...payload,
            restaurant_id: restaurantId,
            opening_stock: currentStock,
            is_active: true
          }])
          .select()
          .single();

        if (insErr) throw insErr;

        // Log opening stock transaction
        if (created?.id && currentStock > 0) {
          await supabase.from('inventory_transactions').insert([{
            restaurant_id: restaurantId,
            inventory_item_id: created.id,
            quantity: currentStock,
            unit: payload.unit,
            before_stock: 0,
            after_stock: currentStock,
            transaction_type: 'OPENING_STOCK',
            reference_type: 'manual',
            user_name: 'Owner',
            notes: `Initial opening stock registered`
          }]);
        }

        Alert.alert('Success', `Created "${payload.name}" in inventory!`);
      }

      setShowItemModal(false);
      await loadInventoryData();
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to save inventory item.');
    } finally {
      setSavingItem(false);
    }
  };

  // 2. DELETE ITEM HANDLER
  const handleDeleteItem = (item) => {
    Alert.alert(
      'Delete Inventory Item',
      `Are you sure you want to delete "${item.name}"? This will remove all associated stock records.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('inventory_items')
                .delete()
                .eq('id', item.id)
                .eq('restaurant_id', restaurantId);
              if (error) throw error;
              Alert.alert('Deleted', `"${item.name}" removed from inventory.`);
              await loadInventoryData();
            } catch (e) {
              Alert.alert('Error', e?.message || 'Failed to delete item.');
            }
          }
        }
      ]
    );
  };

  // 3. PURCHASE / STOCK IN HANDLER
  const handleOpenPurchaseModal = (item = null) => {
    const targetItem = item || inventoryItems[0] || null;
    setSelectedStockInItem(targetItem);
    setPurchaseQty('');
    setPurchaseSupplier(targetItem?.supplier || '');
    setPurchaseInvoice('');
    setPurchaseUnitCost(targetItem?.cost_per_unit ? String(targetItem.cost_per_unit) : '');
    setPurchaseNotes('');
    setShowPurchaseModal(true);
  };

  const handleSavePurchase = async () => {
    const qty = parseFloat(purchaseQty);
    if (!selectedStockInItem || isNaN(qty) || qty <= 0) {
      Alert.alert('Validation Error', 'Please select an ingredient and enter a valid quantity.');
      return;
    }

    setSavingPurchase(true);
    try {
      const beforeStock = Number(selectedStockInItem.current_stock || 0);
      const newStock = beforeStock + qty;
      const unitCost = parseFloat(purchaseUnitCost) || selectedStockInItem.cost_per_unit || 0;
      const totalAmount = qty * unitCost;

      // 1. Insert into inventory_purchases (matching web backend)
      let purchaseRecordId = null;
      try {
        const { data: purchData } = await supabase
          .from('inventory_purchases')
          .insert([{
            restaurant_id: restaurantId,
            supplier_name: purchaseSupplier.trim() || 'Wholesale Supplier',
            invoice_number: purchaseInvoice.trim() || `INV-${Date.now().toString().slice(-5)}`,
            total_amount: totalAmount,
            notes: purchaseNotes.trim() || 'Stock In entry from Mobile APK',
            created_by: 'Owner'
          }])
          .select()
          .single();
        if (purchData?.id) {
          purchaseRecordId = purchData.id;
          await supabase.from('inventory_purchase_items').insert([{
            purchase_id: purchData.id,
            inventory_item_id: selectedStockInItem.id,
            quantity: qty,
            unit: selectedStockInItem.unit || 'kg',
            unit_cost: unitCost,
            total_cost: totalAmount
          }]);
        }
      } catch (pErr) {
        console.log('Purchase table record optional note:', pErr?.message);
      }

      // 2. Update inventory_items current_stock & cost_per_unit
      const { error: stockErr } = await supabase
        .from('inventory_items')
        .update({
          current_stock: newStock,
          cost_per_unit: unitCost > 0 ? unitCost : selectedStockInItem.cost_per_unit,
          supplier: purchaseSupplier.trim() || selectedStockInItem.supplier,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedStockInItem.id)
        .eq('restaurant_id', restaurantId);

      if (stockErr) throw stockErr;

      // 3. Insert transaction ledger record with exact schema
      const noteDetails = [
        purchaseSupplier ? `Supplier: ${purchaseSupplier.trim()}` : '',
        purchaseInvoice ? `Inv: ${purchaseInvoice.trim()}` : '',
        purchaseNotes ? purchaseNotes.trim() : ''
      ].filter(Boolean).join(' | ') || `Stock In purchase (${qty} ${selectedStockInItem.unit})`;

      const { error: txErr } = await supabase
        .from('inventory_transactions')
        .insert([{
          restaurant_id: restaurantId,
          inventory_item_id: selectedStockInItem.id,
          quantity: qty,
          unit: selectedStockInItem.unit || 'kg',
          before_stock: beforeStock,
          after_stock: newStock,
          transaction_type: 'PURCHASE',
          reference_type: 'purchase',
          reference_id: purchaseRecordId || null,
          user_name: 'Owner',
          notes: noteDetails,
          created_at: new Date().toISOString()
        }]);

      if (txErr) console.log('tx insert error:', txErr);

      Alert.alert('Stock In Complete', `+${qty} ${selectedStockInItem.unit} added to ${selectedStockInItem.name}!\nStock updated: ${newStock} ${selectedStockInItem.unit}`);
      setShowPurchaseModal(false);
      await loadInventoryData();
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to record purchase stock in.');
    } finally {
      setSavingPurchase(false);
    }
  };

  // 4. WASTE ENTRY HANDLER
  const handleOpenWasteModal = (item = null) => {
    setSelectedWasteItem(item || inventoryItems[0] || null);
    setWasteQty('');
    setWasteReason('Spoiled');
    setWasteNotes('');
    setShowWasteModal(true);
  };

  const handleSaveWaste = async () => {
    const qty = parseFloat(wasteQty);
    if (!selectedWasteItem || isNaN(qty) || qty <= 0) {
      Alert.alert('Validation Error', 'Please select an ingredient and enter wasted quantity.');
      return;
    }

    setSavingWaste(true);
    try {
      const beforeStock = Number(selectedWasteItem.current_stock || 0);
      const newStock = Math.max(0, beforeStock - qty);
      const costImpact = qty * (Number(selectedWasteItem.cost_per_unit) || 0);

      // 1. Update inventory item stock
      const { error: stockErr } = await supabase
        .from('inventory_items')
        .update({
          current_stock: newStock,
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedWasteItem.id)
        .eq('restaurant_id', restaurantId);

      if (stockErr) throw stockErr;

      // 2. Insert into inventory_waste
      try {
        await supabase.from('inventory_waste').insert([{
          restaurant_id: restaurantId,
          inventory_item_id: selectedWasteItem.id,
          quantity: qty,
          unit: selectedWasteItem.unit || 'kg',
          waste_reason: wasteReason,
          cost_impact: costImpact,
          recorded_by: 'Owner',
          notes: wasteNotes.trim() || `Waste logged: ${wasteReason}`
        }]);
      } catch (wErr) {
        console.log('Waste table log optional note:', wErr?.message);
      }

      // 3. Insert waste transaction ledger
      await supabase.from('inventory_transactions').insert([{
        restaurant_id: restaurantId,
        inventory_item_id: selectedWasteItem.id,
        quantity: -qty,
        unit: selectedWasteItem.unit || 'kg',
        before_stock: beforeStock,
        after_stock: newStock,
        transaction_type: 'WASTE',
        reference_type: 'waste',
        user_name: 'Owner',
        notes: `Waste: ${wasteReason} ${wasteNotes ? `(${wasteNotes})` : ''}`,
        created_at: new Date().toISOString()
      }]);

      Alert.alert('Waste Logged', `Logged ${qty} ${selectedWasteItem.unit} waste for ${selectedWasteItem.name}.\nRemaining Stock: ${newStock} ${selectedWasteItem.unit}`);
      setShowWasteModal(false);
      await loadInventoryData();
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to record waste.');
    } finally {
      setSavingWaste(false);
    }
  };

  // 5. RECIPE CONFIGURE & EDIT HANDLER
  const handleOpenRecipeModal = (menuItem = null) => {
    const mItem = menuItem || menuItems[0] || null;
    setSelectedMenuItemForRecipe(mItem);
    setRecipeServingSize('1 Portion');
    setRecipePreparationSteps('Standard culinary recipe method');

    // Find existing recipe in production inventory_recipes
    const existingRec = recipes.find(r => r.menu_item_id === mItem?.id);
    if (existingRec) {
      setRecipeServingSize(existingRec.serving_size || '1 Portion');
      setRecipePreparationSteps(existingRec.preparation_steps || '');
      const ings = existingRec.inventory_recipe_ingredients || [];
      setRecipeIngredientsList(
        ings.map(ri => {
          const invItem = inventoryItems.find(i => i.id === ri.inventory_item_id) || ri.inventory_items;
          return {
            inventory_item_id: ri.inventory_item_id,
            name: invItem?.name || 'Ingredient',
            quantity: String(ri.quantity || '100'),
            unit: ri.unit || invItem?.unit || 'gram',
            cost_per_unit: invItem?.cost_per_unit || 0
          };
        })
      );
    } else {
      setRecipeIngredientsList([]);
    }
    setShowRecipeModal(true);
  };

  const handleAddIngredientToRecipe = () => {
    if (inventoryItems.length === 0) {
      Alert.alert('No Inventory Items', 'Please create raw inventory items first.');
      return;
    }
    const defaultItem = inventoryItems[0];
    const newIdx = recipeIngredientsList.length;
    setRecipeIngredientsList(prev => [
      ...prev,
      {
        inventory_item_id: defaultItem.id,
        name: defaultItem.name,
        quantity: '50',
        unit: defaultItem.unit || 'gram',
        cost_per_unit: defaultItem.cost_per_unit || 0
      }
    ]);
    // Automatically open ingredient selector for the new row
    setIngredientPickerTargetIndex(newIdx);
    setIngredientPickerSearch('');
    setShowIngredientPickerModal(true);
  };

  const handleRemoveIngredientFromRecipe = (index) => {
    setRecipeIngredientsList(prev => prev.filter((_, i) => i !== index));
  };

  // Select Ingredient for Row
  const handleSelectIngredientForRow = (invItem) => {
    if (ingredientPickerTargetIndex === null) return;
    const updated = [...recipeIngredientsList];
    updated[ingredientPickerTargetIndex] = {
      ...updated[ingredientPickerTargetIndex],
      inventory_item_id: invItem.id,
      name: invItem.name,
      unit: invItem.unit || 'gram',
      cost_per_unit: invItem.cost_per_unit || 0
    };
    setRecipeIngredientsList(updated);
    setShowIngredientPickerModal(false);
    setIngredientPickerTargetIndex(null);
  };

  // Select Unit for Row
  const handleSelectUnitForRow = (u) => {
    if (unitPickerTargetIndex === null) return;
    const updated = [...recipeIngredientsList];
    updated[unitPickerTargetIndex].unit = u;
    setRecipeIngredientsList(updated);
    setShowUnitPickerModal(false);
    setUnitPickerTargetIndex(null);
  };

  // Total Recipe Cost Calculation
  const totalRecipeCost = useMemo(() => {
    return recipeIngredientsList.reduce((sum, ri) => {
      const invItem = inventoryItems.find(i => i.id === ri.inventory_item_id);
      const costPerUnit = invItem?.cost_per_unit || ri.cost_per_unit || 0;
      const lineCost = calculateIngredientCost(ri.quantity, ri.unit, costPerUnit, invItem?.unit || ri.unit);
      return sum + lineCost;
    }, 0);
  }, [recipeIngredientsList, inventoryItems]);

  const handleSaveRecipe = async () => {
    if (!selectedMenuItemForRecipe) {
      Alert.alert('Validation Error', 'Please select a menu dish.');
      return;
    }

    setSavingRecipe(true);
    try {
      let recipeId = null;
      const existingRec = recipes.find(r => r.menu_item_id === selectedMenuItemForRecipe.id);

      if (existingRec?.id) {
        recipeId = existingRec.id;
        const { error: updErr } = await supabase
          .from('inventory_recipes')
          .update({
            serving_size: recipeServingSize.trim() || '1 Portion',
            preparation_steps: recipePreparationSteps.trim() || 'Standard culinary method',
            updated_at: new Date().toISOString()
          })
          .eq('id', recipeId)
          .eq('restaurant_id', restaurantId);
        if (updErr) throw updErr;

        // Delete old ingredients
        await supabase.from('inventory_recipe_ingredients').delete().eq('recipe_id', recipeId);
      } else {
        const { data: newRec, error: rErr } = await supabase
          .from('inventory_recipes')
          .insert([{
            restaurant_id: restaurantId,
            menu_item_id: selectedMenuItemForRecipe.id,
            serving_size: recipeServingSize.trim() || '1 Portion',
            preparation_steps: recipePreparationSteps.trim() || 'Standard culinary method',
            updated_at: new Date().toISOString()
          }])
          .select()
          .single();

        if (rErr) throw rErr;
        recipeId = newRec.id;
      }

      // Insert updated recipe ingredients
      const validIngredients = recipeIngredientsList.filter(ri => ri.inventory_item_id && Number(ri.quantity) > 0);
      if (validIngredients.length > 0 && recipeId) {
        const ingredientsToInsert = validIngredients.map(ri => ({
          recipe_id: recipeId,
          inventory_item_id: ri.inventory_item_id,
          quantity: parseFloat(ri.quantity) || 1,
          unit: ri.unit || 'gram',
          notes: ''
        }));

        const { error: ingErr } = await supabase
          .from('inventory_recipe_ingredients')
          .insert(ingredientsToInsert);

        if (ingErr) throw ingErr;
      }

      Alert.alert('Recipe Saved', `Saved recipe for "${selectedMenuItemForRecipe.name}" with ${validIngredients.length} ingredient(s)!\nTotal portion cost: ₹${totalRecipeCost.toFixed(2)}`);
      setShowRecipeModal(false);
      await loadInventoryData();
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to save recipe configuration.');
    } finally {
      setSavingRecipe(false);
    }
  };

  // 6. SMART RECIPE AI HANDLERS
  const handlePickRecipeCamera = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Camera Permission', 'Please grant camera access to photograph recipes.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
        base64: true
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        setAiRecipeImageUri(asset.uri);
        setAiRecipeImageBase64(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : null);
      }
    } catch (err) {
      Alert.alert('Camera Error', err?.message || 'Failed to open camera.');
    }
  };

  const handlePickRecipeGallery = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Gallery Permission', 'Please grant photo library access.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        quality: 0.8,
        base64: true
      });
      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        setAiRecipeImageUri(asset.uri);
        setAiRecipeImageBase64(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : null);
      }
    } catch (err) {
      Alert.alert('Gallery Error', err?.message || 'Failed to pick image.');
    }
  };

  const handleGenerateAiRecipe = async () => {
    const dish = (aiRecipeDishName || selectedMenuItemForRecipe?.name || '').trim();
    if (!dish && !aiRecipeImageBase64) {
      Alert.alert('Input Required', 'Please enter a dish name or capture a recipe photo.');
      return;
    }

    setAiGenerating(true);
    try {
      // 1. Generate recipe using direct smart culinary AI engine
      const data = await generateDishRecipeAI(dish || 'Culinary Special', {
        imageBase64: aiRecipeImageBase64 || undefined
      });

      if (!data || !data.success || !Array.isArray(data.ingredients)) {
        throw new Error('Failed to generate structured recipe.');
      }

      setAiDraftRecipe(data);
    } catch (err) {
      console.log('[AI Generation Error]:', err?.message);
      Alert.alert('AI Generation Error', err?.message || 'Could not generate recipe with AI.');
    } finally {
      setAiGenerating(false);
    }
  };

  const suggestCategoryForIngredient = (ingName = '') => {
    const norm = ingName.toLowerCase();
    if (/dairy|paneer|cheese|butter|milk|cream|curd|yogurt|ghee|dahi|khoya|mozzarella|cheddar/.test(norm)) {
      return 'Dairy & Cheese';
    }
    if (/tomato|onion|potato|garlic|ginger|chili|chilli|pepper|peas|capsicum|coriander|cilantro|mint|lemon|lime|spinach|palak|mushroom|cabbage|carrot|cauliflower|gobhi|aloo|pyaz|adrak|lahsun|veggie|vegetable/.test(norm)) {
      return 'Vegetables & Produce';
    }
    if (/chicken|mutton|beef|pork|egg|fish|prawn|shrimp|meat|bacon|ham|turkey/.test(norm)) {
      return 'Meat & Poultry';
    }
    if (/masala|salt|jeera|cumin|turmeric|haldi|chili powder|mirch|garam masala|kasuri methi|methi|coriander powder|dhania|cardamom|elaichi|clove|laung|cinnamon|dalchini|bay leaf|tej patta|black pepper|kali mirch|asafoetida|hing|mustard seed|rai|spice|seasoning|oregano|paprika/.test(norm)) {
      return 'Spices & Seasoning';
    }
    if (/rice|flour|atta|maida|besan|sooji|pasta|noodle|bread|dough|bun|crust|grain|wheat|dal|lentil|rajma|chana|oats|peanut|nut|cashew|kaju|badam|almond/.test(norm)) {
      return 'Bakery & Grains';
    }
    if (/oil|sauce|vinegar|ketchup|mayonnaise|syrup|honey|sugar|sweetener|dressing|soy sauce/.test(norm)) {
      return 'Oils & Condiments';
    }
    if (/tea|coffee|juice|water|soda|syrup|beverage|drink/.test(norm)) {
      return 'Beverages';
    }
    return 'General';
  };

  const handleApplyAiRecipe = async () => {
    if (!aiDraftRecipe || !restaurantId) return;

    const dishName = (aiDraftRecipe.recipeName || aiDraftRecipe.dishName || aiRecipeDishName || 'Special Dish').trim();
    const servingSize = aiDraftRecipe.servingSize || '1 Portion';
    const preparationSteps = aiDraftRecipe.preparationSteps || 'Standard culinary preparation';

    let currentInvList = [...inventoryItems];
    const convertedList = [];

    // 1. Process and auto-provision inventory items
    for (const ing of (aiDraftRecipe.ingredients || [])) {
      const ingNameTrim = (ing.name || '').trim();
      if (!ingNameTrim) continue;

      let matched = currentInvList.find(inv => inv.id === ing.matchedInventoryItemId) ||
        currentInvList.find(inv => (inv.name || '').trim().toLowerCase() === ingNameTrim.toLowerCase()) ||
        currentInvList.find(inv => {
          const a = (inv.name || '').toLowerCase();
          const b = ingNameTrim.toLowerCase();
          return a.includes(b) || b.includes(a);
        });

      if (!matched) {
        try {
          const suggestedCat = suggestCategoryForIngredient(ingNameTrim);
          const suggestedUnit = ing.suggestedUnit || 'gram';

          const { data: newInvItem, error: createErr } = await supabase
            .from('inventory_items')
            .insert([{
              restaurant_id: restaurantId,
              name: ingNameTrim,
              category: suggestedCat,
              unit: suggestedUnit,
              current_stock: 0,
              minimum_stock: 5,
              cost_per_unit: 0,
              is_active: true
            }])
            .select()
            .single();

          if (!createErr && newInvItem) {
            matched = newInvItem;
            currentInvList.push(newInvItem);
          }
        } catch (e) {
          console.log('[handleApplyAiRecipe] Auto-create ingredient error:', e?.message);
        }
      }

      if (matched) {
        convertedList.push({
          inventory_item_id: matched.id,
          name: matched.name,
          quantity: String(ing.suggestedQuantity || '100'),
          unit: ing.suggestedUnit || matched.unit || 'gram',
          cost_per_unit: matched.cost_per_unit || 0
        });
      }
    }

    setInventoryItems(currentInvList);
    setRecipeIngredientsList(convertedList);
    setRecipeServingSize(servingSize);
    setRecipePreparationSteps(preparationSteps);

    // 2. AUTO-MENU: Check if dish exists in menu_items or auto-create
    let targetDish = menuItems.find(m => (m.name || '').trim().toLowerCase() === dishName.toLowerCase()) ||
      menuItems.find(m => dishName.toLowerCase().includes((m.name || '').trim().toLowerCase()) || (m.name || '').trim().toLowerCase().includes(dishName.toLowerCase()));

    if (!targetDish) {
      try {
        // Fetch or create a default category
        const { data: cats } = await supabase.from('categories').select('id').eq('restaurant_id', restaurantId).limit(1);
        const defaultCatId = cats && cats[0] ? cats[0].id : null;

        const { data: createdMenu, error: mErr } = await supabase
          .from('menu_items')
          .insert([{
            restaurant_id: restaurantId,
            name: dishName,
            price: 250,
            category_id: defaultCatId,
            is_available: true,
            description: `Chef crafted ${dishName}`
          }])
          .select()
          .single();

        if (!mErr && createdMenu) {
          targetDish = createdMenu;
          setMenuItems(prev => [createdMenu, ...prev]);
        }
      } catch (catErr) {
        console.log('[handleApplyAiRecipe] Auto-create menu item error:', catErr?.message);
      }
    }

    if (!targetDish) {
      targetDish = selectedMenuItemForRecipe || menuItems[0];
    }
    setSelectedMenuItemForRecipe(targetDish);

    // 3. AUTO-SAVE: Automatically save recipe to DB on first attempt
    if (targetDish && targetDish.id && convertedList.length > 0) {
      try {
        let recId = null;
        const existingRec = recipes.find(r => r.menu_item_id === targetDish.id);
        if (existingRec?.id) {
          recId = existingRec.id;
          await supabase
            .from('inventory_recipes')
            .update({
              serving_size: servingSize,
              preparation_steps: preparationSteps,
              updated_at: new Date().toISOString()
            })
            .eq('id', recId);

          await supabase.from('inventory_recipe_ingredients').delete().eq('recipe_id', recId);
        } else {
          const { data: newRec } = await supabase
            .from('inventory_recipes')
            .insert([{
              restaurant_id: restaurantId,
              menu_item_id: targetDish.id,
              serving_size: servingSize,
              preparation_steps: preparationSteps,
              updated_at: new Date().toISOString()
            }])
            .select()
            .single();

          if (newRec) recId = newRec.id;
        }

        if (recId) {
          const ingsToInsert = convertedList.map(ri => ({
            recipe_id: recId,
            inventory_item_id: ri.inventory_item_id,
            quantity: parseFloat(ri.quantity) || 100,
            unit: ri.unit || 'gram',
            notes: ''
          }));
          await supabase.from('inventory_recipe_ingredients').insert(ingsToInsert);
        }
      } catch (autoSaveErr) {
        console.log('[handleApplyAiRecipe] Auto-save recipe error:', autoSaveErr?.message);
      }
    }

    setShowAiRecipeModal(false);
    setAiDraftRecipe(null);
    setAiRecipeImageUri(null);
    setAiRecipeImageBase64(null);
    setShowRecipeModal(true);
    await loadInventoryData();
    Alert.alert(
      'Recipe & Menu Saved!',
      `Successfully generated & saved "${targetDish?.name || dishName}" with ${convertedList.length} commercial ingredients in Menu & Recipe inventory!`
    );
  };

  // Filter items
  const filteredItems = inventoryItems.filter(item =>
    (item.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.category || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredRecipes = recipes.filter(r =>
    (r.menu_items?.name || r.name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredPickerIngredients = inventoryItems.filter(i =>
    (i.name || '').toLowerCase().includes(ingredientPickerSearch.toLowerCase()) ||
    (i.category || '').toLowerCase().includes(ingredientPickerSearch.toLowerCase())
  );

  // Render Stock Item Card
  const renderStockItem = ({ item }) => {
    const currentStock = Number(item.current_stock || 0);
    const minStock = Number(item.minimum_stock ?? item.min_stock ?? item.reorder_level ?? 0);
    const isLow = currentStock <= minStock;
    const unitCost = Number(item.cost_per_unit ?? item.unit_cost ?? 0);

    return (
      <View style={styles.stockCard}>
        <View style={styles.stockCardTop}>
          <View style={[styles.stockIconCircle, isLow && { backgroundColor: '#fee2e2' }]}>
            <MaterialCommunityIcons
              name={isLow ? 'alert-decagram' : 'package-variant-closed'}
              size={22}
              color={isLow ? '#dc2626' : COLORS.primary}
            />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.itemName}>{item.name}</Text>
            <Text style={styles.itemCategory}>{item.category || 'General Ingredient'}</Text>
          </View>
          <View style={styles.stockLevelBox}>
            <Text style={[styles.stockAmount, isLow && { color: '#dc2626' }]}>
              {currentStock} {item.unit || 'units'}
            </Text>
            {isLow && (
              <View style={styles.lowBadge}>
                <Text style={styles.lowBadgeText}>LOW STOCK</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.stockMetaRow}>
          <Text style={styles.metaLabel}>Reorder Level: {minStock} {item.unit || ''}</Text>
          <Text style={styles.metaLabel}>Price: ₹{unitCost.toFixed(2)} / {item.unit || 'unit'}</Text>
        </View>

        {/* Action Buttons Row */}
        <View style={styles.cardActionsRow}>
          <TouchableOpacity
            style={styles.actionBtnGreen}
            onPress={() => handleOpenPurchaseModal(item)}
          >
            <Ionicons name="add-circle-outline" size={14} color="#059669" />
            <Text style={styles.actionBtnGreenText}>Stock In</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtnAmber}
            onPress={() => handleOpenWasteModal(item)}
          >
            <Ionicons name="trash-outline" size={14} color="#d97706" />
            <Text style={styles.actionBtnAmberText}>Log Waste</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtnEdit}
            onPress={() => handleOpenItemModal(item)}
          >
            <Feather name="edit-2" size={14} color="#2563eb" />
            <Text style={styles.actionBtnEditText}>Edit</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtnDelete}
            onPress={() => handleDeleteItem(item)}
          >
            <Feather name="trash" size={14} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  // Render Transaction Ledger Card
  const renderTransactionCard = ({ item: tx }) => {
    const type = (tx.transaction_type || tx.type || 'adjustment').toUpperCase();
    const isPurchase = type === 'PURCHASE' || type === 'OPENING_STOCK';
    const isWaste = type === 'WASTE' || type === 'SPOILAGE';
    const isSale = type === 'ORDER_CONSUMPTION';

    const typeColor = isPurchase ? '#059669' : isWaste ? '#dc2626' : isSale ? '#2563eb' : '#64748b';
    const qty = Number(tx.quantity || 0);

    return (
      <View style={styles.ledgerCard}>
        <View style={styles.ledgerTop}>
          <View style={[styles.ledgerBadge, { backgroundColor: typeColor + '15' }]}>
            <Text style={[styles.ledgerBadgeText, { color: typeColor }]}>{type}</Text>
          </View>
          <Text style={styles.ledgerTime}>
            {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
          </Text>
        </View>
        <Text style={styles.ledgerItemName}>
          {tx.inventory_items?.name || 'Inventory Item'}
        </Text>
        <View style={styles.ledgerBottom}>
          <Text style={[styles.ledgerQty, { color: qty >= 0 ? '#059669' : '#ef4444' }]}>
            {qty >= 0 ? `+${qty}` : `${qty}`} {tx.unit || tx.inventory_items?.unit || ''}
          </Text>
          <Text style={styles.ledgerStockAudit}>
            {tx.before_stock != null ? `${tx.before_stock} → ${tx.after_stock}` : ''}
          </Text>
        </View>
        {!!tx.notes && <Text style={styles.ledgerNotes} numberOfLines={2}>{tx.notes}</Text>}
      </View>
    );
  };

  // Render Recipe Card for Menu Items
  const renderRecipeCard = ({ item: menuItem }) => {
    const existingRec = recipes.find(r => r.menu_item_id === menuItem.id);
    const ingredients = existingRec?.inventory_recipe_ingredients || [];

    // Calculate recipe total cost
    const totalCost = ingredients.reduce((sum, ri) => {
      const invItem = inventoryItems.find(i => i.id === ri.inventory_item_id) || ri.inventory_items;
      return sum + calculateIngredientCost(ri.quantity, ri.unit, invItem?.cost_per_unit, invItem?.unit);
    }, 0);

    const hasRecipe = Boolean(existingRec && ingredients.length > 0);

    return (
      <View style={styles.recipeCard}>
        <View style={styles.recipeHeader}>
          <View style={[styles.recipeIconCircle, { backgroundColor: hasRecipe ? '#ede9fe' : '#f1f5f9' }]}>
            <MaterialCommunityIcons
              name={hasRecipe ? 'chef-hat' : 'food-fork-drink'}
              size={22}
              color={hasRecipe ? '#7c3aed' : '#64748b'}
            />
          </View>
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={styles.recipeTitle}>{menuItem.name}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <Text style={styles.recipeSub}>
                ₹{menuItem.price || 0}
              </Text>
              {hasRecipe ? (
                <View style={styles.recipeBadgeGreen}>
                  <Text style={styles.recipeBadgeGreenText}>
                    {ingredients.length} Ing. • Cost: ₹{totalCost.toFixed(2)}
                  </Text>
                </View>
              ) : (
                <View style={styles.recipeBadgeAmber}>
                  <Text style={styles.recipeBadgeAmberText}>No Recipe Linked</Text>
                </View>
              )}
            </View>
          </View>
        </View>

        {hasRecipe && (
          <View style={styles.ingredientsList}>
            {ingredients.map((ing, idx) => {
              const invItem = inventoryItems.find(i => i.id === ing.inventory_item_id) || ing.inventory_items;
              const lineCost = calculateIngredientCost(ing.quantity, ing.unit, invItem?.cost_per_unit, invItem?.unit);
              return (
                <View key={ing.id || idx} style={styles.ingredientRow}>
                  <Text style={styles.ingName}>• {invItem?.name || 'Item'}</Text>
                  <Text style={styles.ingQty}>
                    {ing.quantity} {ing.unit || invItem?.unit || ''} (₹{lineCost.toFixed(2)})
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        <View style={styles.recipeCardActionsRow}>
          <TouchableOpacity
            style={[styles.recipeActionBtnMain, { backgroundColor: hasRecipe ? '#7c3aed' : '#4f46e5' }]}
            onPress={() => handleOpenRecipeModal(menuItem)}
          >
            <Feather name={hasRecipe ? "edit-2" : "plus-circle"} size={14} color="#ffffff" />
            <Text style={styles.recipeActionBtnMainText}>{hasRecipe ? 'Edit Recipe' : '+ Create Recipe'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.recipeActionBtnAi}
            onPress={() => {
              setAiRecipeDishName(menuItem.name || '');
              setAiRecipeImageUri(null);
              setAiRecipeImageBase64(null);
              setAiDraftRecipe(null);
              setShowAiRecipeModal(true);
            }}
          >
            <Ionicons name="sparkles" size={14} color="#7c3aed" />
            <Text style={styles.recipeActionBtnAiText}>AI Recipe</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        {navigation.canGoBack() && (
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color="#0f172a" />
          </TouchableOpacity>
        )}
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.headerTitle}>Inventory & Recipes</Text>
          <Text style={styles.headerSubtitle}>Full stock tracking, purchases, waste & recipes</Text>
        </View>
        <TouchableOpacity onPress={loadInventoryData} style={styles.refreshBtn}>
          <Ionicons name="refresh" size={20} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {/* Dynamic Action Bar per Tab */}
      <View style={styles.topActionsBar}>
        {activeTab === 'recipes' ? (
          <>
            <TouchableOpacity
              style={[styles.primaryActionBtn, { backgroundColor: '#7c3aed' }]}
              onPress={() => handleOpenRecipeModal()}
            >
              <Ionicons name="add-circle" size={16} color="#ffffff" />
              <Text style={styles.primaryActionBtnText}>Configure Recipe</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryActionBtn, { backgroundColor: '#f5f3ff', borderColor: '#ddd6fe' }]}
              onPress={() => {
                setAiRecipeDishName('');
                setAiRecipeImageUri(null);
                setAiRecipeImageBase64(null);
                setAiDraftRecipe(null);
                setShowAiRecipeModal(true);
              }}
            >
              <Ionicons name="sparkles" size={15} color="#7c3aed" />
              <Text style={[styles.secondaryActionBtnText, { color: '#7c3aed' }]}>AI Recipe</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryActionBtn}
              onPress={() => handleOpenItemModal()}
            >
              <Ionicons name="add" size={15} color="#059669" />
              <Text style={styles.secondaryActionBtnText}>Add Item</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity
              style={styles.primaryActionBtn}
              onPress={() => handleOpenItemModal()}
            >
              <Ionicons name="add" size={16} color="#ffffff" />
              <Text style={styles.primaryActionBtnText}>Add Item</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryActionBtn}
              onPress={() => handleOpenPurchaseModal()}
            >
              <Ionicons name="cart-outline" size={15} color="#059669" />
              <Text style={styles.secondaryActionBtnText}>Stock In</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryActionBtnRed}
              onPress={() => handleOpenWasteModal()}
            >
              <Ionicons name="trash-outline" size={15} color="#dc2626" />
              <Text style={styles.secondaryActionBtnRedText}>Waste</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Tab Navigation */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'stock' && styles.tabBtnActive]}
          onPress={() => setActiveTab('stock')}
        >
          <MaterialCommunityIcons
            name="package-variant"
            size={16}
            color={activeTab === 'stock' ? COLORS.primary : '#64748b'}
          />
          <Text style={[styles.tabBtnText, activeTab === 'stock' && styles.tabBtnTextActive]}>
            Stock ({inventoryItems.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'ledger' && styles.tabBtnActive]}
          onPress={() => setActiveTab('ledger')}
        >
          <MaterialCommunityIcons
            name="history"
            size={16}
            color={activeTab === 'ledger' ? COLORS.primary : '#64748b'}
          />
          <Text style={[styles.tabBtnText, activeTab === 'ledger' && styles.tabBtnTextActive]}>
            Ledger ({transactions.length})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tabBtn, activeTab === 'recipes' && styles.tabBtnActive]}
          onPress={() => setActiveTab('recipes')}
        >
          <MaterialCommunityIcons
            name="book-open-outline"
            size={16}
            color={activeTab === 'recipes' ? '#7c3aed' : '#64748b'}
          />
          <Text style={[styles.tabBtnText, activeTab === 'recipes' && { color: '#7c3aed', fontWeight: '700' }]}>
            Recipes ({recipes.length})
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={18} color="#94a3b8" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder={
            activeTab === 'stock'
              ? 'Search items by name or category...'
              : activeTab === 'ledger'
              ? 'Filter transactions...'
              : 'Search menu dishes & recipes...'
          }
          placeholderTextColor="#94a3b8"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {!!searchQuery && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </View>

      {/* Main List Rendering */}
      {loading ? (
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading inventory data...</Text>
        </View>
      ) : activeTab === 'stock' ? (
        <>
          {/* Stock Value Header Card (Owner & Manager Only) */}
          {isOwnerOrManager && (
            <View style={styles.stockValueHeaderCard}>
              <View style={styles.stockValueCol}>
                <Text style={styles.stockValueLabel}>TOTAL VALUE</Text>
                <Text style={styles.stockValueAmount}>₹{totalStockValue.toFixed(0)}</Text>
                <Text style={styles.stockValueSub}>{inventoryItems.length} items</Text>
              </View>
              <View style={styles.stockValueDivider} />
              <View style={styles.stockValueCol}>
                <Text style={[styles.stockValueLabel, { color: '#d97706' }]}>LOW STOCK</Text>
                <Text style={[styles.stockValueAmount, { color: '#d97706' }]}>₹{lowStockValue.toFixed(0)}</Text>
                <Text style={styles.stockValueSub}>Needs restock</Text>
              </View>
              <View style={styles.stockValueDivider} />
              <View style={styles.stockValueCol}>
                <Text style={[styles.stockValueLabel, { color: '#dc2626' }]}>OUT OF STOCK</Text>
                <Text style={[styles.stockValueAmount, { color: '#dc2626' }]}>{outOfStockCount}</Text>
                <Text style={styles.stockValueSub}>0 Qty Items</Text>
              </View>
            </View>
          )}

          {filteredItems.length === 0 ? (
            <View style={styles.centerBox}>
              <MaterialCommunityIcons name="package-variant-closed" size={48} color="#94a3b8" />
              <Text style={styles.emptyTitle}>No Inventory Items Found</Text>
              <Text style={styles.emptySub}>Tap "Add Item" above to register raw materials and ingredients.</Text>
            </View>
          ) : (
            <FlatList
              data={filteredItems}
              keyExtractor={item => item.id}
              renderItem={renderStockItem}
              contentContainerStyle={styles.listContent}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadInventoryData(); }} />}
            />
          )}
        </>
      ) : activeTab === 'ledger' ? (
        transactions.length === 0 ? (
          <View style={styles.centerBox}>
            <MaterialCommunityIcons name="history" size={48} color="#94a3b8" />
            <Text style={styles.emptyTitle}>No Transaction History</Text>
            <Text style={styles.emptySub}>Stock ins, waste logs, and sales will appear here.</Text>
          </View>
        ) : (
          <FlatList
            data={transactions}
            keyExtractor={item => item.id}
            renderItem={renderTransactionCard}
            contentContainerStyle={styles.listContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadInventoryData(); }} />}
          />
        )
      ) : (
        <FlatList
          data={menuItems.filter(mi => (mi.name || '').toLowerCase().includes(searchQuery.toLowerCase()))}
          keyExtractor={item => item.id}
          renderItem={renderRecipeCard}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={{ gap: 8, marginBottom: 12 }}>
              <TouchableOpacity
                style={styles.addRecipeBanner}
                onPress={() => handleOpenRecipeModal()}
              >
                <Ionicons name="add-circle" size={20} color="#7c3aed" />
                <Text style={styles.addRecipeBannerText}>+ Configure New Recipe</Text>
              </TouchableOpacity>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.centerBox}>
              <MaterialCommunityIcons name="chef-hat" size={48} color="#94a3b8" />
              <Text style={styles.emptyTitle}>No Menu Dishes Found</Text>
              <Text style={styles.emptySub}>Create dishes in Menu Management first, then configure recipes.</Text>
            </View>
          }
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadInventoryData(); }} />}
        />
      )}

      {/* 1. ADD / EDIT ITEM MODAL */}
      <Modal visible={showItemModal} transparent animationType="slide" onRequestClose={() => setShowItemModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingItem ? 'Edit Ingredient' : 'New Ingredient'}</Text>
              <TouchableOpacity onPress={() => setShowItemModal(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 500 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>Item Name *</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. Basmati Rice, Paneer, Amul Butter"
                value={itemName}
                onChangeText={setItemName}
              />

              <Text style={styles.inputLabel}>Category *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                {INVENTORY_CATEGORIES.map(cat => (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.dropdownSelectChip,
                      itemCategory.toLowerCase() === cat.toLowerCase() && styles.dropdownSelectChipActive
                    ]}
                    onPress={() => setItemCategory(cat)}
                  >
                    <Text style={[
                      styles.dropdownSelectChipText,
                      itemCategory.toLowerCase() === cat.toLowerCase() && styles.dropdownSelectChipTextActive
                    ]}>
                      {cat}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <TextInput
                style={styles.modalInput}
                placeholder="Or type custom category name..."
                value={itemCategory}
                onChangeText={setItemCategory}
              />

              <Text style={styles.inputLabel}>Unit of Measurement *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                {INVENTORY_UNITS.map(u => (
                  <TouchableOpacity
                    key={u}
                    style={[
                      styles.dropdownSelectChip,
                      itemUnit.toLowerCase() === u.toLowerCase() && styles.dropdownSelectChipActive
                    ]}
                    onPress={() => setItemUnit(u)}
                  >
                    <Text style={[
                      styles.dropdownSelectChipText,
                      itemUnit.toLowerCase() === u.toLowerCase() && styles.dropdownSelectChipTextActive
                    ]}>
                      {u}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={styles.modalRow}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.inputLabel}>Current Stock</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="0"
                    keyboardType="numeric"
                    value={itemCurrentStock}
                    onChangeText={setItemCurrentStock}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.inputLabel}>Reorder Level (Min Stock) *</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="5"
                    keyboardType="numeric"
                    value={itemMinStock}
                    onChangeText={setItemMinStock}
                  />
                </View>
              </View>

              {/* Price Row: Current Price + Previous Price */}
              <View style={styles.modalRow}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.inputLabel}>Current Price (₹ / unit) *</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="0"
                    keyboardType="numeric"
                    value={itemUnitCost}
                    onChangeText={setItemUnitCost}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.inputLabel}>Previous Price (₹)</Text>
                  <TextInput
                    style={[styles.modalInput, { backgroundColor: '#f1f5f9', color: '#64748b' }]}
                    placeholder="0"
                    editable={false}
                    value={itemPreviousCost}
                  />
                </View>
              </View>

              <Text style={styles.inputLabel}>Supplier Name (Optional)</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. Metro Wholesale / Local Vendor"
                value={itemSupplier}
                onChangeText={setItemSupplier}
              />

              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={handleSaveItem}
                disabled={savingItem}
              >
                {savingItem ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>{editingItem ? 'Save Changes' : 'Create Item'}</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 2. PURCHASE / STOCK IN MODAL */}
      <Modal visible={showPurchaseModal} transparent animationType="slide" onRequestClose={() => setShowPurchaseModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Purchase Entry / Stock In</Text>
              <TouchableOpacity onPress={() => setShowPurchaseModal(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 480 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>Select Ingredient *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                {inventoryItems.map(it => (
                  <TouchableOpacity
                    key={it.id}
                    style={[
                      styles.itemSelectChip,
                      selectedStockInItem?.id === it.id && styles.itemSelectChipActive
                    ]}
                    onPress={() => {
                      setSelectedStockInItem(it);
                      if (it.cost_per_unit) setPurchaseUnitCost(String(it.cost_per_unit));
                      if (it.supplier) setPurchaseSupplier(it.supplier);
                    }}
                  >
                    <Text style={[
                      styles.itemSelectChipText,
                      selectedStockInItem?.id === it.id && styles.itemSelectChipTextActive
                    ]}>
                      {it.name} ({it.current_stock} {it.unit})
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.inputLabel}>Quantity to Add ({selectedStockInItem?.unit || 'units'}) *</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. 10, 25.5"
                keyboardType="numeric"
                value={purchaseQty}
                onChangeText={setPurchaseQty}
              />

              <View style={styles.modalRow}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.inputLabel}>Unit Cost (₹ / {selectedStockInItem?.unit || 'unit'}) *</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="₹ cost per unit"
                    keyboardType="numeric"
                    value={purchaseUnitCost}
                    onChangeText={setPurchaseUnitCost}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.inputLabel}>Total Bill Preview</Text>
                  <TextInput
                    style={[styles.modalInput, { backgroundColor: '#f1f5f9', color: '#059669', fontWeight: '700' }]}
                    editable={false}
                    value={`₹ ${((parseFloat(purchaseQty) || 0) * (parseFloat(purchaseUnitCost) || 0)).toFixed(2)}`}
                  />
                </View>
              </View>

              <View style={styles.modalRow}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.inputLabel}>Supplier Name</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="Vendor / Wholesale"
                    value={purchaseSupplier}
                    onChangeText={setPurchaseSupplier}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.inputLabel}>Invoice / Bill No.</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="#INV-102"
                    value={purchaseInvoice}
                    onChangeText={setPurchaseInvoice}
                  />
                </View>
              </View>

              <Text style={styles.inputLabel}>Purchase Notes</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Optional notes, delivery date, batch details..."
                value={purchaseNotes}
                onChangeText={setPurchaseNotes}
              />

              <TouchableOpacity
                style={[styles.modalSubmitBtn, { backgroundColor: '#059669' }]}
                onPress={handleSavePurchase}
                disabled={savingPurchase}
              >
                {savingPurchase ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>Confirm Stock In</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 3. WASTE LOG MODAL */}
      <Modal visible={showWasteModal} transparent animationType="slide" onRequestClose={() => setShowWasteModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log Kitchen Waste</Text>
              <TouchableOpacity onPress={() => setShowWasteModal(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>Select Ingredient</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                {inventoryItems.map(it => (
                  <TouchableOpacity
                    key={it.id}
                    style={[
                      styles.itemSelectChip,
                      selectedWasteItem?.id === it.id && styles.itemSelectChipActiveRed
                    ]}
                    onPress={() => setSelectedWasteItem(it)}
                  >
                    <Text style={[
                      styles.itemSelectChipText,
                      selectedWasteItem?.id === it.id && styles.itemSelectChipTextActiveRed
                    ]}>
                      {it.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.inputLabel}>Wasted Quantity ({selectedWasteItem?.unit || 'units'}) *</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. 1.5"
                keyboardType="numeric"
                value={wasteQty}
                onChangeText={setWasteQty}
              />

              <Text style={styles.inputLabel}>Reason for Waste</Text>
              <View style={styles.reasonRow}>
                {['Spoiled', 'Expired', 'Spilled', 'Burnt', 'Trim Waste'].map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[
                      styles.reasonChip,
                      wasteReason === r && styles.reasonChipActive
                    ]}
                    onPress={() => setWasteReason(r)}
                  >
                    <Text style={[
                      styles.reasonChipText,
                      wasteReason === r && styles.reasonChipTextActive
                    ]}>
                      {r}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.inputLabel}>Notes</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="Optional notes or details..."
                value={wasteNotes}
                onChangeText={setWasteNotes}
              />

              <TouchableOpacity
                style={[styles.modalSubmitBtn, { backgroundColor: '#dc2626' }]}
                onPress={handleSaveWaste}
                disabled={savingWaste}
              >
                {savingWaste ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>Record Waste</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 4. RECIPE CONFIGURE & EDIT MODAL */}
      <Modal visible={showRecipeModal} transparent animationType="slide" onRequestClose={() => setShowRecipeModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={styles.modalTitle}>Configure Dish Recipe</Text>
                {selectedMenuItemForRecipe && (
                  <Text style={styles.modalSubHeader}>
                    {selectedMenuItemForRecipe.name} (₹{selectedMenuItemForRecipe.price || 0})
                  </Text>
                )}
              </View>
              <TouchableOpacity onPress={() => setShowRecipeModal(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 500 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>Select Menu Dish *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                {menuItems.map(mi => (
                  <TouchableOpacity
                    key={mi.id}
                    style={[
                      styles.itemSelectChip,
                      selectedMenuItemForRecipe?.id === mi.id && styles.itemSelectChipActivePurple
                    ]}
                    onPress={() => handleOpenRecipeModal(mi)}
                  >
                    <Text style={[
                      styles.itemSelectChipText,
                      selectedMenuItemForRecipe?.id === mi.id && styles.itemSelectChipTextActivePurple
                    ]}>
                      {mi.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={styles.modalRow}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.inputLabel}>Serving Standard</Text>
                  <TextInput
                    style={styles.modalInput}
                    placeholder="1 Portion / Standard Serving"
                    value={recipeServingSize}
                    onChangeText={setRecipeServingSize}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={styles.inputLabel}>Portion Cost Preview</Text>
                  <TextInput
                    style={[styles.modalInput, { backgroundColor: '#f5f3ff', color: '#7c3aed', fontWeight: '700' }]}
                    editable={false}
                    value={`₹ ${totalRecipeCost.toFixed(2)}`}
                  />
                </View>
              </View>

              {/* Recipe Ingredients Header */}
              <View style={styles.ingredientsHeaderRow}>
                <Text style={styles.inputLabel}>Recipe Ingredients ({recipeIngredientsList.length})</Text>
                <TouchableOpacity onPress={handleAddIngredientToRecipe} style={styles.addIngBtn}>
                  <Ionicons name="add" size={14} color="#7c3aed" />
                  <Text style={styles.addIngBtnText}>+ Add Ingredient</Text>
                </TouchableOpacity>
              </View>

              {/* Ingredients List Rows with Searchable Dropdown & Unit Dropdown */}
              {recipeIngredientsList.map((ri, idx) => {
                const invItem = inventoryItems.find(i => i.id === ri.inventory_item_id);
                const lineCost = calculateIngredientCost(ri.quantity, ri.unit, invItem?.cost_per_unit, invItem?.unit);

                return (
                  <View key={idx} style={styles.recipeIngEditCard}>
                    <View style={styles.recipeIngRowTop}>
                      {/* Searchable Ingredient Dropdown Trigger */}
                      <TouchableOpacity
                        style={styles.ingSelectTrigger}
                        onPress={() => {
                          setIngredientPickerTargetIndex(idx);
                          setIngredientPickerSearch('');
                          setShowIngredientPickerModal(true);
                        }}
                      >
                        <Text style={styles.ingSelectTriggerText} numberOfLines={1}>
                          {ri.name || invItem?.name || 'Select Ingredient'}
                        </Text>
                        <Ionicons name="chevron-down" size={14} color="#64748b" />
                      </TouchableOpacity>

                      {/* Quantity Input */}
                      <TextInput
                        style={styles.qtyInputBox}
                        placeholder="Qty"
                        keyboardType="numeric"
                        value={ri.quantity}
                        onChangeText={(val) => {
                          const updated = [...recipeIngredientsList];
                          updated[idx].quantity = val;
                          setRecipeIngredientsList(updated);
                        }}
                      />

                      {/* Unit Dropdown Trigger */}
                      <TouchableOpacity
                        style={styles.unitSelectTrigger}
                        onPress={() => {
                          setUnitPickerTargetIndex(idx);
                          setShowUnitPickerModal(true);
                        }}
                      >
                        <Text style={styles.unitSelectTriggerText}>{ri.unit || 'unit'}</Text>
                        <Ionicons name="chevron-down" size={12} color="#7c3aed" />
                      </TouchableOpacity>

                      {/* Remove Button */}
                      <TouchableOpacity
                        onPress={() => handleRemoveIngredientFromRecipe(idx)}
                        style={styles.removeIngBtn}
                      >
                        <Ionicons name="trash-outline" size={16} color="#ef4444" />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.recipeIngRowMeta}>
                      <Text style={styles.ingMetaText}>
                        Base: ₹{invItem?.cost_per_unit || 0}/{invItem?.unit || 'unit'}
                      </Text>
                      <Text style={styles.ingCostText}>Line Cost: ₹{lineCost.toFixed(2)}</Text>
                    </View>
                  </View>
                );
              })}

              <TouchableOpacity
                style={[styles.modalSubmitBtn, { backgroundColor: '#7c3aed', marginTop: 16 }]}
                onPress={handleSaveRecipe}
                disabled={savingRecipe}
              >
                {savingRecipe ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>Save Recipe Configuration</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 5. SEARCHABLE INGREDIENT PICKER MODAL */}
      <Modal visible={showIngredientPickerModal} transparent animationType="slide" onRequestClose={() => setShowIngredientPickerModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Inventory Ingredient</Text>
              <TouchableOpacity onPress={() => setShowIngredientPickerModal(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <View style={styles.pickerSearchBox}>
              <Ionicons name="search" size={16} color="#94a3b8" style={{ marginRight: 6 }} />
              <TextInput
                style={styles.pickerSearchInput}
                placeholder="Search raw items (Tomato, Onion, Oil...)"
                value={ingredientPickerSearch}
                onChangeText={setIngredientPickerSearch}
                autoFocus
              />
            </View>

            <ScrollView style={{ maxHeight: 360 }}>
              {filteredPickerIngredients.map(item => (
                <TouchableOpacity
                  key={item.id}
                  style={styles.pickerItemRow}
                  onPress={() => handleSelectIngredientForRow(item)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickerItemName}>{item.name}</Text>
                    <Text style={styles.pickerItemCategory}>{item.category || 'General'} • {item.current_stock} {item.unit} in stock</Text>
                  </View>
                  <Text style={styles.pickerItemPrice}>₹{Number(item.cost_per_unit || 0).toFixed(2)} / {item.unit}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 6. UNIT PICKER MODAL */}
      <Modal visible={showUnitPickerModal} transparent animationType="fade" onRequestClose={() => setShowUnitPickerModal(false)}>
        <View style={styles.centerModalOverlay}>
          <View style={styles.unitPickerCard}>
            <Text style={styles.unitPickerTitle}>Select Recipe Unit</Text>
            <View style={styles.unitGrid}>
              {INVENTORY_UNITS.map(u => (
                <TouchableOpacity
                  key={u}
                  style={styles.unitChoiceBtn}
                  onPress={() => handleSelectUnitForRow(u)}
                >
                  <Text style={styles.unitChoiceBtnText}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.unitPickerCancelBtn}
              onPress={() => setShowUnitPickerModal(false)}
            >
              <Text style={styles.unitPickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 7. SMART RECIPE AI MODAL (WITH CAMERA + GALLERY + PROMPT) */}
      <Modal visible={showAiRecipeModal} transparent animationType="slide" onRequestClose={() => setShowAiRecipeModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="sparkles" size={20} color="#7c3aed" style={{ marginRight: 6 }} />
                <Text style={styles.modalTitle}>Smart Recipe AI Assistant</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAiRecipeModal(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.aiSubtitle}>
                Generate commercial culinary recipes with exact ingredient quantities and live inventory matching using Gemini AI.
              </Text>

              {/* Dish Name Input */}
              <Text style={styles.inputLabel}>Target Dish Name *</Text>
              <TextInput
                style={styles.modalInput}
                placeholder="e.g. Paneer Butter Masala, Margherita Pizza, Cold Coffee"
                value={aiRecipeDishName}
                onChangeText={setAiRecipeDishName}
              />

              {/* Photo Input (Camera / Gallery) */}
              <Text style={styles.inputLabel}>Recipe Photo or Printed Card (Optional)</Text>
              {aiRecipeImageUri ? (
                <View style={styles.aiImagePreviewBox}>
                  <Image source={{ uri: aiRecipeImageUri }} style={styles.aiImageThumbnail} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.aiImageStatus}>Photo Attached</Text>
                    <TouchableOpacity
                      style={styles.aiRemovePhotoBtn}
                      onPress={() => {
                        setAiRecipeImageUri(null);
                        setAiRecipeImageBase64(null);
                      }}
                    >
                      <Ionicons name="trash-outline" size={14} color="#dc2626" />
                      <Text style={styles.aiRemovePhotoText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.aiPhotoRow}>
                  <TouchableOpacity style={styles.aiPhotoBtn} onPress={handlePickRecipeCamera}>
                    <Ionicons name="camera" size={16} color="#7c3aed" />
                    <Text style={styles.aiPhotoBtnText}>Capture Photo</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.aiPhotoBtn} onPress={handlePickRecipeGallery}>
                    <Ionicons name="images" size={16} color="#7c3aed" />
                    <Text style={styles.aiPhotoBtnText}>Gallery Upload</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Generate Action Button */}
              <TouchableOpacity
                style={[styles.modalSubmitBtn, { backgroundColor: '#7c3aed' }]}
                onPress={handleGenerateAiRecipe}
                disabled={aiGenerating}
              >
                {aiGenerating ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator color="#ffffff" />
                    <Text style={styles.modalSubmitBtnText}>AI Analyzing & Formulating Recipe...</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="sparkles" size={16} color="#ffffff" />
                    <Text style={styles.modalSubmitBtnText}>Generate Recipe with AI</Text>
                  </View>
                )}
              </TouchableOpacity>

              {/* AI Draft Preview Sheet */}
              {aiDraftRecipe && (
                <View style={styles.aiDraftCard}>
                  <View style={styles.aiDraftHeader}>
                    <Text style={styles.aiDraftTitle}>AI Recipe Draft: {aiDraftRecipe.dishName}</Text>
                    <Text style={styles.aiDraftServing}>Standard: {aiDraftRecipe.servingSize}</Text>
                  </View>

                  <Text style={styles.aiDraftSectionTitle}>Extracted Ingredients ({aiDraftRecipe.ingredients?.length || 0}):</Text>
                  {aiDraftRecipe.ingredients?.map((ing, idx) => (
                    <View key={idx} style={styles.aiDraftIngRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.aiDraftIngName}>{ing.name}</Text>
                        <Text style={styles.aiDraftIngMatch}>
                          {ing.isMatched ? `✓ Matched: ${ing.matchedInventoryItemName}` : '• New Ingredient'}
                        </Text>
                      </View>
                      <Text style={styles.aiDraftIngQty}>
                        {ing.suggestedQuantity} {ing.suggestedUnit}
                      </Text>
                    </View>
                  ))}

                  <TouchableOpacity
                    style={styles.aiApplyBtn}
                    onPress={handleApplyAiRecipe}
                  >
                    <Ionicons name="checkmark-circle" size={16} color="#ffffff" />
                    <Text style={styles.aiApplyBtnText}>Apply to Recipe Editor</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  headerSubtitle: { fontSize: 11, color: '#64748b', marginTop: 1 },
  refreshBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#ecfdf5', alignItems: 'center', justifyContent: 'center' },
  topActionsBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  primaryActionBtn: {
    flex: 1.1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 9,
    borderRadius: 10,
    gap: 3,
  },
  primaryActionBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 11 },
  secondaryActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ecfdf5',
    paddingVertical: 9,
    borderRadius: 10,
    gap: 3,
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  secondaryActionBtnText: { color: '#059669', fontWeight: '700', fontSize: 11 },
  secondaryActionBtnRed: {
    flex: 0.9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fef2f2',
    paddingVertical: 9,
    borderRadius: 10,
    gap: 3,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  secondaryActionBtnRedText: { color: '#dc2626', fontWeight: '700', fontSize: 11 },
  aiActionBtn: {
    flex: 1.1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f3ff',
    paddingVertical: 9,
    borderRadius: 10,
    gap: 3,
    borderWidth: 1,
    borderColor: '#ddd6fe',
  },
  aiActionBtnText: { color: '#7c3aed', fontWeight: '700', fontSize: 11 },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#ffffff',
    gap: 8,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    gap: 4,
  },
  tabBtnActive: { backgroundColor: COLORS.primaryLight },
  tabBtnText: { fontSize: 11, fontWeight: '600', color: '#64748b' },
  tabBtnTextActive: { color: COLORS.primary, fontWeight: '700' },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    height: 40,
  },
  searchInput: { flex: 1, fontSize: 13, color: '#0f172a' },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText: { marginTop: 12, fontSize: 13, color: '#64748b' },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginTop: 12 },
  emptySub: { fontSize: 12, color: '#64748b', textAlign: 'center', marginTop: 4, paddingHorizontal: 20 },
  listContent: { padding: 16, paddingBottom: 60 },
  stockCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  stockCardTop: { flexDirection: 'row', alignItems: 'center' },
  stockIconCircle: { width: 40, height: 40, borderRadius: 10, backgroundColor: COLORS.primaryLight, alignItems: 'center', justifyContent: 'center' },
  itemName: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  itemCategory: { fontSize: 11, color: '#64748b', marginTop: 2 },
  stockLevelBox: { alignItems: 'flex-end' },
  stockAmount: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  lowBadge: { backgroundColor: '#fee2e2', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginTop: 4 },
  lowBadgeText: { fontSize: 9, fontWeight: '800', color: '#dc2626' },
  stockMetaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  metaLabel: { fontSize: 11, color: '#64748b' },
  cardActionsRow: { flexDirection: 'row', gap: 6, marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  actionBtnGreen: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#ecfdf5', paddingVertical: 6, borderRadius: 6, gap: 4 },
  actionBtnGreenText: { fontSize: 11, fontWeight: '700', color: '#059669' },
  actionBtnAmber: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fef3c7', paddingVertical: 6, borderRadius: 6, gap: 4 },
  actionBtnAmberText: { fontSize: 11, fontWeight: '700', color: '#d97706' },
  actionBtnEdit: { flex: 0.8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#eff6ff', paddingVertical: 6, borderRadius: 6, gap: 4 },
  actionBtnEditText: { fontSize: 11, fontWeight: '700', color: '#2563eb' },
  actionBtnDelete: { width: 32, height: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fee2e2', borderRadius: 6 },
  ledgerCard: { backgroundColor: '#ffffff', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#f1f5f9' },
  ledgerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  ledgerBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  ledgerBadgeText: { fontSize: 10, fontWeight: '800' },
  ledgerTime: { fontSize: 10, color: '#94a3b8' },
  ledgerItemName: { fontSize: 14, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  ledgerBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ledgerQty: { fontSize: 14, fontWeight: '800' },
  ledgerStockAudit: { fontSize: 11, color: '#64748b', fontWeight: '600' },
  ledgerNotes: { fontSize: 11, color: '#64748b', marginTop: 4 },
  recipeCard: { backgroundColor: '#ffffff', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9' },
  recipeHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  recipeIconCircle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  recipeTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  recipeSub: { fontSize: 12, color: '#64748b', fontWeight: '700' },
  recipeBadgeGreen: { backgroundColor: '#ecfdf5', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: '#a7f3d0' },
  recipeBadgeGreenText: { color: '#059669', fontSize: 10, fontWeight: '700' },
  recipeBadgeAmber: { backgroundColor: '#fef3c7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: '#fde68a' },
  recipeBadgeAmberText: { color: '#b45309', fontSize: 10, fontWeight: '700' },
  recipeCardActionsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  recipeActionBtnMain: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 8 },
  recipeActionBtnMainText: { color: '#ffffff', fontWeight: '700', fontSize: 12 },
  recipeActionBtnAi: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: '#f5f3ff', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: '#ddd6fe' },
  recipeActionBtnAiText: { color: '#7c3aed', fontWeight: '700', fontSize: 12 },
  recipeEditBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: '#f5f3ff' },
  recipeEditBtnText: { fontSize: 11, fontWeight: '700', color: '#7c3aed' },
  ingredientsList: { backgroundColor: '#f8fafc', padding: 10, borderRadius: 8, marginTop: 6 },
  ingredientRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  ingName: { fontSize: 12, color: '#334155', fontWeight: '600' },
  ingQty: { fontSize: 12, color: '#64748b', fontWeight: '700' },
  addRecipeBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 12, backgroundColor: '#f5f3ff', borderRadius: 12, borderWidth: 1, borderColor: '#ddd6fe' },
  addRecipeBannerText: { fontSize: 13, fontWeight: '700', color: '#7c3aed' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#ffffff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  modalSubHeader: { fontSize: 12, color: '#7c3aed', fontWeight: '600', marginTop: 2 },
  inputLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 4, marginTop: 10 },
  modalInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, color: '#0f172a' },
  modalRow: { flexDirection: 'row', justifyContent: 'space-between' },
  modalSubmitBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 18 },
  modalSubmitBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
  itemSelectChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f1f5f9', marginRight: 8 },
  itemSelectChipActive: { backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#a7f3d0' },
  itemSelectChipText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  itemSelectChipTextActive: { color: '#059669', fontWeight: '700' },
  itemSelectChipActiveRed: { backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fecaca' },
  itemSelectChipTextActiveRed: { color: '#dc2626', fontWeight: '700' },
  itemSelectChipActivePurple: { backgroundColor: '#f5f3ff', borderWidth: 1, borderColor: '#ddd6fe' },
  itemSelectChipTextActivePurple: { color: '#7c3aed', fontWeight: '700' },
  reasonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  reasonChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: '#f1f5f9' },
  reasonChipActive: { backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fca5a5' },
  reasonChipText: { fontSize: 11, fontWeight: '600', color: '#64748b' },
  reasonChipTextActive: { color: '#dc2626', fontWeight: '700' },
  ingredientsHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 6 },
  addIngBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: '#f5f3ff' },
  addIngBtnText: { fontSize: 11, fontWeight: '700', color: '#7c3aed' },
  recipeIngEditCard: { backgroundColor: '#f8fafc', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  recipeIngRowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  ingSelectTrigger: { flex: 1.8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  ingSelectTriggerText: { fontSize: 12, fontWeight: '600', color: '#0f172a', flex: 1 },
  qtyInputBox: { width: 64, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, textAlign: 'center', fontSize: 12, color: '#0f172a' },
  unitSelectTrigger: { width: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#f5f3ff', borderWidth: 1, borderColor: '#ddd6fe', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 8 },
  unitSelectTriggerText: { fontSize: 11, fontWeight: '700', color: '#7c3aed' },
  removeIngBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  recipeIngRowMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 4, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  ingMetaText: { fontSize: 10, color: '#64748b' },
  ingCostText: { fontSize: 10, fontWeight: '700', color: '#059669' },
  dropdownSelectChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
    marginRight: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  dropdownSelectChipActive: {
    backgroundColor: COLORS.primaryLight,
    borderColor: COLORS.primary,
  },
  dropdownSelectChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  dropdownSelectChipTextActive: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  // Ingredient Picker Modal
  pickerSearchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f1f5f9', borderRadius: 8, paddingHorizontal: 10, height: 38, marginBottom: 10 },
  pickerSearchInput: { flex: 1, fontSize: 13, color: '#0f172a' },
  pickerItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  pickerItemName: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  pickerItemCategory: { fontSize: 11, color: '#64748b', marginTop: 1 },
  pickerItemPrice: { fontSize: 12, fontWeight: '700', color: '#059669' },
  // Unit Picker Modal
  centerModalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  unitPickerCard: { width: '85%', backgroundColor: '#ffffff', borderRadius: 16, padding: 18, alignItems: 'center' },
  unitPickerTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 14 },
  unitGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 16 },
  unitChoiceBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: '#f5f3ff', borderWidth: 1, borderColor: '#ddd6fe', minWidth: 60, alignItems: 'center' },
  unitChoiceBtnText: { fontSize: 13, fontWeight: '700', color: '#7c3aed' },
  unitPickerCancelBtn: { paddingVertical: 8, paddingHorizontal: 16 },
  unitPickerCancelText: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  // Smart Recipe AI Modal
  aiSubtitle: { fontSize: 12, color: '#64748b', lineHeight: 16, marginBottom: 10 },
  aiPhotoRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  aiPhotoBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#f5f3ff', paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#ddd6fe' },
  aiPhotoBtnText: { fontSize: 12, fontWeight: '700', color: '#7c3aed' },
  aiImagePreviewBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#e2e8f0', marginTop: 6 },
  aiImageThumbnail: { width: 60, height: 60, borderRadius: 8 },
  aiImageStatus: { fontSize: 12, fontWeight: '700', color: '#0f172a' },
  aiRemovePhotoBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  aiRemovePhotoText: { fontSize: 11, color: '#dc2626', fontWeight: '700' },
  aiDraftCard: { backgroundColor: '#f5f3ff', borderRadius: 12, padding: 14, marginTop: 14, borderWidth: 1, borderColor: '#ddd6fe' },
  aiDraftHeader: { marginBottom: 10 },
  aiDraftTitle: { fontSize: 14, fontWeight: '800', color: '#5b21b6' },
  aiDraftServing: { fontSize: 11, color: '#7c3aed', marginTop: 1 },
  aiDraftSectionTitle: { fontSize: 12, fontWeight: '700', color: '#4c1d95', marginBottom: 6 },
  aiDraftIngRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#ede9fe' },
  aiDraftIngName: { fontSize: 12, fontWeight: '700', color: '#1e1b4b' },
  aiDraftIngMatch: { fontSize: 10, color: '#059669', fontWeight: '600' },
  aiDraftIngQty: { fontSize: 12, fontWeight: '800', color: '#6d28d9' },
  aiApplyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#7c3aed', paddingVertical: 10, borderRadius: 8, marginTop: 12 },
  aiApplyBtnText: { fontSize: 12, fontWeight: '700', color: '#ffffff' },
  // Stock Value Header Card
  stockValueHeaderCard: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'space-between',
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 4
  },
  stockValueCol: { flex: 1, alignItems: 'center' },
  stockValueLabel: { fontSize: 9.5, fontWeight: '800', color: '#059669', letterSpacing: 0.5, marginBottom: 2 },
  stockValueAmount: { fontSize: 16, fontWeight: '900', color: '#0f172a' },
  stockValueSub: { fontSize: 9.5, color: '#64748b', marginTop: 1, fontWeight: '600' },
  stockValueDivider: { width: 1, height: 28, backgroundColor: '#e2e8f0' },
});
