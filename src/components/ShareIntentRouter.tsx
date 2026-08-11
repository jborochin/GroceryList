import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';
import { useShareIntentRouter } from '../hooks/useShareIntentRouter';
import { RootStackParamList } from '../navigation/types';

// Renders nothing; it exists so useShareIntentRouter runs inside ShareIntentProvider.
// App itself renders the provider, so it cannot consume that context directly.
export function ShareIntentRouter(props: {
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>;
  ready: boolean;
}): null {
  useShareIntentRouter(props);
  return null;
}
