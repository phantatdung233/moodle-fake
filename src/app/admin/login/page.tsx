import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Đăng nhập quản trị",
};

export default function AdminLoginPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm items-center px-4">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Quản trị đề thi</CardTitle>
          <CardDescription>
            Nhập mật khẩu quản trị để quản lý đề và duyệt đáp án.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
