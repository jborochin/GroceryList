import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { HomeScreen } from '../screens/HomeScreen';
import { RecipeLibraryScreen } from '../screens/RecipeLibraryScreen';
import { WeeklyPlanScreen } from '../screens/WeeklyPlanScreen';
import { GroceryListScreen } from '../screens/GroceryListScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { TabParamList } from './types';
import { AppTabBar } from '../components/ui/AppTabBar';

const Tab = createBottomTabNavigator<TabParamList>();

export function TabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <AppTabBar {...props} />}
      sceneContainerStyle={{ backgroundColor: 'transparent' }}
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          elevation: 0,
        },
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Library" component={RecipeLibraryScreen} />
      <Tab.Screen name="Plan" component={WeeklyPlanScreen} />
      <Tab.Screen name="List" component={GroceryListScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
