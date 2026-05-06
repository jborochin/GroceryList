import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useSettingsStore } from '../store/useSettingsStore';

// Returns true if the user wants reduced motion — either via the system
// accessibility flag or the in-app "Reduce visual effects" toggle.
export function useReducedMotion(): boolean {
  const userFlag = useSettingsStore((s) => s.settings.reduceVisualEffects);
  const [systemFlag, setSystemFlag] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (mounted) setSystemFlag(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      setSystemFlag(v);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return systemFlag || userFlag;
}
