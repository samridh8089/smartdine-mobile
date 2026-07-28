/**
 * Battery & Permission Helper for SmartDine Mobile
 *
 * Prompts staff (Owner, Kitchen, Waiter) to disable Battery Optimization
 * so background notifications & alarm audio work reliably.
 * All calls are safe — app never crashes even if intent fails.
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
 * Opens Android Battery Optimization Settings screen.
 * Uses Linking (no native modules needed) — safe fallback.
 */
export async function openBatteryOptimizationSettings() {
  if (Platform.OS !== 'android') return;

  try {
    // Try expo-intent-launcher if available
    let IntentLauncher = null;
    try {
      IntentLauncher = require('expo-intent-launcher');
    } catch (_) {
      IntentLauncher = null;
    }

    if (IntentLauncher?.startActivityAsync && IntentLauncher?.ActivityAction) {
      try {
        await IntentLauncher.startActivityAsync(
          IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
          { data: 'package:com.smartdine.mobile' }
        );
        return;
      } catch (e1) {
        console.log('[BatteryManager] Direct battery intent failed, trying fallback...');
      }

      try {
        await IntentLauncher.startActivityAsync(
          IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS
        );
        return;
      } catch (e2) {
        console.log('[BatteryManager] Battery settings intent failed, using Linking...');
      }
    }

    // Safe fallback: open app settings via Linking (always works)
    await Linking.openSettings();
  } catch (e) {
    console.log('[BatteryManager] openSettings error (non-fatal):', e.message);
    try {
      await Linking.openSettings();
    } catch (_) {}
  }
}
