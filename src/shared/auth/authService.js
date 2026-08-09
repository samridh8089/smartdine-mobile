import { supabase } from '../supabase/client';
import { stopAllAlarms } from '../audio/alarmManager';
import { storage } from '../storage';
import { STORAGE_KEYS } from '../config';

export const authService = {
  /**
   * Shared Login helper
   */
  async login(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    return data;
  },

  /**
   * Shared Logout helper
   */
  async logout() {
    try {
      stopAllAlarms();
      await supabase.auth.signOut().catch(() => {});
      await storage.removeItem(STORAGE_KEYS.USER_SESSION);
    } catch (e) {
      console.log('[AuthService] Logout warning:', e?.message);
    }
  },

  /**
   * Shared Session Check & Profile Fetch
   */
  async getCurrentUserSession() {
    try {
      const { data: { session }, error: sessionErr } = await supabase.auth.getSession();
      if (sessionErr || !session) return null;

      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('*, restaurants(*)')
        .eq('id', session.user.id)
        .maybeSingle();

      if (profileErr) {
        console.log('[AuthService] Profile fetch error:', profileErr.message);
        return { user: session.user, profile: null };
      }

      return { user: session.user, profile };
    } catch (e) {
      console.log('[AuthService] Session check exception:', e?.message);
      return null;
    }
  },

  /**
   * Shared Navigation Target Helper by Role
   */
  getInitialRouteForRole(role) {
    switch (role) {
      case 'kitchen':
        return 'KitchenApp';
      case 'waiter':
        return 'WaiterApp';
      case 'owner':
      case 'manager':
      case 'cashier':
        return 'MainApp';
      case 'super_admin':
        return 'SuperAdmin';
      default:
        return 'Login';
    }
  },
};
