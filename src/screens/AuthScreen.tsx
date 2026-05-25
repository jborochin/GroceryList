import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../store/useAuthStore';
import { useAppTheme } from '../theme/tokens';
import {
  AmbientBackground,
  Button,
  Header,
  IconButton,
  Input,
  SectionHeader,
  SegmentedControl,
  Surface,
  Text,
  useToast,
} from '../components/ui';
import { supabaseConfigured } from '../lib/supabase';

type Mode = 'signIn' | 'signUp';

export function AuthScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const toast = useToast();

  const session = useAuthStore((s) => s.session);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const signInWithEmail = useAuthStore((s) => s.signInWithEmail);
  const signUpWithEmail = useAuthStore((s) => s.signUpWithEmail);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const clearError = useAuthStore((s) => s.clearError);

  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  React.useEffect(() => {
    if (session) navigation.goBack();
  }, [session, navigation]);

  const submit = async () => {
    clearError();
    if (mode === 'signIn') {
      await signInWithEmail(email.trim(), password);
    } else {
      await signUpWithEmail(email.trim(), password);
      const { error: latestError, session: latestSession } = useAuthStore.getState();
      if (!latestError && !latestSession) {
        toast.show({
          message: 'Check your email to confirm the account.',
          tone: 'neutral',
        });
      }
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.palette.bg }}>
      <AmbientBackground />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            paddingTop: insets.top + t.spacing.md,
            paddingHorizontal: t.spacing.lg,
            paddingBottom: insets.bottom + t.spacing.xl,
            flexGrow: 1,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              marginBottom: t.spacing.sm,
            }}
          >
            <IconButton icon="close" onPress={() => navigation.goBack()} />
          </View>
          <Header
            title={mode === 'signIn' ? 'Welcome back' : 'Create your account'}
            subtitle={
              mode === 'signIn'
                ? 'Sign in to sync your recipes, plan, and pantry across devices.'
                : 'Your local data will move into your account on first sign-in.'
            }
          />

          <SegmentedControl<Mode>
            items={[
              { value: 'signIn', label: 'Sign in' },
              { value: 'signUp', label: 'Sign up' },
            ]}
            value={mode}
            onChange={(v) => {
              clearError();
              setMode(v);
            }}
            style={{ marginBottom: t.spacing.lg }}
          />

          <Surface variant="outlined" pad={t.spacing.lg}>
            <Input
              label="Email"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              containerStyle={{ marginBottom: t.spacing.md }}
            />
            <Input
              label="Password"
              autoCapitalize="none"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            {error ? (
              <Text variant="caption" style={{ color: t.palette.danger, marginTop: t.spacing.sm }}>
                {error}
              </Text>
            ) : null}
            <Button
              label={mode === 'signIn' ? 'Sign in' : 'Create account'}
              onPress={submit}
              loading={loading}
              disabled={!email || !password}
              fullWidth
              style={{ marginTop: t.spacing.lg }}
            />
          </Surface>

          <SectionHeader title="Or continue with" />
          <Button
            label="Continue with Google"
            icon="google"
            variant="secondary"
            onPress={signInWithGoogle}
            loading={loading}
            fullWidth
          />

          {!supabaseConfigured ? (
            <Text
              variant="caption"
              tone="tertiary"
              style={{ textAlign: 'center', marginTop: t.spacing.xl }}
            >
              Supabase is not configured. See supabase/README.md.
            </Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
