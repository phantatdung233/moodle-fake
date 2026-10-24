import Link from "next/link";
import { LogOut } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { forgetStudent } from "@/lib/student/actions";
import type { StudentIdentity } from "@/lib/student/session";

/**
 * The student header, shared by `/` and every `/q/**` page. One row: the logo
 * and product name on the left, then — when the browser has signed in — the
 * MSSV and họ tên, with a way to change them on a shared machine. Whatever the
 * page needs (theme toggle, a way back) follows on the right.
 *
 * The identity is entered once on the home page and applies to every Quiz, so
 * showing it here is the only reminder of who the saved progress belongs to.
 */
export function StudentHeader({
  student,
  actions,
}: {
  student?: StudentIdentity | null;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <Link
        href="/"
        className="group flex min-w-0 items-center gap-2.5 rounded-md"
      >
        <BrandMark className="transition-transform duration-200 group-hover:-rotate-6" />
        <span className="flex min-w-0 flex-col leading-none">
          <span className="truncate text-sm font-semibold tracking-tight">
            Luyện tập Python
          </span>
          <span className="mt-0.5 truncate text-xs text-muted-foreground">
            Trắc nghiệm có giải thích
          </span>
        </span>
      </Link>

      <div className="flex shrink-0 items-center gap-2">
        {student ? (
          <span className="mr-1 flex min-w-0 items-center gap-2 border-r border-border pr-3">
            <span className="flex min-w-0 flex-col items-end leading-tight">
              <span className="max-w-[12rem] truncate text-sm font-medium">
                {student.studentName}
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {student.studentId}
              </span>
            </span>
            <form action={forgetStudent}>
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <LogOut aria-hidden className="size-3.5" />
                Đổi
              </button>
            </form>
          </span>
        ) : null}
        {actions}
      </div>
    </div>
  );
}
