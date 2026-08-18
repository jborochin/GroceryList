import { NavigatorScreenParams } from '@react-navigation/native';
import { FoodItem, MealSlot } from '../types';

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
  RecipeDetail: { recipeId: string };
  MealCatalogDetail: { mealId: string };
  // Food logging. `replacesCellId` is set when the user tapped "Ate other" on a
  // planned meal — whatever they log instead retires that plan row for the day
  // without touching the schedule the grocery list is built from.
  FoodSearch: { slot: MealSlot; date: string; replacesCellId?: string };
  BarcodeScan: { slot: MealSlot; date: string; replacesCellId?: string };
  // Reached from a scan that found nothing: `barcode` keeps the scanned digits
  // so the same product resolves locally next time, and `prefillName` seeds the
  // form. With no slot/date it is just "save a food for later".
  CustomFood: {
    slot?: MealSlot;
    date?: string;
    replacesCellId?: string;
    barcode?: string;
    prefillName?: string;
  } | undefined;
  LogFood: {
    item: FoodItem;
    slot: MealSlot;
    date: string;
    replacesCellId?: string;
  };
  // Cook mode. `servings` carries the detail screen's preview across so amounts
  // arrive already scaled; the cook session owns it from then on. Catalog meals
  // get here via ensureRecipeForMeal, so this is only ever a recipe id.
  CookMode: { recipeId: string; servings?: number };
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
  // Replaced the old `Plan` tab: weekly planning now lives inside Log's Week
  // mode, since the plan is a prediction of the log. `view` lets callers that
  // just committed a week (the swipe deck, Home) land on the grid.
  Log: { view?: 'day' | 'week' } | undefined;
  List: undefined;
  Settings: undefined;
};

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
