import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';

// Local notifications for cook-mode timers, so a timer still buzzes when the
// phone is in your pocket and the app is closed.
//
// Everything here degrades to a no-op rather than throwing: on web (no native
// module), when the user declines the permission prompt, and if the platform
// call fails for any reason. Cook mode must stay fully usable without
// notifications — the sticky timer bar counts down correctly either way, since
// the countdown is derived from an absolute `endsAt` rather than from a
// delivered alert. A notification is an extra nudge, never the source of truth.

const ANDROID_CHANNEL = 'cook-timers';

const supported = Platform.OS === 'ios' || Platform.OS === 'android';

/**
 * Show timer alerts even while the app is foregrounded — during a cook the
 * screen is often on but face-down or across the kitchen.
 *
 * Called once from App.tsx.
 */
export function configureCookNotifications(): void {
  if (!supported) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: false,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

let permissionChecked = false;
let permissionGranted = false;

/**
 * Ask for notification permission, lazily — the first time a timer is started,
 * not at app launch. A cold prompt on first open, before the user has any idea
 * what we'd notify them about, is the fastest way to get denied forever.
 *
 * The answer is cached for the session; a denial is not re-prompted.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!supported) return false;
  if (permissionChecked) return permissionGranted;
  permissionChecked = true;

  try {
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted;
    if (!granted && current.canAskAgain) {
      granted = (await Notifications.requestPermissionsAsync()).granted;
    }

    if (granted && Platform.OS === 'android') {
      // Android drops notifications on the floor without a channel, and the
      // channel is where importance and sound actually live.
      await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
        name: 'Cooking timers',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    permissionGranted = granted;
  } catch {
    permissionGranted = false;
  }
  return permissionGranted;
}

/**
 * Schedule the alert for a timer that ends at `endsAt` (epoch ms).
 * Returns the handle to cancel with, or `null` when notifications are
 * unavailable — callers must treat `null` as normal, not as an error.
 */
export async function scheduleTimerNotification(
  label: string,
  recipeTitle: string,
  endsAt: number
): Promise<string | null> {
  if (!(await ensureNotificationPermission())) return null;
  // Already elapsed (a timer resumed past its end) — the in-app bar handles it.
  if (endsAt <= Date.now()) return null;

  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: `${label} is done`,
        body: recipeTitle,
        sound: 'default',
        ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL } : {}),
      },
      trigger: {
        type: SchedulableTriggerInputTypes.DATE,
        date: new Date(endsAt),
      },
    });
  } catch {
    return null;
  }
}

/** Cancel a scheduled alert — on pause, on delete, and when the session ends. */
export async function cancelTimerNotification(id: string | undefined): Promise<void> {
  if (!supported || !id) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(id);
  } catch {
    // Already delivered or already cancelled; nothing to do either way.
  }
}
