/** Slug rules shared by the admin upload form (client) and the data layer. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const SLUG_FORMAT_ERROR =
  "Slug chỉ gồm chữ thường, số và dấu gạch ngang (ví dụ: python-co-ban).";

/** `Python cơ bản` → `python-co-ban`; suggested in the form as the title is typed. */
export function slugifyTitle(title: string): string {
  return title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function isValidQuizSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}
