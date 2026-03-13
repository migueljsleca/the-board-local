import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { BoardCanvasLayout, BoardFolder, BoardItem } from "@/lib/board-types";

type ImageDatabase = {
  images: BoardItem[];
  folders: BoardFolder[];
};

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "images.json");
const DB_TMP_PATH = path.join(DATA_DIR, "images.json.tmp");
const UPLOADS_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_COMPRESS_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_COMPRESSED_DIMENSION = 2560;
const COMPRESSIBLE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

const EMPTY_DB: ImageDatabase = { images: [], folders: [] };
let writeQueue: Promise<void> = Promise.resolve();

function normalizeLabel(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeLabels(input: string[]) {
  const unique = new Set<string>();
  for (const label of input) {
    const normalized = normalizeLabel(label);
    if (!normalized) continue;
    unique.add(normalized);
  }
  return Array.from(unique).slice(0, 12);
}

function normalizeFolderName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeImageTitle(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 120);
}

function folderNameKey(value: string) {
  return normalizeFolderName(value).toLowerCase();
}

function parseStoredFolder(value: unknown): BoardFolder | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BoardFolder>;
  if (typeof candidate.id !== "string" || typeof candidate.createdAt !== "string" || typeof candidate.name !== "string") {
    return null;
  }
  const name = normalizeFolderName(candidate.name);
  if (!name) return null;
  return {
    id: candidate.id,
    name,
    createdAt: candidate.createdAt,
  };
}

function parseStoredCanvasLayout(value: unknown): BoardCanvasLayout | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BoardCanvasLayout>;
  const x = Number(candidate.x);
  const y = Number(candidate.y);
  const width = Number(candidate.width);
  const height = Number(candidate.height);
  const z = Number(candidate.z);

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (!Number.isFinite(z)) return null;

  return {
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    width: Math.round(width * 100) / 100,
    height: Math.round(height * 100) / 100,
    z: Math.round(z),
  };
}

function parseStoredImage(value: unknown): BoardItem | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BoardItem>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.src !== "string" ||
    typeof candidate.filename !== "string" ||
    typeof candidate.createdAt !== "string"
  ) {
    return null;
  }

  const storedWidth = safeDimension(Number(candidate.width), 1200);
  const storedHeight = safeDimension(Number(candidate.height), 1600);
  const storedByteSize = parseNullablePositiveNumber(candidate.byteSize);
  const storedOriginalByteSize = parseNullablePositiveNumber(candidate.originalByteSize);
  const storedOriginalWidth = parseNullablePositiveNumber(candidate.originalWidth);
  const storedOriginalHeight = parseNullablePositiveNumber(candidate.originalHeight);
  const wasCompressed =
    candidate.wasCompressed === true ||
    (storedByteSize !== null && storedOriginalByteSize !== null && storedOriginalByteSize > storedByteSize);

  return {
    id: candidate.id,
    src: candidate.src,
    width: storedWidth,
    height: storedHeight,
    title: typeof candidate.title === "string" ? normalizeImageTitle(candidate.title) : "",
    labels: normalizeLabels(Array.isArray(candidate.labels) ? candidate.labels.filter((label): label is string => typeof label === "string") : []),
    folderId: typeof candidate.folderId === "string" && candidate.folderId ? candidate.folderId : null,
    origin: "paste",
    createdAt: candidate.createdAt,
    filename: candidate.filename,
    mimeType: typeof candidate.mimeType === "string" && candidate.mimeType ? candidate.mimeType : "application/octet-stream",
    byteSize: storedByteSize,
    originalByteSize: storedOriginalByteSize ?? storedByteSize,
    originalWidth: storedOriginalWidth ?? storedWidth,
    originalHeight: storedOriginalHeight ?? storedHeight,
    wasCompressed,
    canvas: parseStoredCanvasLayout(candidate.canvas),
  };
}

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOADS_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.writeFile(DB_PATH, JSON.stringify(EMPTY_DB, null, 2), "utf8");
  }
}

async function readDb(): Promise<ImageDatabase> {
  await ensureStorage();
  const raw = await fs.readFile(DB_PATH, "utf8");
  let parsed: Partial<ImageDatabase>;
  try {
    parsed = JSON.parse(raw) as Partial<ImageDatabase>;
  } catch {
    throw new Error("Image database JSON is invalid.");
  }
  const folders = Array.isArray(parsed.folders)
    ? parsed.folders.map(parseStoredFolder).filter((folder): folder is BoardFolder => Boolean(folder))
    : [];
  const folderIds = new Set(folders.map((folder) => folder.id));
  const images = Array.isArray(parsed.images)
    ? parsed.images
        .map(parseStoredImage)
        .filter((image): image is BoardItem => Boolean(image))
        .map((image) => ({
          ...image,
          folderId: image.folderId && folderIds.has(image.folderId) ? image.folderId : null,
        }))
    : [];
  return { images, folders };
}

