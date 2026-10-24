import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { BrandMark } from "@/components/brand-mark";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Đăng nhập quản trị",
};

export default function AdminLoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <div className="mb-1 flex items-center gap-2">
            <BrandMark />
            <span className="text-xs font-medium text-muted-foreground">
              Quản trị
            </span>
          </div>
          <CardTitle className="text-lg">Đăng nhập quản trị</CardTitle>
          <CardDescription>Dùng mật khẩu quản trị của bạn.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
      <Link
        href="/"
        className="mt-6 inline-flex items-center justify-center gap-1.5 self-center rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-3.5" />
        Về trang sinh viên
      </Link>
    </main>
  );
}
