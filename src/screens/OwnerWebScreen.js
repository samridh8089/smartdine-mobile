import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  BackHandler,
  Alert,
  Platform,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const DASHBOARD_URL = 'https://www.cleverops.in/dashboard';

export default function OwnerWebScreen({ navigation, route }) {
  const profile = route?.params?.profile || {};
  const webViewRef = useRef(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [sessionJson, setSessionJson] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // 1. Fetch current active Supabase session to inject into WebView
  useEffect(() => {
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
  }, []);

  // 2. Hardware Back Button handler on Android
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const onBackPress = () => {
      if (canGoBack && webViewRef.current) {
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
  }, [canGoBack]);

  // 3. Pre-inject session token before page loads
  const injectedAuthScript = `
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
  `;

  // 4. Handle messages from web app (e.g. sign out)
  const handleMessage = async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data?.type === 'SIGN_OUT') {
        await AsyncStorage.removeItem('@smartdine_auth_profile').catch(() => {});
        await supabase.auth.signOut().catch(() => {});
        navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
      }
    } catch (_) {}
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <WebView
        ref={webViewRef}
        source={{ uri: DASHBOARD_URL }}
        injectedJavaScriptBeforeContentLoaded={injectedAuthScript}
        onNavigationStateChange={(navState) => {
          setCanGoBack(navState.canGoBack);
          // If web app redirects to /login, route to native Login
          if (navState.url && navState.url.includes('/login') && !navState.loading) {
            navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          }
        }}
        onLoadEnd={() => setIsLoading(false)}
        onMessage={handleMessage}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        sharedCookiesEnabled={true}
        thirdPartyCookiesEnabled={true}
        allowsBackForwardNavigationGestures={true}
        pullToRefreshEnabled={true}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        overScrollMode="never"
        bounces={false}
        style={styles.webView}
      />
      {isLoading && (
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
