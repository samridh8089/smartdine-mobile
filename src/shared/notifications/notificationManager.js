import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { CONFIG } from '../config';
import { supabase } from '../supabase/client';

// Handler for foreground notifications
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
} catch (e) {
  console.log('[NotificationManager] Set notification handler warning:', e?.message);
}

export async function setupNotificationChannel() {
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync(CONFIG.NOTIFICATION_CHANNEL_ID, {
        name: CONFIG.NOTIFICATION_CHANNEL_NAME,
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 500, 250, 500],
        lightColor: '#e11d48',
        sound: 'order_tune',
        enableVibrate: true,
        showBadge: true,
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      });
    } catch (e) {
      console.log('[NotificationManager] Channel creation error:', e?.message);
    }
  }
}

export async function registerForPushNotificationsAsync(userId) {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('[NotificationDiagnostics] Push permission state: NOT GRANTED');
      console.log('[NotificationDiagnostics] Expo Push Token generated: NO');
      return null;
    }

    const projectId = CONFIG.PROJECT_ID || '2fb0358d-6e46-4269-996d-0614a98052e1';
    let tokenData = null;
    try {
      tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    } catch (tokenErr) {
      console.log('[NotificationDiagnostics] Expo Push Token generated: NO (Error:', tokenErr?.message, ')');
      return null;
    }

    const token = tokenData?.data;
    if (token) {
      console.log('[NotificationDiagnostics] Expo Push Token generated: YES');
    } else {
      console.log('[NotificationDiagnostics] Expo Push Token generated: NO');
      return null;
    }

    if (token && userId) {
      const { error: dbErr } = await supabase
        .from('profiles')
        .update({ push_token: token })
        .eq('id', userId);

      if (dbErr) {
        console.log('[NotificationDiagnostics] Database token persistence: FAILED (Error:', dbErr?.message, ')');
      } else {
        console.log('[NotificationDiagnostics] Database token persistence: SUCCESS');
      }
    }
    return token;
  } catch (e) {
    console.log('[NotificationDiagnostics] Push registration error:', e?.message);
    return null;
  }
}

export async function sendLocalNotification(title, body, channelId = CONFIG.NOTIFICATION_CHANNEL_ID) {
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'order_tune',
        priority: Notifications.AndroidNotificationPriority.MAX,
        data: { timestamp: Date.now() },
      },
      trigger: null, // Immediate delivery
    });
  } catch (e) {
    console.log('[NotificationManager] sendLocalNotification error:', e?.message);
  }
}
