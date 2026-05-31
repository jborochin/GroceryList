import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';

// Liquid Glass accessibility flags. Each hook OR's the OS-level
// AccessibilityInfo setting with the in-app `reduceVisualEffects` toggle, so
// either source can force the solid / no-motion fallbacks at runtime.

function useOsFlag(
  read: () => Promise<boolean> | undefined,
  event: 'reduceTransparencyChanged' | 'reduceMotionChanged'
): boolean {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    let mounted = true;
    const initial = read();
    if (initial) {
      initial.then((v) => mounted && setFlag(v)).catch(() => undefined);
    }
    const sub = AccessibilityInfo.addEventListener(event, setFlag);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, [read, event]);
  return flag;
}

/** True when glass should fall back to a solid surface (no blur/translucency). */
export function useReduceTransparency(): boolean {
  const setting = useSettingsStore((s) => s.settings.reduceVisualEffects);
  const os = useOsFlag(
    () => AccessibilityInfo.isReduceTransparencyEnabled?.(),
    'reduceTransparencyChanged'
  );
  return setting || os;
}

/** True when motion (gradient parallax, springs) should be frozen. */
export function useReduceMotion(): boolean {
  const setting = useSettingsStore((s) => s.settings.reduceVisualEffects);
  const os = useOsFlag(
    () => AccessibilityInfo.isReduceMotionEnabled(),
    'reduceMotionChanged'
  );
  return setting || os;
}
