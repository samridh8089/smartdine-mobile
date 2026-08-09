import AsyncStorage from '@react-native-async-storage/async-storage';

export const storage = {
  async getItem(key, defaultValue = null) {
    try {
      const val = await AsyncStorage.getItem(key);
      if (val === null) return defaultValue;
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    } catch (e) {
      console.log(`[Storage] getItem error for ${key}:`, e?.message);
      return defaultValue;
    }
  },

  async setItem(key, value) {
    try {
      const strVal = typeof value === 'string' ? value : JSON.stringify(value);
      await AsyncStorage.setItem(key, strVal);
      return true;
    } catch (e) {
      console.log(`[Storage] setItem error for ${key}:`, e?.message);
      return false;
    }
  },

  async removeItem(key) {
    try {
      await AsyncStorage.removeItem(key);
      return true;
    } catch (e) {
      console.log(`[Storage] removeItem error for ${key}:`, e?.message);
      return false;
    }
  },

  async clearAll() {
    try {
      await AsyncStorage.clear();
      return true;
    } catch (e) {
      console.log('[Storage] clearAll error:', e?.message);
      return false;
    }
  },
};
