/**
 * AlarmManager — Safe Continuous Alarm for SmartDine
 *
 * Uses Vibration + expo-notifications for loud alerts.
 * Completely eliminates native audio player calls to prevent screen blackout crashes.
 */

import { Vibration } from 'react-native';

// ─── Internal State ─────────────────────────────────────────────────────────
let _isPlaying = false;
let _currentAlarmType = null;
let _vibrationInterval = null;

// ─── Safe lazy load of expo-notifications ────────────────────────────────
function getNotifications() {
  try {
    return require('expo-notifications') || null;
  } catch (e) {
    return null;
  }
}

// ─── Vibration loop ───────────────────────────────────────────────────────────
function _startVibration() {
  try {
    _stopVibration();
    Vibration.vibrate([0, 800, 400], true);

    // Backup interval in case OS cancels vibration
    _vibrationInterval = setInterval(() => {
      try {
        Vibration.vibrate([0, 800, 400], true);
      } catch (_) {}
    }, 4000);
  } catch (e) {
    console.log('[AlarmManager] Vibration error (non-fatal):', e.message);
  }
}

function _stopVibration() {
  try {
    if (_vibrationInterval) {
      clearInterval(_vibrationInterval);
      _vibrationInterval = null;
    }
    Vibration.cancel();
  } catch (_) {}
}

// ─── Notification alert ────────────────────────────────────────────────────
async function _sendNotification(title, body, type) {
  try {
    const Notifications = getNotifications();
    if (!Notifications?.scheduleNotificationAsync) return;

    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        channelId: 'smartdine-urgent-channel',
        priority: 'max',
        vibrate: [0, 800, 400, 800],
        data: { alarmType: type },
      },
      trigger: null,
    });
  } catch (e) {
    console.log('[AlarmManager] Notification error (non-fatal):', e.message);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start continuous alarm (vibration + notification).
 */
export async function startAlarm(type, title, body) {
  try {
    if (_isPlaying && _currentAlarmType === type) return;

    _currentAlarmType = type;
    _isPlaying = true;

    // 1. Safe vibration loop
    _startVibration();

    // 2. High priority notification
    _sendNotification(title, body, type).catch(() => {});

    console.log('[AlarmManager] Safe alarm started:', type);
  } catch (e) {
    console.log('[AlarmManager] startAlarm error:', e.message);
  }
}

/**
 * Stop continuous alarm.
 */
export async function stopAlarm() {
  try {
    _isPlaying = false;
    _currentAlarmType = null;
    _stopVibration();
    console.log('[AlarmManager] Alarm stopped.');
  } catch (e) {
    console.log('[AlarmManager] stopAlarm error:', e.message);
  }
}

/**
 * Check if alarm is currently active.
 */
export function isAlarmActive() {
  return _isPlaying;
}

/**
 * Get currently active alarm type.
 */
export function getActiveAlarmType() {
  return _currentAlarmType;
}
