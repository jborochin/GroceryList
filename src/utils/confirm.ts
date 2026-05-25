import { Alert, Platform } from 'react-native';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

// Cross-platform confirm. React Native's Alert.alert on web maps to
// window.alert and ignores button callbacks, so destructive flows must
// branch to window.confirm there.
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  const {
    title,
    message,
    confirmLabel = 'OK',
    cancelLabel = 'Cancel',
    destructive = false,
  } = opts;

  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    return Promise.resolve(
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(text)
        : true
    );
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      {
        text: confirmLabel,
        style: destructive ? 'destructive' : 'default',
        onPress: () => resolve(true),
      },
    ]);
  });
}
