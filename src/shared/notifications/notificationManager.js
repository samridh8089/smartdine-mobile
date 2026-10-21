import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { CONFIG } from '../config';
import { supabase } from '../supabase/client';

// Global diagnostic state for hidden Debug Diagnostic Panel
export const notificationDiagnostics = {
  token: null,
  tokenType: null,
  permissionStatus: 'undetermined',
  channelsReady: false,
  channelList: [],
  lastReceivedPush: null,
  lastAlertTimestamp: null,
  lastRegisteredAt: null,
  error: null,
};

export function getNotificationDiagnostics() {
  return notificationDiagnostics;
}

// Handler for foreground notifications:
// In foreground, in-app alarmManager plays the audio bell and updates UI.
// shouldPlaySound is set to false here to prevent duplicate system sound on top of in-app audio.
try {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      try {
        notificationDiagnostics.lastReceivedPush = {
          title: notification?.request?.content?.title || 'Order Alert',
          body: notification?.request?.content?.body || '',
          data: notification?.request?.content?.data || {},
          time: new Date().toLocaleTimeString(),
        };
        notificationDiagnostics.lastAlertTimestamp = new Date().toLocaleTimeString();
      } catch (_) {}

      return {
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: true,
      };
    },
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
      { id: 'smartdine_kitchen_v2', name: 'CleverOps Kitchen Orders v2' },
      { id: 'smartdine_waiter', name: 'CleverOps Waiter Calls' },
      { id: 'smartdine_waiter_v2', name: 'CleverOps Waiter Calls v2' },
      { id: 'smartdine_owner', name: 'CleverOps Owner Alerts' },
      { id: 'smartdine_owner_v2', name: 'CleverOps Owner Alerts v2' },
      { id: CONFIG.NOTIFICATION_CHANNEL_ID || 'smartdine-urgent-v3', name: CONFIG.NOTIFICATION_CHANNEL_NAME || 'CleverOps Staff Alerts' },
      { id: 'smartdine-urgent-channel', name: 'CleverOps Urgent Channel' },
    ];

    const activeList = [];
    for (const ch of channels) {
      try {
        const existing = await Notifications.getNotificationChannelAsync(ch.id);
        // Only set channel if not already configured with MAX importance and sound
        if (!existing || existing.importance < Notifications.AndroidImportance.HIGH || !existing.sound) {
          await Notifications.setNotificationChannelAsync(ch.id, {
            ...channelConfig,
            name: ch.name,
          });
        }
        activeList.push(ch.id);
      } catch (e) {
        console.log(`[NotificationManager] Channel creation warning for ${ch.id}:`, e?.message);
      }
    }
    notificationDiagnostics.channelsReady = true;
    notificationDiagnostics.channelList = activeList;
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
    notificationDiagnostics.permissionStatus = finalStatus;

    if (finalStatus !== 'granted') {
      console.log('[NotificationDiagnostics] Push permission state: NOT GRANTED');
      notificationDiagnostics.error = 'Notification permission not granted';
      return null;
    }

    const projectId = CONFIG.PROJECT_ID || 'ce3e3736-755b-46c6-ab6d-285377cbe349';
    let token = null;
    let tokenType = 'Expo Push Token';

    // 1. Primary on Android: Native FCM Device Token (bypasses Expo FCM credentials error)
    if (Platform.OS === 'android') {
      try {
        if (typeof Notifications.getDevicePushTokenAsync === 'function') {
          const devToken = await Notifications.getDevicePushTokenAsync();
          if (devToken?.data && typeof devToken.data === 'string' && devToken.data.length > 20) {
            token = devToken.data;
            tokenType = 'Native FCM Token';
            console.log('[NotificationDiagnostics] Using Native FCM Device Token:', token.slice(0, 20) + '...');
          }
        }
      } catch (devErr) {
        console.log('[NotificationDiagnostics] Native Device Token check note:', devErr?.message);
      }
    }

    // 2. Secondary: Expo Push Token fallback (for iOS or non-FCM Android)
    if (!token) {
      try {
        const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
        token = tokenData?.data;
        tokenType = 'Expo Push Token';
      } catch (tokenErr) {
        console.log('[NotificationDiagnostics] Expo Push Token warning:', tokenErr?.message);
      }
    }

    if (!token) {
      notificationDiagnostics.error = 'Failed to generate push token';
      return null;
    }

    notificationDiagnostics.token = token;
    notificationDiagnostics.tokenType = tokenType;
    console.log('[NotificationDiagnostics] FCM token exists: YES');
    console.log('[NotificationDiagnostics] Token type:', tokenType);
    console.log('[NotificationDiagnostics] token length:', token.length);
    console.log('[NotificationDiagnostics] user ID exists:', userId ? 'YES' : 'NO');

    if (userId) {
      const { data: prof } = await supabase.from('profiles').select('restaurant_id, role').eq('id', userId).maybeSingle();
      console.log('[NotificationDiagnostics] restaurant ID exists:', prof?.restaurant_id ? 'YES' : 'NO');
      console.log('[NotificationDiagnostics] role:', prof?.role || 'N/A');

      const { error: dbErr } = await supabase
        .from('profiles')
        .update({
          push_token: token,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      if (dbErr) {
        console.log('[NotificationDiagnostics] Database token persistence: FAILED (Error:', dbErr?.message, ')');
        notificationDiagnostics.error = dbErr.message;
      } else {
        console.log('[NotificationDiagnostics] Database token persistence: SUCCESS');
        notificationDiagnostics.lastRegisteredAt = new Date().toLocaleTimeString();
      }
    }
    return token;
  } catch (e) {
    console.log('[NotificationDiagnostics] Push registration error:', e?.message);
    notificationDiagnostics.error = e?.message;
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
      notificationDiagnostics.token = null;
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
      trigger: null,
    });
    notificationDiagnostics.lastAlertTimestamp = new Date().toLocaleTimeString();
  } catch (e) {
    console.log('[NotificationManager] sendLocalNotification error:', e?.message);
  }
}
