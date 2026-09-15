import { Directory, Filesystem } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { fetchBlob } from './api';

/**
 * Saves a generated document where the user can find it.
 *
 * On Android the file goes to the device's Documents folder and the path is
 * reported back, because a blob URL inside a WebView is not something a person
 * can hand to anyone. In the browser it falls back to a normal download.
 */
export async function saveDocument(
  path: string,
  query?: Record<string, string | number | undefined>,
): Promise<{ fileName: string; location: string }> {
  const { blob, fileName } = await fetchBlob(path, query);

  if (!Capacitor.isNativePlatform()) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoke on the next tick so the download has started.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { fileName, location: 'Downloads' };
  }

  const base64 = await blobToBase64(blob);
  await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Documents,
    recursive: true,
  });
  return { fileName, location: 'Documents' };
}

/** Loads an image document for display inside the app. */
export async function loadImageObjectUrl(documentId: string): Promise<string> {
  const { blob } = await fetchBlob(`/documents/${documentId}/file`);
  return URL.createObjectURL(blob);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const result = String(reader.result);
      // Strip the "data:<mime>;base64," prefix that Filesystem does not want.
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}
