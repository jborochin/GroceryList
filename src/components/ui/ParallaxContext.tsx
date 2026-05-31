import React, { createContext, useContext } from 'react';
import { SharedValue, useSharedValue } from 'react-native-reanimated';

// Non-persisted, in-memory only: a single Reanimated shared value carrying the
// active scroll offset. Primary scroll views write to it; the root
// AmbientBackground reads it to drive the gradient parallax. Lives here (not in
// a Zustand store) so updates stay on the UI thread with no re-renders.
const ParallaxContext = createContext<SharedValue<number> | null>(null);

export function ParallaxProvider({ children }: { children: React.ReactNode }) {
  const scrollY = useSharedValue(0);
  return <ParallaxContext.Provider value={scrollY}>{children}</ParallaxContext.Provider>;
}

/** Shared scroll offset, or null when rendered outside a provider. */
export function useParallax(): SharedValue<number> | null {
  return useContext(ParallaxContext);
}
