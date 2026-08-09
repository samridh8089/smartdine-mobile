import React, { useState } from 'react';
import { TouchableOpacity, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';

export default function OTAUpdateBtn({ iconColor = '#0284c7', bgColor = '#e0f2fe', style }) {
  const [checking, setChecking] = useState(false);

  const handleCheckForUpdate = async () => {
    if (__DEV__) {
      Alert.alert('Development Mode', 'OTA updates are active in Production standalone build.');
      return;
    }

    setChecking(true);
    try {
      const update = await Updates.checkForUpdateAsync();
      if (update.isAvailable) {
        await Updates.fetchUpdateAsync();
        Alert.alert(
          'Update Successful! 🎉',
          'The app has been updated to the latest version. Restarting now...',
          [
            {
              text: 'OK',
              onPress: async () => {
                await Updates.reloadAsync();
              },
            },
          ],
          { cancelable: false }
        );
      } else {
        Alert.alert('App Up To Date ✅', 'You are already using the latest version of SmartDine!');
      }
    } catch (error) {
      console.log('[OTAUpdate] Error:', error?.message);
      Alert.alert('Update Check', error?.message || 'Unable to check for updates right now.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.btn, { backgroundColor: bgColor }, style]}
      onPress={handleCheckForUpdate}
      disabled={checking}
      activeOpacity={0.7}
    >
      {checking ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : (
        <Ionicons name="cloud-download-outline" size={20} color={iconColor} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justify: 'center',
  },
});
