import { Audio } from 'expo-av';
import { Vibration, Platform } from 'react-native';

const activeSounds = {};
let audioConfigured = false;

async function configureAudio() {
  if (audioConfigured) return;
  try {
    await Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    });
    audioConfigured = true;
  } catch (e) {
    console.log('[AlarmManager] Audio config error:', e?.message);
  }
}

export async function startAlarm(type = 'default', title = '', body = '') {
  try {
    await configureAudio();
    if (activeSounds[type]) {
      try { await activeSounds[type].stopAsync(); } catch {}
      try { await activeSounds[type].unloadAsync(); } catch {}
      delete activeSounds[type];
    }

    const { sound } = await Audio.Sound.createAsync(
      require('../../../assets/order_tune.mp3'),
      { isLooping: true, volume: 1.0, shouldPlay: true }
    );
    activeSounds[type] = sound;

    if (Platform.OS === 'android') {
      Vibration.vibrate([0, 500, 250, 500], true);
    }
  } catch (e) {
    console.log(`[AlarmManager] startAlarm error (${type}):`, e?.message);
  }
}

export async function stopAlarm(type = 'default') {
  try {
    if (activeSounds[type]) {
      await activeSounds[type].stopAsync().catch(() => {});
      await activeSounds[type].unloadAsync().catch(() => {});
      delete activeSounds[type];
    }

    if (Object.keys(activeSounds).length === 0) {
      Vibration.cancel();
    }
  } catch (e) {
    console.log(`[AlarmManager] stopAlarm error (${type}):`, e?.message);
  }
}

export async function stopAllAlarms() {
  try {
    Vibration.cancel();
    const types = Object.keys(activeSounds);
    for (const type of types) {
      try {
        await activeSounds[type]?.stopAsync?.();
        await activeSounds[type]?.unloadAsync?.();
      } catch {}
      delete activeSounds[type];
    }
  } catch (e) {
    console.log('[AlarmManager] stopAllAlarms error:', e?.message);
  }
}
