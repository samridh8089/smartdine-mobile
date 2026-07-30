/**
 * AlarmManager — Continuous Alarm with Custom Order Tune for SmartDine
 *
 * Plays assets/order_tune.mp3 continuously in background and lockscreen
 * using expo-av Audio + Vibration + expo-notifications MAX priority alert.
 */

import { Vibration } from 'react-native';
import { Audio } from 'expo-av';

// ─── Internal State ─────────────────────────────────────────────────────────
let _isPlaying = false;
let _currentAlarmType = null;
let _vibrationInterval = null;
let _soundInstance = null;

// ─── Audio Setup & Playback ──────────────────────────────────────────────
async function _playOrderTune() {
  try {
    await _stopSound();

    // Set full background & lockscreen audio mode
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      interruptionModeIOS: 1, // DuckOthers
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      interruptionModeAndroid: 1, // DoNotMix
      playThroughEarpieceAndroid: false,
    });

    const soundObject = new Audio.Sound();
    await soundObject.loadAsync(
      require('../../assets/order_tune.mp3'),
      { shouldPlay: true, isLooping: true, volume: 1.0 }
    );
    await soundObject.playAsync();
    _soundInstance = soundObject;
    console.log('[AlarmManager] Playing order_tune.mp3 successfully');
  } catch (e) {
    console.log('[AlarmManager] Audio playback error:', e?.message || e);
  }
}

async function _stopSound() {
  try {
    if (_soundInstance) {
      await _soundInstance.stopAsync();
      await _soundInstance.unloadAsync();
      _soundInstance = null;
    }
  } catch (_) {
    _soundInstance = null;
  }
}

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
    Vibration.vibrate([0, 1000, 500, 1000], true);

    _vibrationInterval = setInterval(() => {
      try {
        Vibration.vibrate([0, 1000, 500, 1000], true);
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
        vibrate: [0, 1000, 500, 1000],
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
 * Start continuous alarm (order_tune.mp3 + vibration + notification).
 */
export async function startAlarm(type, title, body) {
  try {
    if (_isPlaying && _currentAlarmType === type) return;

    _currentAlarmType = type;
    _isPlaying = true;

    // 1. Play custom order_tune.mp3 audio looping in background
    _playOrderTune().catch(() => {});

    // 2. Safe vibration loop
    _startVibration();

    // 3. High priority notification
    _sendNotification(title, body, type).catch(() => {});

    console.log('[AlarmManager] Safe alarm started with order_tune.mp3:', type);
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
    await _stopSound();
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
