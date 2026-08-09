import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config';

export const supabase = createClient(
  CONFIG.SUPABASE_URL,
  CONFIG.SUPABASE_ANON_KEY,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);

/**
 * Shared helper to create a monitored Realtime channel with status callback.
 */
export function createMonitoredChannel(channelName, table, filter, onData, onStatusChange) {
  const channel = supabase.channel(channelName);

  if (table && onData) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter },
      onData
    );
  }

  channel.subscribe((status) => {
    if (onStatusChange) {
      onStatusChange(status === 'SUBSCRIBED', status);
    }
  });

  return channel;
}

/**
 * Safe cleanup helper for Supabase channel unsubscriptions.
 */
export function removeChannelSafely(channel) {
  if (!channel) return;
  try {
    supabase.removeChannel(channel);
  } catch (e) {
    console.log('[Supabase] Channel remove warning:', e?.message);
  }
}