async function writeDb(db: ImageDatabase) {
  const serialized = JSON.stringify(db, null, 2);
  const writeTask = async () => {
    await fs.writeFile(DB_TMP_PATH, serialized, "utf8");
    await fs.rename(DB_TMP_PATH, DB_PATH);
  };
  writeQueue = writeQueue.then(writeTask, writeTask);
  await writeQueue;
}

type ProcessedUploadFile = {
  buffer: Buffer;
  mimeType: string;
  width: number | null;
  height: number | null;
  originalWidth: number | null;
  originalHeight: number | null;
  byteSize: number;
  originalByteSize: number;
  wasCompressed: boolean;
};

function normalizeMimeType(value: string) {
  const mime = value.trim().toLowerCase();
  return mime || "application/octet-stream";
}

function extensionForMimeType(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "image/jpg") return "jpg";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/avif") return "avif";
  if (mime === "image/svg+xml") return "svg";
  return "bin";
}

function hasPositiveDimension(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function parseNullablePositiveNumber(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric);
}

function wasImageResized(input: { width: number | null; height: number | null }, output: { width: number | null; height: number | null }) {
  return (
    (hasPositiveDimension(input.width) && hasPositiveDimension(output.width) && output.width < input.width) ||
    (hasPositiveDimension(input.height) && hasPositiveDimension(output.height) && output.height < input.height)
  );
}

async function readImageDimensions(buffer: Buffer) {
  try {
    const metadata = await sharp(buffer).metadata();
    return {
      width: hasPositiveDimension(metadata.width) ? metadata.width : null,
      height: hasPositiveDimension(metadata.height) ? metadata.height : null,
    };
  } catch {
    return { width: null, height: null };
  }
}

async function processUploadFile(file: File): Promise<ProcessedUploadFile> {
  const mimeType = normalizeMimeType(file.type);
  const inputBuffer = Buffer.from(await file.arrayBuffer());
  const shouldCompress = file.size > MAX_COMPRESS_SOURCE_BYTES && COMPRESSIBLE_MIME_TYPES.has(mimeType);

  if (!shouldCompress) {
    const dimensions = await readImageDimensions(inputBuffer);
    return {
      buffer: inputBuffer,
      mimeType,
      width: dimensions.width,
      height: dimensions.height,
      originalWidth: dimensions.width,
      originalHeight: dimensions.height,
      byteSize: inputBuffer.length,
      originalByteSize: inputBuffer.length,
      wasCompressed: false,
    };
  }

  const sourceDimensions = await readImageDimensions(inputBuffer);
  let pipeline = sharp(inputBuffer).resize({
    width: MAX_COMPRESSED_DIMENSION,
    height: MAX_COMPRESSED_DIMENSION,
    fit: "inside",
    withoutEnlargement: true,
  });

  if (mimeType === "image/jpeg") {
    pipeline = pipeline.jpeg({ quality: 80, mozjpeg: true });
  } else if (mimeType === "image/png") {
    pipeline = pipeline.png({ compressionLevel: 9, effort: 10 });
  } else if (mimeType === "image/webp") {
    pipeline = pipeline.webp({ quality: 80, effort: 4 });
  } else if (mimeType === "image/avif") {
    pipeline = pipeline.avif({ quality: 50, effort: 4 });
  }

  const { data: compressedBuffer, info } = await pipeline.toBuffer({ resolveWithObject: true });
  const compressedDimensions = {
    width: hasPositiveDimension(info.width) ? info.width : null,
    height: hasPositiveDimension(info.height) ? info.height : null,
  };
  const resized = wasImageResized(sourceDimensions, compressedDimensions);

  if (!resized && compressedBuffer.length >= inputBuffer.length) {
    return {
      buffer: inputBuffer,
      mimeType,
      width: sourceDimensions.width,
      height: sourceDimensions.height,
      originalWidth: sourceDimensions.width,
      originalHeight: sourceDimensions.height,
      byteSize: inputBuffer.length,
      originalByteSize: inputBuffer.length,
      wasCompressed: false,
    };
  }

  return {
    buffer: compressedBuffer,
    mimeType,
    width: compressedDimensions.width ?? sourceDimensions.width,
    height: compressedDimensions.height ?? sourceDimensions.height,
    originalWidth: sourceDimensions.width,
    originalHeight: sourceDimensions.height,
    byteSize: compressedBuffer.length,
    originalByteSize: inputBuffer.length,
    wasCompressed: true,
  };
}

