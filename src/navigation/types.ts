import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
  RecipeDetail: { recipeId: string };
  MealCatalogDetail: { mealId: string };
  AddRecipe: { prefilledUrl?: string } | undefined;
  Pantry: undefined;
  AutoMealPrep: undefined;
  Auth: undefined;
  Onboarding: undefined;
};

export type TabParamList = {
  Home: undefined;
  Library: undefined;
  Plan: undefined;
  List: undefined;
  Settings: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
