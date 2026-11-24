import React, { useRef, useState, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  Alert,
  Platform,
  StatusBar,
  SafeAreaView,
  Share,
  Linking,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const DASHBOARD_URL = 'https://www.cleverops.in/dashboard';
const WEBVIEW_SOURCE = { uri: DASHBOARD_URL };

export default function OwnerWebScreen({ navigation, route }) {
  const profile = route?.params?.profile || {};
  const webViewRef = useRef(null);
  const canGoBackRef = useRef(false);
  const [sessionJson, setSessionJson] = useState(route?.params?.sessionJson || null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  // 1. Fetch active Supabase session if not passed via navigation params
  useEffect(() => {
    if (!sessionJson) {
      async function loadSession() {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
            setSessionJson(JSON.stringify(session));
          }
        } catch (err) {
          console.log('[OwnerWebScreen] session fetch warning:', err?.message);
        }
      }
      loadSession();
    }
  }, [sessionJson]);

  // 2. Hardware Back Button handler on Android (reads ref directly to avoid re-renders)
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBackPress = () => {
      if (canGoBackRef.current && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      Alert.alert(
        'Exit CleverOps',
        'Are you sure you want to exit the app?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Exit', onPress: () => BackHandler.exitApp() },
        ],
        { cancelable: true }
      );
      return true;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backHandler.remove();
  }, []);

  // Clean sign-out and return to Login without splash flicker
  const handleSignOutAndReset = async () => {
    try {
      await AsyncStorage.removeItem('@smartdine_auth_profile').catch(() => {});
      await supabase.auth.signOut().catch(() => {});
      navigation.reset({ index: 0, routes: [{ name: 'Login', params: { skipSplash: true } }] });
    } catch (_) {}
  };

  // 3. Pre-inject session token before page loads (memoized so script reference is stable)
  const injectedAuthScript = useMemo(() => `
    (function() {
      try {
        ${sessionJson ? `
          var sessionObj = ${sessionJson};
          if (sessionObj && sessionObj.access_token) {
            localStorage.setItem('smartdine_auth_token_v2', JSON.stringify(sessionObj));
          }
        ` : ''}
        // Bridge for sign out
        window.__CLEVEROPS_MOBILE_APP__ = true;
      } catch(e) {}
    })();
    true;
  `, [sessionJson]);

  // 4. Handle messages from web app (sign out, file downloads, native shares)
  const handleMessage = async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data?.type === 'SIGN_OUT') {
        await handleSignOutAndReset();
      } else if (data?.type === 'SHARE_FILE' || data?.type === 'DOWNLOAD_FILE') {
        try {
          const rawBase64 = (data.base64 || '').replace(/^data:image\/[a-z]+;base64,/, '');
          const filename = data.filename || `salary_slip_${Date.now()}.png`;
          const fileUri = `${FileSystem.cacheDirectory}${filename}`;
          if (rawBase64) {
            await FileSystem.writeAsStringAsync(fileUri, rawBase64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            if (data.type === 'SHARE_FILE') {
              await Share.share({
                url: fileUri,
                title: data.title || 'Salary Slip',
                message: data.message || `Salary Slip: ${filename}`,
              });
            } else {
              Alert.alert('Slip Saved', `Salary slip saved to device:\n${filename}`);
            }
          }
        } catch (fileErr) {
          console.log('[OwnerWebScreen] file share error:', fileErr?.message);
        }
      }
    } catch (_) {}
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <WebView
        ref={webViewRef}
        source={WEBVIEW_SOURCE}
        injectedJavaScriptBeforeContentLoaded={injectedAuthScript}
        onShouldStartLoadWithRequest={(request) => {
          if (
            request.url.startsWith('whatsapp://') ||
            request.url.startsWith('https://wa.me') ||
            request.url.startsWith('intent://') ||
            request.url.startsWith('mailto:') ||
            request.url.startsWith('tel:')
          ) {
            Linking.openURL(request.url).catch(() => {});
            return false;
          }
          return true;
        }}
        onNavigationStateChange={(navState) => {
          canGoBackRef.current = !!navState.canGoBack;
          // If web app redirects to /login, route cleanly to native Login
          if (navState.url && navState.url.includes('/login') && !navState.loading) {
            handleSignOutAndReset();
          }
        }}
        onLoadEnd={() => setIsInitialLoading(false)}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
        allowsBackForwardNavigationGestures={true}
        pullToRefreshEnabled={false}
        androidLayerType="hardware"
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        overScrollMode="never"
        bounces={false}
        style={styles.webView}
      />
      {isInitialLoading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color="#059669" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingTop: Platform.OS === 'android' ? Math.max(StatusBar.currentHeight || 0, 38) + 6 : 0,
  },
  webView: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
});
