import { useEffect, useRef } from 'react';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { useShareIntentContext } from 'expo-share-intent';
import { parseSharedUrl } from '../utils/instagramUrl';
import { RootStackParamList } from '../navigation/types';

// Turns "Share → MealFlow" into a screen. The provider above us handles the native
// plumbing (it listens on expo-linking's URL plus a native event, and re-checks
// whenever the app becomes active), so this only has to decide where a share goes.
//
// Navigation happens through the container ref rather than a linking config: the
// app has never had one, and the provider does not need it — useLinkingURL
// delivers the URL on its own, on both cold and warm start.

interface Options {
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>;
  /** NavigationContainer's onReady has fired. A share can land before it does. */
  ready: boolean;
}

export function useShareIntentRouter({ navigationRef, ready }: Options): void {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  // The provider re-emits on app-active, so without this the same share would
  // navigate again every time the app came back to the foreground.
  const lastHandled = useRef<string | null>(null);

  useEffect(() => {
    if (!hasShareIntent || !ready || !navigationRef.isReady()) return;

    // iOS hands over a weburl; Android hands over text/plain, often with the
    // caption or a "Check this out" wrapped around the link.
    const payload = shareIntent.webUrl ?? shareIntent.text ?? '';
    const target = parseSharedUrl(payload);

    if (target.kind === 'none') {
      // Nothing importable — a shared image, a profile link, plain text. Clearing
      // it stops the provider re-offering it on every foreground.
      resetShareIntent();
      return;
    }
    if (lastHandled.current === target.url) return;
    lastHandled.current = target.url;

    // AddRecipe imports a sharedUrl on mount, choosing the Instagram caption path
    // or the JSON-LD path by classifying the URL itself.
    navigationRef.navigate('AddRecipe', { sharedUrl: target.url });
    resetShareIntent();
  }, [hasShareIntent, shareIntent, ready, navigationRef, resetShareIntent]);
}
