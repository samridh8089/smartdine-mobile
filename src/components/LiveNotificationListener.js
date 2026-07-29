import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Vibration } from 'react-native';
import { supabase } from '../lib/supabase';

export default function LiveNotificationListener({ profile }) {
  const [notification, setNotification] = React.useState(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!profile || !profile.restaurant_id) return;

    let ordersSubscription;
    let callsSubscription;
    try {
      // Listen for New Orders
      ordersSubscription = supabase
        .channel(`public:orders:${profile.restaurant_id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${profile.restaurant_id}` }, payload => {
          try {
            if (profile.role === 'kitchen' || profile.role === 'waiter' || profile.role === 'owner') {
              showNotification('New Order Received!');
            }
          } catch (_) {}
        })
        .subscribe();

      // Listen for Waiter Calls
      callsSubscription = supabase
        .channel(`public:customer_requests:${profile.restaurant_id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'customer_requests', filter: `restaurant_id=eq.${profile.restaurant_id}` }, payload => {
          try {
            if (profile.role === 'waiter' || profile.role === 'owner') {
              const tableName = payload?.new?.table_name || 'N/A';
              const reqType = payload?.new?.type === 'request_bill' ? 'Bill Requested' : 'Waiter Called';
              showNotification(`Table ${tableName}: ${reqType}`);
            }
          } catch (_) {}
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

  const showNotification = (message) => {
    try {
      setNotification(message);
      Vibration.vibrate([0, 500, 200, 500]);

      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();

      setTimeout(() => {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => setNotification(null));
      }, 4000);
    } catch (_) {}
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
    backgroundColor: '#059669',
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
