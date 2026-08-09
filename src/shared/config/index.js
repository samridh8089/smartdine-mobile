import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra || {};

export const CONFIG = {
  SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL || extra.EXPO_PUBLIC_SUPABASE_URL || 'https://mock-supabase.smartdine.internal',
  SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || extra.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'mock-anon-key',
  NOTIFICATION_CHANNEL_ID: 'smartdine-urgent-v3',
  NOTIFICATION_CHANNEL_NAME: 'Urgent Orders & Calls',
  POLL_INTERVAL_MS: 6000,
  HEARTBEAT_INTERVAL_MS: 30000,
};

export const STORAGE_KEYS = {
  KITCHEN_PENDING_QUEUE: '@smartdine_kitchen_pending_queue',
  WAITER_PENDING_ORDERS: '@smartdine_waiter_pending_orders',
  WAITER_PENDING_CALLS: '@smartdine_waiter_pending_calls',
  OWNER_PENDING_ORDERS: '@smartdine_owner_pending_orders',
  USER_SESSION: '@smartdine_user_session',
};
