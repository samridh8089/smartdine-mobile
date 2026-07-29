/**
 * Battery & Permission Helper for SmartDine Mobile
 *
 * Prompts staff (Owner, Kitchen, Waiter) to disable Battery Optimization
 * so background notifications & alarm audio work reliably.
 * Safe fallback using React Native Linking.
 */

import { Alert, Platform, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BATTERY_PROMPT_KEY = '@smartdine_battery_prompt_v2';

/**
 * Prompts user for Unrestricted Battery Optimization permission.
 * Shows once per install unless forcePrompt = true.
 */
export async function checkAndPromptBatteryOptimization(forcePrompt = false) {
  if (Platform.OS !== 'android') return;

  try {
    const hasPrompted = await AsyncStorage.getItem(BATTERY_PROMPT_KEY);
    if (hasPrompted && !forcePrompt) return;

    Alert.alert(
      '🔋 Enable Unrestricted Battery',
      'To ensure loud continuous order alarms and instant waiter calls ring even when your phone screen is off or locked, please set SmartDine battery usage to "Unrestricted".\n\nGo to: Settings → Apps → SmartDine → Battery → Unrestricted',
      [
        {
          text: 'Later',
          style: 'cancel',
          onPress: async () => {
            try {
              await AsyncStorage.setItem(BATTERY_PROMPT_KEY, 'true');
            } catch (_) {}
          },
        },
        {
          text: 'Open Settings',
          onPress: async () => {
            try {
              await AsyncStorage.setItem(BATTERY_PROMPT_KEY, 'true');
            } catch (_) {}
            openBatteryOptimizationSettings();
          },
        },
      ],
      { cancelable: false }
    );
  } catch (e) {
    console.log('[BatteryManager] Prompt error (non-fatal):', e.message);
  }
}

/**
 * Opens Android Battery Optimization Settings screen directly via Linking.
 */
export async function openBatteryOptimizationSettings() {
  if (Platform.OS !== 'android') return;

  try {
    await Linking.openSettings();
  } catch (e) {
    console.log('[BatteryManager] openSettings error (non-fatal):', e.message);
  }
}
