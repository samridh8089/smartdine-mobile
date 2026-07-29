import { registerRootComponent } from 'expo';
import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import App from './App';

// Global Uncaught Exception Handler
if (global.ErrorUtils) {
  try {
    const originalHandler = global.ErrorUtils.getGlobalHandler();
    global.ErrorUtils.setGlobalHandler((error, isFatal) => {
      console.log('CRITICAL GLOBAL JS ERROR:', error);
      if (originalHandler) {
        try {
          originalHandler(error, isFatal);
        } catch (_) {}
      }
    });
  } catch (e) {
    console.log('Failed to attach ErrorUtils handler:', e);
  }
}

class RootErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.log('ROOT ERROR BOUNDARY CAUGHT:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const errStr = String(this.state.error || 'Unknown Error');
      const stack = this.state.error?.stack || '';
      return (
        <View style={styles.container}>
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>App Launch Error</Text>
            <Text style={styles.label}>Error Details:</Text>
            <Text style={styles.code}>{errStr}</Text>
            <Text style={styles.label}>Stack Trace:</Text>
            <Text style={styles.stack}>{stack}</Text>
          </ScrollView>
        </View>
      );
    }
    return this.props.children;
  }
}

function Root() {
  return (
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  );
}

registerRootComponent(Root);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 24,
    paddingTop: 60,
  },
  title: {
    color: '#ef4444',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  label: {
    color: '#0ea5e9',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 12,
    marginBottom: 6,
  },
  code: {
    color: '#0f172a',
    fontSize: 13,
    fontFamily: 'monospace',
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    padding: 12,
    borderRadius: 8,
  },
  stack: {
    color: '#64748b',
    fontSize: 11,
    fontFamily: 'monospace',
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderWidth: 1,
    padding: 12,
    borderRadius: 8,
  },
});
