/**
 * Upload limits shared by the app and `next.config.ts`. Kept dependency-free:
 * Next loads the config through its own transpiler, which cannot follow the
 * app's `@/…` imports (and `upload.ts` pulls in the parser's `node:crypto`).
 */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** What `next.config.ts` passes to `serverActions.bodySizeLimit`. */
export const MAX_UPLOAD_LIMIT = `${MAX_UPLOAD_BYTES / (1024 * 1024)}mb`;
