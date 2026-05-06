import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../../theme/tokens';
import { useSettingsStore } from '../../store/useSettingsStore';

// Full-screen warm gradient backdrop that gives glass surfaces something to
// refract against. Returns a flat bg fill when reduce-effects is on.
export function AmbientBackground() {
  const t = useAppTheme();
  const reduceEffects = useSettingsStore((s) => s.settings.reduceVisualEffects);

  if (reduceEffects) {
    return (
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { backgroundColor: t.palette.bg }]}
      />
    );
  }

  return (
    <LinearGradient
      pointerEvents="none"
      colors={[t.palette.ambienceA, t.palette.ambienceB, t.palette.ambienceC]}
      locations={[0, 0.55, 1]}
      style={StyleSheet.absoluteFill}
    />
  );
}
