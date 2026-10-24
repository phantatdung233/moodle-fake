import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { logoutAdmin } from "@/lib/admin/actions";

/**
 * The admin header, shared by every `/admin/**` page except the login screen.
 * Same bar on every page (and in the database-error fallbacks), so leaving the
 * dashboard is always the same click: the mark goes back to `/admin`, the tabs
 * switch between Đề thi and Kết quả, and "Trang sinh viên", the theme toggle
 * and Đăng xuất always sit on the right in that order.
 *
 * `active` marks the current tab and is carried by `aria-current` as well as
 * the fill, so the state never relies on colour alone.
 */
export type AdminSection = "quizzes" | "results";

const TABS: { section: AdminSection; href: string; label: string }[] = [
  { section: "quizzes", href: "/admin", label: "Đề thi" },
  { section: "results", href: "/admin/results", label: "Kết quả" },
];

export function AdminHeader({ active }: { active: AdminSection }) {
  return (
    <div className="sticky top-0 z-30 -mx-4 mb-6 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/85 sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
        <Link
          href="/admin"
          className="flex items-center gap-2 rounded-md text-sm font-semibold tracking-tight"
        >
          <BrandMark />
          <span className="sr-only sm:not-sr-only">Quản trị</span>
        </Link>

        <nav aria-label="Khu vực quản trị" className="flex items-center gap-1">
          {TABS.map((tab) => {
            const current = tab.section === active;
            return (
              <Link
                key={tab.section}
                href={tab.href}
                aria-current={current ? "page" : undefined}
                className={
                  current
                    ? "rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background"
                    : "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                }
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowUpRight aria-hidden className="size-3.5" />
            {/* Kept visible on phones: an arrow alone would be an unlabelled
                icon, and this is the way out of the admin area. */}
            <span>
              <span className="sm:hidden">Sinh viên</span>
              <span className="hidden sm:inline">Trang sinh viên</span>
            </span>
          </Link>
          <ThemeToggle />
          <form action={logoutAdmin}>
            <Button type="submit" variant="outline" size="sm">
              Đăng xuất
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

/** The one error state every admin page shares when MongoDB is unreachable. */
export function AdminDatabaseError() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Không kết nối được cơ sở dữ liệu</CardTitle>
        <CardDescription>
          Kiểm tra <code className="font-mono">MONGODB_URI</code> và mongod rồi
          tải lại trang.
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
