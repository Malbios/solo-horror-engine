/**
 * Reading pack files from a folder the player picked once. Only some browsers can pick a folder
 * and keep it between visits; the handle is kept in IndexedDB because localStorage holds text only.
 */

type ReadPermission = "granted" | "denied" | "prompt";

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission(options: { mode: "read" }): Promise<ReadPermission>;
  requestPermission(options: { mode: "read" }): Promise<ReadPermission>;
};

type FolderPicker = (options: { mode: "read"; id: string }) => Promise<FileSystemDirectoryHandle>;

const DATABASE = "solo-horror-engine";
const STORE = "handles";
const FOLDER_KEY = "packs-folder";
const PICKER_ID = "packs";
const MAX_DEPTH = 6;
const SKIPPED_FOLDERS = new Set(["node_modules"]);

function picker(): FolderPicker | null {
  const candidate: unknown = (window as unknown as { showDirectoryPicker?: unknown })
    .showDirectoryPicker;
  return typeof candidate === "function" ? (candidate.bind(window) as FolderPicker) : null;
}

export function folderSupported(): boolean {
  return picker() !== null && typeof indexedDB !== "undefined";
}

export async function chooseFolder(): Promise<FileSystemDirectoryHandle> {
  const pick = picker();
  if (pick === null) throw new Error("This browser cannot open a folder.");
  return pick({ mode: "read", id: PICKER_ID });
}

/** Asks again for read access when the browser has dropped it; must run inside a tap or click. */
export async function ensureReadable(folder: FileSystemDirectoryHandle): Promise<boolean> {
  const handle = folder as PermissionHandle;
  if ((await handle.queryPermission({ mode: "read" })) === "granted") return true;
  return (await handle.requestPermission({ mode: "read" })) === "granted";
}

/** The text of every `.json` file in the folder and its subfolders. */
export async function readJsonTexts(
  folder: FileSystemDirectoryHandle,
  depth = 0,
): Promise<string[]> {
  const texts: string[] = [];
  for await (const entry of folder.values()) {
    if (entry.kind === "directory") {
      const skip = entry.name.startsWith(".") || SKIPPED_FOLDERS.has(entry.name);
      if (!skip && depth < MAX_DEPTH) texts.push(...(await readJsonTexts(entry, depth + 1)));
    } else if (entry.name.toLowerCase().endsWith(".json")) {
      texts.push(await (await entry.getFile()).text());
    }
  }
  return texts;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open storage"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  use: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = use(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Storage request failed"));
    });
  } finally {
    database.close();
  }
}

export async function rememberedFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const stored: unknown = await withStore("readonly", (store) => store.get(FOLDER_KEY));
    return stored instanceof FileSystemDirectoryHandle ? stored : null;
  } catch {
    return null;
  }
}

export async function rememberFolder(folder: FileSystemDirectoryHandle): Promise<void> {
  await withStore("readwrite", (store) => store.put(folder, FOLDER_KEY));
}
