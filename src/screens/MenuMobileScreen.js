import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  TextInput, ActivityIndicator, RefreshControl, Platform,
  Switch, Modal, ScrollView, Alert, Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../lib/supabase';
import { CONFIG } from '../shared/config';
import { COLORS, FONTS, RADIUS, SHADOWS, formatCurrency } from '../lib/theme';

export default function MenuMobileScreen({ route, navigation }) {
  const profile = route?.params?.profile ?? {};
  const [restaurantId, setRestaurantId] = useState(
    profile?.restaurant_id || profile?.restaurants?.id || null
  );

  const [categories, setCategories] = useState([]);
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedItem, setSelectedItem] = useState(null);
  const [updatingItemId, setUpdatingItemId] = useState(null);

  // Add / Edit Item Modal States
  const [showItemModal, setShowItemModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formName, setFormName] = useState('');
  const [formPrice, setFormPrice] = useState('');
  const [formCategoryId, setFormCategoryId] = useState('');
  const [formNewCategoryName, setFormNewCategoryName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formIsVeg, setFormIsVeg] = useState(true);
  const [formVariants, setFormVariants] = useState([]);
  const [formImageUrl, setFormImageUrl] = useState('');
  const [formImageBase64, setFormImageBase64] = useState(null);
  const [savingItem, setSavingItem] = useState(false);

  // Smart Menu AI Scanner Modal States
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiStep, setAiStep] = useState('scan'); // 'scan' | 'extracting' | 'review'
  const [extractedDishes, setExtractedDishes] = useState([]);
  const [publishingAi, setPublishingAi] = useState(false);
  const [editingDishIndex, setEditingDishIndex] = useState(null);
  const [editDishModalVisible, setEditDishModalVisible] = useState(false);
  const [dishEditForm, setDishEditForm] = useState({ name: '', price: '', category_name: '', description: '', is_veg: true });
  const [isProvisioningModalVisible, setIsProvisioningModalVisible] = useState(false);

  // Fetch missing restaurant_id if not in profile params
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
          console.log('[MenuMobile] fetch restaurant_id error:', e?.message);
        }
      }
    }
    fetchMissingRestaurantId();
  }, [restaurantId]);

  // Load Categories & Menu Items
  const loadMenuData = useCallback(async () => {
    if (!restaurantId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      // 1. Fetch Categories
      const { data: catData, error: catErr } = await supabase
        .from('categories')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('sort_order', { ascending: true });

      if (catErr) {
        console.log('[MenuMobile] Fetch categories error:', catErr.message);
      } else {
        setCategories(catData || []);
      }

      // 2. Fetch Menu Items with Variants
      const { data: itemData, error: itemErr } = await supabase
        .from('menu_items')
        .select('*, menu_item_variants(*)')
        .eq('restaurant_id', restaurantId)
        .order('name', { ascending: true });

      if (itemErr) {
        console.log('[MenuMobile] Fetch menu_items error:', itemErr.message);
      } else {
        setMenuItems(itemData || []);
      }
    } catch (e) {
      console.log('[MenuMobile] loadMenuData error:', e?.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    loadMenuData();
  }, [loadMenuData]);

  // Real-time subscription for live menu updates
  useEffect(() => {
    if (!restaurantId) return;

    const channel = supabase
      .channel(`menu-realtime-${restaurantId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'menu_items',
        filter: `restaurant_id=eq.${restaurantId}`
      }, () => {
        loadMenuData();
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'categories',
        filter: `restaurant_id=eq.${restaurantId}`
      }, () => {
        loadMenuData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [restaurantId, loadMenuData]);

  // Toggle item availability (86 item / in-stock)
  const toggleItemAvailability = async (item) => {
    const newStatus = !item.is_available;
    setUpdatingItemId(item.id);

    // Optimistic update
    setMenuItems(prev =>
      prev.map(m => m.id === item.id ? { ...m, is_available: newStatus } : m)
    );

    try {
      const { error } = await supabase
        .from('menu_items')
        .update({ is_available: newStatus, updated_at: new Date().toISOString() })
        .eq('id', item.id)
        .eq('restaurant_id', restaurantId);

      if (error) {
        Alert.alert('Update Failed', error.message);
        // Rollback
        setMenuItems(prev =>
          prev.map(m => m.id === item.id ? { ...m, is_available: item.is_available } : m)
        );
      }
    } catch (e) {
      console.log('[MenuMobile] toggle availability error:', e?.message);
    } finally {
      setUpdatingItemId(null);
    }
  };

  // Helper: Read Base64 from Image/File Asset
  const getAssetBase64 = async (asset) => {
    if (asset.base64) {
      const mime = asset.mimeType || 'image/jpeg';
      return `data:${mime};base64,${asset.base64}`;
    }
    if (asset.uri) {
      const rawBase64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const mime = asset.mimeType || (asset.uri.endsWith('.png') ? 'image/png' : asset.uri.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
      return `data:${mime};base64,${rawBase64}`;
    }
    throw new Error('Could not extract image data from selected file.');
  };

  // Helper: Upload Image to Supabase Storage via backend API
  const uploadDishImageToStorage = async (restId, itemId, dataUrl) => {
    if (!dataUrl) return '';
    if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) return dataUrl;
    try {
      const res = await fetch(`${CONFIG.API_BASE_URL}/api/ai-menu/upload-image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId: restId,
          itemId: itemId || `dish_${Date.now()}`,
          imageUrl: dataUrl,
        }),
      });
      const data = await res.json();
      if (res.ok && data.storageUrl) {
        return data.storageUrl;
      }
    } catch (e) {
      console.log('[Upload Warning] Server upload error:', e?.message);
    }
    return dataUrl;
  };

  // 1. ADD / EDIT DISH MEDIA PICKERS
  const handlePickDishImageCamera = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera access is required to take dish photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const dataUrl = await getAssetBase64(asset);
        setFormImageBase64(dataUrl);
        setFormImageUrl(asset.uri);
      }
    } catch (err) {
      Alert.alert('Camera Error', err?.message || 'Failed to capture photo.');
    }
  };

  const handlePickDishImageGallery = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Photo library access is required to select photos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const dataUrl = await getAssetBase64(asset);
        setFormImageBase64(dataUrl);
        setFormImageUrl(asset.uri);
      }
    } catch (err) {
      Alert.alert('Gallery Error', err?.message || 'Failed to select image.');
    }
  };

  const handleRemoveDishImage = () => {
    setFormImageUrl('');
    setFormImageBase64(null);
  };

  // 2. OPEN ADD / EDIT ITEM MODAL
  const handleOpenItemModal = (item = null) => {
    setEditingItem(item);
    if (item) {
      setFormName(item.name || '');
      setFormPrice(String(item.price || ''));
      setFormCategoryId(item.category_id || categories[0]?.id || '');
      setFormNewCategoryName('');
      setFormDescription(item.description || '');
      setFormIsVeg(item.is_veg !== false);
      setFormImageUrl(item.image_url || '');
      setFormImageBase64(null);
      const vars = item.menu_item_variants || item.variants || [];
      setFormVariants(vars.map(v => ({ name: v.name, price: String(v.price) })));
    } else {
      setFormName('');
      setFormPrice('');
      setFormCategoryId(categories[0]?.id || '');
      setFormNewCategoryName('');
      setFormDescription('');
      setFormIsVeg(true);
      setFormImageUrl('');
      setFormImageBase64(null);
      setFormVariants([]);
    }
    setShowItemModal(true);
  };

  const handleSaveMenuItem = async () => {
    if (!formName.trim() || !formPrice.trim()) {
      Alert.alert('Validation Error', 'Dish name and base price are required.');
      return;
    }

    setSavingItem(true);
    try {
      let targetCategoryId = formCategoryId;

      // Handle custom new category creation if entered
      if (formNewCategoryName.trim()) {
        const { data: newCat, error: catErr } = await supabase
          .from('categories')
          .insert([{
            restaurant_id: restaurantId,
            name: formNewCategoryName.trim(),
            sort_order: categories.length + 1
          }])
          .select()
          .single();

        if (catErr) throw catErr;
        targetCategoryId = newCat.id;
      }

      if (!targetCategoryId && categories.length > 0) {
        targetCategoryId = categories[0].id;
      }

      let finalImageUrl = formImageUrl || null;
      if (formImageBase64) {
        finalImageUrl = await uploadDishImageToStorage(
          restaurantId,
          editingItem?.id || `dish_${Date.now()}`,
          formImageBase64
        );
      }

      const itemPayload = {
        restaurant_id: restaurantId,
        category_id: targetCategoryId,
        name: formName.trim(),
        price: parseFloat(formPrice) || 0,
        description: formDescription.trim() || null,
        is_veg: formIsVeg,
        image_url: finalImageUrl,
        is_available: true,
        updated_at: new Date().toISOString()
      };

      let itemId = editingItem?.id;

      if (itemId) {
        const { error } = await supabase
          .from('menu_items')
          .update(itemPayload)
          .eq('id', itemId)
          .eq('restaurant_id', restaurantId);
        if (error) throw error;
      } else {
        const { data: created, error } = await supabase
          .from('menu_items')
          .insert([itemPayload])
          .select()
          .single();
        if (error) throw error;
        itemId = created.id;
      }

      // Handle Variants (e.g. Half / Full)
      if (itemId) {
        await supabase.from('menu_item_variants').delete().eq('menu_item_id', itemId);
        if (formVariants.length > 0) {
          const variantsToInsert = formVariants
            .filter(v => v.name.trim() && !isNaN(parseFloat(v.price)))
            .map(v => ({
              menu_item_id: itemId,
              name: v.name.trim(),
              price: parseFloat(v.price)
            }));
          if (variantsToInsert.length > 0) {
            await supabase.from('menu_item_variants').insert(variantsToInsert);
          }
        }
      }

      Alert.alert('Success', `Dish "${itemPayload.name}" saved successfully!`);
      setShowItemModal(false);
      setSelectedItem(null);
      await loadMenuData();
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to save menu item.');
    } finally {
      setSavingItem(false);
    }
  };

  // 3. DELETE MENU ITEM HANDLER
  const handleDeleteMenuItem = (item) => {
    Alert.alert(
      'Delete Dish',
      `Are you sure you want to permanently delete "${item.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              const { error } = await supabase
                .from('menu_items')
                .delete()
                .eq('id', item.id)
                .eq('restaurant_id', restaurantId);
              if (error) throw error;
              Alert.alert('Deleted', `"${item.name}" was removed.`);
              setSelectedItem(null);
              await loadMenuData();
            } catch (e) {
              Alert.alert('Error', e?.message || 'Failed to delete dish.');
            }
          }
        }
      ]
    );
  };

  // 4. SMART MENU AI SCANNER HANDLERS (EXACT WEB REUSE - NO MOCK DATA)
  const handleStartAiScan = () => {
    setAiStep('scan');
    setExtractedDishes([]);
    setShowAiModal(true);
  };

  const executeRealAiOcr = async ({ images, textContent }) => {
    let activeRestId = restaurantId;
    
    // Self-Healing 5-Retry Exponential Backoff Profile Loader
    if (!activeRestId) {
      const delays = [500, 1000, 1500, 2000, 2500];
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user?.id) {
            // 1. Fetch profile
            const { data: p } = await supabase.from('profiles').select('restaurant_id, email').eq('id', user.id).maybeSingle();
            if (p?.restaurant_id) {
              activeRestId = p.restaurant_id;
              setRestaurantId(p.restaurant_id);
              break;
            }

            // 2. Self-healing fallback: query restaurants table by owner_id or email
            const { data: matchedRests } = await supabase
              .from('restaurants')
              .select('id, owner_id, settings')
              .order('created_at', { ascending: false })
              .limit(20);

            const foundRest = (matchedRests || []).find(r =>
              r.owner_id === user.id ||
              (p?.email && r.settings?.owner_email?.toLowerCase() === p.email.toLowerCase()) ||
              (user.email && r.settings?.owner_email?.toLowerCase() === user.email.toLowerCase())
            );

            if (foundRest?.id) {
              activeRestId = foundRest.id;
              setRestaurantId(foundRest.id);
              // Auto-link profile
              await supabase.from('profiles').update({ restaurant_id: foundRest.id, role: 'owner' }).eq('id', user.id);
              break;
            }
          }
        } catch (retryErr) {
          console.log(`[Smart Menu AI] Profile retry attempt ${attempt + 1} notice:`, retryErr?.message);
        }
        await new Promise(r => setTimeout(r, delays[attempt]));
      }
    }

    if (!activeRestId) {
      // If still missing, show smooth provisioning fallback modal instead of error
      setIsProvisioningModalVisible(true);
      return;
    }
    setAiStep('extracting');

    try {
      const requestId = `req_mobile_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const res = await fetch(`${CONFIG.API_BASE_URL}/api/ai-menu/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurantId: activeRestId,
          images: images || [],
          textContent: textContent || '',
          requestId
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success || !data.categories || data.categories.length === 0) {
        const errorMsg = data.message || data.error || 'Could not read menu items from the uploaded file. Please try a clearer photo.';
        Alert.alert('OCR Analysis Failed', errorMsg);
        setAiStep('scan');
        return;
      }

      const flatDishes = [];
      data.categories.forEach(cat => {
        const catName = cat.name || 'General';
        (cat.items || []).forEach(item => {
          flatDishes.push({
            id: item.id || `dish_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            name: item.name || 'Unnamed Dish',
            category_name: catName,
            price: String(item.price !== undefined && item.price !== null ? item.price : 0),
            description: item.description || '',
            is_veg: item.is_veg !== false,
            has_variants: item.has_variants || false,
            variants: item.variants || []
          });
        });
      });

      if (flatDishes.length === 0) {
        Alert.alert('OCR Result', 'No dishes could be detected in this menu. Please try another page.');
        setAiStep('scan');
        return;
      }

      setExtractedDishes(flatDishes);
      setAiStep('review');
    } catch (err) {
      console.log('[Smart Menu AI Error]', err);
      Alert.alert('Connection Error', err?.message || 'Failed to connect to Smart Menu AI server. Please check your internet connection.');
      setAiStep('scan');
    }
  };

  // Option 1: Capture Menu via Camera
  const handleAiCaptureCamera = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Camera permission is required to photograph physical menus.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const dataUrl = await getAssetBase64(asset);
        await executeRealAiOcr({
          images: [{ base64: dataUrl, type: asset.mimeType || 'image/jpeg', name: 'camera_menu.jpg' }],
          textContent: ''
        });
      }
    } catch (e) {
      Alert.alert('Camera Error', e?.message || 'Failed to capture photo.');
    }
  };

  // Option 2: Upload Image Files from Gallery (Single / Multiple)
  const handleAiUploadImages = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Gallery permission is required to select menu photos.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 0.8,
        base64: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const imagePayloads = await Promise.all(
          result.assets.map(async (asset, idx) => {
            const dataUrl = await getAssetBase64(asset);
            return {
              base64: dataUrl,
              type: asset.mimeType || 'image/jpeg',
              name: `gallery_page_${idx + 1}.jpg`
            };
          })
        );
        await executeRealAiOcr({
          images: imagePayloads,
          textContent: ''
        });
      }
    } catch (e) {
      Alert.alert('Gallery Error', e?.message || 'Failed to select image.');
    }
  };

  // Option 3: Upload Document (PDF / TXT)
  const handleAiUploadDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain'],
        copyToCacheDirectory: true,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const fileName = asset.name || 'document';
        if (fileName.endsWith('.txt') || asset.mimeType === 'text/plain') {
          const text = await FileSystem.readAsStringAsync(asset.uri);
          await executeRealAiOcr({
            images: [],
            textContent: text
          });
        } else {
          const rawBase64 = await FileSystem.readAsStringAsync(asset.uri, {
            encoding: FileSystem.EncodingType.Base64,
          });
          const pdfDataUrl = `data:application/pdf;base64,${rawBase64}`;
          await executeRealAiOcr({
            images: [{ base64: pdfDataUrl, type: 'application/pdf', name: fileName }],
            textContent: ''
          });
        }
      }
    } catch (e) {
      Alert.alert('Document Error', e?.message || 'Failed to select document.');
    }
  };

  const handleOpenDishEditor = (index) => {
    const d = extractedDishes[index];
    if (!d) return;
    setEditingDishIndex(index);
    setDishEditForm({
      name: d.name,
      price: String(d.price || ''),
      category_name: d.category_name,
      description: d.description || '',
      is_veg: d.is_veg !== false
    });
    setEditDishModalVisible(true);
  };

  const handleSaveDishEdit = () => {
    if (editingDishIndex === null) return;
    const updated = [...extractedDishes];
    updated[editingDishIndex] = {
      ...updated[editingDishIndex],
      name: dishEditForm.name.trim() || updated[editingDishIndex].name,
      price: dishEditForm.price.trim() || updated[editingDishIndex].price,
      category_name: dishEditForm.category_name.trim() || updated[editingDishIndex].category_name,
      description: dishEditForm.description.trim() || updated[editingDishIndex].description,
      is_veg: dishEditForm.is_veg
    };
    setExtractedDishes(updated);
    setEditDishModalVisible(false);
    setEditingDishIndex(null);
  };

  const handleDeleteExtractedDish = (index) => {
    setExtractedDishes(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddNewExtractedDish = () => {
    const newDish = {
      id: `ai-custom-${Date.now()}`,
      category_name: categories[0]?.name || 'Main Course',
      name: 'New Custom Dish',
      description: 'Chef special prepared fresh upon order.',
      price: '150',
      is_veg: true
    };
    setExtractedDishes(prev => [newDish, ...prev]);
  };

  const handlePublishExtractedDishes = async () => {
    let activeRestId = restaurantId;
    if (!activeRestId) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) {
          const { data: p } = await supabase.from('profiles').select('restaurant_id').eq('id', user.id).maybeSingle();
          if (p?.restaurant_id) activeRestId = p.restaurant_id;
        }
      } catch (e) {}
    }

    if (!activeRestId || extractedDishes.length === 0) {
      Alert.alert('Error', 'Restaurant ID not found. Please log out and log in again.');
      return;
    }

    setPublishingAi(true);
    try {
      // 1. Fetch current categories for restaurant
      const { data: currentCats } = await supabase
        .from('categories')
        .select('*')
        .eq('restaurant_id', activeRestId);

      const catMap = {};
      (currentCats || []).forEach(c => {
        catMap[c.name.toLowerCase().trim()] = c.id;
      });

      for (const d of extractedDishes) {
        const catClean = (d.category_name || 'General').trim();
        const key = catClean.toLowerCase();

        if (!catMap[key]) {
          // Check if category exists case-insensitively
          const { data: existingCat } = await supabase
            .from('categories')
            .select('id')
            .eq('restaurant_id', activeRestId)
            .ilike('name', catClean)
            .maybeSingle();

          if (existingCat?.id) {
            catMap[key] = existingCat.id;
          } else {
            const { data: newC } = await supabase
              .from('categories')
              .insert([{ restaurant_id: activeRestId, name: catClean, sort_order: Object.keys(catMap).length + 1 }])
              .select()
              .maybeSingle();

            if (newC?.id) {
              catMap[key] = newC.id;
            } else {
              // Retry query fallback
              const { data: retryCat } = await supabase
                .from('categories')
                .select('id')
                .eq('restaurant_id', activeRestId)
                .limit(1)
                .maybeSingle();
              if (retryCat?.id) catMap[key] = retryCat.id;
            }
          }
        }
      }

      // 2. Insert items
      for (const d of extractedDishes) {
        const catId = catMap[(d.category_name || 'General').trim().toLowerCase()] || categories[0]?.id;
        if (catId) {
          await supabase.from('menu_items').insert([{
            restaurant_id: restaurantId,
            category_id: catId,
            name: d.name.trim(),
            price: parseFloat(d.price) || 0,
            description: d.description || null,
            is_veg: d.is_veg !== false,
            is_available: true
          }]);
        }
      }

      Alert.alert('AI Import Successful', `Published ${extractedDishes.length} dishes to your menu!`);
      setShowAiModal(false);
      await loadMenuData();
    } catch (e) {
      Alert.alert('Error', e?.message || 'Failed to publish extracted menu items.');
    } finally {
      setPublishingAi(false);
    }
  };

  // Filter items
  const filteredItems = menuItems.filter(item => {
    const matchesCategory = selectedCategory === 'all' || item.category_id === selectedCategory;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch = !q ||
      item.name?.toLowerCase().includes(q) ||
      item.description?.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  const getCategoryName = (catId) => {
    const cat = categories.find(c => c.id === catId);
    return cat ? cat.name : 'General';
  };

  const renderItem = ({ item }) => {
    const variants = item.menu_item_variants || item.variants || [];
    const isUpdating = updatingItemId === item.id;

    return (
      <TouchableOpacity
        style={[
          styles.itemCard,
          !item.is_available && styles.itemCardDisabled
        ]}
        onPress={() => setSelectedItem(item)}
        activeOpacity={0.7}
      >
        <View style={styles.itemCardContent}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {!!item.image_url && (
              <Image source={{ uri: item.image_url }} style={styles.dishListThumb} />
            )}
            <View style={{ flex: 1 }}>
              {/* Veg / Non-Veg Icon & Title */}
              <View style={styles.itemHeaderRow}>
                <View style={[styles.vegBadge, item.is_veg ? styles.vegBorder : styles.nonVegBorder]}>
                  <View style={[styles.vegDot, item.is_veg ? styles.vegDotColor : styles.nonVegDotColor]} />
                </View>

                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={[styles.itemName, !item.is_available && styles.textDisabled]}>
                    {item.name}
                  </Text>
                  <Text style={styles.itemCategoryBadge}>
                    {getCategoryName(item.category_id)}
                  </Text>
                </View>

                {/* In-Stock / 86 Toggle */}
                <View style={styles.toggleWrap}>
                  {isUpdating ? (
                    <ActivityIndicator size="small" color={COLORS.primary} />
                  ) : (
                    <Switch
                      value={item.is_available !== false}
                      onValueChange={() => toggleItemAvailability(item)}
                      trackColor={{ false: '#e2e8f0', true: '#a7f3d0' }}
                      thumbColor={item.is_available !== false ? COLORS.primary : '#94a3b8'}
                      style={{ transform: [{ scaleX: 0.85 }, { scaleY: 0.85 }] }}
                    />
                  )}
                </View>
              </View>

              {/* Description */}
              {!!item.description && (
                <Text style={styles.itemDesc} numberOfLines={2}>
                  {item.description}
                </Text>
              )}

              {/* Price & Variant count */}
              <View style={styles.itemFooterRow}>
                <Text style={[styles.itemPrice, !item.is_available && styles.textDisabled]}>
                  {formatCurrency(item.price)}
                </Text>

                {variants.length > 0 && (
                  <View style={styles.variantTag}>
                    <Ionicons name="layers-outline" size={12} color="#059669" />
                    <Text style={styles.variantTagText}>{variants.length} Variants</Text>
                  </View>
                )}

                <View style={[
                  styles.statusPill,
                  item.is_available !== false ? styles.statusPillAvailable : styles.statusPillOut
                ]}>
                  <Text style={[
                    styles.statusPillText,
                    item.is_available !== false ? styles.statusPillTextAvailable : styles.statusPillTextOut
                  ]}>
                    {item.is_available !== false ? 'IN STOCK' : 'OUT OF STOCK (86)'}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Menu Management</Text>
          <Text style={styles.headerSub}>
            {menuItems.length} items · {categories.length} categories
          </Text>
        </View>
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => { setRefreshing(true); loadMenuData(); }}
          activeOpacity={0.7}
        >
          <Feather name="refresh-cw" size={18} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      {/* Top Action Buttons (Add Dish + Smart Menu AI) */}
      <View style={styles.topActionBar}>
        <TouchableOpacity
          style={styles.primaryAddBtn}
          onPress={() => handleOpenItemModal()}
        >
          <Ionicons name="add-circle" size={18} color="#ffffff" />
          <Text style={styles.primaryAddBtnText}>Add Dish</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.aiSmartMenuBtn}
          onPress={handleStartAiScan}
        >
          <MaterialCommunityIcons name="auto-fix" size={18} color="#7c3aed" />
          <Text style={styles.aiSmartMenuBtnText}>Smart Menu AI</Text>
        </TouchableOpacity>
      </View>

      {/* Search Input */}
      <View style={styles.searchBarContainer}>
        <Feather name="search" size={18} color="#94a3b8" style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search items by name or description..."
          placeholderTextColor="#94a3b8"
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Ionicons name="close-circle" size={18} color="#94a3b8" />
          </TouchableOpacity>
        )}
      </View>

      {/* Categories Horizontal Scroll */}
      <View style={styles.categoriesContainer}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoriesScroll}
        >
          <TouchableOpacity
            style={[
              styles.categoryChip,
              selectedCategory === 'all' && styles.categoryChipActive
            ]}
            onPress={() => setSelectedCategory('all')}
          >
            <Text style={[
              styles.categoryChipText,
              selectedCategory === 'all' && styles.categoryChipTextActive
            ]}>
              All Items ({menuItems.length})
            </Text>
          </TouchableOpacity>

          {categories.map(cat => {
            const count = menuItems.filter(m => m.category_id === cat.id).length;
            const isSelected = selectedCategory === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[
                  styles.categoryChip,
                  isSelected && styles.categoryChipActive
                ]}
                onPress={() => setSelectedCategory(cat.id)}
              >
                <Text style={[
                  styles.categoryChipText,
                  isSelected && styles.categoryChipTextActive
                ]}>
                  {cat.name} ({count})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Menu Item List */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading menu catalog...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadMenuData(); }}
              colors={[COLORS.primary]}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="silverware-fork-knife" size={48} color="#cbd5e1" />
              <Text style={styles.emptyTitle}>No menu items found</Text>
              <Text style={styles.emptySub}>
                {searchQuery ? 'Try adjusting your search criteria.' : 'Tap "Add Dish" or "Smart Menu AI" to add items.'}
              </Text>
            </View>
          }
        />
      )}

      {/* 1. ITEM DETAIL & ACTIONS MODAL */}
      <Modal
        visible={selectedItem !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedItem(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {selectedItem && (
              <>
                <View style={styles.modalHeader}>
                  <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={[styles.vegBadge, selectedItem.is_veg ? styles.vegBorder : styles.nonVegBorder]}>
                      <View style={[styles.vegDot, selectedItem.is_veg ? styles.vegDotColor : styles.nonVegDotColor]} />
                    </View>
                    <Text style={styles.modalTitle} numberOfLines={1}>{selectedItem.name}</Text>
                  </View>
                  <TouchableOpacity onPress={() => setSelectedItem(null)} style={styles.modalCloseBtn}>
                    <Ionicons name="close" size={20} color="#64748b" />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                  {!!selectedItem.image_url && (
                    <Image source={{ uri: selectedItem.image_url }} style={styles.dishModalDetailImage} />
                  )}

                  {/* Category & Availability Banner */}
                  <View style={styles.modalMetaRow}>
                    <Text style={styles.modalCategoryName}>
                      Category: {getCategoryName(selectedItem.category_id)}
                    </Text>
                    <View style={[
                      styles.statusPill,
                      selectedItem.is_available !== false ? styles.statusPillAvailable : styles.statusPillOut
                    ]}>
                      <Text style={[
                        styles.statusPillText,
                        selectedItem.is_available !== false ? styles.statusPillTextAvailable : styles.statusPillTextOut
                      ]}>
                        {selectedItem.is_available !== false ? 'IN STOCK' : 'OUT OF STOCK (86)'}
                      </Text>
                    </View>
                  </View>

                  {/* Base Price */}
                  <View style={styles.priceRow}>
                    <Text style={styles.priceLabel}>Base Price:</Text>
                    <Text style={styles.priceValue}>{formatCurrency(selectedItem.price)}</Text>
                  </View>

                  {/* Description */}
                  {!!selectedItem.description && (
                    <View style={styles.detailSection}>
                      <Text style={styles.sectionLabel}>DESCRIPTION</Text>
                      <Text style={styles.detailText}>{selectedItem.description}</Text>
                    </View>
                  )}

                  {/* Variants / Portions */}
                  {(selectedItem.menu_item_variants || selectedItem.variants || []).length > 0 && (
                    <View style={styles.detailSection}>
                      <Text style={styles.sectionLabel}>VARIANTS & PORTIONS</Text>
                      {(selectedItem.menu_item_variants || selectedItem.variants || []).map((v, i) => (
                        <View key={v.id || i} style={styles.variantItem}>
                          <Text style={styles.variantName}>{v.name}</Text>
                          <Text style={styles.variantPrice}>{formatCurrency(v.price)}</Text>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Stock Toggle Action */}
                  <TouchableOpacity
                    style={[
                      styles.toggleStockBtn,
                      selectedItem.is_available !== false ? styles.toggleStockBtnOut : styles.toggleStockBtnIn
                    ]}
                    onPress={async () => {
                      await toggleItemAvailability(selectedItem);
                      setSelectedItem(prev => prev ? { ...prev, is_available: !prev.is_available } : null);
                    }}
                  >
                    <Ionicons
                      name={selectedItem.is_available !== false ? "close-circle-outline" : "checkmark-circle-outline"}
                      size={18}
                      color="#ffffff"
                      style={{ marginRight: 6 }}
                    />
                    <Text style={styles.toggleStockBtnText}>
                      {selectedItem.is_available !== false ? 'Mark as Out of Stock (86)' : 'Restore to In Stock'}
                    </Text>
                  </TouchableOpacity>

                  {/* Edit & Delete Action Buttons */}
                  <View style={styles.modalActionButtonsRow}>
                    <TouchableOpacity
                      style={styles.modalEditBtn}
                      onPress={() => {
                        const it = selectedItem;
                        setSelectedItem(null);
                        handleOpenItemModal(it);
                      }}
                    >
                      <Feather name="edit-2" size={16} color="#2563eb" />
                      <Text style={styles.modalEditBtnText}>Edit Dish</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={styles.modalDeleteBtn}
                      onPress={() => handleDeleteMenuItem(selectedItem)}
                    >
                      <Feather name="trash" size={16} color="#dc2626" />
                      <Text style={styles.modalDeleteBtnText}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* 2. ADD / EDIT DISH MODAL (WITH CAMERA + GALLERY UPLOAD + REMOVE) */}
      <Modal visible={showItemModal} transparent animationType="slide" onRequestClose={() => setShowItemModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingItem ? 'Edit Dish' : 'Add New Dish'}</Text>
              <TouchableOpacity onPress={() => setShowItemModal(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>Dish Name *</Text>
              <TextInput
                style={styles.textInput}
                placeholder="e.g. Paneer Butter Masala"
                value={formName}
                onChangeText={setFormName}
              />

              {/* Dish Image Section with Camera + Upload Gallery + Remove */}
              <Text style={styles.inputLabel}>Dish Image (Optional)</Text>
              {formImageBase64 || formImageUrl ? (
                <View style={styles.dishImagePreviewCard}>
                  <Image source={{ uri: formImageBase64 || formImageUrl }} style={styles.dishImagePreview} />
                  <View style={styles.dishImageButtonsRow}>
                    <TouchableOpacity style={styles.imageActionBtn} onPress={handlePickDishImageCamera}>
                      <Ionicons name="camera-outline" size={14} color="#2563eb" />
                      <Text style={styles.imageActionBtnText}>Camera</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.imageActionBtn} onPress={handlePickDishImageGallery}>
                      <Ionicons name="image-outline" size={14} color="#2563eb" />
                      <Text style={styles.imageActionBtnText}>Gallery</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.imageActionBtn, styles.imageActionBtnDelete]} onPress={handleRemoveDishImage}>
                      <Ionicons name="trash-outline" size={14} color="#dc2626" />
                      <Text style={[styles.imageActionBtnText, { color: '#dc2626' }]}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.noImagePickerBox}>
                  <Text style={styles.noImageText}>Add dish photo from camera or gallery</Text>
                  <View style={styles.noImageBtnsRow}>
                    <TouchableOpacity style={styles.pickerChoiceBtn} onPress={handlePickDishImageCamera}>
                      <Ionicons name="camera" size={16} color="#7c3aed" />
                      <Text style={styles.pickerChoiceBtnText}>Camera</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.pickerChoiceBtn} onPress={handlePickDishImageGallery}>
                      <Ionicons name="images" size={16} color="#7c3aed" />
                      <Text style={styles.pickerChoiceBtnText}>Upload Image</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>Base Price (₹) *</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="250"
                    keyboardType="numeric"
                    value={formPrice}
                    onChangeText={setFormPrice}
                  />
                </View>
                <View style={{ flex: 1, justifyContent: 'center', paddingTop: 16 }}>
                  <TouchableOpacity
                    style={[styles.vegToggleBtn, formIsVeg ? styles.vegToggleActive : styles.nonVegToggleActive]}
                    onPress={() => setFormIsVeg(!formIsVeg)}
                  >
                    <View style={[styles.vegBadge, formIsVeg ? styles.vegBorder : styles.nonVegBorder]}>
                      <View style={[styles.vegDot, formIsVeg ? styles.vegDotColor : styles.nonVegDotColor]} />
                    </View>
                    <Text style={styles.vegToggleText}>{formIsVeg ? 'VEGETARIAN' : 'NON-VEG'}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.inputLabel}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                {categories.map(c => (
                  <TouchableOpacity
                    key={c.id}
                    style={[styles.catSelectChip, formCategoryId === c.id && styles.catSelectChipActive]}
                    onPress={() => { setFormCategoryId(c.id); setFormNewCategoryName(''); }}
                  >
                    <Text style={[styles.catSelectChipText, formCategoryId === c.id && styles.catSelectChipTextActive]}>
                      {c.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <TextInput
                style={styles.textInput}
                placeholder="Or type new category name..."
                value={formNewCategoryName}
                onChangeText={setFormNewCategoryName}
              />

              <Text style={styles.inputLabel}>Description</Text>
              <TextInput
                style={[styles.textInput, { height: 64, textAlignVertical: 'top' }]}
                placeholder="Dish description, ingredients, taste notes..."
                multiline
                value={formDescription}
                onChangeText={setFormDescription}
              />

              {/* Variants Section (Half / Full) */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <Text style={styles.inputLabel}>Variants / Portions</Text>
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                  onPress={() => setFormVariants(prev => [...prev, { name: prev.length === 0 ? 'Half' : 'Full', price: '' }])}
                >
                  <Ionicons name="add-circle" size={16} color={COLORS.primary} />
                  <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.primary }}>Add Variant</Text>
                </TouchableOpacity>
              </View>

              {formVariants.map((v, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  <TextInput
                    style={[styles.textInput, { flex: 1.5 }]}
                    placeholder="e.g. Half / Full"
                    value={v.name}
                    onChangeText={(val) => {
                      const updated = [...formVariants];
                      updated[i].name = val;
                      setFormVariants(updated);
                    }}
                  />
                  <TextInput
                    style={[styles.textInput, { flex: 1 }]}
                    placeholder="₹ Price"
                    keyboardType="numeric"
                    value={v.price}
                    onChangeText={(val) => {
                      const updated = [...formVariants];
                      updated[i].price = val;
                      setFormVariants(updated);
                    }}
                  />
                  <TouchableOpacity
                    style={{ justifyContent: 'center', paddingHorizontal: 6 }}
                    onPress={() => setFormVariants(prev => prev.filter((_, idx) => idx !== i))}
                  >
                    <Ionicons name="trash-outline" size={18} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              ))}

              <TouchableOpacity
                style={styles.modalSubmitBtn}
                onPress={handleSaveMenuItem}
                disabled={savingItem}
              >
                {savingItem ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.modalSubmitBtnText}>{editingItem ? 'Save Changes' : 'Publish Dish'}</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 3. SMART MENU BY CLEVEROPS AI SCANNER MODAL (EXACT SAME AS WEB) */}
      <Modal visible={showAiModal} transparent animationType="slide" onRequestClose={() => setShowAiModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '90%' }]}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialCommunityIcons name="auto-fix" size={22} color="#7c3aed" />
                <Text style={styles.modalTitle}>Smart Menu AI Digitizer</Text>
              </View>
              <TouchableOpacity onPress={() => setShowAiModal(false)}>
                <Ionicons name="close" size={22} color="#64748b" />
              </TouchableOpacity>
            </View>

            {aiStep === 'scan' ? (
              <ScrollView style={{ paddingVertical: 6 }} showsVerticalScrollIndicator={false}>
                <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 14 }}>
                  Choose how you want to digitize your restaurant menu:
                </Text>

                {/* 3 Main Action Cards (Exact same as Web) */}
                <View style={{ gap: 10 }}>
                  {/* Card 1: Capture Menu (Mobile Camera) */}
                  <TouchableOpacity
                    style={styles.aiWebCard}
                    onPress={handleAiCaptureCamera}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.aiWebCardIconBox, { backgroundColor: '#10b981' }]}>
                      <Ionicons name="camera" size={24} color="#ffffff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={styles.aiWebCardTitle}>Capture Menu</Text>
                        <Text style={styles.aiWebCardBadge}>Camera</Text>
                      </View>
                      <Text style={styles.aiWebCardDesc}>
                        Photograph physical menu, printed card, or board directly.
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {/* Card 2: Upload Image Files (Gallery) */}
                  <TouchableOpacity
                    style={styles.aiWebCard}
                    onPress={handleAiUploadImages}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.aiWebCardIconBox, { backgroundColor: '#3b82f6' }]}>
                      <Ionicons name="images" size={24} color="#ffffff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={styles.aiWebCardTitle}>Upload Image Files</Text>
                        <Text style={[styles.aiWebCardBadge, { color: '#2563eb', backgroundColor: '#dbeafe' }]}>Single / Multi</Text>
                      </View>
                      <Text style={styles.aiWebCardDesc}>
                        Select one or multiple menu page photos from gallery.
                      </Text>
                    </View>
                  </TouchableOpacity>

                  {/* Card 3: Upload Document (PDF / TXT) */}
                  <TouchableOpacity
                    style={styles.aiWebCard}
                    onPress={handleAiUploadDocument}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.aiWebCardIconBox, { backgroundColor: '#8b5cf6' }]}>
                      <Ionicons name="document-text" size={24} color="#ffffff" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={styles.aiWebCardTitle}>Upload Document</Text>
                        <Text style={[styles.aiWebCardBadge, { color: '#7c3aed', backgroundColor: '#ede9fe' }]}>PDF / TXT</Text>
                      </View>
                      <Text style={styles.aiWebCardDesc}>
                        Upload digital menu PDF or plain text menu file.
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : aiStep === 'extracting' ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <ActivityIndicator size="large" color="#7c3aed" />
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f172a', marginTop: 16 }}>
                  Reading Menu with Gemini Vision OCR...
                </Text>
                <Text style={{ fontSize: 12, color: '#64748b', marginTop: 4, textAlign: 'center' }}>
                  Extracting categories, dishes, prices & portion sizes...
                </Text>
              </View>
            ) : (
              <View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#0f172a' }}>
                    OCR Preview ({extractedDishes.length} dishes detected)
                  </Text>
                  <TouchableOpacity
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                    onPress={handleAddNewExtractedDish}
                  >
                    <Ionicons name="add-circle" size={16} color="#7c3aed" />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#7c3aed' }}>+ Add Item</Text>
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
                  {extractedDishes.map((dish, i) => (
                    <View key={dish.id || i} style={styles.aiDishCard}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <View style={[styles.vegBadge, dish.is_veg ? styles.vegBorder : styles.nonVegBorder]}>
                              <View style={[styles.vegDot, dish.is_veg ? styles.vegDotColor : styles.nonVegDotColor]} />
                            </View>
                            <Text style={{ fontSize: 14, fontWeight: '700', color: '#0f172a' }}>
                              {dish.name}
                            </Text>
                          </View>
                          <Text style={{ fontSize: 11, color: '#7c3aed', marginTop: 2, fontWeight: '600' }}>
                            {dish.category_name}
                          </Text>
                        </View>

                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ fontSize: 14, fontWeight: '800', color: '#059669' }}>
                            ₹{dish.price}
                          </Text>
                          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                            <TouchableOpacity onPress={() => handleOpenDishEditor(i)}>
                              <Ionicons name="create-outline" size={16} color="#2563eb" />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => handleDeleteExtractedDish(i)}>
                              <Ionicons name="trash-outline" size={16} color="#ef4444" />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                      {!!dish.description && (
                        <Text style={{ fontSize: 11, color: '#64748b', marginTop: 4 }} numberOfLines={2}>
                          {dish.description}
                        </Text>
                      )}
                    </View>
                  ))}
                </ScrollView>

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <TouchableOpacity
                    style={[styles.modalSubmitBtn, { flex: 1, backgroundColor: '#f1f5f9' }]}
                    onPress={() => setAiStep('scan')}
                  >
                    <Text style={{ color: '#475569', fontWeight: '700', fontSize: 13 }}>← Rescan</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.modalSubmitBtn, { flex: 2, backgroundColor: '#7c3aed' }]}
                    onPress={handlePublishExtractedDishes}
                    disabled={publishingAi}
                  >
                    {publishingAi ? (
                      <ActivityIndicator color="#ffffff" />
                    ) : (
                      <Text style={styles.modalSubmitBtnText}>Publish ({extractedDishes.length}) to Menu</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Quick Edit Extracted Dish Modal */}
      <Modal visible={editDishModalVisible} transparent animationType="fade" onRequestClose={() => setEditDishModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '80%' }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Dish Before Publish</Text>
              <TouchableOpacity onPress={() => setEditDishModalVisible(false)}>
                <Ionicons name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.inputLabel}>Dish Name *</Text>
              <TextInput
                style={styles.textInput}
                value={dishEditForm.name}
                onChangeText={(val) => setDishEditForm(prev => ({ ...prev, name: val }))}
              />

              <Text style={styles.inputLabel}>Category Name *</Text>
              <TextInput
                style={styles.textInput}
                value={dishEditForm.category_name}
                onChangeText={(val) => setDishEditForm(prev => ({ ...prev, category_name: val }))}
              />

              <Text style={styles.inputLabel}>Price (₹) *</Text>
              <TextInput
                style={styles.textInput}
                keyboardType="numeric"
                value={dishEditForm.price}
                onChangeText={(val) => setDishEditForm(prev => ({ ...prev, price: val }))}
              />

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 10 }}>
                <Text style={styles.inputLabel}>Vegetarian</Text>
                <Switch
                  value={dishEditForm.is_veg}
                  onValueChange={(val) => setDishEditForm(prev => ({ ...prev, is_veg: val }))}
                  trackColor={{ false: '#e2e8f0', true: '#a7f3d0' }}
                  thumbColor={dishEditForm.is_veg ? '#16a34a' : '#94a3b8'}
                />
              </View>

              <Text style={styles.inputLabel}>Description</Text>
              <TextInput
                style={[styles.textInput, { height: 50 }]}
                multiline
                value={dishEditForm.description}
                onChangeText={(val) => setDishEditForm(prev => ({ ...prev, description: val }))}
              />

              <TouchableOpacity
                style={[styles.modalSubmitBtn, { backgroundColor: '#7c3aed', marginTop: 12 }]}
                onPress={handleSaveDishEdit}
              >
                <Text style={styles.modalSubmitBtnText}>Save Dish</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* PROVISIONING LOADING FLOW MODAL */}
      <Modal visible={isProvisioningModalVisible} transparent animationType="fade" onRequestClose={() => setIsProvisioningModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.75)', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#ffffff', borderRadius: 20, padding: 28, width: '100%', maxWidth: 360, alignItems: 'center' }}>
            <ActivityIndicator size="large" color="#059669" style={{ marginBottom: 16 }} />
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#0f172a', marginBottom: 6, textAlign: 'center' }}>Setting Up Your Account...</Text>
            <Text style={{ fontSize: 13, color: '#64748b', textAlign: 'center', marginBottom: 20 }}>Provisioning your restaurant workspace & digital menu.</Text>
            
            <View style={{ width: '100%', gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="checkmark-circle" size={18} color="#059669" />
                <Text style={{ fontSize: 13, color: '#334155', fontWeight: '600' }}>Creating Restaurant Workspace</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="checkmark-circle" size={18} color="#059669" />
                <Text style={{ fontSize: 13, color: '#334155', fontWeight: '600' }}>Setting up Digital Menu & Tables</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator size="small" color="#2563eb" />
                <Text style={{ fontSize: 13, color: '#2563eb', fontWeight: '700' }}>Linking Profile & Account</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Ionicons name="ellipse-outline" size={18} color="#94a3b8" />
                <Text style={{ fontSize: 13, color: '#94a3b8' }}>Syncing Account Credentials</Text>
              </View>
            </View>

            <TouchableOpacity
              style={{ marginTop: 24, backgroundColor: '#f1f5f9', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10 }}
              onPress={() => setIsProvisioningModalVisible(false)}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>Close & Retry</Text>
            </TouchableOpacity>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  headerSub: { fontSize: 11, color: '#64748b', marginTop: 1 },
  refreshBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center' },
  topActionBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  primaryAddBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  primaryAddBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  aiSmartMenuBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f5f3ff',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: '#ddd6fe',
  },
  aiSmartMenuBtnText: { color: '#7c3aed', fontWeight: '700', fontSize: 13 },
  searchBarContainer: {
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
  categoriesContainer: { backgroundColor: '#ffffff', paddingBottom: 8 },
  categoriesScroll: { paddingHorizontal: 16, gap: 6 },
  categoryChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: '#f1f5f9' },
  categoryChipActive: { backgroundColor: COLORS.primaryLight },
  categoryChipText: { fontSize: 12, fontWeight: '600', color: '#64748b' },
  categoryChipTextActive: { color: COLORS.primary, fontWeight: '700' },
  listContent: { padding: 16, paddingBottom: 60 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  loadingText: { marginTop: 12, fontSize: 13, color: '#64748b' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginTop: 12 },
  emptySub: { fontSize: 12, color: '#64748b', textAlign: 'center', marginTop: 4 },
  itemCard: { backgroundColor: '#ffffff', borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#f1f5f9', elevation: 1 },
  itemCardDisabled: { opacity: 0.65, backgroundColor: '#f8fafc' },
  itemCardContent: {},
  dishListThumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: '#f1f5f9' },
  dishModalDetailImage: { width: '100%', height: 160, borderRadius: 12, marginBottom: 12, backgroundColor: '#f1f5f9' },
  itemHeaderRow: { flexDirection: 'row', alignItems: 'center' },
  vegBadge: { width: 14, height: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', borderRadius: 2 },
  vegBorder: { borderColor: '#16a34a' },
  nonVegBorder: { borderColor: '#dc2626' },
  vegDot: { width: 6, height: 6, borderRadius: 3 },
  vegDotColor: { backgroundColor: '#16a34a' },
  nonVegDotColor: { backgroundColor: '#dc2626' },
  itemName: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  itemCategoryBadge: { fontSize: 11, color: '#64748b', marginTop: 1 },
  textDisabled: { color: '#94a3b8', textDecorationLine: 'line-through' },
  toggleWrap: { marginLeft: 8 },
  itemDesc: { fontSize: 12, color: '#64748b', marginTop: 6, lineHeight: 17 },
  itemFooterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f1f5f9' },
  itemPrice: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  variantTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#ecfdf5', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  variantTagText: { fontSize: 10, fontWeight: '700', color: '#059669' },
  statusPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  statusPillAvailable: { backgroundColor: '#ecfdf5' },
  statusPillOut: { backgroundColor: '#fee2e2' },
  statusPillText: { fontSize: 9, fontWeight: '800' },
  statusPillTextAvailable: { color: '#059669' },
  statusPillTextOut: { color: '#dc2626' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#ffffff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { fontSize: 17, fontWeight: '700', color: '#0f172a' },
  modalCloseBtn: { padding: 4 },
  modalMetaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalCategoryName: { fontSize: 13, color: '#64748b', fontWeight: '600' },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  priceLabel: { fontSize: 13, color: '#64748b' },
  priceValue: { fontSize: 16, fontWeight: '800', color: '#0f172a' },
  detailSection: { marginTop: 12 },
  sectionLabel: { fontSize: 10, fontWeight: '800', color: '#94a3b8', letterSpacing: 0.5, marginBottom: 4 },
  detailText: { fontSize: 13, color: '#334155', lineHeight: 18 },
  variantItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  variantName: { fontSize: 13, color: '#0f172a' },
  variantPrice: { fontSize: 13, fontWeight: '700', color: '#059669' },
  toggleStockBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingVertical: 12, marginTop: 16 },
  toggleStockBtnOut: { backgroundColor: '#dc2626' },
  toggleStockBtnIn: { backgroundColor: '#059669' },
  toggleStockBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 13 },
  modalActionButtonsRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  modalEditBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#eff6ff', paddingVertical: 10, borderRadius: 10, gap: 6 },
  modalEditBtnText: { color: '#2563eb', fontWeight: '700', fontSize: 13 },
  modalDeleteBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fee2e2', paddingVertical: 10, borderRadius: 10, gap: 6 },
  modalDeleteBtnText: { color: '#dc2626', fontWeight: '700', fontSize: 13 },
  inputLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 4, marginTop: 10 },
  textInput: { backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13, color: '#0f172a' },
  vegToggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10, borderWidth: 1 },
  vegToggleActive: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  nonVegToggleActive: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  vegToggleText: { fontSize: 11, fontWeight: '800', color: '#334155' },
  catSelectChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: '#f1f5f9', marginRight: 6 },
  catSelectChipActive: { backgroundColor: COLORS.primaryLight, borderWidth: 1, borderColor: COLORS.primary },
  catSelectChipText: { fontSize: 12, color: '#64748b', fontWeight: '600' },
  catSelectChipTextActive: { color: COLORS.primary, fontWeight: '700' },
  modalSubmitBtn: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 16 },
  modalSubmitBtnText: { color: '#ffffff', fontWeight: '700', fontSize: 14 },
  
  // Dish Image Picker Styles
  dishImagePreviewCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  dishImagePreview: { width: '100%', height: 140, borderRadius: 8, backgroundColor: '#e2e8f0' },
  dishImageButtonsRow: { flexDirection: 'row', gap: 8, marginTop: 8, width: '100%' },
  imageActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
    paddingVertical: 7,
    borderRadius: 8,
    gap: 4,
  },
  imageActionBtnText: { fontSize: 12, fontWeight: '700', color: '#2563eb' },
  imageActionBtnDelete: { backgroundColor: '#fee2e2' },
  noImagePickerBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    padding: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  noImageText: { fontSize: 12, color: '#64748b', marginBottom: 8 },
  noImageBtnsRow: { flexDirection: 'row', gap: 8 },
  pickerChoiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f5f3ff',
    borderWidth: 1,
    borderColor: '#ddd6fe',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  pickerChoiceBtnText: { fontSize: 12, fontWeight: '700', color: '#7c3aed' },

  // Smart Menu AI Web Cards
  aiWebCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 12,
  },
  aiWebCardIconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiWebCardTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  aiWebCardBadge: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    color: '#059669',
    backgroundColor: '#d1fae5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  aiWebCardDesc: { fontSize: 12, color: '#64748b', marginTop: 2, lineHeight: 16 },
  aiDishCard: { backgroundColor: '#f8fafc', padding: 10, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#e2e8f0' },
});
