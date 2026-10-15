import Link from "next/link";
import { ADMIN_PAGE_SIZE } from "@/lib/admin-pagination";

export default function AdminPagination({
  path,
  page,
  total,
  filters = {},
}: {
  path: string;
  page: number;
  total: number;
  filters?: Record<string, string>;
}) {
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const href = (value: number) =>
    `${path}?${new URLSearchParams({ ...filters, page: String(value) })}`;
  return (
    <nav
      aria-label="Pagination"
      className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <span className="text-fg-subtle">
        {total === 0
          ? "0 results"
          : `${(page - 1) * ADMIN_PAGE_SIZE + 1}–${Math.min(page * ADMIN_PAGE_SIZE, total)} of ${total}`}{" "}
        · Page {page} of {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={href(page - 1)} className="btn-secondary px-3 py-2">
            Previous
          </Link>
        )}
        {page < pages && (
          <Link href={href(page + 1)} className="btn-secondary px-3 py-2">
            Next
          </Link>
        )}
      </div>
    </nav>
  );
}
