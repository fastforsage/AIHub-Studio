import type { Category, Provider } from "../catalog/catalogModel";

export function getInitiallyExpandedCategories(
  categories: readonly Category[],
  providers: readonly Provider[]
): string[] {
  // Categories start collapsed; the user expands them explicitly.
  void categories;
  void providers;
  return [];
}

export function toggleExpandedCategory(currentIds: readonly string[], categoryId: string): string[] {
  return currentIds.includes(categoryId)
    ? currentIds.filter((id) => id !== categoryId)
    : [...currentIds, categoryId];
}
