import { adminShell } from "@/lib/admin/shell";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AdminHeader } from "@/app/admin/admin-header";

export const metadata: Metadata = {
  title: "Không tìm thấy đề",
};

export default function AdminQuizNotFound() {
  return (
    <main className={adminShell}>
      <AdminHeader active="quizzes" />
      <h1 className="text-2xl font-semibold">Không tìm thấy đề</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Đề này không tồn tại hoặc đã bị xoá.
      </p>
      <div className="mt-6">
        <Button asChild variant="outline">
          <Link href="/admin">Về danh sách đề</Link>
        </Button>
      </div>
    </main>
  );
}
