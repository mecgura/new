/** Small time helpers so pages don't call Date.now() directly while rendering. */
export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
