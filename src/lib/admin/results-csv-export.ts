/**
 * The CSV body `/admin/results/export.csv` sends: the same filter as the table,
 * with no row cap (an export is meant to hold the whole lớp).
 */
import { listResultsForExport, type ResultsFilter } from "./results-repository";
import { toCsv } from "./results-csv";

export async function exportResultsCsv(filter: ResultsFilter = {}): Promise<string> {
  return toCsv(await listResultsForExport(filter));
}
