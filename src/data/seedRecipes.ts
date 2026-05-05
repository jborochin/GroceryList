import { Recipe, PantryItem } from '../types';

const now = 0;

function mkRecipe(id: string, r: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'>): Recipe {
  return { ...r, id, createdAt: now, updatedAt: now };
}

export const SEED_RECIPES: Recipe[] = [
  mkRecipe('seed-sheet-pan-chicken', {
    title: 'Sheet-Pan Chicken & Vegetables',
    servings: 4,
    ingredients: [
      { name: 'chicken breast', quantity: 1.5, unit: 'lb' },
      { name: 'broccoli', quantity: 1, unit: 'lb' },
      { name: 'bell pepper', quantity: 2, unit: 'each' },
      { name: 'red onion', quantity: 1, unit: 'each' },
      { name: 'olive oil', quantity: 3, unit: 'tbsp' },
      { name: 'garlic', quantity: 3, unit: 'clove' },
      { name: 'paprika', quantity: 1, unit: 'tsp' },
      { name: 'salt', quantity: 1, unit: 'tsp' },
      { name: 'black pepper', quantity: 0.5, unit: 'tsp' },
    ],
    nutritionPerServing: { calories: 420, proteinG: 42, carbsG: 18, fatG: 19 },
  }),
  mkRecipe('seed-overnight-oats', {
    title: 'Overnight Oats with Berries',
    servings: 1,
    ingredients: [
      { name: 'rolled oats', quantity: 0.5, unit: 'cup' },
      { name: 'milk', quantity: 0.5, unit: 'cup' },
      { name: 'greek yogurt', quantity: 0.25, unit: 'cup' },
      { name: 'blueberry', quantity: 0.5, unit: 'cup' },
      { name: 'honey', quantity: 1, unit: 'tbsp' },
      { name: 'cinnamon', quantity: 0.25, unit: 'tsp' },
    ],
    nutritionPerServing: { calories: 380, proteinG: 18, carbsG: 62, fatG: 7 },
  }),
  mkRecipe('seed-beef-stir-fry', {
    title: 'Beef Stir-Fry with Rice',
    servings: 4,
    ingredients: [
      { name: 'ground beef', quantity: 1, unit: 'lb' },
      { name: 'brown rice', quantity: 1, unit: 'cup' },
      { name: 'broccoli', quantity: 0.5, unit: 'lb' },
      { name: 'carrot', quantity: 2, unit: 'each' },
      { name: 'garlic', quantity: 4, unit: 'clove' },
      { name: 'ginger', quantity: 1, unit: 'tbsp' },
      { name: 'soy sauce', quantity: 3, unit: 'tbsp' },
      { name: 'sesame oil', quantity: 1, unit: 'tbsp' },
      { name: 'green onion', quantity: 3, unit: 'each' },
    ],
    nutritionPerServing: { calories: 510, proteinG: 32, carbsG: 45, fatG: 22 },
  }),
];

export const SEED_PANTRY: Omit<PantryItem, 'id'>[] = [
  { name: 'salt' },
  { name: 'black pepper' },
  { name: 'olive oil' },
  { name: 'soy sauce' },
];
