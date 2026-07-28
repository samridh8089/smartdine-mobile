/**
 * AlarmManager — Safe Continuous Alarm for SmartDine
 *
 * Uses only Vibration (always available) + expo-notifications for alerts.
 * expo-av audio is optional — if unavailable, vibration alone is used.
 * All native calls are safely wrapped to prevent crashes.
 */

import { Vibration, Platform } from 'react-native';

// ─── Internal State ─────────────────────────────────────────────────────────
let _soundObject = null;
let _isPlaying = false;
let _currentAlarmType = null;
let _vibrationTimerActive = false;

// ─── Safe lazy load of expo-av ────────────────────────────────────────────
function getAudio() {
  try {
    const av = require('expo-av');
    return av?.Audio || null;
  } catch (e) {
    return null;
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

// ─── Configure audio session ─────────────────────────────────────────────────
async function _configureAudio() {
  try {
    const Audio = getAudio();
    if (!Audio?.setAudioModeAsync) return;
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });
  } catch (e) {
    console.log('[AlarmManager] Audio config error (non-fatal):', e.message);
  }
}

// ─── Vibration loop ───────────────────────────────────────────────────────────
function _startVibration() {
  try {
    Vibration.cancel();
    // Repeat: 800ms on, 400ms off
    Vibration.vibrate([0, 800, 400], true);
    _vibrationTimerActive = true;
  } catch (e) {
    console.log('[AlarmManager] Vibration error (non-fatal):', e.message);
  }
}

function _stopVibration() {
  try {
    Vibration.cancel();
    _vibrationTimerActive = false;
  } catch (e) {
    // ignore
  }
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

// ─── Audio playback ───────────────────────────────────────────────────────────
async function _startAudio() {
  try {
    const Audio = getAudio();
    if (!Audio?.Sound?.createAsync) return;

    await _configureAudio();

    // Stop any previous sound
    if (_soundObject) {
      try {
        await _soundObject.stopAsync();
        await _soundObject.unloadAsync();
      } catch (_) {}
      _soundObject = null;
    }

    const { sound } = await Audio.Sound.createAsync(
      require('../../assets/alarm.mp3'),
      {
        shouldPlay: true,
        isLooping: true,
        volume: 1.0,
        isMuted: false,
      }
    );
    _soundObject = sound;
    console.log('[AlarmManager] Audio started');
  } catch (e) {
    console.log('[AlarmManager] Audio start error (vibration still active):', e.message);
    _soundObject = null;
  }
}

async function _stopAudio() {
  if (!_soundObject) return;
  try {
    await _soundObject.stopAsync();
    await _soundObject.unloadAsync();
  } catch (e) {
    console.log('[AlarmManager] Audio stop error (non-fatal):', e.message);
  } finally {
    _soundObject = null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Start the continuous alarm.
 * @param {'new_order'|'waiter_call'|'food_ready'} type
 * @param {string} title
 * @param {string} body
 */
export async function startAlarm(type, title, body) {
  try {
    // Don't restart same type
    if (_isPlaying && _currentAlarmType === type) return;

    _currentAlarmType = type;
    _isPlaying = true;

    // 1. Vibration (always works)
    _startVibration();

    // 2. Notification
    _sendNotification(title, body, type).catch(() => {});

    // 3. Audio (optional, won't crash if fails)
    _startAudio().catch(() => {});

    console.log('[AlarmManager] Alarm started:', type);
  } catch (e) {
    console.log('[AlarmManager] startAlarm error (non-fatal):', e.message);
  }
}

/**
 * Stop the continuous alarm.
 */
export async function stopAlarm() {
  try {
    if (!_isPlaying) return;

    _isPlaying = false;
    _currentAlarmType = null;

    _stopVibration();
    await _stopAudio();

    console.log('[AlarmManager] Alarm stopped.');
  } catch (e) {
    console.log('[AlarmManager] stopAlarm error (non-fatal):', e.message);
  }
}

/**
 * Check if alarm is currently active.
 */
export function isAlarmActive() {
  return _isPlaying;
}

/**
 * Get the currently active alarm type.
 */
export function getActiveAlarmType() {
  return _currentAlarmType;
}
