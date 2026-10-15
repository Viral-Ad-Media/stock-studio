export const ADMIN_PAGE_SIZE = 50;

export function adminPage(raw: string | undefined, total?: number) {
  const value = Number(raw);
  const page = Number.isSafeInteger(value) && value > 0 ? value : 1;
  return total === undefined
    ? Math.min(page, 1_000_000)
    : Math.min(page, Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)));
}
