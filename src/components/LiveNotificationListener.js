import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { supabase } from '../lib/supabase';

// expo-av loaded lazily inside function to prevent crash if native module unavailable
function getAudio() {
  try {
    return require('expo-av')?.Audio || null;
  } catch (e) {
    return null;
  }
}

export default function LiveNotificationListener({ profile }) {
  const [notification, setNotification] = React.useState(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!profile || !profile.restaurant_id) return;

    // Listen for New Orders
    const ordersSubscription = supabase
      .channel('public:orders')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: `restaurant_id=eq.${profile.restaurant_id}` }, payload => {
        if (profile.role === 'kitchen' || profile.role === 'waiter' || profile.role === 'owner') {
          showNotification('New Order Received!', 'beep');
        }
      })
      .subscribe();

    // Listen for Waiter Calls
    const callsSubscription = supabase
      .channel('public:customer_requests')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'customer_requests', filter: `restaurant_id=eq.${profile.restaurant_id}` }, payload => {
        if (profile.role === 'waiter' || profile.role === 'owner') {
          showNotification(`Table ${payload.new.table_name}: ${payload.new.type === 'request_bill' ? 'Bill Requested' : 'Waiter Called'}`, 'bell');
        }
      })
      .subscribe();

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

    // Play Sound safely
    try {
      const Audio = getAudio();
      if (Audio?.Sound?.createAsync) {
        const soundUri = type === 'beep'
          ? 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg'
          : 'https://actions.google.com/sounds/v1/alarms/dinner_bell.ogg';

        const { sound } = await Audio.Sound.createAsync({ uri: soundUri }, { shouldPlay: true });
        sound.setOnPlaybackStatusUpdate((status) => {
          if (status.didJustFinish) {
            sound.unloadAsync();
          }
        });
      }
    } catch (e) {
      console.log('Failed to play sound (non-fatal):', e.message);
    }

    // Show popup
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 300,
      useNativeDriver: true,
    }).start();

    // Hide popup after 4 seconds
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
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <Text style={styles.text}>{notification}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    left: 20,
    right: 20,
    backgroundColor: '#3b82f6',
    padding: 16,
    borderRadius: 8,
    zIndex: 9999,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  text: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  }
});
