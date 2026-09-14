import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
  resetting: boolean;
}

/**
 * Last line of defence under the navigator.
 *
 * Without it, a render-time throw anywhere in the tree is a white screen with no
 * way back except reinstalling. Offers "Try again" (re-render) and, for the case
 * where persisted state itself is what throws, "Reset local data" — which clears
 * AsyncStorage. Account data is unaffected: it is re-pulled from Supabase on the
 * next sign-in, and the sync outbox is deliberately part of what gets cleared so a
 * poisoned entry can't be replayed.
 *
 * Deliberately plain React Native primitives, no theme or Paper: the theme
 * provider may be what failed.
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, resetting: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  private retry = () => this.setState({ error: null });

  private resetLocalData = async () => {
    this.setState({ resetting: true });
    try {
      await AsyncStorage.clear();
    } catch {
      // Nothing more to do — the retry below still gives the tree another chance.
    }
    this.setState({ error: null, resetting: false });
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          MealFlow hit an error it couldn't recover from. You can try again, or reset the data
          stored on this device. Anything synced to your account will come back when you sign in.
        </Text>
        <Text style={styles.detail} numberOfLines={4}>
          {this.state.error.message}
        </Text>
        <Pressable onPress={this.retry} style={[styles.button, styles.primary]}>
          <Text style={styles.primaryLabel}>Try again</Text>
        </Pressable>
        <Pressable
          onPress={this.resetLocalData}
          disabled={this.state.resetting}
          style={[styles.button, styles.secondary]}
        >
          <Text style={styles.secondaryLabel}>
            {this.state.resetting ? 'Resetting…' : 'Reset local data'}
          </Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#F5F8F6',
  },
  title: { fontSize: 22, fontWeight: '700', color: '#34495E', marginBottom: 12 },
  body: { fontSize: 15, lineHeight: 22, color: '#34495E', marginBottom: 12 },
  detail: { fontSize: 12, color: '#7F8C8D', marginBottom: 24, fontFamily: 'monospace' },
  button: { paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  primary: { backgroundColor: '#2ECC71' },
  primaryLabel: { color: '#FFFFFF', fontWeight: '600', fontSize: 16 },
  secondary: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#D5DBDB' },
  secondaryLabel: { color: '#34495E', fontWeight: '600', fontSize: 16 },
});
