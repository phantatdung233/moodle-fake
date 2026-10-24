"use client";

import { Children, isValidElement, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

type Filter = "all" | "correct" | "wrong" | "blank";
export type ReviewFilterCounts = Record<Filter, number>;

const labels: Record<Filter, string> = {
  all: "Tất cả",
  correct: "Đúng",
  wrong: "Sai",
  blank: "Bỏ trống",
};

export function QuestionReviewFilter({
  children,
  counts,
}: {
  children: React.ReactNode;
  counts: ReviewFilterCounts;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const items = useMemo(() => Children.toArray(children), [children]);
  const visibleItems = items.filter((item) => {
    if (filter === "all" || !isValidElement<{ "data-filter-tone"?: Filter }>(item)) {
      return true;
    }
    return item.props["data-filter-tone"] === filter;
  });

  return (
    <div className="flex flex-col gap-3">
      <div
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible"
        role="group"
        aria-label="Lọc câu hỏi"
      >
        {(Object.keys(labels) as Filter[]).map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={filter === value ? "default" : "outline"}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className="shrink-0"
          >
            {labels[value]}
            <span className="rounded-full bg-current/10 px-1.5 text-[0.7rem] tabular-nums">
              {counts[value]}
            </span>
          </Button>
        ))}
      </div>
      {visibleItems.length > 0 ? (
        visibleItems
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Không có câu nào.
        </p>
      )}
    </div>
  );
}
