"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { slugifyTitle } from "@/lib/quiz/slug";
import { confirmUpload, previewUpload, type UploadState } from "@/lib/admin/upload-actions";

const initialState: UploadState = {};

/**
 * Upload in two steps: "Xem trước" posts the file alone and returns counts and
 * parse errors; "Tạo đề nháp" posts the same file plus title/slug and creates a
 * new draft Quiz. The file input stays the same DOM node for both requests, so
 * the browser re-sends the chosen file without keeping its bytes in React state.
 */
export function UploadForm() {
  const [previewState, previewAction, previewPending] = useActionState(
    previewUpload,
    initialState,
  );
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmUpload,
    initialState,
  );

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  // The slug follows the title until the giảng viên edits it by hand.
  const [slugTouched, setSlugTouched] = useState(false);

  const preview = confirmState.preview ?? previewState.preview;
  const error = confirmState.error ?? previewState.error;

  function onTitleChange(value: string) {
    setTitle(value);
    if (!slugTouched) setSlug(slugifyTitle(value));
  }

  return (
    <form action={previewAction} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="file">File JSON xuất từ Moodle</Label>
        <Input
          id="file"
          name="file"
          type="file"
          accept="application/json,.json"
          required
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="h-auto py-1.5 file:mr-2"
        />
        <p className="text-xs text-muted-foreground">
          Tối đa 5 MB. Hệ thống chỉ đọc file, chưa lưu gì cho tới khi bạn bấm “Tạo đề
          nháp”.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="title">Tên đề</Label>
          <Input
            id="title"
            name="title"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Python cơ bản"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="slug">Slug (đường dẫn)</Label>
          <Input
            id="slug"
            name="slug"
            value={slug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value);
            }}
            placeholder="python-co-ban"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            aria-invalid={error ? true : undefined}
          />
          <p className="text-xs break-all text-muted-foreground">
            Sinh viên vào làm tại <code className="font-mono">/q/{slug || "…"}</code>
          </p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      {preview ? <QuizPreviewSummary preview={preview} /> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="submit"
          variant={preview ? "outline" : "default"}
          disabled={previewPending || confirmPending || !file}
        >
          {previewPending ? "Đang đọc file…" : preview ? "Xem lại file" : "Xem trước"}
        </Button>
        {preview ? (
          <Button
            type="submit"
            formAction={confirmAction}
            disabled={previewPending || confirmPending}
          >
            {confirmPending ? "Đang tạo đề…" : "Tạo đề nháp"}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function QuizPreviewSummary({ preview }: { preview: NonNullable<UploadState["preview"]> }) {
  const ready = preview.questions - preview.needsReview;
  const [showAllErrors, setShowAllErrors] = useState(false);
  const errors = showAllErrors ? preview.errors : preview.errors.slice(0, 10);

  return (
    <div className="flex flex-col gap-3 border-t pt-4 text-sm">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tổng câu" value={preview.questions} />
        <Stat label="Trắc nghiệm" value={preview.byType.multichoice} />
        <Stat label="Điền khuyết" value={preview.byType.multianswer} />
        <Stat label="Cần duyệt đáp án" value={preview.needsReview} highlight />
      </dl>

      <p className="text-muted-foreground">
        {ready} câu đã có đáp án dùng được. {preview.needsReview} câu sẽ được lưu ở
        trạng thái <span className="font-medium text-foreground">cần duyệt</span> để
        sửa sau — không câu nào bị bỏ.
      </p>

      {preview.errors.length > 0 ? (
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer font-medium">
            Lỗi parse ({preview.errors.length} câu Moodle xuất hỏng)
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-muted-foreground">
            {errors.map((item, index) => (
              <li key={`${item.questionId}-${index}`} className="flex gap-2">
                <span className="font-mono font-medium text-foreground">
                  {item.questionId}
                </span>
                <span>{item.reason}</span>
              </li>
            ))}
          </ul>
          {preview.errors.length > errors.length ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="mt-2 px-0"
              onClick={() => setShowAllErrors(true)}
            >
              Xem tất cả {preview.errors.length} lỗi
            </Button>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col rounded-lg border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-lg font-semibold", highlight && "text-amber-600")}>
        {value}
      </dd>
    </div>
  );
}
