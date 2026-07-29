import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { supabase } from '../lib/supabase';
import { Audio } from 'expo-av';

// Helper function to safely play notification sound
async function playSound(soundType) {
  try {
    const soundObject = new Audio.Sound();
    await soundObject.loadAsync(require('../../assets/alarm.mp3'));
    await soundObject.playAsync();
  } catch (error) {
    console.log('Error playing notification sound:', error);
  }
}

export default function LiveNotificationListener({ profile }) {
  const [notification, setNotification] = React.useState(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!profile || !profile.restaurant_id) return;

    // Listen for New Orders
    let ordersSubscription;
    let callsSubscription;
    try {
      ordersSubscription = supabase
        .channel('public:orders')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${profile.restaurant_id}` }, payload => {
          if (profile.role === 'kitchen' || profile.role === 'waiter' || profile.role === 'owner') {
            showNotification('New Order Received!', 'beep');
          }
        })
        .subscribe();

      // Listen for Waiter Calls
      callsSubscription = supabase
        .channel('public:customer_requests')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'customer_requests', filter: `restaurant_id=eq.${profile.restaurant_id}` }, payload => {
          if (profile.role === 'waiter' || profile.role === 'owner') {
            showNotification(`Table ${payload.new.table_name}: ${payload.new.type === 'request_bill' ? 'Bill Requested' : 'Waiter Called'}`, 'bell');
          }
        })
        .subscribe();
    } catch (e) {
      console.log('Notification listener setup error:', e);
    }

    return () => {
      if (ordersSubscription) {
        try { supabase.removeChannel(ordersSubscription); } catch (_) {}
      }
      if (callsSubscription) {
        try { supabase.removeChannel(callsSubscription); } catch (_) {}
      }
    };
  }, [profile]);

  const showNotification = async (message, type) => {
    setNotification(message);

    playSound(type).catch(() => {});

    // Fade in banner
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    // Auto-dismiss after 4 seconds
    setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setNotification(null));
    }, 4000);
  };

  if (!notification) return null;

  return (
    <Animated.View style={[styles.banner, { opacity: fadeAnim }]}>
      <Text style={styles.text}>{notification}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    backgroundColor: '#0ea5e9',
    padding: 14,
    borderRadius: 10,
    zIndex: 9999,
    elevation: 10,
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  text: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
