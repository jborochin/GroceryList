import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;
  RecipeDetail: { recipeId: string };
  AddRecipe: { prefilledUrl?: string } | undefined;
  Pantry: undefined;
  Auth: undefined;
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
