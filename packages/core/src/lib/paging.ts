// Page arithmetic shared by every long list. Pure, so the web app can use the same shapes.
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

export type PageRequest = { page?: number; pageSize?: number };

export type Paged<T> = { rows: T[]; total: number; page: number; pageSize: number; pages: number };

/** `skip` and `take` for a page request, clamped to sane values. */
export function pageArgs(req: PageRequest = {}): { skip: number; take: number; page: number; pageSize: number } {
  const pageSize = Math.min(Math.max(Math.trunc(req.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
  const page = Math.max(Math.trunc(req.page ?? 1) || 1, 1);
  return { skip: (page - 1) * pageSize, take: pageSize, page, pageSize };
}

export function toPaged<T>(rows: T[], total: number, args: { page: number; pageSize: number }): Paged<T> {
  return { rows, total, page: args.page, pageSize: args.pageSize, pages: Math.max(Math.ceil(total / args.pageSize), 1) };
}
