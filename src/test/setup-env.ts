// Deterministic env for tests that read admin secrets. Tests must never rely on
// a developer's local `.env*` file.
process.env.ADMIN_PASSWORD = "mat-khau-test";
process.env.SESSION_SECRET = "bi-mat-phien-test";
