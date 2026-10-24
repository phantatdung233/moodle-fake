"use client";

import { Children, isValidElement, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

type Filter = "all" | "correct" | "wrong" | "blank";

const labels: Record<Filter, string> = {
  all: "Tất cả",
  correct: "Đúng",
  wrong: "Sai",
  blank: "Bỏ trống",
};

export function QuestionReviewFilter({
  children,
}: {
  children: React.ReactNode;
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
      <div className="flex flex-wrap gap-2" role="group" aria-label="Lọc câu hỏi">
        {(Object.keys(labels) as Filter[]).map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={filter === value ? "default" : "outline"}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {labels[value]}
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
