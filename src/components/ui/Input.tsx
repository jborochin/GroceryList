import React, { useState } from 'react';
import { Pressable, TextInput, TextInputProps, View, ViewStyle } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAppTheme } from '../../theme/tokens';
import { Text } from './Text';

interface Props extends Omit<TextInputProps, 'style'> {
  label?: string;
  helper?: string;
  error?: string;
  leftIcon?: string;
  rightIcon?: string;
  onRightPress?: () => void;
  multiline?: boolean;
  containerStyle?: ViewStyle;
}

export function Input({
  label,
  helper,
  error,
  leftIcon,
  rightIcon,
  onRightPress,
  multiline,
  containerStyle,
  ...rest
}: Props) {
  const t = useAppTheme();
  const [focused, setFocused] = useState(false);

  const borderColor = error
    ? t.palette.danger
    : focused
    ? t.palette.primary
    : t.palette.border;

  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="caption" weight="medium" tone="secondary" style={{ marginBottom: 6 }}>
          {label}
        </Text>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: multiline ? 'flex-start' : 'center',
          backgroundColor: t.palette.surface,
          borderColor,
          borderWidth: 1,
          borderRadius: t.radius.sm,
          paddingHorizontal: t.spacing.md,
          paddingVertical: multiline ? t.spacing.sm : 0,
          minHeight: multiline ? 96 : 48,
        }}
      >
        {leftIcon ? (
          <Icon
            name={leftIcon}
            size={18}
            color={t.palette.textTertiary}
            style={{ marginRight: 8, marginTop: multiline ? 4 : 0 }}
          />
        ) : null}
        <TextInput
          {...rest}
          multiline={multiline}
          onFocus={(e) => {
            setFocused(true);
            rest.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            rest.onBlur?.(e);
          }}
          placeholderTextColor={t.palette.textTertiary}
          style={{
            flex: 1,
            color: t.palette.textPrimary,
            fontFamily: t.font.regular,
            fontSize: t.fontSize.body,
            paddingVertical: multiline ? 4 : 12,
            textAlignVertical: multiline ? 'top' : 'center',
          }}
        />
        {rightIcon ? (
          <Pressable onPress={onRightPress} hitSlop={8}>
            <Icon name={rightIcon} size={18} color={t.palette.textTertiary} style={{ marginLeft: 8 }} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text variant="caption" tone="danger" style={{ marginTop: 6 }}>
          {error}
        </Text>
      ) : helper ? (
        <Text variant="caption" tone="tertiary" style={{ marginTop: 6 }}>
          {helper}
        </Text>
      ) : null}
    </View>
  );
}
