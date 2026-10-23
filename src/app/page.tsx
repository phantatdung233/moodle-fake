export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-semibold">Luyện tập Python</h1>
      <p className="mt-2 text-muted-foreground">
        Danh sách đề đang mở sẽ hiển thị ở đây.
      </p>
      <p className="mt-6 text-sm text-muted-foreground">
        Giảng viên quản lý đề tại{" "}
        <a className="underline underline-offset-4" href="/admin">
          /admin
        </a>
        .
      </p>
    </main>
  );
}
