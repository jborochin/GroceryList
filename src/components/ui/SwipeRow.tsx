import React, { useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../theme/tokens';
import { Text } from './Text';
import { haptics } from '../../utils/haptics';

interface Props {
  onDelete: () => void;
  deleteLabel?: string;
  children: React.ReactNode;
}

// Wraps a row with a left-swipe-to-delete affordance. Reveals a red action;
// a threshold haptic fires the first time the action becomes commit-sized.
// Tap on the revealed action confirms the destructive action.
export function SwipeRow({ onDelete, deleteLabel = 'Delete', children }: Props) {
  const t = useAppTheme();
  const triggered = useRef(false);
  const swipeableRef = useRef<Swipeable>(null);

  const renderRightActions = (
    progress: Animated.AnimatedInterpolation<string | number>
  ) => {
    const opacity = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    });
    const scale = progress.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.6, 0.95, 1],
    });

    return (
      <Animated.View style={[styles.action, { opacity, transform: [{ scale }] }]}>
        <Pressable
          onPress={() => {
            haptics.warn();
            swipeableRef.current?.close();
            onDelete();
          }}
          style={{
            backgroundColor: t.palette.danger,
            width: 96,
            height: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: t.radius.md,
          }}
          accessibilityRole="button"
          accessibilityLabel={deleteLabel}
        >
          <Icon name="trash-can-outline" size={20} color={t.palette.dangerSoft} />
          <Text variant="caption" style={{ color: t.palette.dangerSoft, marginTop: 2 }}>
            {deleteLabel}
          </Text>
        </Pressable>
      </Animated.View>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      friction={1.6}
      rightThreshold={48}
      onSwipeableWillOpen={() => {
        if (!triggered.current) {
          triggered.current = true;
          haptics.selection();
        }
      }}
      onSwipeableClose={() => {
        triggered.current = false;
      }}
      overshootRight={false}
    >
      <View>{children}</View>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
});
