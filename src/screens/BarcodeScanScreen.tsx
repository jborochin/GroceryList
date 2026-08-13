import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FoodSearchError, lookupBarcode } from '../lib/foodSearch';
import { haptics } from '../utils/haptics';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import { Button, IconButton, Surface, Text } from '../components/ui';

type Nav = NativeStackNavigationProp<RootStackParamList>;

// The symbologies actually printed on grocery packaging. Narrowing the list
// keeps the decoder off QR codes and shipping labels, which speeds up
// recognition and stops a poster in the background hijacking the scan.
const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

/**
 * Scan a product barcode and log it.
 *
 * Native only — the web build hides the entry point, because there is no camera
 * to open. Cannot run in Expo Go either; it needs a development build
 * (`eas build --profile development`).
 */
export function BarcodeScanScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'BarcodeScan'>>();
  const { slot, date, replacesCellId } = params;

  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<'scanning' | 'resolving' | 'missed'>('scanning');
  const [missedCode, setMissedCode] = useState('');
  const [offline, setOffline] = useState(false);

  // The camera fires continuously while a barcode is in frame — dozens of
  // callbacks a second for one physical scan. A ref (not state) gates them,
  // because state wouldn't have committed before the next callback arrives.
  const handled = useRef(false);

  const handleScanned = useCallback(
    ({ data }: { data: string }) => {
      if (handled.current) return;
      handled.current = true;
      haptics.selection();
      setStatus('resolving');

      void lookupBarcode(data)
        .then((item) => {
          navigation.replace('LogFood', { item, slot, date, replacesCellId });
        })
        .catch((err: unknown) => {
          // A miss is routine, not an error: anything regional, small batch or
          // newly launched will be absent from both databases. Offer to create
          // it rather than bouncing the user back to a search box.
          //
          // A network failure is NOT the same thing and must not be reported as
          // "not in the database" — the fix there is to retry, not to retype a
          // food that probably does exist.
          const offline = err instanceof FoodSearchError && err.kind !== 'not-found';
          setMissedCode(data);
          setOffline(offline);
          setStatus('missed');
        });
    },
    [navigation, slot, date, replacesCellId]
  );

  const rescan = () => {
    handled.current = false;
    setStatus('scanning');
  };

  if (!permission) {
    // Permission state is still loading.
    return <View style={{ flex: 1, backgroundColor: '#000' }} />;
  }

  if (!permission.granted) {
    return (
      <View style={[styles.fill, { backgroundColor: t.palette.bg, paddingTop: insets.top }]}>
        <View style={{ padding: t.spacing.lg, gap: t.spacing.md }}>
          <Text variant="title">Camera access needed</Text>
          <Text variant="body" tone="secondary">
            MealFlow uses the camera to read barcodes on food packaging. Nothing is recorded or
            uploaded — the barcode digits are all that leave your device.
          </Text>
          <Button
            label={permission.canAskAgain ? 'Allow camera' : 'Open settings'}
            icon="camera"
            onPress={() => void requestPermission()}
            size="lg"
            fullWidth
          />
          <Button
            label="Search instead"
            variant="tonal"
            onPress={() => navigation.goBack()}
            fullWidth
          />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: '#000' }]}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }}
        onBarcodeScanned={status === 'scanning' ? handleScanned : undefined}
      />

      {/* Reticle. Purely an aiming aid, so it never intercepts touches. */}
      <View pointerEvents="none" style={styles.center}>
        <View
          style={{
            width: '78%',
            aspectRatio: 1.9,
            borderWidth: 2,
            borderColor: status === 'scanning' ? 'rgba(255,255,255,0.85)' : t.palette.primary,
            borderRadius: t.radius.lg,
          }}
        />
      </View>

      <View style={[styles.top, { paddingTop: insets.top + t.spacing.sm }]}>
        <IconButton
          icon="close"
          onPress={() => navigation.goBack()}
          variant="overlay"
          size={22}
          accessibilityLabel="Close the scanner"
        />
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + t.spacing.lg }]}>
        {status === 'scanning' ? (
          <Surface variant="flat" pad={t.spacing.md} style={{ alignItems: 'center' }}>
            <Text variant="body" weight="medium">
              Point at a barcode
            </Text>
            <Text variant="micro" tone="tertiary" style={{ marginTop: 2 }}>
              Hold steady — the whole barcode inside the frame.
            </Text>
          </Surface>
        ) : null}

        {status === 'resolving' ? (
          <Surface
            variant="flat"
            pad={t.spacing.md}
            style={{ flexDirection: 'row', alignItems: 'center', gap: t.spacing.sm }}
          >
            <ActivityIndicator color={t.palette.primary} />
            <Text variant="body">Looking it up…</Text>
          </Surface>
        ) : null}

        {status === 'missed' ? (
          <Surface variant="flat" pad={t.spacing.lg} style={{ gap: t.spacing.sm }}>
            <Text variant="title">{offline ? "Couldn't look that up" : 'Not in the database'}</Text>
            <Text variant="small" tone="secondary">
              {offline
                ? `Barcode ${missedCode} couldn't be checked — you may be offline. Try again, or add it by hand.`
                : `Barcode ${missedCode} isn't in FoodData Central or Open Food Facts. Add it once and it's saved to your own foods.`}
            </Text>
            {/* Retry leads when the lookup failed; creating leads when it
                genuinely missed. Same two buttons, ordered by what will work. */}
            {offline ? (
              <Button label="Try again" variant="primary" icon="refresh" onPress={rescan} fullWidth />
            ) : null}
            <Button
              label="Add this food"
              icon="pencil-plus"
              variant={offline ? 'tonal' : 'primary'}
              onPress={() =>
                navigation.replace('CustomFood', {
                  slot,
                  date,
                  replacesCellId,
                  barcode: missedCode,
                })
              }
              fullWidth
            />
            {!offline ? (
              <Button label="Scan again" variant="tonal" icon="barcode-scan" onPress={rescan} fullWidth />
            ) : null}
          </Surface>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', left: 16, top: 0 },
  bottom: { position: 'absolute', left: 16, right: 16, bottom: 0 },
});
