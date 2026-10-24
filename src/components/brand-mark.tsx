import { cn } from "@/lib/utils";

/**
 * The app's one logo: a two-tone chip that reads as `py` — the product is a
 * Python practice tool, so the mark borrows the two colours the language is
 * known by rather than inventing a brand nobody asked for. Pure CSS, one
 * element, no image request.
 *
 * Decorative by default: every place it appears also shows the product name,
 * so the icon is hidden from the accessibility tree unless a caller asks for a
 * labelled one (`label`).
 */
export function BrandMark({
  className,
  label,
}: {
  className?: string;
  /** When set, the mark stands alone and announces what it is. */
  label?: string;
}) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "relative inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[0.6rem] bg-brand font-mono text-[0.8rem] font-bold text-brand-foreground shadow-[inset_0_-3px_0_0_var(--brand-cool)]",
        className,
      )}
    >
      py
    </span>
  );
}
