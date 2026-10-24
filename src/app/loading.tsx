import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <main
      aria-busy="true"
      aria-label="Đang tải"
      className="mx-auto flex min-h-[60vh] w-full max-w-5xl items-center justify-center px-4 py-12 sm:px-6"
    >
      <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Đang tải…
      </div>
    </main>
  );
}
