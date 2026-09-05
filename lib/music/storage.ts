import type { Song } from './types';
const DB_NAME = 'tapcomposer';
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('songs', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error('Close other TapComposer tabs to save your song.'));
  });
}
export async function saveSong(song: Song): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction('songs', 'readwrite');
    transaction.objectStore('songs').put(song);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
}
export async function listSongs(): Promise<Song[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database
      .transaction('songs', 'readonly')
      .objectStore('songs')
      .getAll();
    request.onsuccess = () => {
      database.close();
      resolve(
        (request.result as Song[])
          .filter((s) => s.version === 1)
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
    };
    request.onerror = () => {
      database.close();
      reject(request.error);
    };
  });
}
export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export const safeFilename = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}\-_ ]/gu, '')
    .trim()
    .slice(0, 80) || 'My little song';