function safeDimension(value: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded <= 0) return fallback;
  return rounded;
}

export async function listImages() {
  const db = await readDb();
  return [...db.images].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export async function listBoardData() {
  const db = await readDb();
  return {
    images: [...db.images].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    folders: [...db.folders].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function createImage(input: {
  file: File;
  width: number;
  height: number;
  folderId?: string | null;
}) {
  const db = await readDb();
  const id = randomUUID();
  const processed = await processUploadFile(input.file);
  const ext = extensionForMimeType(processed.mimeType);
  const filename = `${id}.${ext}`;
  const absoluteFilePath = path.join(UPLOADS_DIR, filename);
  await fs.writeFile(absoluteFilePath, processed.buffer);

  const width = safeDimension(processed.width ?? input.width, 1200);
  const height = safeDimension(processed.height ?? input.height, 1600);
  const originalWidth = safeDimension(processed.originalWidth ?? width, width);
  const originalHeight = safeDimension(processed.originalHeight ?? height, height);

  const image: BoardItem = {
    id,
    src: `/uploads/${filename}`,
    width,
    height,
    title: "",
    labels: [],
    folderId: input.folderId && db.folders.some((folder) => folder.id === input.folderId) ? input.folderId : null,
    origin: "paste",
    createdAt: new Date().toISOString(),
    filename,
    mimeType: processed.mimeType,
    byteSize: processed.byteSize,
    originalByteSize: processed.originalByteSize,
    originalWidth,
    originalHeight,
    wasCompressed: processed.wasCompressed,
    canvas: null,
  };

  db.images.push(image);
  await writeDb(db);
  return image;
}

export async function removeImageById(id: string) {
  const db = await readDb();
  const index = db.images.findIndex((image) => image.id === id);
  if (index < 0) return false;

  const [image] = db.images.splice(index, 1);
  await writeDb(db);
  await fs.rm(path.join(UPLOADS_DIR, image.filename), { force: true });
  return true;
}

type UpdateImageByIdInput = {
  labels?: string[];
  folderId?: string | null;
  title?: string;
  canvas?: BoardCanvasLayout | null;
};

type UpdateImageByIdResult =
  | {
      kind: "ok";
      image: BoardItem;
    }
  | {
      kind: "image-not-found";
    }
  | {
      kind: "folder-not-found";
    };

export async function updateImageById(id: string, input: UpdateImageByIdInput): Promise<UpdateImageByIdResult> {
  const db = await readDb();
  const image = db.images.find((item) => item.id === id);
  if (!image) return { kind: "image-not-found" };

  if (input.folderId !== undefined) {
    if (input.folderId !== null && !db.folders.some((folder) => folder.id === input.folderId)) {
      return { kind: "folder-not-found" };
    }
    image.folderId = input.folderId;
  }

  if (input.labels !== undefined) {
    image.labels = normalizeLabels(input.labels);
  }

  if (input.title !== undefined) {
    image.title = normalizeImageTitle(input.title);
  }

  if (input.canvas !== undefined) {
    image.canvas = input.canvas ? parseStoredCanvasLayout(input.canvas) : null;
  }

  await writeDb(db);
  return { kind: "ok", image };
}

type CreateFolderResult =
  | {
      kind: "ok";
      folder: BoardFolder;
    }
  | {
      kind: "invalid-name";
    }
  | {
      kind: "duplicate-name";
    };

export async function createFolder(input: { name: string }): Promise<CreateFolderResult> {
  const normalizedName = normalizeFolderName(input.name);
  if (!normalizedName) return { kind: "invalid-name" };

  const db = await readDb();
  const normalizedKey = folderNameKey(normalizedName);
  const duplicate = db.folders.some((folder) => folderNameKey(folder.name) === normalizedKey);
  if (duplicate) return { kind: "duplicate-name" };

  const folder: BoardFolder = {
    id: randomUUID(),
    name: normalizedName,
    createdAt: new Date().toISOString(),
  };

  db.folders.push(folder);
  await writeDb(db);
  return { kind: "ok", folder };
}

export async function removeFolderById(id: string) {
  const db = await readDb();
  const index = db.folders.findIndex((folder) => folder.id === id);
  if (index < 0) return false;

  db.folders.splice(index, 1);
  for (const image of db.images) {
    if (image.folderId === id) {
      image.folderId = null;
    }
  }
  await writeDb(db);
  return true;
}
