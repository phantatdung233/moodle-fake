"use client";

import { startTransition, useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { cn } from "@/lib/utils";
import { slugifyTitle } from "@/lib/quiz/slug";
import { toUploadFilePayload } from "@/lib/admin/upload-file";
import {
  confirmUpload,
  previewUpload,
  type ConfirmUploadInput,
  type QuizUploadPreview,
  type UploadState,
} from "@/lib/admin/upload-actions";

const initialState: UploadState = {};

/**
 * Upload in two steps, each its own form:
 * 1. "Xem trước" parses the chosen file and shows counts + parse errors. The
 *    file bytes are re-sent by the browser, and the server keeps none of them.
 * 2. "Tạo đề nháp" (in the preview) sends the same file with title/slug and
 *    creates a new draft Quiz.
 *
 * Step 2 calls a plain action inside a transition instead of a second
 * useActionState: a hydrated Next runtime carries over only one action state
 * per form, and step 1 already owns it.
 */
export function UploadForm() {
  const [previewState, previewAction, previewPending] = useActionState(
    previewUpload,
    initialState,
  );

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | undefined>();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  // The slug follows the title until the giảng viên edits it by hand.
  const [slugTouched, setSlugTouched] = useState(false);
  const [confirmResult, setConfirmResult] = useState<UploadState | null>(null);
  const [confirming, setConfirming] = useState(false);

  // A failed confirm carries a fresh preview; prefer it over the earlier one.
  const preview = confirmResult?.preview ?? previewState.preview;
  const error = fileError ?? confirmResult?.error ?? previewState.error;

  function onTitleChange(value: string) {
    setTitle(value);
    if (!slugTouched) setSlug(slugifyTitle(value));
  }

  function onChooseAnotherFile() {
    setFile(null);
    setFileError(undefined);
    setConfirmResult(null);
  }

  async function onConfirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirming) return;
    if (!file) {
      setFileError("Hãy chọn một file JSON để tải lên.");
      return;
    }

    setFileError(undefined);
    setConfirmResult(null);
    setConfirming(true);
    // The redirect the action performs is only followed inside a transition.
    startTransition(async () => {
      try {
        // React does not carry a `File` through a reference, so send its bytes
        // and metadata as plain fields the action rebuilds into a `File`.
        const result = await confirmUpload(await toUploadFilePayload(file), {
          title,
          slug,
        } satisfies ConfirmUploadInput);
        // Success redirects; anything still returned is an error to show,
        // keeping the preview on screen so only the title/slug needs fixing.
        setConfirmResult(result?.error ? result : null);
      } finally {
        setConfirming(false);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {preview ? null : (
        <form action={previewAction} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            {/*
              The browser's own file button reads "Choose File / No file chosen"
              in English, whatever the page language. Hide it from view but keep
              it in the form (the label opens it), and show the chosen name.
            */}
            <span className="text-sm font-medium" aria-hidden="true">
              File JSON xuất từ Moodle
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" asChild>
                <label htmlFor="preview-file" className="cursor-pointer">
                  Chọn file…
                </label>
              </Button>
              <span className="text-sm text-muted-foreground">
                {file ? file.name : "Chưa chọn file nào"}
              </span>
            </div>
            <input
              id="preview-file"
              name="file"
              type="file"
              accept="application/json,.json"
              required
              aria-label="File JSON xuất từ Moodle"
              className="sr-only"
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setFileError(undefined);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Tối đa 5 MB. Hệ thống chỉ đọc file, chưa lưu gì cho tới khi bạn bấm
              “Tạo đề nháp”.
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={previewPending}>
              {previewPending ? "Đang đọc file…" : "Xem trước"}
            </Button>
          </div>
        </form>
      )}

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      {preview ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              Xem trước {file ? `file “${file.name}”` : "file đã tải lên"}
            </p>
            <Button type="button" variant="outline" size="sm" onClick={onChooseAnotherFile}>
              Chọn file khác
            </Button>
          </div>

          <QuizPreviewSummary preview={preview} />

          <form onSubmit={onConfirm} className="flex flex-col gap-4 border-t pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="title">Tên đề</Label>
                <Input
                  id="title"
                  name="title"
                  value={title}
                  onChange={(event) => onTitleChange(event.target.value)}
                  placeholder="Python cơ bản"
                  required
                  maxLength={200}
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
                  required
                  aria-invalid={confirmResult?.error ? true : undefined}
                />
                <p className="text-xs break-all text-muted-foreground">
                  Sinh viên vào làm tại{" "}
                  <code className="font-mono">/q/{slug || "…"}</code>
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {preview.needsReview} câu cần duyệt đáp án sẽ được lưu ở trạng thái
                nháp.
              </p>
              <Button type="submit" disabled={confirming}>
                {confirming ? "Đang tạo đề…" : "Tạo đề nháp"}
              </Button>
            </div>
          </form>
        </>
      ) : null}
    </div>
  );
}

function QuizPreviewSummary({ preview }: { preview: QuizUploadPreview }) {
  const ready = preview.questions - preview.needsReview;
  const [showAllErrors, setShowAllErrors] = useState(false);
  const errors = showAllErrors ? preview.errors : preview.errors.slice(0, 10);

  return (
    <div className="flex flex-col gap-3 text-sm">
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
        <details className="rounded-sm border p-3">
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
    <div className="flex flex-col border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-lg font-semibold", highlight && "text-warning")}>
        {value}
      </dd>
    </div>
  );
}
