import { supabase } from './supabase';
import { CONFIG } from '../shared/config';

/**
 * Robust HTTP client with automatic Supabase JWT attachment and auto-refresh.
 * Solves mobile 401 UNAUTHORIZED issues across Android APK and iOS.
 */
export async function getValidAccessToken() {
  try {
    const { data: sessionData, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) {
      console.warn('[apiClient] getSession error:', sessionErr.message);
    }

    let session = sessionData?.session;

    // Check if token is missing, expired, or expiring within 2 minutes (120 seconds)
    const isExpiringSoon = session?.expires_at
      ? (session.expires_at * 1000 - Date.now()) < 120000
      : false;

    if (!session?.access_token || isExpiringSoon) {
      console.log('[apiClient] Session missing or expiring soon, refreshing...');
      const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
      if (!refreshErr && refreshData?.session) {
        session = refreshData.session;
        console.log('[apiClient] Session successfully refreshed.');
      } else if (refreshErr) {
        console.warn('[apiClient] refreshSession warning:', refreshErr.message);
      }
    }

    return session?.access_token || null;
  } catch (err) {
    console.error('[apiClient] Failed to retrieve valid access token:', err);
    return null;
  }
}

/**
 * Dispatches an HTTP request with Authorization: Bearer <token>
 * Automatically handles baseUrl prepending and 401 auto-retry once after fresh refresh.
 */
export async function fetchWithAuth(urlOrPath, options = {}) {
  const baseUrl = CONFIG.API_BASE_URL || 'https://www.cleverops.in';
  const fullUrl = urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://')
    ? urlOrPath
    : `${baseUrl.replace(/\/$/, '')}/${urlOrPath.replace(/^\//, '')}`;

  let token = await getValidAccessToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    console.warn('[apiClient] No Supabase access token found for request to:', fullUrl);
  }

  let response = await fetch(fullUrl, {
    ...options,
    headers
  });

  // If 401 Unauthorized, force one silent token refresh and retry once
  if (response.status === 401) {
    console.warn(`[apiClient] 401 received from ${fullUrl}. Attempting force refresh & retry...`);
    try {
      const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
      if (!refreshErr && refreshData?.session?.access_token) {
        token = refreshData.session.access_token;
        headers['Authorization'] = `Bearer ${token}`;
        response = await fetch(fullUrl, {
          ...options,
          headers
        });
        console.log(`[apiClient] Retry request completed with status: ${response.status}`);
      }
    } catch (retryErr) {
      console.error('[apiClient] Error during 401 retry:', retryErr);
    }
  }

  return response;
}
