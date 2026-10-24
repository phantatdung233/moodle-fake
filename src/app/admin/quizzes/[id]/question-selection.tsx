"use client";

import { useMemo, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toggleQuestion } from "@/lib/admin/lifecycle-actions";
import type { AdminQuestionRow } from "@/lib/quiz/repository";

export type QuestionSelectionListProps = {
  quizId: string;
  questions: AdminQuestionRow[];
  /** A published/archived Quiz cannot be edited: the list renders read-only. */
  readOnly: boolean;
};

const TYPE_LABEL: Record<AdminQuestionRow["type"], string> = {
  multichoice: "Trắc nghiệm",
  multianswer: "Điền khuyết",
};

/**
 * "Chọn câu đưa vào đề": a checkbox per Question with a search box and quick
 * filters, so 180 rows stay workable. Each click saves immediately; the server
 * refuses the write on a published Quiz.
 */
export function QuestionSelectionList({ quizId, questions, readOnly }: QuestionSelectionListProps) {
  const [rows, setRows] = useState(questions);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "ready" | "needs_review" | "enabled">("all");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "ready" && row.status !== "ready") return false;
      if (filter === "needs_review" && row.status !== "needs_review") return false;
      if (filter === "enabled" && !row.enabled) return false;
      if (needle === "") return true;
      return row.id.toLowerCase().includes(needle) || row.preview.toLowerCase().includes(needle);
    });
  }, [rows, query, filter]);

  const enabledCount = rows.filter((row) => row.enabled).length;
  const publishableCount = rows.filter((row) => row.enabled && row.status === "ready").length;

  function onToggle(row: AdminQuestionRow, enabled: boolean) {
    if (readOnly) return;
    setError(null);
    // Optimistic: the checkbox flips at once; a rejection rolls it back.
    setRows((previous) =>
      previous.map((candidate) => (candidate.id === row.id ? { ...candidate, enabled } : candidate)),
    );
    startTransition(async () => {
      try {
        const result = await toggleQuestion(quizId, row.id, enabled);
        if (!result.ok) {
          setError(result.error);
          setRows((previous) =>
            previous.map((candidate) =>
              candidate.id === row.id ? { ...candidate, enabled: row.enabled } : candidate,
            ),
          );
        }
      } catch {
        setError("Không lưu được thay đổi. Kiểm tra kết nối rồi thử lại.");
        setRows((previous) =>
          previous.map((candidate) =>
            candidate.id === row.id ? { ...candidate, enabled: row.enabled } : candidate,
          ),
        );
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Tìm câu theo mã hoặc nội dung"
          placeholder="Tìm theo mã câu hoặc nội dung…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-xs"
        />
        <div className="flex flex-wrap gap-1">
          {(
            [
              ["all", `Tất cả (${rows.length})`],
              ["enabled", `Đang bật (${enabledCount})`],
              ["ready", "Đã có đáp án"],
              ["needs_review", "Cần duyệt"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={filter === value ? "default" : "outline"}
              onClick={() => setFilter(value)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <p className="text-sm text-muted-foreground">
        Đang bật <strong>{enabledCount}</strong> câu; trong đó <strong>{publishableCount}</strong>{" "}
        câu đã có đáp án sẽ được publish. Câu cần duyệt hoặc đang tắt sẽ bị loại khi publish.
        {pending ? " Đang lưu…" : null}
      </p>

      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}

      <ul className="flex max-h-[70vh] min-h-96 flex-col divide-y overflow-y-auto rounded-md border">
        {visible.length === 0 ? (
          <li className="p-4 text-sm text-muted-foreground">Không có câu nào khớp bộ lọc.</li>
        ) : null}
        {visible.map((row) => (
          <li key={row.id} className="flex items-start gap-3 p-3">
            <input
              type="checkbox"
              id={`question-${row.id}`}
              className="mt-1 size-4"
              checked={row.enabled}
              disabled={readOnly || pending}
              onChange={(event) => onToggle(row, event.target.checked)}
            />
            <label htmlFor={`question-${row.id}`} className="min-w-0 flex-1 cursor-pointer">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-medium">{row.id}</span>
                <Badge variant="outline">{TYPE_LABEL[row.type]}</Badge>
                <Badge variant={row.status === "ready" ? "secondary" : "destructive"}>
                  {row.status === "ready" ? "Đã có đáp án" : "Cần duyệt"}
                </Badge>
              </span>
              <span
                className={cn(
                  "mt-1 block truncate text-sm text-muted-foreground",
                  !row.enabled && "line-through",
                )}
              >
                {row.preview}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
