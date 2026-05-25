import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeStore } from '../store/useRecipeStore';
import { RecipeCard } from '../components/RecipeCard';
import { EmptyState } from '../components/EmptyState';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import { confirm } from '../utils/confirm';
import {
  AmbientBackground,
  CollapsingHeader,
  Header,
  IconButton,
  Input,
  Button,
  Text,
  TAB_BAR_SPACE,
} from '../components/ui';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function RecipeLibraryScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const recipes = useRecipeStore((s) => s.recipes);
  const deleteRecipe = useRecipeStore((s) => s.deleteRecipe);
  const [query, setQuery] = useState('');

  const handleDelete = async (id: string, title: string) => {
    const ok = await confirm({
      title: `Delete ${title}?`,
      message: 'This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) deleteRecipe(id);
  };

  const filtered = useMemo(() => {
    if (!query.trim()) return recipes;
    const q = query.trim().toLowerCase();
    return recipes.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.ingredients.some((i) => i.name.toLowerCase().includes(q))
    );
  }, [recipes, query]);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  return (
    <View style={{ flex: 1, backgroundColor: t.palette.bg }}>
      <AmbientBackground />
      <Animated.FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingHorizontal: t.spacing.lg,
          paddingBottom: TAB_BAR_SPACE + t.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={
          <View>
            <Header
              title="Recipes"
              subtitle={
                recipes.length === 0
                  ? 'Build your library to start planning.'
                  : `${recipes.length} saved`
              }
            />
            {recipes.length > 0 ? (
              <View style={{ marginBottom: t.spacing.lg }}>
                <Input
                  placeholder="Search recipes or ingredients"
                  value={query}
                  onChangeText={setQuery}
                  leftIcon="magnify"
                  rightIcon={query ? 'close-circle' : undefined}
                  onRightPress={query ? () => setQuery('') : undefined}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
              </View>
            ) : null}
            {filtered.length > 0 && query ? (
              <Text variant="caption" tone="tertiary" style={{ marginBottom: t.spacing.sm }}>
                {filtered.length} {filtered.length === 1 ? 'match' : 'matches'}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <RecipeCard
            recipe={item}
            onPress={() => navigation.navigate('RecipeDetail', { recipeId: item.id })}
            trailing={
              <IconButton
                icon="delete-outline"
                variant="danger"
                size={18}
                onPress={() => handleDelete(item.id, item.title)}
                accessibilityLabel={`Delete ${item.title}`}
              />
            }
          />
        )}
        ListEmptyComponent={
          <View style={{ marginTop: t.spacing.xxl }}>
            <EmptyState
              icon="silverware-fork-knife"
              title={recipes.length === 0 ? 'Your library is empty' : 'No matches'}
              subtitle={
                recipes.length === 0
                  ? 'Tap the button below to add your first recipe — paste a URL or enter manually.'
                  : 'Try another search term.'
              }
            />
          </View>
        }
      />

      <View
        style={{
          position: 'absolute',
          right: t.spacing.lg,
          bottom: TAB_BAR_SPACE + t.spacing.sm,
        }}
      >
        <Button
          label="Add recipe"
          icon="plus"
          onPress={() => navigation.navigate('AddRecipe', undefined)}
          variant="primary"
          size="md"
          style={t.shadow.medium}
        />
      </View>
      <CollapsingHeader title="Recipes" scrollY={scrollY} />
    </View>
  );
}
