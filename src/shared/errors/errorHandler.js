import { Alert } from 'react-native';

export const errorHandler = {
  logError(context, error) {
    console.log(`[ErrorGuard][${context}]`, error?.message || error);
  },

  showUserError(title, message) {
    Alert.alert(title || 'Error', message || 'An unexpected error occurred. Please try again.');
  },

  async safeExecute(task, context = 'GeneralTask', fallbackValue = null) {
    try {
      return await task();
    } catch (e) {
      this.logError(context, e);
      return fallbackValue;
    }
  },
};
