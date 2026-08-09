import { Platform } from 'react-native';

export const OPTIMIZED_FLATLIST_PROPS = {
  initialNumToRender: 8,
  maxToRenderPerBatch: 10,
  windowSize: 5,
  removeClippedSubviews: Platform.OS === 'android',
  updateCellsBatchingPeriod: 50,
};
