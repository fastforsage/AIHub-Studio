import type { Category, Provider } from "../catalog/catalogModel";

export function getInitiallyExpandedCategories(
  categories: readonly Category[],
  providers: readonly Provider[]
): string[] {
  return categories
    .filter((category) => providers.some((provider) => provider.categoryIds.includes(category.id)))
    .map((category) => category.id);
}

export function toggleExpandedCategory(currentIds: readonly string[], categoryId: string): string[] {
  return currentIds.includes(categoryId)
    ? currentIds.filter((id) => id !== categoryId)
    : [...currentIds, categoryId];
}
