import React, { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRecipeStore } from '../store/useRecipeStore';
import { RecipeCard } from '../components/RecipeCard';
import { EmptyState } from '../components/EmptyState';
import { RootStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/tokens';
import { Header, Input, Button, Text, TAB_BAR_SPACE } from '../components/ui';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function RecipeLibraryScreen() {
  const t = useAppTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<Nav>();
  const recipes = useRecipeStore((s) => s.recipes);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return recipes;
    const q = query.trim().toLowerCase();
    return recipes.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        r.ingredients.some((i) => i.name.toLowerCase().includes(q))
    );
  }, [recipes, query]);

  return (
    <View style={{ flex: 1, backgroundColor: t.palette.bg }}>
      <FlatList
        data={filtered}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingHorizontal: t.spacing.lg,
          paddingBottom: TAB_BAR_SPACE + t.spacing.lg,
        }}
        showsVerticalScrollIndicator={false}
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
    </View>
  );
}
