import { NavigatorScreenParams } from '@react-navigation/native';
import { MealSlot } from '../types';

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
  RecipeDetail: { recipeId: string };
  MealCatalogDetail: { mealId: string };
  // sharedUrl arrives from the OS share sheet (see useShareIntentRouter) and is
  // imported automatically on mount; prefilledUrl only populates the field.
  AddRecipe: { prefilledUrl?: string; sharedUrl?: string } | undefined;
  Pantry: undefined;
  AutoMealPrep: undefined;
  MealSwipe: { days?: number; slotCounts?: Record<MealSlot, number> } | undefined;
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
