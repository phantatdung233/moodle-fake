/**
 * Browser side of the upload: splits the chosen `File` into parts a Server
 * Action can carry. Kept out of `upload.ts` so the client bundle never pulls
 * in the parser (which imports `node:crypto`).
 */
export type UploadFilePayload = {
  name: string;
  size: number;
  type?: string;
  bytes: Uint8Array<ArrayBuffer>;
};

export async function toUploadFilePayload(file: File): Promise<UploadFilePayload> {
  return {
    name: file.name,
    size: file.size,
    type: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}
