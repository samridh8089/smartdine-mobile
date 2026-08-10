import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { Vibration, Platform } from 'react-native';
import { Asset } from 'expo-asset';

const activeSounds = {};
let audioConfigured = false;
let preloadedSoundAsset = null;

async function configureAudio() {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      staysActiveInBackground: true,
      interruptionModeIOS: InterruptionModeIOS.DuckOthers,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
      playThroughEarpieceAndroid: false,
    });
    audioConfigured = true;
  } catch (e) {
    console.log('[AlarmManagerDiagnostics] Audio config warning:', e?.message);
  }
}

async function getSoundSource() {
  try {
    const requireAsset = require('../../../assets/order_tune.mp3');
    const asset = Asset.fromModule(requireAsset);
    
    if (!asset.downloaded) {
      try {
        await asset.downloadAsync();
      } catch (downloadErr) {
        console.log('[AlarmManagerDiagnostics] Asset downloadAsync fallback caught:', downloadErr?.message);
      }
    }

    if (asset.localUri) {
      console.log('[AlarmManagerDiagnostics] Using localUri asset source:', asset.localUri);
      return { uri: asset.localUri };
    }

    if (asset.uri) {
      console.log('[AlarmManagerDiagnostics] Using asset.uri source:', asset.uri);
      return { uri: asset.uri };
    }

    return requireAsset;
  } catch (e) {
    console.log('[AlarmManagerDiagnostics] getSoundSource error:', e?.message);
    return require('../../../assets/order_tune.mp3');
  }
}

export async function startAlarm(type = 'default', title = '', body = '') {
  try {
    console.log(`[AlarmManagerDiagnostics] startAlarm called for type: ${type}`);
    await configureAudio();

    if (activeSounds[type]) {
      try { await activeSounds[type].stopAsync(); } catch {}
      try { await activeSounds[type].unloadAsync(); } catch {}
      delete activeSounds[type];
    }

    const soundSource = await getSoundSource();
    const { sound } = await Audio.Sound.createAsync(
      soundSource,
      { isLooping: true, volume: 1.0, shouldPlay: true }
    );
    activeSounds[type] = sound;

    try {
      await sound.playAsync();
    } catch (pErr) {
      console.log(`[AlarmManagerDiagnostics] sound.playAsync warning: ${pErr?.message}`);
    }

    console.log(`[AlarmManagerDiagnostics] In-App Custom Bell playing (${type}): YES`);

    if (Platform.OS === 'android') {
      Vibration.vibrate([0, 500, 250, 500], true);
    }
  } catch (e) {
    console.log(`[AlarmManagerDiagnostics] In-App Custom Bell error (${type}):`, e?.message);
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
