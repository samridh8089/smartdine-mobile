import { Platform, Vibration } from 'react-native';
import { supabase } from './supabase';

let Notifications = null;

function getNotifications() {
  if (!Notifications) {
    try {
      Notifications = require('expo-notifications');
      if (Notifications && Notifications.setNotificationHandler) {
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowAlert: true,
            shouldPlaySound: true,
            shouldSetBadge: true,
          }),
        });
      }
    } catch (e) {
      console.log('expo-notifications load warning:', e);
    }
  }
  return Notifications;
}

// Configure High-Importance Android Notification Channel for loud alerts
export async function setupNotificationChannel() {
  const Notifs = getNotifications();
  if (Platform.OS === 'android' && Notifs && Notifs.setNotificationChannelAsync) {
    try {
      await Notifs.setNotificationChannelAsync('smartdine-urgent-channel', {
        name: 'SmartDine Urgent Order & Waiter Alerts',
        importance: Notifs.AndroidImportance ? Notifs.AndroidImportance.MAX : 5,
        vibrationPattern: [0, 1000, 500, 1000, 500, 1000],
        lightColor: '#EF4444',
        sound: 'default',
        lockscreenVisibility: Notifs.AndroidNotificationVisibility
          ? Notifs.AndroidNotificationVisibility.PUBLIC
          : 1,
        bypassDnd: true,
        showBadge: true,
      });
    } catch (e) {
      console.log('Error creating notification channel:', e);
    }
  }
}

// Request permission and register Expo Push Token in Supabase profile
export async function registerPushToken(userIdParam = null) {
  try {
    const Notifs = getNotifications();
    if (!Notifs) return null;

    let targetUserId = userIdParam;
    if (!targetUserId) {
      const { data: { session } } = await supabase.auth.getSession();
      targetUserId = session?.user?.id;
    }

    const { status: existingStatus } = await Notifs.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifs.requestPermissionsAsync();
      finalStatus = status;
    }

    await setupNotificationChannel();

    if (finalStatus !== 'granted') return null;

    let token = null;
    try {
      if (Notifs.getExpoPushTokenAsync) {
        const tokenData = await Notifs.getExpoPushTokenAsync({
          projectId: '407eef68-5b75-4b63-b679-8123df863ea7',
        });
        token = tokenData?.data;
        console.log('EXPO FCM PUSH TOKEN GENERATED:', token);
      }
    } catch (pushErr) {
      console.log('Expo Push Token error:', pushErr);
    }

    if (token && targetUserId) {
      const { error: updateErr } = await supabase
        .from('profiles')
        .update({ push_token: token })
        .eq('id', targetUserId);
      console.log('SAVED PUSH TOKEN TO SUPABASE USER:', targetUserId, token, updateErr);
    }

    return token;
  } catch (e) {
    console.log('Error in registerPushToken:', e);
    return null;
  }
}

// Trigger System Alert (local notification + vibration)
export async function sendSystemAlert(title, body, data = {}) {
  try {
    Vibration.vibrate([0, 1000, 500, 1000]);
    const Notifs = getNotifications();

    if (Notifs && Notifs.scheduleNotificationAsync) {
      await Notifs.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: 'default',
          channelId: 'smartdine-urgent-channel',
          priority: Notifs.AndroidNotificationPriority
            ? Notifs.AndroidNotificationPriority.MAX
            : 2,
          vibrate: [0, 1000, 500, 1000],
          data,
        },
        trigger: null, // Immediate
      });
    }
  } catch (e) {
    console.log('Error triggering system alert:', e);
  }
}

// Dispatch push to staff devices
export async function sendPushToRestaurantStaff(restaurantId, title, body, data = {}) {
  try {
    sendSystemAlert(title, body, data);

    if (!restaurantId) return;

    const { data: staffProfiles } = await supabase
      .from('profiles')
      .select('push_token')
      .eq('restaurant_id', restaurantId)
      .not('push_token', 'is', null);

    if (!staffProfiles || staffProfiles.length === 0) return;

    const messages = staffProfiles
      .map(p => p.push_token)
      .filter(Boolean)
      .map(token => ({
        to: token,
        sound: 'default',
        priority: 'high',
        channelId: 'smartdine-urgent-channel',
        title,
        body,
        data,
        _displayInForeground: true,
      }));

    if (messages.length > 0) {
      await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messages),
      });
    }
  } catch (e) {
    console.log('Error dispatching push to staff:', e);
  }
}
