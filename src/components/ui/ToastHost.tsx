import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeInUp,
  FadeOutUp,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../theme/tokens';
import { GlassSurface } from './GlassSurface';
import { Text } from './Text';
import { haptics } from '../../utils/haptics';

type ToastTone = 'neutral' | 'success' | 'warning' | 'danger';

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  durationMs?: number;
  action?: { label: string; onPress: () => void };
}

interface InternalToast extends ToastOptions {
  id: number;
}

interface ToastApi {
  show: (opts: ToastOptions) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) {
    // Allow noop usage in tests / non-mounted hosts.
    return { show: () => {} };
  }
  return api;
}

export function ToastHost({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<InternalToast | null>(null);
  const idRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const show = useCallback((opts: ToastOptions) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    idRef.current += 1;
    const next: InternalToast = { id: idRef.current, ...opts };
    setToast(next);
    if (opts.tone === 'success') haptics.success();
    else if (opts.tone === 'warning' || opts.tone === 'danger') haptics.warn();
    const dur = opts.durationMs ?? 3500;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setToast((cur) => (cur && cur.id === next.id ? null : cur));
    }, dur);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastView toast={toast} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: InternalToast | null; onDismiss: () => void }) {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();

  if (!toast) return null;

  const iconName =
    toast.tone === 'success'
      ? 'check-circle-outline'
      : toast.tone === 'warning'
      ? 'alert-outline'
      : toast.tone === 'danger'
      ? 'alert-octagon-outline'
      : 'information-outline';

  const iconColor =
    toast.tone === 'success'
      ? t.palette.success
      : toast.tone === 'warning'
      ? t.palette.warning
      : toast.tone === 'danger'
      ? t.palette.danger
      : t.palette.textSecondary;

  return (
    <View
      pointerEvents="box-none"
      style={[
        styles.host,
        { top: insets.top + 8, left: t.spacing.lg, right: t.spacing.lg },
      ]}
      accessibilityLiveRegion="polite"
    >
      <Animated.View
        key={toast.id}
        entering={FadeInUp.duration(220)}
        exiting={FadeOutUp.duration(180)}
      >
        <GlassSurface variant="chrome" radius={t.radius.lg} shadow="strong">
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: t.spacing.md,
              paddingHorizontal: t.spacing.lg,
              paddingVertical: t.spacing.md,
            }}
          >
            <Icon name={iconName} size={20} color={iconColor} />
            <Text variant="body" weight="medium" style={{ flex: 1 }} numberOfLines={2}>
              {toast.message}
            </Text>
            {toast.action ? (
              <Pressable
                onPress={() => {
                  toast.action!.onPress();
                  onDismiss();
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={toast.action.label}
              >
                <Text variant="body" weight="semibold" tone="accent">
                  {toast.action.label}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </GlassSurface>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    zIndex: 1000,
  },
});
