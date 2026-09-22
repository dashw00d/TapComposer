import type { ExportedLabSession, LabSession } from './protocol';
function openLab(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tapcomposer-voice-lab', 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore('sessions', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveLab(session: LabSession) {
  const db = await openLab();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('sessions', 'readwrite');
    transaction.objectStore('sessions').put(session);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = transaction.onabort = () => {
      db.close();
      reject(transaction.error);
    };
  });
}
export async function latestLab(): Promise<LabSession | null> {
  const db = await openLab();
  return new Promise((resolve, reject) => {
    const request = db.transaction('sessions').objectStore('sessions').getAll();
    request.onsuccess = () => {
      db.close();
      resolve(
        (request.result as LabSession[]).sort(
          (a, b) => b.createdAt - a.createdAt,
        )[0] ?? null,
      );
    };
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
  });
}
export async function exportLab(session: LabSession) {
  const takes: ExportedLabSession['takes'] = [];
  for (const { audio, ...metadata } of session.takes) {
    const bytes = new Uint8Array(await audio.arrayBuffer());
    let binary = '';
    for (let at = 0; at < bytes.length; at += 16384)
      binary += String.fromCharCode(...bytes.subarray(at, at + 16384));
    takes.push({ ...metadata, audioBase64: btoa(binary) });
  }
  return new Blob(
    [JSON.stringify({ ...session, format: 'tapcomposer-voice-lab', takes })],
    { type: 'application/json' },
  );
}
