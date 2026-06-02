/* AGPL-3.0-or-later */
import * as tus from "tus-js-client";
import { getImageUploadUrl, getStreamUploadUrl } from "@/lib/cf-api";

export type ProgressFn = (percent: number) => void;

// Image: one-time direct-upload URL, then a multipart POST (XHR for progress).
async function uploadImage(file: File, requireSignedURLs: boolean, onProgress: ProgressFn) {
  const { uploadURL } = await getImageUploadUrl(requireSignedURLs);
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadURL);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error(`Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error("Network error"));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

// Video: Worker-minted TUS upload URL, then resumable upload via tus-js-client.
async function uploadVideo(file: File, requireSignedURLs: boolean, onProgress: ProgressFn) {
  const { uploadURL } = await getStreamUploadUrl({
    uploadLength: file.size,
    name: file.name,
    requireSignedURLs,
  });
  await new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      uploadUrl: uploadURL,
      chunkSize: 52_428_800, // 50 MiB (>= CF's 5 MiB min, divisible by 256 KiB)
      retryDelays: [0, 1000, 3000, 5000],
      onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)),
      onError: (err) => reject(err),
      onSuccess: () => resolve(),
    });
    upload.start();
  });
}

export function isUploadable(file: File): boolean {
  return file.type.startsWith("image/") || file.type.startsWith("video/");
}

export async function uploadFile(
  file: File,
  requireSignedURLs: boolean,
  onProgress: ProgressFn,
): Promise<void> {
  if (file.type.startsWith("image/")) return uploadImage(file, requireSignedURLs, onProgress);
  if (file.type.startsWith("video/")) return uploadVideo(file, requireSignedURLs, onProgress);
  throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
}
