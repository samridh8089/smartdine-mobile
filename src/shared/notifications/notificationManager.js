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
    const channelConfig = {
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 250, 500],
      lightColor: '#059669',
      sound: 'order_tune',
      enableVibrate: true,
      showBadge: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.NOTIFICATION_RINGTONE,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
      },
    };

    const channels = [
      { id: 'smartdine_kitchen', name: 'CleverOps Kitchen Orders' },
      { id: 'smartdine_waiter', name: 'CleverOps Waiter Calls' },
      { id: 'smartdine_owner', name: 'CleverOps Owner Alerts' },
      { id: CONFIG.NOTIFICATION_CHANNEL_ID || 'smartdine-urgent-v3', name: CONFIG.NOTIFICATION_CHANNEL_NAME || 'CleverOps Staff Alerts' },
    ];

    for (const ch of channels) {
      try {
        await Notifications.setNotificationChannelAsync(ch.id, {
          ...channelConfig,
          name: ch.name,
        });
      } catch (e) {
        console.log(`[NotificationManager] Channel creation warning for ${ch.id}:`, e?.message);
      }
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
    console.log('[NotificationDiagnostics] FCM token exists:', token ? 'YES' : 'NO');
    console.log('[NotificationDiagnostics] token length:', token ? token.length : 0);
    console.log('[NotificationDiagnostics] user ID exists:', userId ? 'YES' : 'NO');

    if (token && userId) {
      const { data: prof } = await supabase.from('profiles').select('restaurant_id, role').eq('id', userId).maybeSingle();
      console.log('[NotificationDiagnostics] restaurant ID exists:', prof?.restaurant_id ? 'YES' : 'NO');
      console.log('[NotificationDiagnostics] role:', prof?.role || 'N/A');

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

export async function unregisterPushToken(userId) {
  try {
    if (userId) {
      await supabase
        .from('profiles')
        .update({ push_token: null })
        .eq('id', userId);
      console.log('[NotificationDiagnostics] Push token unregistered for user:', userId);
    }
  } catch (e) {
    console.log('[NotificationManager] unregisterPushToken error:', e?.message);
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
