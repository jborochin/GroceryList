import React, { useRef } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import ReanimatedSwipeable, {
  SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Reanimated, {
  interpolate,
  SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../theme/tokens';
import { haptics } from '../../utils/haptics';

interface Props {
  onDelete: () => void;
  deleteLabel?: string;
  icon?: string;
  children: React.ReactNode;
}

// Wraps a row with a left-swipe-to-delete affordance. Reveals a red action;
// a threshold haptic fires the first time the row opens. Tap on the revealed
// action confirms the destructive action.
//
// Built on ReanimatedSwipeable (UI-thread gesture) so it composes with lists
// whose scrolling is driven by useAnimatedScrollHandler — the legacy JS-thread
// Swipeable silently fails to activate inside those.
export function SwipeRow({ onDelete, deleteLabel = 'Delete', icon = 'trash-can-outline', children }: Props) {
  const t = useAppTheme();
  const triggered = useRef(false);
  const swipeableRef = useRef<SwipeableMethods | null>(null);

  const renderRightActions = (progress: SharedValue<number>) => (
    <RightAction
      progress={progress}
      icon={icon}
      label={deleteLabel}
      bg={t.palette.danger}
      fg="#FFFFFF"
      radius={t.radius.md}
      onPress={() => {
        haptics.warn();
        swipeableRef.current?.close();
        onDelete();
      }}
    />
  );

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      friction={1.6}
      rightThreshold={48}
      overshootRight={false}
      onSwipeableWillOpen={() => {
        if (!triggered.current) {
          triggered.current = true;
          haptics.selection();
        }
      }}
      onSwipeableClose={() => {
        triggered.current = false;
      }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

interface RightActionProps {
  progress: SharedValue<number>;
  icon: string;
  label: string;
  bg: string;
  fg: string;
  radius: number;
  onPress: () => void;
}

function RightAction({ progress, icon, label, bg, fg, radius, onPress }: RightActionProps) {
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: interpolate(progress.value, [0, 0.5, 1], [0.6, 0.95, 1]) }],
  }));

  return (
    <Reanimated.View style={[styles.action, style]}>
      <Pressable
        onPress={onPress}
        style={{
          backgroundColor: bg,
          width: 96,
          height: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius,
        }}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Icon name={icon} size={22} color={fg} />
      </Pressable>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  action: {
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
});
