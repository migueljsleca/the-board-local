"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BoardFolder, BoardItem } from "@/lib/board-types";

const ALL_FOLDER_KEY = "all";
const NO_LABEL_FILTER_VALUE = "no-label";
const CREATE_NEW_BOARD_OPTION_VALUE = "__create_new_board__";
const DEFAULT_CANVAS_BACKGROUND = "#111317";
const CANVAS_BACKGROUND_STORAGE_KEY = "the-board-canvas-background";
const LABEL_CONTEXT_TRIGGER_SELECTOR = "[data-label-context-menu='true']";
type FixedFolderKey = typeof ALL_FOLDER_KEY;
type FolderKey = FixedFolderKey | `folder:${string}`;
type GridDensity = "compact" | "small" | "medium" | "large";
type SearchScope = "both" | "folders" | "labels";
type SortMode = "oldest-first" | "newest-first" | "random";

type LabelFilterEntry = {
  value: string;
  label: string;
  system?: boolean;
};

type LabelContextMenuState = {
  label: string;
  x: number;
  y: number;
};

type LabelActionPopoverState = {
  mode: "rename" | "delete";
  label: string;
  x: number;
  y: number;
  draft: string;
};

const GRID_DENSITY_OPTIONS: Array<{ key: GridDensity; label: string }> = [
  { key: "compact", label: "Compact" },
  { key: "small", label: "Small" },
  { key: "medium", label: "Medium" },
  { key: "large", label: "Large" },
];

const GRID_DENSITY_INDEX: Record<GridDensity, number> = {
  compact: 0,
  small: 1,
  medium: 2,
  large: 3,
};

const GRID_COLUMNS_CLASS: Record<GridDensity, string> = {
  compact: "sm:columns-2 lg:columns-5",
  small: "sm:columns-2 lg:columns-4",
  medium: "sm:columns-2 lg:columns-3",
  large: "sm:columns-2 lg:columns-2",
};

const GRID_IMAGE_SIZES: Record<GridDensity, string> = {
  compact: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 20vw",
  small: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw",
  medium: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw",
  large: "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 50vw",
};

const CANVAS_MIN_SCALE = 0.2;
const CANVAS_MAX_SCALE = 2.8;
const CANVAS_MIN_IMAGE_WIDTH = 120;
const CANVAS_MAX_IMAGE_WIDTH = 1800;
const CANVAS_GAP = 80;
const CANVAS_ROW_WIDTH = 2800;

type CanvasLayout = NonNullable<BoardItem["canvas"]>;
type CanvasLayoutMap = Record<string, CanvasLayout>;
type CanvasHandle = "nw" | "ne" | "sw" | "se";
type Point = { x: number; y: number };
type CanvasViewport = { x: number; y: number; scale: number };
type CanvasPointer = Point & { pointerType: string };
type CanvasSelectionBox = { x: number; y: number; width: number; height: number };
type CanvasOverlayRect = { itemId: string; x: number; y: number; width: number; height: number; isTiny: boolean; centerX: number; centerY: number };
type CanvasInteractionMode = "idle" | "pan" | "drag" | "resize" | "pinch" | "select";

type CanvasInteraction =
  | { mode: "idle" }
  | { mode: "pan"; pointerId: number; startClient: Point; startViewport: CanvasViewport }
  | { mode: "drag"; pointerId: number; itemIds: string[]; startClient: Point; startLayouts: CanvasLayoutMap }
  | { mode: "select"; pointerId: number; startClient: Point; additive: boolean; startSelection: string[] }
  | { mode: "resize"; pointerId: number; itemId: string; handle: CanvasHandle; startClient: Point; startLayout: CanvasLayout }
  | {
      mode: "pinch";
      pointerIds: [number, number];
      startDistance: number;
      startScale: number;
      startViewport: CanvasViewport;
      worldPoint: Point;
    };

function canvasHandleTransform(handle: CanvasHandle, zoomScale: number) {
  const normalizedScale = Number.isFinite(zoomScale) && zoomScale > 0 ? zoomScale : 1;
  const inverseScale = 1 / normalizedScale;
  if (handle === "nw") return `translate(-50%, -50%) scale(${inverseScale})`;
  if (handle === "ne") return `translate(50%, -50%) scale(${inverseScale})`;
  if (handle === "sw") return `translate(-50%, 50%) scale(${inverseScale})`;
  return `translate(50%, 50%) scale(${inverseScale})`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampChannel(value: number) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function rgbToHex(red: number, green: number, blue: number) {
  const r = clampChannel(red).toString(16).padStart(2, "0");
  const g = clampChannel(green).toString(16).padStart(2, "0");
  const b = clampChannel(blue).toString(16).padStart(2, "0");
  return `#${r}${g}${b}`;
}

function hexToRgb(hex: string) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ] as const;
}

function normalizeHexColor(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutHash = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (/^[0-9a-fA-F]{3}$/.test(withoutHash)) {
    const expanded = withoutHash
      .split("")
      .map((char) => `${char}${char}`)
      .join("");
    return `#${expanded.toLowerCase()}`;
  }
  if (/^[0-9a-fA-F]{6}$/.test(withoutHash)) {
    return `#${withoutHash.toLowerCase()}`;
  }
  return null;
}

function rgbToHsv(red: number, green: number, blue: number) {
  const r = clampChannel(red) / 255;
  const g = clampChannel(green) / 255;
  const b = clampChannel(blue) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === r) {
      hue = ((g - b) / delta) % 6;
    } else if (max === g) {
      hue = (b - r) / delta + 2;
    } else {
      hue = (r - g) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const saturation = max === 0 ? 0 : delta / max;
  const value = max;
  return [hue, saturation, value] as const;
}

function hsvToRgb(hue: number, saturation: number, value: number) {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation, 0, 1);
  const v = clamp(value, 0, 1);
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const match = v - chroma;

  let rPrime = 0;
  let gPrime = 0;
  let bPrime = 0;

  if (h < 60) {
    rPrime = chroma;
    gPrime = x;
  } else if (h < 120) {
    rPrime = x;
    gPrime = chroma;
  } else if (h < 180) {
    gPrime = chroma;
    bPrime = x;
  } else if (h < 240) {
    gPrime = x;
    bPrime = chroma;
  } else if (h < 300) {
    rPrime = x;
    bPrime = chroma;
  } else {
    rPrime = chroma;
    bPrime = x;
  }

  return [
    clampChannel((rPrime + match) * 255),
    clampChannel((gPrime + match) * 255),
    clampChannel((bPrime + match) * 255),
  ] as const;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function formatMegabytes(bytes: number | null | undefined) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "Unknown";
  const megabytes = bytes / (1024 * 1024);
  const decimals = megabytes >= 10 ? 1 : 2;
  return `${megabytes.toFixed(decimals)} MB`;
}

function formatDimensions(width: number | null | undefined, height: number | null | undefined) {
  if (!width || !height) return "Unknown";
  return `${Math.round(width)} x ${Math.round(height)}`;
}

function clampScale(value: number) {
  return clamp(value, CANVAS_MIN_SCALE, CANVAS_MAX_SCALE);
}

function layoutEquals(a: CanvasLayout, b: CanvasLayout) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && a.z === b.z;
}

function normalizeCanvasLayout(layout: CanvasLayout): CanvasLayout {
  return {
    x: round2(layout.x),
    y: round2(layout.y),
    width: round2(clamp(layout.width, CANVAS_MIN_IMAGE_WIDTH, CANVAS_MAX_IMAGE_WIDTH)),
    height: round2(Math.max(50, layout.height)),
    z: Math.round(layout.z),
  };
}

function imageSeedSize(item: BoardItem) {
  const dominant = Math.max(item.width, item.height, 1);
  let scale = 300 / dominant;
  let width = item.width * scale;
  let height = item.height * scale;

  const minDim = Math.min(width, height);
  if (minDim < 140) {
    scale = 140 / minDim;
    width *= scale;
    height *= scale;
  }

  const maxDim = Math.max(width, height);
  if (maxDim > 500) {
    scale = 500 / maxDim;
    width *= scale;
    height *= scale;
  }

  width = clamp(width, 140, 500);
  height = clamp(height, 100, 650);

  return {
    width: round2(width),
    height: round2(height),
  };
}

function createPackedLayouts(items: BoardItem[], startY: number, startZ: number) {
  const layouts: CanvasLayoutMap = {};
  let cursorX = 0;
  let cursorY = startY;
  let rowHeight = 0;
  let z = startZ;

  for (const item of items) {
    const size = imageSeedSize(item);
    if (cursorX > 0 && cursorX + size.width > CANVAS_ROW_WIDTH) {
      cursorX = 0;
      cursorY += rowHeight + CANVAS_GAP;
      rowHeight = 0;
    }

    layouts[item.id] = {
      x: round2(cursorX),
      y: round2(cursorY),
      width: size.width,
      height: size.height,
      z,
    };
    z += 1;
    cursorX += size.width + CANVAS_GAP;
    rowHeight = Math.max(rowHeight, size.height);
  }

  return { layouts, nextZ: z };
}

function getCanvasBounds(layouts: CanvasLayoutMap) {
  const ids = Object.keys(layouts);
  if (!ids.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const id of ids) {
    const layout = layouts[id];
    minX = Math.min(minX, layout.x);
    minY = Math.min(minY, layout.y);
    maxX = Math.max(maxX, layout.x + layout.width);
    maxY = Math.max(maxY, layout.y + layout.height);
  }

  return { minX, minY, maxX, maxY };
}

function buildCanvasLayouts(items: BoardItem[]) {
  const persisted: CanvasLayoutMap = {};
  let maxZ = 0;

  for (const item of items) {
    if (!item.canvas) continue;
    const normalized = normalizeCanvasLayout(item.canvas);
    persisted[item.id] = normalized;
    maxZ = Math.max(maxZ, normalized.z);
  }

  const missing = items.filter((item) => !persisted[item.id]);
  if (!missing.length) {
    return { layouts: persisted, maxZ };
  }

  const persistedBounds = getCanvasBounds(persisted);
  const seedStartY = persistedBounds ? persistedBounds.maxY + CANVAS_GAP * 2 : 0;
  const seeded = createPackedLayouts(missing, seedStartY, maxZ + 1);
  return {
    layouts: { ...persisted, ...seeded.layouts },
    maxZ: Math.max(maxZ, seeded.nextZ - 1),
  };
}

function distanceBetweenPoints(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function selectionBoxFromPoints(start: Point, end: Point): CanvasSelectionBox {
  const minX = Math.min(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  return {
    x: minX,
    y: minY,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function canvasLayoutIntersectsWorldBounds(layout: CanvasLayout, bounds: { left: number; right: number; top: number; bottom: number }) {
  const right = layout.x + layout.width;
  const bottom = layout.y + layout.height;
  return layout.x <= bounds.right && right >= bounds.left && layout.y <= bounds.bottom && bottom >= bounds.top;
}

function normalizeSelection(itemIds: Iterable<string>) {
  return Array.from(new Set(itemIds)).sort((a, b) => a.localeCompare(b));
}

function selectionEquals(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function targetAcceptsTextInput(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  if (element.isContentEditable) return true;
  const tagName = element.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function normalizeLabel(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function parseLabelInput(value: string) {
  const unique = new Set<string>();
  for (const chunk of value.split(",")) {
    const label = normalizeLabel(chunk);
    if (!label) continue;
    unique.add(label);
  }
  return Array.from(unique).slice(0, 12);
}

function normalizeFolderName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function folderKeyForId(folderId: string): FolderKey {
  return `folder:${folderId}`;
}

function readCustomFolderId(folderKey: FolderKey) {
  if (!folderKey.startsWith("folder:")) return null;
  return folderKey.slice("folder:".length);
}

function timestampFromCreatedAt(input: string) {
  const parsed = new Date(input).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function randomOrderScore(value: string, seed: number) {
  let hash = seed ^ 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readImageSize(src: string) {
  return new Promise<{ width: number; height: number }>((resolve) => {
    const image = new window.Image();
    image.onload = () => {
      resolve({
        width: image.naturalWidth || image.width || 1280,
        height: image.naturalHeight || image.height || 1600,
      });
    };
    image.onerror = () => resolve({ width: 1280, height: 1600 });
    image.src = src;
  });
}

async function readImageSizeFromFile(file: File) {
  const url = URL.createObjectURL(file);
  try {
    return await readImageSize(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

type CustomDropdownOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type CustomDropdownProps = {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: CustomDropdownOption[];
  disabled?: boolean;
  containerClassName?: string;
  triggerClassName?: string;
  menuClassName?: string;
  optionClassName?: string;
  menuPosition?: "top" | "bottom";
};

function CustomDropdown({
  ariaLabel,
  value,
  onChange,
  options,
  disabled = false,
  containerClassName,
  triggerClassName,
  menuClassName,
  optionClassName,
  menuPosition = "bottom",
}: CustomDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isMenuOpen = isOpen && !disabled;
  const selectedOption = options.find((option) => option.value === value) ?? options[0] ?? null;

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMenuOpen]);

  return (
    <div ref={rootRef} className={`relative ${containerClassName ?? ""}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isMenuOpen}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        className={`inline-flex w-full items-center justify-between gap-2 text-left ${triggerClassName ?? ""}`}
      >
        <span className="truncate">{selectedOption?.label ?? ""}</span>
        <span className="shrink-0 text-current/70">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
            <path fill="currentColor" d="M7.4 9.4a1 1 0 0 1 1.4 0L12 12.58l3.2-3.18a1 1 0 1 1 1.4 1.42l-3.9 3.88a1 1 0 0 1-1.4 0L7.4 10.82a1 1 0 0 1 0-1.42Z" />
          </svg>
        </span>
      </button>
      {isMenuOpen ? (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={`absolute left-0 z-[90] max-h-64 w-full overflow-auto rounded-xl border border-white/20 bg-[#14171d]/96 p-1 shadow-[0_18px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl ${
            menuPosition === "top" ? "bottom-[calc(100%+0.3rem)]" : "top-[calc(100%+0.3rem)]"
          } ${menuClassName ?? ""}`}
        >
          {options.map((option) => (
            <button
              key={`${ariaLabel}-${option.value}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              disabled={option.disabled}
              onClick={() => {
                if (option.disabled) return;
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`flex w-full items-center rounded-lg px-2.5 py-1.5 text-xs transition ${
                option.value === value
                  ? "bg-white/18 text-white"
                  : "text-white/85 hover:bg-white/12 hover:text-white"
              } disabled:cursor-not-allowed disabled:opacity-45 ${optionClassName ?? ""}`}
            >
              <span className="truncate">{option.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function CanvasIcon({ className }: { className?: string }) {
  return <Image src="/icons/canvas.svg" alt="" width={18} height={18} className={className} />;
}

function InfoIcon({ className }: { className?: string }) {
  return <Image src="/icons/info.svg" alt="" width={18} height={18} className={className} />;
}

export default function Home() {
  const [items, setItems] = useState<BoardItem[]>([]);
  const [folders, setFolders] = useState<BoardFolder[]>([]);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isTopSearchOpen, setIsTopSearchOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<FolderKey>(ALL_FOLDER_KEY);
  const [labelQuery, setLabelQuery] = useState("");
  const [activeFilterLabel, setActiveFilterLabel] = useState<string | null>(null);
  const [labelEditorItemId, setLabelEditorItemId] = useState<string | null>(null);
  const [newLabelDraft, setNewLabelDraft] = useState("");
  const [newFolderDraft, setNewFolderDraft] = useState("");
  const [isFolderCreatorOpen, setIsFolderCreatorOpen] = useState(false);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [savingLabelItemId, setSavingLabelItemId] = useState<string | null>(null);
  const [savingFolderItemId, setSavingFolderItemId] = useState<string | null>(null);
  const [savingTitleItemId, setSavingTitleItemId] = useState<string | null>(null);
  const [activeItemTitleDraft, setActiveItemTitleDraft] = useState("");
  const [hoverBoardCreatorItemId, setHoverBoardCreatorItemId] = useState<string | null>(null);
  const [hoverBoardDraft, setHoverBoardDraft] = useState("");
  const [creatingHoverBoardItemId, setCreatingHoverBoardItemId] = useState<string | null>(null);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [deletingLabel, setDeletingLabel] = useState<string | null>(null);
  const [renamingLabel, setRenamingLabel] = useState<string | null>(null);
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null);
  const [confirmFolderId, setConfirmFolderId] = useState<string | null>(null);
  const [labelContextMenu, setLabelContextMenu] = useState<LabelContextMenuState | null>(null);
  const [labelActionPopover, setLabelActionPopover] = useState<LabelActionPopoverState | null>(null);
  const [confirmImageId, setConfirmImageId] = useState<string | null>(null);
  const [gridDensity, setGridDensity] = useState<GridDensity>("medium");
  const [searchScope, setSearchScope] = useState<SearchScope>("both");
  const [sortMode, setSortMode] = useState<SortMode>("newest-first");
  const [shuffleSeed, setShuffleSeed] = useState(1);
  const [visibleCardIds, setVisibleCardIds] = useState<Set<string>>(() => new Set());
  const [loadedImageIds, setLoadedImageIds] = useState<Set<string>>(() => new Set());
  const [isCanvasMode, setIsCanvasMode] = useState(false);
  const [canvasLayouts, setCanvasLayouts] = useState<CanvasLayoutMap>({});
  const [selectedCanvasItemIds, setSelectedCanvasItemIds] = useState<string[]>([]);
  const [canvasSelectionBox, setCanvasSelectionBox] = useState<CanvasSelectionBox | null>(null);
  const [canvasBackgroundColor, setCanvasBackgroundColor] = useState(DEFAULT_CANVAS_BACKGROUND);
  const [canvasHexDraft, setCanvasHexDraft] = useState(DEFAULT_CANVAS_BACKGROUND);
  const [isCanvasColorPickerOpen, setIsCanvasColorPickerOpen] = useState(false);
  const [canvasViewport, setCanvasViewport] = useState<CanvasViewport>({ x: 0, y: 0, scale: 1 });
  const [canvasInteractionMode, setCanvasInteractionMode] = useState<CanvasInteractionMode>("idle");
  const [isCanvasHandMode, setIsCanvasHandMode] = useState(false);
  const [canvasLoadedImageIds, setCanvasLoadedImageIds] = useState<Set<string>>(() => new Set());
  const [isCanvasHelpExpanded, setIsCanvasHelpExpanded] = useState(false);
  const [isCanvasHelpHovered, setIsCanvasHelpHovered] = useState(false);
  const masonrySectionRef = useRef<HTMLElement | null>(null);
  const labelContextMenuRef = useRef<HTMLDivElement | null>(null);
  const labelActionPopoverRef = useRef<HTMLDivElement | null>(null);
  const canvasSurfaceRef = useRef<HTMLDivElement | null>(null);
  const canvasColorPickerRef = useRef<HTMLDivElement | null>(null);
  const canvasColorPlaneRef = useRef<HTMLDivElement | null>(null);
  const canvasLayoutsRef = useRef<CanvasLayoutMap>({});
  const canvasViewportRef = useRef<CanvasViewport>({ x: 0, y: 0, scale: 1 });
  const canvasInteractionRef = useRef<CanvasInteraction>({ mode: "idle" });
  const canvasPointersRef = useRef<Record<number, CanvasPointer>>({});
  const canvasPersistTimeoutsRef = useRef<Record<string, number>>({});
  const canvasPendingLayoutsRef = useRef<Record<string, CanvasLayout>>({});
  const canvasPersistSequenceRef = useRef<Record<string, number>>({});
  const selectedCanvasItemIdsRef = useRef<string[]>([]);
  const hasEnteredCanvasRef = useRef(false);
  const wasCanvasModeRef = useRef(false);

  const normalizedSearchQuery = normalizeLabel(labelQuery);
  const canvasBackgroundRgb = useMemo(
    () => hexToRgb(canvasBackgroundColor) ?? (hexToRgb(DEFAULT_CANVAS_BACKGROUND) as readonly [number, number, number]),
    [canvasBackgroundColor],
  );
  const [canvasRed, canvasGreen, canvasBlue] = canvasBackgroundRgb;
  const canvasBackgroundHsv = useMemo(
    () => rgbToHsv(canvasRed, canvasGreen, canvasBlue),
    [canvasBlue, canvasGreen, canvasRed],
  );
  const [canvasHue, canvasSaturation, canvasValue] = canvasBackgroundHsv;

  const allLabels = useMemo(() => {
    const unique = new Set<string>();
    for (const item of items) {
      for (const label of item.labels) {
        unique.add(label);
      }
    }
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const labelFilterEntries = useMemo<LabelFilterEntry[]>(() => {
    const entries: LabelFilterEntry[] = allLabels.map((label) => ({
      value: label,
      label: `#${label}`,
    }));
    if (items.some((item) => item.labels.length === 0)) {
      entries.unshift({
        value: NO_LABEL_FILTER_VALUE,
        label: "#no-label",
        system: true,
      });
    }
    return entries;
  }, [allLabels, items]);

  const visibleSidebarLabelEntries = useMemo(() => {
    if (!normalizedSearchQuery) return labelFilterEntries;
    return labelFilterEntries.filter((entry) => normalizeLabel(entry.label).includes(normalizedSearchQuery));
  }, [labelFilterEntries, normalizedSearchQuery]);

  const folderEntries = useMemo<Array<{ key: FolderKey; label: string; count: number; kind: "fixed" | "custom" }>>(() => {
    const fixedEntries: Array<{ key: FolderKey; label: string; count: number; kind: "fixed" }> = [
      {
        key: ALL_FOLDER_KEY,
        label: "All images",
        count: items.length,
        kind: "fixed" as const,
      },
    ];
    const customEntries = folders.map((folder) => ({
      key: folderKeyForId(folder.id),
      label: folder.name,
      count: items.filter((item) => item.folderId === folder.id).length,
      kind: "custom" as const,
    }));
    return [...fixedEntries, ...customEntries];
  }, [folders, items]);

  const visibleFolderEntries = useMemo(() => {
    if (!normalizedSearchQuery) return folderEntries;
    return folderEntries.filter((folder) => normalizeLabel(folder.label).includes(normalizedSearchQuery));
  }, [folderEntries, normalizedSearchQuery]);

  const modalFolderResults = useMemo(() => {
    const source = normalizedSearchQuery ? visibleFolderEntries : folderEntries;
    return source.slice(0, 18);
  }, [folderEntries, normalizedSearchQuery, visibleFolderEntries]);

  const modalLabelResults = useMemo(() => {
    const source = normalizedSearchQuery ? visibleSidebarLabelEntries : labelFilterEntries;
    return source.slice(0, 24);
  }, [labelFilterEntries, normalizedSearchQuery, visibleSidebarLabelEntries]);

  const sidebarFolderEntries = useMemo(() => {
    const activeEntry = folderEntries.find((folder) => folder.key === activeFolder);
    if (!visibleFolderEntries.length) return activeEntry ? [activeEntry] : [];
    if (visibleFolderEntries.some((folder) => folder.key === activeFolder)) return visibleFolderEntries;
    return activeEntry ? [activeEntry, ...visibleFolderEntries] : visibleFolderEntries;
  }, [activeFolder, folderEntries, visibleFolderEntries]);

  const sidebarFolderOptions = useMemo(
    () =>
      sidebarFolderEntries.map((folder) => ({
        value: folder.key,
        label: `${folder.label} (${folder.count})`,
      })),
    [sidebarFolderEntries],
  );

  const headerFolderOptions = useMemo(
    () =>
      folderEntries.map((folder) => ({
        value: folder.key,
        label: `${folder.label} (${folder.count})`,
      })),
    [folderEntries],
  );

  const labelFilterOptions = useMemo(
    () => [
      { value: "", label: "All labels" },
      ...labelFilterEntries.map((entry) => ({
        value: entry.value,
        label: entry.label,
      })),
    ],
    [labelFilterEntries],
  );

  const boardAssignmentOptions = useMemo(
    () => [
      { value: "", label: "No board" },
      ...folders.map((folder) => ({
        value: folder.id,
        label: folder.name,
      })),
      { value: CREATE_NEW_BOARD_OPTION_VALUE, label: "+ Create new board" },
    ],
    [folders],
  );

  const folderNameById = useMemo(() => {
    return new Map(folders.map((folder) => [folder.id, folder.name]));
  }, [folders]);

  const filteredItems = useMemo(() => {
    const customFolderId = readCustomFolderId(activeFolder);
    return items.filter((item) => {
      const byFolder =
        activeFolder === ALL_FOLDER_KEY
          ? true
          : Boolean(customFolderId) && item.folderId === customFolderId;
      const byFixedLabel = !activeFilterLabel
        ? true
        : activeFilterLabel === NO_LABEL_FILTER_VALUE
          ? item.labels.length === 0
          : item.labels.includes(activeFilterLabel);
      const folderName = item.folderId ? folderNameById.get(item.folderId) || "" : "no board";
      const titleText = normalizeLabel(item.title || "");
      const matchesNoLabelQuery = item.labels.length === 0 && NO_LABEL_FILTER_VALUE.includes(normalizedSearchQuery);
      const bySearchQuery = normalizedSearchQuery
        ? item.labels.some((label) => label.includes(normalizedSearchQuery)) ||
          matchesNoLabelQuery ||
          normalizeLabel(folderName).includes(normalizedSearchQuery) ||
          titleText.includes(normalizedSearchQuery)
        : true;
      return byFolder && byFixedLabel && bySearchQuery;
    });
  }, [activeFilterLabel, activeFolder, folderNameById, items, normalizedSearchQuery]);

  const displayedItems = useMemo(() => {
    const nextItems = [...filteredItems];
    if (sortMode === "newest-first") {
      nextItems.sort((a, b) => timestampFromCreatedAt(b.createdAt) - timestampFromCreatedAt(a.createdAt));
      return nextItems;
    }
    if (sortMode === "oldest-first") {
      nextItems.sort((a, b) => timestampFromCreatedAt(a.createdAt) - timestampFromCreatedAt(b.createdAt));
      return nextItems;
    }
    nextItems.sort((a, b) => {
      const scoreA = randomOrderScore(a.id, shuffleSeed);
      const scoreB = randomOrderScore(b.id, shuffleSeed);
      if (scoreA === scoreB) return a.id.localeCompare(b.id);
      return scoreA - scoreB;
    });
    return nextItems;
  }, [filteredItems, shuffleSeed, sortMode]);

  const activeItem = activeItemId ? items.find((item) => item.id === activeItemId) ?? null : null;
  const navigableItems = displayedItems.length ? displayedItems : items;
  const activeIndex = activeItem ? navigableItems.findIndex((item) => item.id === activeItem.id) : -1;
  const activeGridDensityIndex = GRID_DENSITY_INDEX[gridDensity];
  const masonryColumnsClass = GRID_COLUMNS_CLASS[gridDensity];
  const imageSizes = GRID_IMAGE_SIZES[gridDensity];
  const canvasItems = useMemo(() => {
    return [...items]
      .filter((item) => Boolean(canvasLayouts[item.id]))
      .sort((a, b) => {
        const zA = canvasLayouts[a.id]?.z ?? 0;
        const zB = canvasLayouts[b.id]?.z ?? 0;
        if (zA === zB) return a.id.localeCompare(b.id);
        return zA - zB;
      });
  }, [canvasLayouts, items]);
  const selectedCanvasLayoutMap = useMemo(() => {
    const selectedLayouts: CanvasLayoutMap = {};
    for (const itemId of selectedCanvasItemIds) {
      const layout = canvasLayouts[itemId];
      if (!layout) continue;
      selectedLayouts[itemId] = layout;
    }
    return selectedLayouts;
  }, [canvasLayouts, selectedCanvasItemIds]);
  const selectedCanvasWorldBounds = useMemo(() => getCanvasBounds(selectedCanvasLayoutMap), [selectedCanvasLayoutMap]);
  const selectedCanvasOverlayRects = useMemo<CanvasOverlayRect[]>(() => {
    const minOverlaySize = 14;
    return Object.entries(selectedCanvasLayoutMap).map(([itemId, layout]) => {
      const screenX = layout.x * canvasViewport.scale + canvasViewport.x;
      const screenY = layout.y * canvasViewport.scale + canvasViewport.y;
      const screenWidth = layout.width * canvasViewport.scale;
      const screenHeight = layout.height * canvasViewport.scale;
      const overlayWidth = Math.max(screenWidth, minOverlaySize);
      const overlayHeight = Math.max(screenHeight, minOverlaySize);
      const x = screenX - (overlayWidth - screenWidth) / 2;
      const y = screenY - (overlayHeight - screenHeight) / 2;
      return {
        itemId,
        x,
        y,
        width: overlayWidth,
        height: overlayHeight,
        isTiny: screenWidth < minOverlaySize || screenHeight < minOverlaySize,
        centerX: screenX + screenWidth / 2,
        centerY: screenY + screenHeight / 2,
      };
    });
  }, [canvasViewport.scale, canvasViewport.x, canvasViewport.y, selectedCanvasLayoutMap]);
  const selectedCanvasGroupOverlay = useMemo(() => {
    if (!selectedCanvasWorldBounds || selectedCanvasItemIds.length < 2) return null;
    const x = selectedCanvasWorldBounds.minX * canvasViewport.scale + canvasViewport.x;
    const y = selectedCanvasWorldBounds.minY * canvasViewport.scale + canvasViewport.y;
    const width = (selectedCanvasWorldBounds.maxX - selectedCanvasWorldBounds.minX) * canvasViewport.scale;
    const height = (selectedCanvasWorldBounds.maxY - selectedCanvasWorldBounds.minY) * canvasViewport.scale;
    return { x, y, width, height };
  }, [canvasViewport.scale, canvasViewport.x, canvasViewport.y, selectedCanvasItemIds.length, selectedCanvasWorldBounds]);
  const selectedCanvasItemSet = useMemo(() => new Set(selectedCanvasItemIds), [selectedCanvasItemIds]);
  const singleSelectedCanvasItemId = selectedCanvasItemIds.length === 1 ? selectedCanvasItemIds[0] : null;
  const showCanvasHelpMessage = isCanvasHelpExpanded || isCanvasHelpHovered;

  const setCanvasSelection = useCallback((itemIds: Iterable<string>) => {
    const nextSelection = normalizeSelection(itemIds);
    setSelectedCanvasItemIds((current) => (selectionEquals(current, nextSelection) ? current : nextSelection));
  }, []);

  const goToNext = useCallback(() => {
    if (!navigableItems.length) return;
    setActiveItemId((currentId) => {
      if (!currentId) return navigableItems[0].id;
      const currentIndex = navigableItems.findIndex((item) => item.id === currentId);
      if (currentIndex < 0) return navigableItems[0].id;
      return navigableItems[(currentIndex + 1) % navigableItems.length].id;
    });
  }, [navigableItems]);

  const goToPrevious = useCallback(() => {
    if (!navigableItems.length) return;
    setActiveItemId((currentId) => {
      if (!currentId) return navigableItems[0].id;
      const currentIndex = navigableItems.findIndex((item) => item.id === currentId);
      if (currentIndex < 0) return navigableItems[0].id;
      return navigableItems[(currentIndex - 1 + navigableItems.length) % navigableItems.length].id;
    });
  }, [navigableItems]);

  const markImageLoaded = useCallback((imageId: string) => {
    setLoadedImageIds((current) => {
      if (current.has(imageId)) return current;
      const next = new Set(current);
      next.add(imageId);
      return next;
    });
  }, []);

  const markCanvasImageLoaded = useCallback((imageId: string) => {
    setCanvasLoadedImageIds((current) => {
      if (current.has(imageId)) return current;
      const next = new Set(current);
      next.add(imageId);
      return next;
    });
  }, []);

  const loadImages = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/images", { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Request failed");
      }
      const payload = (await response.json()) as { images?: BoardItem[]; folders?: BoardFolder[] };
      setItems(Array.isArray(payload.images) ? payload.images : []);
      setFolders(Array.isArray(payload.folders) ? payload.folders : []);
      setNotice(null);
    } catch {
      setNotice("Could not load saved images.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const uploadImage = useCallback(async (file: File, width: number, height: number, folderId?: string | null) => {
    const formData = new FormData();
    formData.append("image", file);
    formData.append("width", String(width));
    formData.append("height", String(height));
    if (folderId) {
      formData.append("folderId", folderId);
    }
    const response = await fetch("/api/images", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) throw new Error("Upload failed");
    const payload = (await response.json()) as { image: BoardItem };
    return payload.image;
  }, []);

  const saveItemMetadata = useCallback(
    async (itemId: string, input: { labels?: string[]; folderId?: string | null; title?: string; canvas?: CanvasLayout | null }) => {
      const response = await fetch(`/api/images/${itemId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      if (!response.ok) throw new Error("Image update failed");

      const payload = (await response.json()) as { image: BoardItem };
      setItems((current) => current.map((item) => (item.id === payload.image.id ? payload.image : item)));
    },
    [],
  );

  const saveItemLabels = useCallback(
    async (itemId: string, labels: string[]) => {
      await saveItemMetadata(itemId, { labels });
    },
    [saveItemMetadata],
  );

  const addLabelsToItem = useCallback(
    async (item: BoardItem, input: string) => {
      const nextLabels = parseLabelInput(input);
      if (!nextLabels.length) return;
      const merged = Array.from(new Set([...item.labels, ...nextLabels])).slice(0, 12);
      await saveItemLabels(item.id, merged);
    },
    [saveItemLabels],
  );

  const saveItemTitle = useCallback(
    async (item: BoardItem, rawTitle: string) => {
      const normalizedTitle = rawTitle.trim().replace(/\s+/g, " ").slice(0, 120);
      if (normalizedTitle === item.title) return;
      setSavingTitleItemId(item.id);
      try {
        await saveItemMetadata(item.id, { title: normalizedTitle });
        setNotice(null);
      } catch {
        setNotice("Could not save image text.");
      } finally {
        setSavingTitleItemId((current) => (current === item.id ? null : current));
      }
    },
    [saveItemMetadata],
  );

  const removeLabelFromItem = useCallback(
    async (item: BoardItem, labelToRemove: string) => {
      if (!item.labels.includes(labelToRemove)) return;
      setSavingLabelItemId(item.id);
      try {
        const nextLabels = item.labels.filter((label) => label !== labelToRemove);
        await saveItemLabels(item.id, nextLabels);
        setNotice(null);
      } catch {
        setNotice("Could not remove label.");
      } finally {
        setSavingLabelItemId((current) => (current === item.id ? null : current));
      }
    },
    [saveItemLabels],
  );

  const assignFolderToItem = useCallback(
    async (item: BoardItem, folderId: string | null) => {
      if (item.folderId === folderId) return;
      setSavingFolderItemId(item.id);
      try {
        await saveItemMetadata(item.id, { folderId });
        setNotice(null);
      } catch {
        setNotice("Could not update the board.");
      } finally {
        setSavingFolderItemId((current) => (current === item.id ? null : current));
      }
    },
    [saveItemMetadata],
  );

  const createBoard = useCallback(async (name: string) => {
    const response = await fetch("/api/folders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      if (response.status === 409) {
        throw new Error("BoardAlreadyExists");
      }
      throw new Error("CreateBoardFailed");
    }
    const payload = (await response.json()) as { folder: BoardFolder };
    setFolders((current) => [...current, payload.folder].sort((a, b) => a.name.localeCompare(b.name)));
    return payload.folder;
  }, []);

  const createCustomFolder = useCallback(async () => {
    const name = normalizeFolderName(newFolderDraft);
    if (!name) {
      setNotice("Board name cannot be empty.");
      return;
    }
    setIsCreatingFolder(true);
    try {
      const folder = await createBoard(name);
      setActiveFolder(folderKeyForId(folder.id));
      setNewFolderDraft("");
      setIsFolderCreatorOpen(false);
      setNotice(null);
    } catch (error) {
      if (error instanceof Error && error.message === "BoardAlreadyExists") {
        setNotice("A board with that name already exists.");
      } else {
        setNotice("Could not create board.");
      }
    } finally {
      setIsCreatingFolder(false);
    }
  }, [createBoard, newFolderDraft]);

  const deleteCustomFolder = useCallback(async (folderId: string) => {
    setDeletingFolderId(folderId);
    try {
      const response = await fetch(`/api/folders/${folderId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error("Delete board failed");
      }

      setFolders((current) => current.filter((folder) => folder.id !== folderId));
      setItems((current) => current.map((item) => (item.folderId === folderId ? { ...item, folderId: null } : item)));
      setActiveFolder((current) => (current === folderKeyForId(folderId) ? ALL_FOLDER_KEY : current));
      setNotice(null);
    } catch {
      setNotice("Could not delete board.");
    } finally {
      setDeletingFolderId((current) => (current === folderId ? null : current));
      setConfirmFolderId((current) => (current === folderId ? null : current));
    }
  }, []);

  const deleteLabelEverywhere = useCallback(
    async (label: string) => {
      const itemsWithLabel = items.filter((item) => item.labels.includes(label));
      setDeletingLabel(label);
      try {
        for (const item of itemsWithLabel) {
          const nextLabels = item.labels.filter((itemLabel) => itemLabel !== label);
          await saveItemLabels(item.id, nextLabels);
        }
        setActiveFilterLabel((current) => (current === label ? null : current));
        setNotice(null);
      } catch {
        setNotice("Could not delete label.");
        void loadImages();
      } finally {
        setDeletingLabel((current) => (current === label ? null : current));
      }
    },
    [items, loadImages, saveItemLabels],
  );

  const renameLabelEverywhere = useCallback(
    async (label: string, rawNextLabel: string) => {
      const nextLabel = normalizeLabel(rawNextLabel);
      if (!nextLabel) {
        setNotice("Label name cannot be empty.");
        return;
      }
      if (nextLabel === NO_LABEL_FILTER_VALUE) {
        setNotice("That label name is reserved.");
        return;
      }
      if (nextLabel === label) return;
      const itemsWithLabel = items.filter((item) => item.labels.includes(label));
      if (!itemsWithLabel.length) return;

      setRenamingLabel(label);
      try {
        for (const item of itemsWithLabel) {
          const renamedLabels = item.labels.map((itemLabel) => (itemLabel === label ? nextLabel : itemLabel));
          const nextLabels = Array.from(new Set(renamedLabels)).slice(0, 12);
          await saveItemLabels(item.id, nextLabels);
        }
        setActiveFilterLabel((current) => (current === label ? nextLabel : current));
        setNotice(null);
      } catch {
        setNotice("Could not rename label.");
        void loadImages();
      } finally {
        setRenamingLabel((current) => (current === label ? null : current));
      }
    },
    [items, loadImages, saveItemLabels],
  );

  const placeFloatingPanel = useCallback((clientX: number, clientY: number, panelWidth: number, panelHeight: number) => {
    const viewportPadding = 8;
    const x = clamp(clientX, viewportPadding, Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding));
    const y = clamp(clientY, viewportPadding, Math.max(viewportPadding, window.innerHeight - panelHeight - viewportPadding));
    return { x, y };
  }, []);

  const openLabelContextMenu = useCallback((label: string, clientX: number, clientY: number) => {
    const position = placeFloatingPanel(clientX, clientY, 164, 84);
    setLabelActionPopover(null);
    setLabelContextMenu({ label, x: position.x, y: position.y });
  }, [placeFloatingPanel]);

  useEffect(() => {
    const handleLabelContextMenuCapture = (event: MouseEvent) => {
      if (isCanvasMode) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const trigger = target.closest<HTMLElement>(LABEL_CONTEXT_TRIGGER_SELECTOR);
      if (!trigger) return;
      const label = trigger.dataset.labelContextValue;
      if (!label || trigger.dataset.labelContextSystem === "true") return;
      event.preventDefault();
      event.stopPropagation();
      openLabelContextMenu(label, event.clientX, event.clientY);
    };

    window.addEventListener("contextmenu", handleLabelContextMenuCapture, true);
    return () => {
      window.removeEventListener("contextmenu", handleLabelContextMenuCapture, true);
    };
  }, [isCanvasMode, openLabelContextMenu]);

  const requestRenameLabel = useCallback(
    (label: string) => {
      if (deletingLabel === label || renamingLabel === label) return;
      const anchorX = labelContextMenu?.x ?? window.innerWidth / 2;
      const anchorY = labelContextMenu?.y ?? window.innerHeight / 2;
      const position = placeFloatingPanel(anchorX, anchorY + 30, 220, 116);
      setLabelContextMenu(null);
      setLabelActionPopover({
        mode: "rename",
        label,
        draft: label,
        x: position.x,
        y: position.y,
      });
    },
    [deletingLabel, labelContextMenu, placeFloatingPanel, renamingLabel],
  );

  const requestDeleteLabel = useCallback(
    (label: string) => {
      if (deletingLabel === label || renamingLabel === label) return;
      const anchorX = labelContextMenu?.x ?? window.innerWidth / 2;
      const anchorY = labelContextMenu?.y ?? window.innerHeight / 2;
      const position = placeFloatingPanel(anchorX, anchorY + 30, 164, 84);
      setLabelContextMenu(null);
      setLabelActionPopover({
        mode: "delete",
        label,
        draft: label,
        x: position.x,
        y: position.y,
      });
    },
    [deletingLabel, labelContextMenu, placeFloatingPanel, renamingLabel],
  );

  const submitRenameLabel = useCallback(() => {
    if (!labelActionPopover || labelActionPopover.mode !== "rename") return;
    const { label, draft } = labelActionPopover;
    setLabelActionPopover(null);
    void renameLabelEverywhere(label, draft);
  }, [labelActionPopover, renameLabelEverywhere]);

  const submitDeleteLabel = useCallback(() => {
    if (!labelActionPopover || labelActionPopover.mode !== "delete") return;
    const { label } = labelActionPopover;
    setLabelActionPopover(null);
    void deleteLabelEverywhere(label);
  }, [deleteLabelEverywhere, labelActionPopover]);

  const deleteItem = useCallback(async (item: BoardItem) => {
    setDeletingImageId(item.id);
    try {
      const response = await fetch(`/api/images/${item.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setNotice("Could not delete the image.");
        return;
      }
      setItems((current) => current.filter((existing) => existing.id !== item.id));
      setActiveItemId((currentId) => (currentId === item.id ? null : currentId));
      setLabelEditorItemId((current) => (current === item.id ? null : current));
      setNotice(null);
    } catch {
      setNotice("Could not delete the image.");
    } finally {
      setDeletingImageId((current) => (current === item.id ? null : current));
      setConfirmImageId((current) => (current === item.id ? null : current));
    }
  }, []);

  useEffect(() => {
    if (!labelContextMenu && !labelActionPopover) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (labelContextMenuRef.current?.contains(event.target as Node)) return;
      if (labelActionPopoverRef.current?.contains(event.target as Node)) return;
      setLabelContextMenu(null);
      setLabelActionPopover(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLabelContextMenu(null);
        setLabelActionPopover(null);
      }
    };

    const handleScroll = () => {
      setLabelContextMenu(null);
      setLabelActionPopover(null);
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [labelActionPopover, labelContextMenu]);

  useEffect(() => {
    const hasMenuLabel = labelContextMenu
      ? labelFilterEntries.some((entry) => !entry.system && entry.value === labelContextMenu.label)
      : true;
    const hasPopoverLabel = labelActionPopover
      ? labelFilterEntries.some((entry) => !entry.system && entry.value === labelActionPopover.label)
      : true;
    if (!hasMenuLabel) {
      setLabelContextMenu(null);
    }
    if (!hasPopoverLabel) {
      setLabelActionPopover(null);
    }
  }, [labelActionPopover, labelContextMenu, labelFilterEntries]);

  useEffect(() => {
    canvasLayoutsRef.current = canvasLayouts;
  }, [canvasLayouts]);

  useEffect(() => {
    selectedCanvasItemIdsRef.current = selectedCanvasItemIds;
  }, [selectedCanvasItemIds]);

  useEffect(() => {
    canvasViewportRef.current = canvasViewport;
  }, [canvasViewport]);

  const persistCanvasLayout = useCallback(async (itemId: string, layout: CanvasLayout, sequence: number) => {
    try {
      const response = await fetch(`/api/images/${itemId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ canvas: layout }),
      });
      if (!response.ok) {
        throw new Error("Canvas save failed");
      }
      if (canvasPersistSequenceRef.current[itemId] !== sequence) return;
      setItems((current) => current.map((item) => (item.id === itemId ? { ...item, canvas: layout } : item)));
      setNotice(null);
    } catch {
      if (canvasPersistSequenceRef.current[itemId] !== sequence) return;
      setNotice("Could not save canvas layout.");
    }
  }, []);

  const flushCanvasLayoutPersist = useCallback(
    (itemId: string) => {
      const timeoutId = canvasPersistTimeoutsRef.current[itemId];
      if (timeoutId) {
        window.clearTimeout(timeoutId);
        delete canvasPersistTimeoutsRef.current[itemId];
      }
      const pendingLayout = canvasPendingLayoutsRef.current[itemId];
      if (!pendingLayout) return;
      delete canvasPendingLayoutsRef.current[itemId];
      const sequence = (canvasPersistSequenceRef.current[itemId] ?? 0) + 1;
      canvasPersistSequenceRef.current[itemId] = sequence;
      void persistCanvasLayout(itemId, pendingLayout, sequence);
    },
    [persistCanvasLayout],
  );

  const queueCanvasLayoutPersist = useCallback(
    (itemId: string, layout: CanvasLayout) => {
      canvasPendingLayoutsRef.current[itemId] = layout;
      const timeoutId = canvasPersistTimeoutsRef.current[itemId];
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
      canvasPersistTimeoutsRef.current[itemId] = window.setTimeout(() => {
        flushCanvasLayoutPersist(itemId);
      }, 280);
    },
    [flushCanvasLayoutPersist],
  );

  const placeUploadedItemsOnCanvas = useCallback(
    (uploadedItems: BoardItem[]) => {
      if (!uploadedItems.length) return;
      const viewport = canvasViewportRef.current;
      const worldCenterX = (window.innerWidth / 2 - viewport.x) / viewport.scale;
      const worldCenterY = (window.innerHeight / 2 - viewport.y) / viewport.scale;
      const rowWidthLimit = 920;
      const gap = 36;

      setCanvasLayouts((current) => {
        const next = { ...current };
        let maxZ = Object.values(next).reduce((highest, entry) => Math.max(highest, entry.z), 0);
        const startX = worldCenterX - rowWidthLimit / 2;
        let cursorX = 0;
        let cursorY = worldCenterY;
        let rowHeight = 0;

        for (const item of uploadedItems) {
          const size = imageSeedSize(item);
          if (cursorX > 0 && cursorX + size.width > rowWidthLimit) {
            cursorX = 0;
            cursorY += rowHeight + gap;
            rowHeight = 0;
          }

          maxZ += 1;
          const layout = normalizeCanvasLayout({
            x: startX + cursorX,
            y: cursorY,
            width: size.width,
            height: size.height,
            z: maxZ,
          });
          next[item.id] = layout;
          cursorX += size.width + gap;
          rowHeight = Math.max(rowHeight, size.height);
          queueCanvasLayoutPersist(item.id, layout);
        }

        canvasLayoutsRef.current = next;
        return next;
      });
    },
    [queueCanvasLayoutPersist],
  );

  const flushAllCanvasLayoutPersists = useCallback(() => {
    const ids = Object.keys(canvasPendingLayoutsRef.current);
    for (const id of ids) {
      flushCanvasLayoutPersist(id);
    }
  }, [flushCanvasLayoutPersist]);

  const applyCanvasLayouts = useCallback(
    (nextLayouts: CanvasLayoutMap, persist: "none" | "debounce" | "flush" = "debounce") => {
      const changedLayouts: CanvasLayoutMap = {};
      for (const [itemId, layout] of Object.entries(nextLayouts)) {
        const currentLayout = canvasLayoutsRef.current[itemId];
        if (!currentLayout) continue;
        const normalizedLayout = normalizeCanvasLayout(layout);
        if (layoutEquals(currentLayout, normalizedLayout)) continue;
        changedLayouts[itemId] = normalizedLayout;
      }

      const changedIds = Object.keys(changedLayouts);
      if (!changedIds.length) return;

      setCanvasLayouts((current) => {
        let changed = false;
        const next = { ...current };
        for (const itemId of changedIds) {
          const previous = current[itemId];
          const normalizedLayout = changedLayouts[itemId];
          if (!previous || layoutEquals(previous, normalizedLayout)) continue;
          next[itemId] = normalizedLayout;
          changed = true;
        }
        if (!changed) return current;
        canvasLayoutsRef.current = next;
        return next;
      });

      for (const itemId of changedIds) {
        const normalizedLayout = changedLayouts[itemId];
        if (persist === "debounce") {
          queueCanvasLayoutPersist(itemId, normalizedLayout);
        } else if (persist === "flush") {
          canvasPendingLayoutsRef.current[itemId] = normalizedLayout;
          flushCanvasLayoutPersist(itemId);
        }
      }
    },
    [flushCanvasLayoutPersist, queueCanvasLayoutPersist],
  );

  const applyCanvasLayout = useCallback(
    (itemId: string, nextLayout: CanvasLayout, persist: "none" | "debounce" | "flush" = "debounce") => {
      applyCanvasLayouts({ [itemId]: nextLayout }, persist);
    },
    [applyCanvasLayouts],
  );

  const bringCanvasItemsToFront = useCallback(
    (itemIds: string[], persist: "none" | "debounce" | "flush" = "debounce") => {
      const source = canvasLayoutsRef.current;
      const uniqueIds = normalizeSelection(itemIds).filter((itemId) => Boolean(source[itemId]));
      if (!uniqueIds.length) return {};

      const orderedIds = [...uniqueIds].sort((left, right) => {
        const layoutLeft = source[left];
        const layoutRight = source[right];
        if (layoutLeft.z === layoutRight.z) return left.localeCompare(right);
        return layoutLeft.z - layoutRight.z;
      });

      let nextZ = Object.values(source).reduce((highest, entry) => Math.max(highest, entry.z), 0);
      const elevatedLayouts: CanvasLayoutMap = {};
      for (const itemId of orderedIds) {
        const layout = source[itemId];
        nextZ += 1;
        elevatedLayouts[itemId] = { ...layout, z: nextZ };
      }

      applyCanvasLayouts(elevatedLayouts, persist);
      return elevatedLayouts;
    },
    [applyCanvasLayouts],
  );

  const bringCanvasItemToFront = useCallback(
    (itemId: string, persist: "none" | "debounce" | "flush" = "debounce") => {
      const elevated = bringCanvasItemsToFront([itemId], persist);
      return elevated[itemId];
    },
    [bringCanvasItemsToFront],
  );

  const centerCanvasViewport = useCallback((layouts: CanvasLayoutMap) => {
    const bounds = getCanvasBounds(layouts);
    const centerX = bounds ? (bounds.minX + bounds.maxX) / 2 : 0;
    const centerY = bounds ? (bounds.minY + bounds.maxY) / 2 : 0;
    const nextViewport = {
      x: window.innerWidth / 2 - centerX,
      y: window.innerHeight / 2 - centerY,
      scale: 1,
    };
    setCanvasViewport(nextViewport);
    canvasViewportRef.current = nextViewport;
  }, []);

  const initializeCanvasModeLayouts = useCallback((preserveViewport = false) => {
    const built = buildCanvasLayouts(items);
    setCanvasLayouts(built.layouts);
    canvasLayoutsRef.current = built.layouts;
    setCanvasLoadedImageIds(new Set());
    if (!preserveViewport) {
      centerCanvasViewport(built.layouts);
    }
  }, [centerCanvasViewport, items]);

  const exitCanvasMode = useCallback(() => {
    flushAllCanvasLayoutPersists();
    setIsCanvasMode(false);
    setSelectedCanvasItemIds([]);
    setCanvasSelectionBox(null);
    setIsCanvasHandMode(false);
    setIsCanvasHelpExpanded(false);
    setIsCanvasHelpHovered(false);
    setCanvasInteractionMode("idle");
    canvasInteractionRef.current = { mode: "idle" };
    canvasPointersRef.current = {};
  }, [flushAllCanvasLayoutPersists]);

  const enterCanvasMode = useCallback(() => {
    const shouldPreserveViewport = hasEnteredCanvasRef.current;
    setActiveItemId(null);
    setSelectedCanvasItemIds([]);
    setCanvasSelectionBox(null);
    setIsCanvasHandMode(false);
    setIsTopSearchOpen(false);
    setLabelEditorItemId(null);
    setHoverBoardCreatorItemId(null);
    setNewLabelDraft("");
    setHoverBoardDraft("");
    setConfirmImageId(null);
    setConfirmFolderId(null);
    setLabelContextMenu(null);
    setLabelActionPopover(null);
    setIsCanvasMode(true);
    setIsCanvasHelpExpanded(true);
    setIsCanvasHelpHovered(false);
    setCanvasInteractionMode("idle");
    canvasInteractionRef.current = { mode: "idle" };
    canvasPointersRef.current = {};
    initializeCanvasModeLayouts(shouldPreserveViewport);
    hasEnteredCanvasRef.current = true;
  }, [initializeCanvasModeLayouts]);

  const resetCanvasInteraction = useCallback(() => {
    canvasInteractionRef.current = { mode: "idle" };
    setCanvasInteractionMode("idle");
    setCanvasSelectionBox(null);
  }, []);

  const readCanvasLocalPoint = useCallback((clientX: number, clientY: number) => {
    const surface = canvasSurfaceRef.current;
    if (!surface) return null;
    const bounds = surface.getBoundingClientRect();
    return {
      x: clientX - bounds.left,
      y: clientY - bounds.top,
    };
  }, []);

  const maybeStartPinch = useCallback(() => {
    const entries = Object.entries(canvasPointersRef.current).filter(([, pointer]) => pointer.pointerType === "touch");
    if (entries.length < 2) return false;

    const [firstEntry, secondEntry] = entries;
    const firstId = Number(firstEntry[0]);
    const secondId = Number(secondEntry[0]);
    const firstPoint = firstEntry[1];
    const secondPoint = secondEntry[1];
    const startDistance = distanceBetweenPoints(firstPoint, secondPoint);
    if (startDistance < 8) return false;

    const startViewport = canvasViewportRef.current;
    const midpoint = {
      x: (firstPoint.x + secondPoint.x) / 2,
      y: (firstPoint.y + secondPoint.y) / 2,
    };
    const worldPoint = {
      x: (midpoint.x - startViewport.x) / startViewport.scale,
      y: (midpoint.y - startViewport.y) / startViewport.scale,
    };

    canvasInteractionRef.current = {
      mode: "pinch",
      pointerIds: [firstId, secondId],
      startDistance,
      startScale: startViewport.scale,
      startViewport,
      worldPoint,
    };
    setCanvasInteractionMode("pinch");
    return true;
  }, []);

  const handleCanvasBackgroundPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isCanvasMode) return;
      if (event.button !== 0 && event.pointerType !== "touch") return;

      const localPoint = readCanvasLocalPoint(event.clientX, event.clientY);
      if (!localPoint) return;

      canvasPointersRef.current[event.pointerId] = {
        ...localPoint,
        pointerType: event.pointerType,
      };

      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();

      if (event.pointerType === "touch" && maybeStartPinch()) {
        return;
      }

      const shouldPan = event.pointerType === "touch" || isCanvasHandMode;
      if (!shouldPan) {
        const additiveSelection = event.metaKey || event.ctrlKey || event.shiftKey;
        if (!additiveSelection) {
          setCanvasSelection([]);
        }
        canvasInteractionRef.current = {
          mode: "select",
          pointerId: event.pointerId,
          startClient: localPoint,
          additive: additiveSelection,
          startSelection: selectedCanvasItemIdsRef.current,
        };
        setCanvasSelectionBox(selectionBoxFromPoints(localPoint, localPoint));
        setCanvasInteractionMode("select");
        return;
      }

      const startViewport = canvasViewportRef.current;
      canvasInteractionRef.current = {
        mode: "pan",
        pointerId: event.pointerId,
        startClient: localPoint,
        startViewport,
      };
      setCanvasInteractionMode("pan");
    },
    [isCanvasHandMode, isCanvasMode, maybeStartPinch, readCanvasLocalPoint, setCanvasSelection],
  );

  const handleCanvasItemPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>, itemId: string) => {
      if (event.button !== 0 && event.pointerType !== "touch") return;
      const localPoint = readCanvasLocalPoint(event.clientX, event.clientY);
      if (!localPoint) return;

      event.preventDefault();
      event.stopPropagation();
      if (event.pointerType !== "touch" && isCanvasHandMode) {
        event.currentTarget.setPointerCapture(event.pointerId);
        canvasPointersRef.current[event.pointerId] = {
          ...localPoint,
          pointerType: event.pointerType,
        };
        const startViewport = canvasViewportRef.current;
        canvasInteractionRef.current = {
          mode: "pan",
          pointerId: event.pointerId,
          startClient: localPoint,
          startViewport,
        };
        setCanvasInteractionMode("pan");
        return;
      }

      const isToggleSelection = event.metaKey || event.ctrlKey || event.shiftKey;
      if (isToggleSelection) {
        const toggledSelection = new Set(selectedCanvasItemIdsRef.current);
        if (toggledSelection.has(itemId)) {
          toggledSelection.delete(itemId);
        } else {
          toggledSelection.add(itemId);
        }
        setCanvasSelection(toggledSelection);
        return;
      }

      const currentSelection = selectedCanvasItemIdsRef.current;
      const shouldDragSelection = currentSelection.length > 1 && currentSelection.includes(itemId);
      const dragItemIds = shouldDragSelection ? currentSelection : [itemId];
      setCanvasSelection(dragItemIds);

      const elevatedLayouts = bringCanvasItemsToFront(dragItemIds, "debounce");
      const startLayoutIds = normalizeSelection(Object.keys(elevatedLayouts));
      if (!startLayoutIds.length) return;

      event.currentTarget.setPointerCapture(event.pointerId);
      canvasPointersRef.current[event.pointerId] = {
        ...localPoint,
        pointerType: event.pointerType,
      };
      canvasInteractionRef.current = {
        mode: "drag",
        pointerId: event.pointerId,
        itemIds: startLayoutIds,
        startClient: localPoint,
        startLayouts: elevatedLayouts,
      };
      setCanvasInteractionMode("drag");
    },
    [bringCanvasItemsToFront, isCanvasHandMode, readCanvasLocalPoint, setCanvasSelection],
  );

  const handleCanvasResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>, itemId: string, handle: CanvasHandle) => {
      if (event.button !== 0 && event.pointerType !== "touch") return;
      const localPoint = readCanvasLocalPoint(event.clientX, event.clientY);
      if (!localPoint) return;

      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      setCanvasSelection([itemId]);

      const elevated = bringCanvasItemToFront(itemId, "debounce");
      const startLayout = elevated ?? canvasLayoutsRef.current[itemId];
      if (!startLayout) return;

      canvasPointersRef.current[event.pointerId] = {
        ...localPoint,
        pointerType: event.pointerType,
      };
      canvasInteractionRef.current = {
        mode: "resize",
        pointerId: event.pointerId,
        itemId,
        handle,
        startClient: localPoint,
        startLayout,
      };
      setCanvasInteractionMode("resize");
    },
    [bringCanvasItemToFront, readCanvasLocalPoint, setCanvasSelection],
  );

  const handleCanvasPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const localPoint = readCanvasLocalPoint(event.clientX, event.clientY);
      if (!localPoint) return;

      const knownPointer = canvasPointersRef.current[event.pointerId];
      if (knownPointer) {
        canvasPointersRef.current[event.pointerId] = {
          ...knownPointer,
          x: localPoint.x,
          y: localPoint.y,
        };
      }

      const interaction = canvasInteractionRef.current;
      if (interaction.mode === "idle") return;

      event.preventDefault();

      if (interaction.mode === "pinch") {
        const [firstId, secondId] = interaction.pointerIds;
        const first = canvasPointersRef.current[firstId];
        const second = canvasPointersRef.current[secondId];
        if (!first || !second) return;
        const distance = distanceBetweenPoints(first, second);
        if (distance < 8) return;
        const midpoint = {
          x: (first.x + second.x) / 2,
          y: (first.y + second.y) / 2,
        };
        const nextScale = clampScale(interaction.startScale * (distance / interaction.startDistance));
        const nextViewport = {
          x: midpoint.x - interaction.worldPoint.x * nextScale,
          y: midpoint.y - interaction.worldPoint.y * nextScale,
          scale: nextScale,
        };
        setCanvasViewport(nextViewport);
        canvasViewportRef.current = nextViewport;
        return;
      }

      if (interaction.mode === "pan") {
        if (event.pointerId !== interaction.pointerId) return;
        const deltaX = localPoint.x - interaction.startClient.x;
        const deltaY = localPoint.y - interaction.startClient.y;
        const nextViewport = {
          x: interaction.startViewport.x + deltaX,
          y: interaction.startViewport.y + deltaY,
          scale: interaction.startViewport.scale,
        };
        setCanvasViewport(nextViewport);
        canvasViewportRef.current = nextViewport;
        return;
      }

      if (interaction.mode === "select") {
        if (event.pointerId !== interaction.pointerId) return;
        const nextSelectionBox = selectionBoxFromPoints(interaction.startClient, localPoint);
        setCanvasSelectionBox(nextSelectionBox);

        const viewport = canvasViewportRef.current;
        const worldBounds = {
          left: (nextSelectionBox.x - viewport.x) / viewport.scale,
          right: (nextSelectionBox.x + nextSelectionBox.width - viewport.x) / viewport.scale,
          top: (nextSelectionBox.y - viewport.y) / viewport.scale,
          bottom: (nextSelectionBox.y + nextSelectionBox.height - viewport.y) / viewport.scale,
        };

        const selectedByBox = Object.entries(canvasLayoutsRef.current)
          .filter(([, layout]) => canvasLayoutIntersectsWorldBounds(layout, worldBounds))
          .map(([itemId]) => itemId);
        if (interaction.additive) {
          const mergedSelection = new Set(interaction.startSelection);
          for (const itemId of selectedByBox) {
            mergedSelection.add(itemId);
          }
          setCanvasSelection(mergedSelection);
        } else {
          setCanvasSelection(selectedByBox);
        }
        return;
      }

      if (interaction.mode === "drag") {
        if (event.pointerId !== interaction.pointerId) return;
        const scale = canvasViewportRef.current.scale;
        let deltaX = (localPoint.x - interaction.startClient.x) / scale;
        let deltaY = (localPoint.y - interaction.startClient.y) / scale;
        if (event.shiftKey) {
          if (Math.abs(deltaX) >= Math.abs(deltaY)) {
            deltaY = 0;
          } else {
            deltaX = 0;
          }
        }
        const nextLayouts: CanvasLayoutMap = {};
        for (const itemId of interaction.itemIds) {
          const startLayout = interaction.startLayouts[itemId];
          if (!startLayout) continue;
          nextLayouts[itemId] = {
            ...startLayout,
            x: startLayout.x + deltaX,
            y: startLayout.y + deltaY,
          };
        }
        applyCanvasLayouts(nextLayouts, "debounce");
        return;
      }

      if (interaction.mode === "resize") {
        if (event.pointerId !== interaction.pointerId) return;
        const scale = canvasViewportRef.current.scale;
        const deltaX = (localPoint.x - interaction.startClient.x) / scale;
        const deltaY = (localPoint.y - interaction.startClient.y) / scale;
        const aspect = interaction.startLayout.width / Math.max(interaction.startLayout.height, 1);

        const horizontalSign = interaction.handle.includes("w") ? -1 : 1;
        const verticalSign = interaction.handle.includes("n") ? -1 : 1;

        const widthFromX = interaction.startLayout.width + horizontalSign * deltaX;
        const heightFromY = interaction.startLayout.height + verticalSign * deltaY;
        const widthFromY = heightFromY * aspect;

        let width = Math.abs(deltaX) > Math.abs(deltaY * aspect) ? widthFromX : widthFromY;
        width = clamp(width, CANVAS_MIN_IMAGE_WIDTH, CANVAS_MAX_IMAGE_WIDTH);
        const height = Math.max(50, width / aspect);

        const nextLayout: CanvasLayout = {
          ...interaction.startLayout,
          x: interaction.handle.includes("w") ? interaction.startLayout.x + (interaction.startLayout.width - width) : interaction.startLayout.x,
          y: interaction.handle.includes("n") ? interaction.startLayout.y + (interaction.startLayout.height - height) : interaction.startLayout.y,
          width,
          height,
        };
        applyCanvasLayout(interaction.itemId, nextLayout, "debounce");
      }
    },
    [applyCanvasLayout, applyCanvasLayouts, readCanvasLocalPoint, setCanvasSelection],
  );

  const handleCanvasPointerEnd = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const interaction = canvasInteractionRef.current;
      delete canvasPointersRef.current[event.pointerId];

      if (interaction.mode === "drag" && interaction.pointerId === event.pointerId) {
        for (const itemId of interaction.itemIds) {
          flushCanvasLayoutPersist(itemId);
        }
      } else if (interaction.mode === "resize" && interaction.pointerId === event.pointerId) {
        flushCanvasLayoutPersist(interaction.itemId);
      }

      if (interaction.mode === "pinch") {
        const remainingTouchPointers = Object.entries(canvasPointersRef.current).filter(([, pointer]) => pointer.pointerType === "touch");
        if (remainingTouchPointers.length >= 2) {
          void maybeStartPinch();
          return;
        }
        if (remainingTouchPointers.length === 1) {
          const [pointerIdText, pointer] = remainingTouchPointers[0];
          const nextInteraction: CanvasInteraction = {
            mode: "pan",
            pointerId: Number(pointerIdText),
            startClient: { x: pointer.x, y: pointer.y },
            startViewport: canvasViewportRef.current,
          };
          canvasInteractionRef.current = nextInteraction;
          setCanvasInteractionMode("pan");
          return;
        }
      }

      if (interaction.mode === "pan" && interaction.pointerId !== event.pointerId) {
        return;
      }
      if (interaction.mode === "drag" && interaction.pointerId !== event.pointerId) {
        return;
      }
      if (interaction.mode === "resize" && interaction.pointerId !== event.pointerId) {
        return;
      }
      if (interaction.mode === "select" && interaction.pointerId !== event.pointerId) {
        return;
      }

      resetCanvasInteraction();
    },
    [flushCanvasLayoutPersist, maybeStartPinch, resetCanvasInteraction],
  );

  const handleCanvasWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!isCanvasMode) return;
      const localPoint = readCanvasLocalPoint(event.clientX, event.clientY);
      if (!localPoint) return;
      event.preventDefault();

      const currentViewport = canvasViewportRef.current;
      const zoomFactor = Math.exp(-event.deltaY * 0.0012);
      const nextScale = clampScale(currentViewport.scale * zoomFactor);
      if (nextScale === currentViewport.scale) return;

      const worldX = (localPoint.x - currentViewport.x) / currentViewport.scale;
      const worldY = (localPoint.y - currentViewport.y) / currentViewport.scale;
      const nextViewport = {
        x: localPoint.x - worldX * nextScale,
        y: localPoint.y - worldY * nextScale,
        scale: nextScale,
      };
      setCanvasViewport(nextViewport);
      canvasViewportRef.current = nextViewport;
    },
    [isCanvasMode, readCanvasLocalPoint],
  );

  const applyCanvasColorFromPlane = useCallback(
    (clientX: number, clientY: number, element: HTMLDivElement) => {
      const rect = element.getBoundingClientRect();
      const saturation = clamp((clientX - rect.left) / rect.width, 0, 1);
      const value = clamp(1 - (clientY - rect.top) / rect.height, 0, 1);
      const [red, green, blue] = hsvToRgb(canvasHue, saturation, value);
      setCanvasBackgroundColor(rgbToHex(red, green, blue));
    },
    [canvasHue],
  );

  const updateCanvasRgbChannel = useCallback(
    (channel: "r" | "g" | "b", rawValue: string) => {
      const parsed = Number.parseInt(rawValue, 10);
      if (!Number.isFinite(parsed)) return;
      const next = clampChannel(parsed);
      const red = channel === "r" ? next : canvasRed;
      const green = channel === "g" ? next : canvasGreen;
      const blue = channel === "b" ? next : canvasBlue;
      setCanvasBackgroundColor(rgbToHex(red, green, blue));
    },
    [canvasBlue, canvasGreen, canvasRed],
  );

  const applyCanvasHexDraft = useCallback(() => {
    const normalized = normalizeHexColor(canvasHexDraft);
    if (!normalized) return;
    setCanvasBackgroundColor(normalized);
    setCanvasHexDraft(normalized);
  }, [canvasHexDraft]);

  useEffect(() => {
    void loadImages();
  }, [loadImages]);

  useEffect(() => {
    const storedColor = window.localStorage.getItem(CANVAS_BACKGROUND_STORAGE_KEY);
    if (!storedColor) return;
    if (/^#[0-9a-fA-F]{6}$/.test(storedColor)) {
      setCanvasBackgroundColor(storedColor);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(CANVAS_BACKGROUND_STORAGE_KEY, canvasBackgroundColor);
  }, [canvasBackgroundColor]);

  useEffect(() => {
    setCanvasHexDraft(canvasBackgroundColor);
  }, [canvasBackgroundColor]);

  useEffect(() => {
    if (isCanvasMode) return;
    setIsCanvasColorPickerOpen(false);
  }, [isCanvasMode]);

  useEffect(() => {
    if (!isCanvasMode || !isCanvasColorPickerOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!canvasColorPickerRef.current?.contains(event.target as Node)) {
        setIsCanvasColorPickerOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsCanvasColorPickerOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isCanvasColorPickerOpen, isCanvasMode]);

  useEffect(() => {
    const timeoutRegistry = canvasPersistTimeoutsRef.current;
    return () => {
      for (const timeoutId of Object.values(timeoutRegistry)) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  useEffect(() => {
    if (!isCanvasMode) return;

    setCanvasLayouts((current) => {
      const next: CanvasLayoutMap = {};
      let changed = false;

      for (const item of items) {
        const existing = current[item.id];
        if (!existing) continue;
        next[item.id] = existing;
      }

      if (Object.keys(next).length !== Object.keys(current).length) {
        changed = true;
      }

      const missingItems = items.filter((item) => !next[item.id]);
      if (missingItems.length) {
        const bounds = getCanvasBounds(next);
        const seedStartY = bounds ? bounds.maxY + CANVAS_GAP * 2 : 0;
        const nextZ = Object.values(next).reduce((highest, layout) => Math.max(highest, layout.z), 0) + 1;
        const seeded = createPackedLayouts(missingItems, seedStartY, nextZ);
        Object.assign(next, seeded.layouts);
        changed = true;
      }

      if (!changed) return current;
      canvasLayoutsRef.current = next;
      return next;
    });
  }, [isCanvasMode, items]);

  useEffect(() => {
    if (!selectedCanvasItemIds.length) return;
    const remainingSelection = selectedCanvasItemIds.filter((itemId) => Boolean(canvasLayouts[itemId]));
    if (remainingSelection.length === selectedCanvasItemIds.length) return;
    setCanvasSelection(remainingSelection);
  }, [canvasLayouts, selectedCanvasItemIds, setCanvasSelection]);

  useEffect(() => {
    if (!isCanvasMode || !isCanvasHelpExpanded) return;
    const timeoutId = window.setTimeout(() => {
      setIsCanvasHelpExpanded(false);
    }, 3800);
    return () => window.clearTimeout(timeoutId);
  }, [isCanvasHelpExpanded, isCanvasMode]);

  useEffect(() => {
    setCanvasLoadedImageIds((current) => {
      const next = new Set<string>();
      for (const item of items) {
        if (current.has(item.id)) next.add(item.id);
      }
      return next;
    });
  }, [items]);

  useEffect(() => {
    if (wasCanvasModeRef.current && !isCanvasMode) {
      setVisibleCardIds(new Set(displayedItems.map((item) => item.id)));
      void loadImages();
    }
    wasCanvasModeRef.current = isCanvasMode;
  }, [displayedItems, isCanvasMode, loadImages]);

  useEffect(() => {
    if (activeFilterLabel && !labelFilterEntries.some((entry) => entry.value === activeFilterLabel)) {
      setActiveFilterLabel(null);
    }
  }, [activeFilterLabel, labelFilterEntries]);

  useEffect(() => {
    setActiveItemTitleDraft(activeItem?.title ?? "");
  }, [activeItem?.id, activeItem?.title]);

  useEffect(() => {
    const customFolderId = readCustomFolderId(activeFolder);
    if (!customFolderId) return;
    if (!folders.some((folder) => folder.id === customFolderId)) {
      setActiveFolder(ALL_FOLDER_KEY);
    }
  }, [activeFolder, folders]);

  useEffect(() => {
    const onPaste = async (event: ClipboardEvent) => {
      const clipboardItems = event.clipboardData?.items;
      if (!clipboardItems) return;

      const imageFiles = Array.from(clipboardItems)
        .filter((item) => item.type.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));

      if (!imageFiles.length) return;

      event.preventDefault();

      const uploadedItems: BoardItem[] = [];
      let failedCount = 0;
      const targetFolderId = readCustomFolderId(activeFolder);

      for (const file of imageFiles) {
        try {
          const { width, height } = await readImageSizeFromFile(file);
          const uploaded = await uploadImage(file, width, height, targetFolderId);
          uploadedItems.push(uploaded);
        } catch {
          failedCount += 1;
        }
      }

      if (uploadedItems.length) {
        setItems((current) => [...uploadedItems, ...current]);
        if (isCanvasMode) {
          placeUploadedItemsOnCanvas(uploadedItems);
        }
      }

      if (failedCount > 0) {
        setNotice(`${failedCount} image${failedCount > 1 ? "s" : ""} failed to save.`);
      } else {
        setNotice(null);
      }
    };

    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
    };
  }, [activeFolder, isCanvasMode, placeUploadedItemsOnCanvas, uploadImage]);

  useEffect(() => {
    if (!activeItem) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveItemId(null);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPrevious();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeItem, goToNext, goToPrevious]);

  useEffect(() => {
    if (!isCanvasMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (selectedCanvasItemIdsRef.current.length) {
        setCanvasSelection([]);
        return;
      }
      exitCanvasMode();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exitCanvasMode, isCanvasMode, setCanvasSelection]);

  useEffect(() => {
    if (!isCanvasMode) {
      setIsCanvasHandMode(false);
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      if (targetAcceptsTextInput(event.target)) return;
      event.preventDefault();
      setIsCanvasHandMode(true);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      setIsCanvasHandMode(false);
    };

    const onWindowBlur = () => {
      setIsCanvasHandMode(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onWindowBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [isCanvasMode]);

  useEffect(() => {
    if (!isTopSearchOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsTopSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isTopSearchOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey || event.altKey) || event.key.toLowerCase() !== "c") return;
      if (targetAcceptsTextInput(event.target)) return;
      event.preventDefault();
      if (isCanvasMode) {
        exitCanvasMode();
      } else {
        enterCanvasMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enterCanvasMode, exitCanvasMode, isCanvasMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCanvasMode) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsTopSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCanvasMode]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCanvasMode) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "b") return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable) return;
      const tagName = target?.tagName;
      if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") return;
      event.preventDefault();
      setIsSidebarCollapsed((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isCanvasMode]);

  useEffect(() => {
    document.body.style.overflow = activeItem || isTopSearchOpen || isCanvasMode ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [activeItem, isCanvasMode, isTopSearchOpen]);

  useEffect(() => {
    setVisibleCardIds((current) => {
      const next = new Set<string>();
      for (const item of displayedItems) {
        if (current.has(item.id)) next.add(item.id);
      }
      return next;
    });
  }, [displayedItems]);

  useEffect(() => {
    setLoadedImageIds((current) => {
      const next = new Set<string>();
      for (const item of items) {
        if (current.has(item.id)) next.add(item.id);
      }
      return next;
    });
  }, [items]);

  useEffect(() => {
    if (isCanvasMode) return;
    const container = masonrySectionRef.current;
    if (!container) return;
    const cards = Array.from(container.querySelectorAll<HTMLElement>("[data-fade-card-id]"));
    if (!cards.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleCardIds((current) => {
          const next = new Set(current);
          let changed = false;
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const id = (entry.target as HTMLElement).dataset.fadeCardId;
            if (!id || next.has(id)) continue;
            next.add(id);
            changed = true;
            observer.unobserve(entry.target);
          }
          return changed ? next : current;
        });
      },
      { threshold: 0.06, rootMargin: "0px 0px -2% 0px" },
    );

    for (const card of cards) {
      observer.observe(card);
    }

    return () => observer.disconnect();
  }, [displayedItems, isCanvasMode]);

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      {!isCanvasMode ? (
        <>
          <main className="relative w-full pb-0 pt-0">
            <div className="flex items-start">
              <aside
            className={`relative sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r transition-[width,opacity,transform,padding,border-color,background-color] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] md:flex ${
              isSidebarCollapsed
                ? "w-0 -translate-x-2 border-r-transparent bg-transparent pr-0 pt-3 opacity-0 pointer-events-none"
                : "w-[272px] translate-x-0 border-r-white/8 bg-gradient-to-b from-black/55 via-black/45 to-black/35 pr-0 pt-3 opacity-100 backdrop-blur-xl"
            }`}
              >
              <div className="flex items-center justify-between px-4 py-2">
                <div>
                  <Link href="/" className="text-[11px] uppercase tracking-[0.24em] text-white/55 transition hover:text-white/80">
                    THE BOARD
                  </Link>
                </div>
                <button
                  type="button"
                  aria-label="Collapse sidebar"
                  onClick={() => setIsSidebarCollapsed(true)}
                  className="inline-flex items-center justify-center px-1.5 py-1 text-white/75 transition hover:text-white"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
                    <path fill="currentColor" d="M16.3 17.3a1 1 0 0 1-1.4 0L9.6 12l5.3-5.3a1 1 0 1 1 1.4 1.4L12.4 12l3.9 3.9a1 1 0 0 1 0 1.4Zm-5 0a1 1 0 0 1-1.4 0L4.6 12l5.3-5.3a1 1 0 1 1 1.4 1.4L7.4 12l3.9 3.9a1 1 0 0 1 0 1.4Z" />
                  </svg>
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3">
                <div className="mb-4">
                  <button
                    type="button"
                    onClick={() => setIsTopSearchOpen(true)}
                    className="flex w-full items-center gap-2 rounded-lg border border-white/12 bg-white/5 py-1.5 pl-2.5 pr-3 text-left text-xs text-white/75 transition hover:border-white/28 hover:text-white/90"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 text-white/55">
                      <path fill="currentColor" d="M10.5 4a6.5 6.5 0 0 1 5.16 10.46l3.69 3.69a1 1 0 1 1-1.42 1.42l-3.69-3.69A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
                    </svg>
                    <span>Search</span>
                    <span className="ml-auto text-[10px] text-white/60">Cmd K</span>
                  </button>
                </div>

                <div className="space-y-4">
                  <section>
                    <div className="mb-1.5 flex items-center gap-2">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-white/40">Boards</p>
                      <button
                        type="button"
                        aria-label={isFolderCreatorOpen ? "Hide new board input" : "Show new board input"}
                        onClick={() => setIsFolderCreatorOpen((current) => !current)}
                        className="ml-auto inline-flex items-center justify-center px-1 py-0.5 text-white/80 transition hover:text-white"
                      >
                        <span className="text-[15px] leading-none">{isFolderCreatorOpen ? "−" : "+"}</span>
                      </button>
                    </div>
                    <div className="space-y-2">
                      <CustomDropdown
                        ariaLabel="Select board"
                        value={activeFolder}
                        onChange={(nextValue) => setActiveFolder(nextValue as FolderKey)}
                        options={sidebarFolderOptions}
                        containerClassName="block w-full"
                        triggerClassName="rounded-lg border border-white/12 bg-white/5 py-1.5 pl-2.5 pr-2 text-xs text-white/80 outline-none transition hover:border-white/28 focus-visible:border-white/35 focus-visible:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                      {normalizedSearchQuery && !visibleFolderEntries.length ? (
                        <p className="rounded-xl border border-white/12 bg-white/4 px-3 py-2 text-xs text-white/45">No board matches</p>
                      ) : null}
                      {(() => {
                        const selectedCustomFolderId = readCustomFolderId(activeFolder);
                        if (!selectedCustomFolderId) return null;
                        const isDeletingSelectedFolder = deletingFolderId === selectedCustomFolderId;
                        const isConfirmingSelectedFolder = confirmFolderId === selectedCustomFolderId;
                        return (
                          <div className="space-y-1.5">
                            <button
                              type="button"
                              onClick={() => setConfirmFolderId(selectedCustomFolderId)}
                              disabled={isDeletingSelectedFolder}
                              className="w-full rounded-xl border border-white/12 bg-white/5 px-2.5 py-2 text-xs text-white/75 transition hover:border-white/25 hover:bg-white/9 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isDeletingSelectedFolder ? "Deleting board..." : "Delete selected board"}
                            </button>
                            {isConfirmingSelectedFolder ? (
                              <div className="w-[160px] rounded-xl border border-white/16 bg-black/60 px-2.5 py-2 text-xs text-white/75">
                                <p>Delete this board?</p>
                                <div className="mt-1.5 flex gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (isDeletingSelectedFolder) return;
                                      void deleteCustomFolder(selectedCustomFolderId);
                                    }}
                                    disabled={isDeletingSelectedFolder}
                                    className="rounded-lg border border-white/22 bg-white/8 px-2 py-1 text-[11px] text-white/90 transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {isDeletingSelectedFolder ? "Deleting..." : "Yes"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmFolderId(null)}
                                    className="rounded-lg border border-white/18 px-2 py-1 text-[11px] text-white/70 transition hover:border-white/32 hover:text-white/90"
                                  >
                                    No
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}
                      {isFolderCreatorOpen ? (
                        <form
                          className="pt-1.5"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void createCustomFolder();
                          }}
                        >
                          <div className="flex gap-1.5">
                            <input
                              value={newFolderDraft}
                              onChange={(event) => setNewFolderDraft(event.target.value)}
                              placeholder="New board"
                              className="w-full rounded-none border border-white/12 bg-white/5 px-2.5 py-2 text-xs text-white/80 outline-none placeholder:text-white/32 transition focus:border-white/30 focus:bg-white/8"
                            />
                            <button
                              type="submit"
                              disabled={isCreatingFolder}
                              className="rounded-none border border-white/18 bg-white/7 px-2.5 py-2 text-xs font-medium text-white/78 transition hover:border-white/30 hover:bg-white/11 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {isCreatingFolder ? "..." : "Add"}
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  </section>

                  <section>
                    <p className="mb-1.5 text-[11px] uppercase tracking-[0.16em] text-white/40">Labels</p>
                    <div className="flex flex-wrap gap-2">
                      {visibleSidebarLabelEntries.map((entry) => {
                        const label = entry.value;
                        const isSystemLabel = Boolean(entry.system);
                        const isActive = label === activeFilterLabel;
                        return (
                          <div
                            key={label}
                            data-label-context-menu="true"
                            data-label-context-value={label}
                            data-label-context-system={isSystemLabel ? "true" : "false"}
                            className={`relative inline-flex items-center rounded-none border px-3 py-1 transition ${
                              isActive
                                ? "border-white/42 bg-white/14 text-white"
                                : "border-white/22 bg-white/6 text-white/80 hover:border-white/38 hover:bg-white/12 hover:text-white/90"
                            }`}
                            onContextMenu={(event) => {
                              if (isSystemLabel) return;
                              event.preventDefault();
                              event.stopPropagation();
                              openLabelContextMenu(label, event.clientX, event.clientY);
                            }}
                            onMouseDown={(event) => {
                              if (isSystemLabel) return;
                              const isContextTrigger = event.button === 2 || (event.button === 0 && event.ctrlKey);
                              if (!isContextTrigger) return;
                              event.preventDefault();
                              event.stopPropagation();
                              openLabelContextMenu(label, event.clientX, event.clientY);
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setLabelContextMenu(null);
                                setLabelActionPopover(null);
                                setActiveFilterLabel((current) => (current === label ? null : label));
                              }}
                              className="text-xs leading-none"
                            >
                              {entry.label}
                            </button>
                          </div>
                        );
                      })}
                      {!labelFilterEntries.length ? (
                        <p className="rounded-xl border border-white/12 bg-white/4 px-3 py-2 text-xs text-white/45">No labels yet</p>
                      ) : null}
                      {normalizedSearchQuery && !visibleSidebarLabelEntries.length ? (
                        <p className="rounded-xl border border-white/12 bg-white/4 px-3 py-2 text-xs text-white/45">No label matches</p>
                      ) : null}
                    </div>
                  </section>
                </div>
              </div>

              {activeFilterLabel || normalizedSearchQuery || activeFolder !== ALL_FOLDER_KEY ? (
                <div className="px-4 py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveFilterLabel(null);
                      setLabelQuery("");
                      setActiveFolder(ALL_FOLDER_KEY);
                    }}
                    className="w-full rounded-xl border border-white/12 bg-white/5 px-3 py-1.5 text-xs text-white/70 transition hover:border-white/28 hover:bg-white/9 hover:text-white/90"
                  >
                    Clear filters
                  </button>
                </div>
              ) : null}

              <div className="px-4 pb-3 pt-2">
                <p className="text-[11px] leading-relaxed text-white/45">
                  Design starts here.
                  <br />
                  Collect. Curate. Create.
                </p>
              </div>
              </aside>

              <div
            className={`min-w-0 flex-1 px-3 pb-12 pt-3 transition-[padding] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] md:pr-4 ${
              isSidebarCollapsed ? "md:pl-3" : "md:pl-4"
            }`}
              >
            <section className="mb-4 rounded-2xl border border-border/70 bg-card/45 p-3 md:hidden">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsTopSearchOpen(true)}
                  className="flex w-full items-center gap-2 rounded-xl border border-border/80 bg-background/70 px-3 py-2 text-left text-sm text-muted-foreground transition hover:border-primary/70 hover:text-foreground"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                    <path fill="currentColor" d="M10.5 4a6.5 6.5 0 0 1 5.16 10.46l3.69 3.69a1 1 0 1 1-1.42 1.42l-3.69-3.69A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
                  </svg>
                  <span className="truncate">{labelQuery ? `Search: ${labelQuery}` : "Search..."}</span>
                </button>
                <button
                  type="button"
                  aria-label="Open canvas mode"
                  title="Canvas mode"
                  onClick={enterCanvasMode}
                  className="inline-flex shrink-0 items-center gap-2.5 px-1 py-1 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                >
                  <CanvasIcon className="h-4.5 w-4.5 opacity-80 dark:invert" />
                  <span>Canvas</span>
                </button>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {visibleFolderEntries.map((folder) => {
                  const isActive = folder.key === activeFolder;
                  const customFolderId = folder.kind === "custom" ? readCustomFolderId(folder.key) : null;
                  const isDeleting = Boolean(customFolderId && deletingFolderId === customFolderId);
                  return (
                    <div key={`mobile-${folder.key}`} className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setActiveFolder(folder.key)}
                        className={`rounded-none border px-3 py-1 text-xs transition ${
                          isActive
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border/80 bg-background/70 text-muted-foreground hover:border-primary/70 hover:text-foreground"
                        }`}
                      >
                        {folder.label} ({folder.count})
                      </button>
                      {customFolderId ? (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setConfirmFolderId(customFolderId)}
                            disabled={isDeleting}
                            className="inline-flex h-6 w-6 items-center justify-center rounded-none border border-border/70 bg-background/70 text-muted-foreground transition hover:border-primary/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {isDeleting ? "…" : "×"}
                          </button>
                          {confirmFolderId === customFolderId ? (
                            <div className="absolute right-0 top-[calc(100%+4px)] z-40 w-[145px] rounded-lg border border-border/80 bg-background p-1.5 text-[11px] text-foreground shadow-[0_10px_24px_rgba(0,0,0,0.2)]">
                              <p>Delete board?</p>
                              <div className="mt-1 flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isDeleting) return;
                                    void deleteCustomFolder(customFolderId);
                                  }}
                                  disabled={isDeleting}
                                  className="rounded-md border border-border/80 px-1.5 py-0.5 text-[10px] transition hover:border-primary/70 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isDeleting ? "..." : "Yes"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmFolderId(null)}
                                  className="rounded-md border border-border/80 px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:border-primary/70 hover:text-foreground"
                                >
                                  No
                                </button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <form
                className="mt-2.5 flex gap-1.5"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createCustomFolder();
                }}
              >
                <input
                  value={newFolderDraft}
                  onChange={(event) => setNewFolderDraft(event.target.value)}
                  placeholder="New board"
                  className="w-full rounded-none border border-border/80 bg-background/70 px-3 py-2 text-xs outline-none transition focus:border-primary"
                />
                <button
                  type="submit"
                  disabled={isCreatingFolder}
                  className="rounded-none border border-border/80 bg-background/70 px-3 py-2 text-xs font-medium transition hover:border-primary/70 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCreatingFolder ? "..." : "Add"}
                </button>
              </form>
              {labelFilterEntries.length ? (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {labelFilterEntries.map((entry) => {
                    const label = entry.value;
                    const isSystemLabel = Boolean(entry.system);
                    const isActive = label === activeFilterLabel;
                    return (
                      <div
                        key={`mobile-label-${label}`}
                        data-label-context-menu="true"
                        data-label-context-value={label}
                        data-label-context-system={isSystemLabel ? "true" : "false"}
                        className="inline-flex items-center gap-1"
                        onContextMenu={(event) => {
                          if (isSystemLabel) return;
                          event.preventDefault();
                          event.stopPropagation();
                          openLabelContextMenu(label, event.clientX, event.clientY);
                        }}
                        onMouseDown={(event) => {
                          if (isSystemLabel) return;
                          const isContextTrigger = event.button === 2 || (event.button === 0 && event.ctrlKey);
                          if (!isContextTrigger) return;
                          event.preventDefault();
                          event.stopPropagation();
                          openLabelContextMenu(label, event.clientX, event.clientY);
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setLabelContextMenu(null);
                            setLabelActionPopover(null);
                            setActiveFilterLabel((current) => (current === label ? null : label));
                          }}
                          className={`rounded-none border px-3 py-1 text-xs transition ${
                            isActive
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border/80 bg-background/70 text-muted-foreground hover:border-primary/70 hover:text-foreground"
                          }`}
                        >
                          {entry.label}
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </section>

            <section className="relative mb-6 hidden min-h-11 items-center px-2 py-2 text-sm text-muted-foreground md:flex">
              <div className="flex items-center gap-4 self-center">
                {isSidebarCollapsed ? (
                  <button
                    type="button"
                    aria-label="Expand sidebar"
                    onClick={() => setIsSidebarCollapsed(false)}
                    className="-ml-2 inline-flex items-center justify-center px-1.5 py-1 text-white/75 transition hover:text-white"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
                      <path fill="currentColor" d="M7.7 6.7a1 1 0 0 1 1.4 0L14.4 12l-5.3 5.3a1 1 0 1 1-1.4-1.4L11.6 12 7.7 8.1a1 1 0 0 1 0-1.4Zm5 0a1 1 0 0 1 1.4 0l5.3 5.3-5.3 5.3a1 1 0 0 1-1.4-1.4l3.9-3.9-3.9-3.9a1 1 0 0 1 0-1.4Z" />
                    </svg>
                  </button>
                ) : null}
                <p>
                  <span className="font-semibold text-foreground">
                    {filteredItems.length}/{items.length}
                  </span>{" "}
                  images
                </p>
              </div>

              <div className="ml-auto flex items-center gap-6 self-center text-xs">
                {isSidebarCollapsed ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <button
                      type="button"
                      aria-label={isTopSearchOpen ? "Close search" : "Open search"}
                      onClick={() => setIsTopSearchOpen((current) => !current)}
                      className="inline-flex min-w-[184px] items-center gap-2 rounded-lg border border-border/70 bg-background/55 py-1 pl-2.5 pr-3 text-xs text-muted-foreground transition hover:border-primary/70 hover:text-foreground"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                        <path fill="currentColor" d="M10.5 4a6.5 6.5 0 0 1 5.16 10.46l3.69 3.69a1 1 0 1 1-1.42 1.42l-3.69-3.69A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
                      </svg>
                      <span>Search</span>
                      <span className="ml-auto text-[10px] text-muted-foreground/80">Cmd K</span>
                    </button>
                    <span className="mx-0.5 h-4 border-l border-border/70" aria-hidden="true" />
                    <span className="whitespace-nowrap">Board:</span>
                    <CustomDropdown
                      ariaLabel="Filter by board"
                      value={activeFolder}
                      onChange={(nextValue) => setActiveFolder(nextValue as FolderKey)}
                      options={headerFolderOptions}
                      containerClassName="min-w-[160px]"
                      triggerClassName="rounded-lg border border-border/80 bg-background/70 py-0.5 pl-2.5 pr-2 text-xs text-foreground outline-none transition hover:border-primary/55 focus-visible:border-primary/70 disabled:cursor-not-allowed disabled:opacity-60"
                      menuClassName="border-border/80 bg-background/95"
                      optionClassName="text-foreground"
                    />
                    <span className="mx-0.5 h-4 border-l border-border/70" aria-hidden="true" />
                    <span className="whitespace-nowrap">Label:</span>
                    <CustomDropdown
                      ariaLabel="Filter by label"
                      value={activeFilterLabel ?? ""}
                      onChange={(nextValue) => setActiveFilterLabel(nextValue || null)}
                      options={labelFilterOptions}
                      containerClassName="min-w-[128px]"
                      triggerClassName="rounded-lg border border-border/80 bg-background/70 py-0.5 pl-2.5 pr-2 text-xs text-foreground outline-none transition hover:border-primary/55 focus-visible:border-primary/70 disabled:cursor-not-allowed disabled:opacity-60"
                      menuClassName="border-border/80 bg-background/95"
                      optionClassName="text-foreground"
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                    <button
                      type="button"
                      aria-label={isTopSearchOpen ? "Close search" : "Open search"}
                      onClick={() => setIsTopSearchOpen((current) => !current)}
                      className="inline-flex min-w-[184px] items-center gap-2 rounded-lg border border-border/70 bg-background/55 py-1 pl-2.5 pr-3 text-xs text-muted-foreground transition hover:border-primary/70 hover:text-foreground"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                        <path fill="currentColor" d="M10.5 4a6.5 6.5 0 0 1 5.16 10.46l3.69 3.69a1 1 0 1 1-1.42 1.42l-3.69-3.69A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
                      </svg>
                      <span>Search</span>
                      <span className="ml-auto text-[10px] text-muted-foreground/80">Cmd K</span>
                    </button>
                    <span className="mx-0.5 h-4 border-l border-border/70" aria-hidden="true" />
                    <span>Board:</span>
                    <CustomDropdown
                      ariaLabel="Filter by board"
                      value={activeFolder}
                      onChange={(nextValue) => setActiveFolder(nextValue as FolderKey)}
                      options={headerFolderOptions}
                      containerClassName="min-w-[160px]"
                      triggerClassName="rounded-lg border border-border/80 bg-background/70 py-0.5 pl-2.5 pr-2 text-xs text-foreground outline-none transition hover:border-primary/55 focus-visible:border-primary/70 disabled:cursor-not-allowed disabled:opacity-60"
                      menuClassName="border-border/80 bg-background/95"
                      optionClassName="text-foreground"
                    />
                    <span className="mx-0.5 h-4 border-l border-border/70" aria-hidden="true" />
                    <span>Label:</span>
                    <CustomDropdown
                      ariaLabel="Filter by label"
                      value={activeFilterLabel ?? ""}
                      onChange={(nextValue) => setActiveFilterLabel(nextValue || null)}
                      options={labelFilterOptions}
                      containerClassName="min-w-[128px]"
                      triggerClassName="rounded-lg border border-border/80 bg-background/70 py-0.5 pl-2.5 pr-2 text-xs text-foreground outline-none transition hover:border-primary/55 focus-visible:border-primary/70 disabled:cursor-not-allowed disabled:opacity-60"
                      menuClassName="border-border/80 bg-background/95"
                      optionClassName="text-foreground"
                    />
                  </div>
                )}
                <div className="flex items-center gap-3 border-l border-border/70 pl-4">
                  <span className="text-xs text-muted-foreground/90">Sort:</span>
                  <div className="flex items-center gap-0">
                    <button
                      type="button"
                      aria-label="Sort from oldest to newest"
                      title="Oldest to newest"
                      onClick={() => setSortMode("oldest-first")}
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition ${
                        sortMode === "oldest-first"
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                        <path fill="currentColor" d="M12 5a1 1 0 0 1 1 1v9.58l1.3-1.29a1 1 0 0 1 1.4 1.42l-3 2.97a1 1 0 0 1-1.4 0l-3-2.97a1 1 0 1 1 1.4-1.42l1.3 1.29V6a1 1 0 0 1 1-1Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      aria-label="Sort from newest to oldest"
                      title="Newest to oldest"
                      onClick={() => setSortMode("newest-first")}
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition ${
                        sortMode === "newest-first"
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                        <path fill="currentColor" d="M12 19a1 1 0 0 1-1-1V8.42l-1.3 1.29a1 1 0 1 1-1.4-1.42l3-2.97a1 1 0 0 1 1.4 0l3 2.97a1 1 0 1 1-1.4 1.42L13 8.42V18a1 1 0 0 1-1 1Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      aria-label="Shuffle image order"
                      title="Shuffle"
                      onClick={() => {
                        setSortMode("random");
                        setShuffleSeed((current) => current + 1);
                      }}
                      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition ${
                        sortMode === "random"
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <svg
                        viewBox="0 0 256 256"
                        aria-hidden="true"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="16"
                      >
                        <path d="M32,72H55.06a64,64,0,0,1,52.08,26.8l41.72,58.4A64,64,0,0,0,200.94,184H232" />
                        <polyline points="208 48 232 72 208 96" />
                        <polyline points="208 160 232 184 208 208" />
                        <path d="M147.66,100.47l1.2-1.67A64,64,0,0,1,200.94,72H232" />
                        <path d="M32,184H55.06a64,64,0,0,0,52.08-26.8l1.2-1.67" />
                      </svg>
                    </button>
                  </div>
                  <span className="mx-0.5 h-4 border-l border-border/70" aria-hidden="true" />
                  <span className="text-xs text-muted-foreground/90">View:</span>
                  <div className="flex items-center">
                    <input
                      type="range"
                      min={0}
                      max={GRID_DENSITY_OPTIONS.length - 1}
                      step={1}
                      value={activeGridDensityIndex}
                      onChange={(event) => {
                        const option = GRID_DENSITY_OPTIONS[Number(event.target.value)];
                        if (option) setGridDensity(option.key);
                      }}
                      aria-label="Adjust board view density"
                      className="h-1.5 w-28 cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
                    />
                  </div>
                  <span className="mx-0.5 h-4 border-l border-border/70" aria-hidden="true" />
                  <button
                    type="button"
                    aria-label="Open canvas mode"
                    title="Canvas mode"
                    onClick={enterCanvasMode}
                    className="inline-flex items-center gap-2 px-1 py-0.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
                  >
                    <CanvasIcon className="h-3.5 w-3.5 opacity-80 dark:invert" />
                    <span>Canvas</span>
                  </button>
                </div>
              </div>
            </section>

            {notice ? (
              <div className="mb-4 rounded-xl border border-destructive/70 bg-destructive/10 px-3 py-2.5 text-sm text-destructive-foreground">
                {notice}
              </div>
            ) : null}

            {isLoading ? (
              <div className="rounded-2xl border border-border/70 bg-card/45 px-4 py-8 text-center text-sm text-muted-foreground">
                Loading saved board...
              </div>
            ) : displayedItems.length ? (
              <section ref={masonrySectionRef} className={`columns-1 gap-2 ${masonryColumnsClass}`}>
                {displayedItems.map((item, index) => (
                  <article
                    key={item.id}
                    data-fade-card-id={item.id}
                    className={`group relative mb-2 break-inside-avoid overflow-hidden rounded-xl border border-border/20 bg-card/60 shadow-[0_18px_50px_rgba(0,0,0,0.45)] transition-[opacity,transform,filter] duration-[920ms] ease-[cubic-bezier(0.2,0.8,0.2,1)] will-change-[opacity,transform,filter] ${
                      visibleCardIds.has(item.id) ? "translate-y-0 opacity-100 blur-0" : "translate-y-[3px] opacity-0 blur-[1px]"
                    }`}
                    style={{ transitionDelay: `${(index % 8) * 10}ms` }}
                  >
                    <button
                      type="button"
                      onClick={() => setConfirmImageId(item.id)}
                      aria-label="Delete image"
                      disabled={deletingImageId === item.id}
                      className="absolute right-3 top-3 z-40 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/22 bg-black/55 text-white/90 opacity-0 backdrop-blur-md transition duration-200 hover:scale-[1.03] hover:border-rose-300/65 hover:bg-rose-500/28 hover:text-white group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4.5 w-4.5">
                        <path
                          fill="currentColor"
                          d="M8.5 4A1.5 1.5 0 0 0 7 5.5V6H5.25a.75.75 0 0 0 0 1.5H6l.56 10.01A2.5 2.5 0 0 0 9.06 20h5.88a2.5 2.5 0 0 0 2.5-2.49L18 7.5h.75a.75.75 0 0 0 0-1.5H17v-.5A1.5 1.5 0 0 0 15.5 4h-7Zm0 1.5h7a.5.5 0 0 1 .5.5V6H8v-.5a.5.5 0 0 1 .5-.5Zm-1 2h9l-.55 9.93a1 1 0 0 1-1 .95H9.05a1 1 0 0 1-1-.95L7.5 7.5Zm2.75 2a.75.75 0 0 0-.75.75v5a.75.75 0 0 0 1.5 0v-5a.75.75 0 0 0-.75-.75Zm3.5 0a.75.75 0 0 0-.75.75v5a.75.75 0 0 0 1.5 0v-5a.75.75 0 0 0-.75-.75Z"
                        />
                      </svg>
                    </button>
                    {confirmImageId === item.id ? (
                      <div className="absolute right-3 top-14 z-50 w-[180px] rounded-xl border border-white/30 bg-black/88 p-2 text-xs text-white/90 shadow-[0_14px_30px_rgba(0,0,0,0.45)]">
                        <p>Delete this image?</p>
                        <div className="mt-2 flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => void deleteItem(item)}
                            disabled={deletingImageId === item.id}
                            className="rounded-lg border border-white/40 bg-white/15 px-2 py-1 text-[11px] text-white transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingImageId === item.id ? "Deleting..." : "Yes"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmImageId(null)}
                            className="rounded-lg border border-white/30 px-2 py-1 text-[11px] text-white/75 transition hover:border-white/55 hover:text-white"
                          >
                            No
                          </button>
                        </div>
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setActiveItemId(item.id)}
                      aria-label="Open image in lightbox"
                      className="relative block w-full cursor-zoom-in text-left"
                    >
                      <Image
                        src={item.src}
                        alt=""
                        width={item.width}
                        height={item.height}
                        unoptimized
                        sizes={imageSizes}
                        loading="lazy"
                        onLoad={() => markImageLoaded(item.id)}
                        className={`h-auto w-full select-none object-cover transition-[opacity,filter,transform] duration-[1400ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                          loadedImageIds.has(item.id) ? "opacity-100 blur-0" : "opacity-0 blur-[1.5px]"
                        } group-hover:scale-[1.015]`}
                      />
                    </button>

                    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-28 bg-gradient-to-b from-black/80 via-black/18 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-24 bg-gradient-to-t from-black/75 via-black/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100" />

                    <div className="absolute left-3 top-3 z-30 flex max-w-[85%] flex-wrap items-center gap-1.5 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                      {item.labels.map((label) => (
                        <div
                          key={`${item.id}-${label}`}
                          data-label-context-menu="true"
                          data-label-context-value={label}
                          data-label-context-system="false"
                          className="inline-flex h-6 items-center rounded-none border border-white/35 bg-black/55 text-white/90 backdrop-blur-sm transition hover:border-white/70"
                        >
                          <button
                            type="button"
                            onClick={() => setActiveFilterLabel(label)}
                            className="flex h-full items-center px-2.5 text-[11px] leading-none"
                          >
                            #{label}
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove #${label} from this image`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (savingLabelItemId === item.id) return;
                              void removeLabelFromItem(item, label);
                            }}
                            disabled={savingLabelItemId === item.id}
                            className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-none text-white/70 transition hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3">
                              <path
                                fill="currentColor"
                                d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.12L10.58 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.88a1 1 0 0 0 0-1.41Z"
                              />
                            </svg>
                          </button>
                        </div>
                      ))}
                      {labelEditorItemId === item.id ? (
                        <form
                          className="flex items-center gap-1 rounded-none border border-white/35 bg-black/58 px-1 py-1 backdrop-blur-md"
                          onSubmit={(event) => {
                            event.preventDefault();
                            setSavingLabelItemId(item.id);
                            void addLabelsToItem(item, newLabelDraft)
                              .then(() => {
                                setNotice(null);
                                setNewLabelDraft("");
                                setLabelEditorItemId(null);
                              })
                              .catch(() => setNotice("Could not save labels."))
                              .finally(() => setSavingLabelItemId((current) => (current === item.id ? null : current)));
                          }}
                        >
                          <input
                            autoFocus
                            value={newLabelDraft}
                            onChange={(event) => setNewLabelDraft(event.target.value)}
                            placeholder="Add label"
                            className="w-28 rounded-none border border-white/30 bg-black/45 px-2.5 py-1 text-[11px] text-white outline-none placeholder:text-white/50 focus:border-white/70"
                          />
                          <button
                            type="submit"
                            disabled={savingLabelItemId === item.id}
                            className="rounded-none border border-white/40 bg-white/15 px-2 py-1 text-[11px] text-white transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {savingLabelItemId === item.id ? "..." : "Add"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setLabelEditorItemId(null);
                              setNewLabelDraft("");
                            }}
                            className="rounded-none border border-white/30 px-2 py-1 text-[11px] text-white/75 transition hover:border-white/55 hover:text-white"
                          >
                            Close
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setLabelEditorItemId(item.id);
                            setNewLabelDraft("");
                          }}
                          className="inline-flex h-6 items-center rounded-none border border-white/40 bg-black/62 px-3 text-[11px] font-medium text-white/95 backdrop-blur-sm transition hover:border-white/75 hover:bg-black/70"
                        >
                          + Add label
                        </button>
                      )}
                    </div>

                    <div className="absolute bottom-2 right-3 z-30 opacity-100 transition-opacity duration-200 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                      <div className="mb-2 inline-flex items-center rounded-lg border border-white/35 bg-black/62 p-1 backdrop-blur-md">
                        <span className="px-2 text-[10px] uppercase tracking-[0.22em] text-white/70">Board</span>
                        {hoverBoardCreatorItemId === item.id ? (
                          <form
                            className="flex min-w-[170px] items-center gap-1"
                            onSubmit={(event) => {
                              event.preventDefault();
                              const boardName = normalizeFolderName(hoverBoardDraft);
                              if (!boardName) {
                                setNotice("Board name cannot be empty.");
                                return;
                              }
                              setCreatingHoverBoardItemId(item.id);
                              void createBoard(boardName)
                                .then(async (folder) => {
                                  await assignFolderToItem(item, folder.id);
                                  setHoverBoardCreatorItemId(null);
                                  setHoverBoardDraft("");
                                  setNotice(null);
                                })
                                .catch((error: unknown) => {
                                  if (error instanceof Error && error.message === "BoardAlreadyExists") {
                                    setNotice("A board with that name already exists.");
                                  } else {
                                    setNotice("Could not create board.");
                                  }
                                })
                                .finally(() => {
                                  setCreatingHoverBoardItemId((current) => (current === item.id ? null : current));
                                });
                            }}
                          >
                            <input
                              value={hoverBoardDraft}
                              onChange={(event) => setHoverBoardDraft(event.target.value)}
                              placeholder="New board"
                            className="w-full rounded-none border border-white/30 bg-black/45 px-2 py-1 text-xs text-white outline-none placeholder:text-white/50 focus:border-white/70"
                          />
                          <button
                            type="submit"
                            disabled={creatingHoverBoardItemId === item.id}
                            className="rounded-none border border-white/40 bg-white/15 px-2 py-1 text-xs text-white transition hover:bg-white/25 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {creatingHoverBoardItemId === item.id ? "..." : "Add"}
                          </button>
                            <button
                              type="button"
                              onClick={() => {
                                setHoverBoardCreatorItemId(null);
                                setHoverBoardDraft("");
                              }}
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-white/30 text-white/75 transition hover:border-white/55 hover:text-white"
                            >
                              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3">
                                <path
                                  fill="currentColor"
                                  d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.12L10.58 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.88a1 1 0 0 0 0-1.41Z"
                                />
                              </svg>
                            </button>
                          </form>
                        ) : (
                          <CustomDropdown
                            ariaLabel={`Assign board for image ${item.id}`}
                            value={item.folderId ?? ""}
                            onChange={(nextValue) => {
                              if (nextValue === CREATE_NEW_BOARD_OPTION_VALUE) {
                                setHoverBoardCreatorItemId(item.id);
                                setHoverBoardDraft("");
                                return;
                              }
                              setHoverBoardCreatorItemId((current) => (current === item.id ? null : current));
                              void assignFolderToItem(item, nextValue || null);
                            }}
                            options={boardAssignmentOptions}
                            disabled={savingFolderItemId === item.id}
                            containerClassName="w-[190px] min-w-[190px]"
                            triggerClassName="rounded-md border border-white/35 bg-black/70 py-1.5 pl-2.5 pr-2 text-xs font-medium whitespace-nowrap text-white outline-none transition hover:border-white/55 focus-visible:border-white/65 disabled:cursor-not-allowed disabled:opacity-60"
                            menuClassName="border-white/30 bg-black/90"
                            menuPosition="top"
                          />
                        )}
                      </div>
                    </div>

                  </article>
                ))}
              </section>
            ) : items.length ? (
              <div className="rounded-2xl border border-border/70 bg-card/45 px-4 py-10 text-center">
                <p className="text-base font-medium">No images match this filter combination.</p>
                <p className="mt-2 text-sm text-muted-foreground">Try another board, label, or clear all filters.</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-border/70 bg-card/45 px-4 py-10 text-center">
                <p className="text-base font-medium">Your board is empty.</p>
                <p className="mt-2 text-sm text-muted-foreground">Paste images with Cmd + V and they will stay saved after reload.</p>
              </div>
            )}
              </div>
            </div>
          </main>

      {isTopSearchOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[12vh] md:p-8 md:pt-[14vh]"
          onClick={() => setIsTopSearchOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Search boards, labels, and image text"
        >
          <div
            className="w-full max-w-4xl rounded-2xl border border-white/14 bg-[#131416]/95 p-4 shadow-[0_30px_80px_rgba(0,0,0,0.5)] backdrop-blur-xl md:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50">
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                  <path fill="currentColor" d="M10.5 4a6.5 6.5 0 0 1 5.16 10.46l3.69 3.69a1 1 0 1 1-1.42 1.42l-3.69-3.69A6.5 6.5 0 1 1 10.5 4Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" />
                </svg>
              </span>
              <input
                autoFocus
                value={labelQuery}
                onChange={(event) => setLabelQuery(event.target.value)}
                placeholder="Search boards, labels, and image text..."
                className="w-full rounded-xl border border-white/14 bg-black/35 px-9 py-2.5 pr-16 text-sm text-white outline-none placeholder:text-white/40 transition focus:border-white/35"
              />
              <button
                type="button"
                onClick={() => setIsTopSearchOpen(false)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-white/20 bg-white/8 px-2 py-0.5 text-[11px] text-white/80 transition hover:border-white/40 hover:text-white"
              >
                Esc
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {(["both", "folders", "labels"] as SearchScope[]).map((scope) => (
                <button
                  key={`search-scope-${scope}`}
                  type="button"
                  onClick={() => setSearchScope(scope)}
                  className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                    searchScope === scope
                      ? "border-white/60 bg-white/18 text-white"
                      : "border-white/18 bg-white/6 text-white/70 hover:border-white/35 hover:text-white"
                  }`}
                >
                  {scope === "both" ? "Both" : scope === "folders" ? "Boards" : "Labels"}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setLabelQuery("");
                  setActiveFolder(ALL_FOLDER_KEY);
                  setActiveFilterLabel(null);
                }}
                className="ml-auto rounded-lg border border-white/18 bg-white/6 px-2.5 py-1 text-xs text-white/70 transition hover:border-white/35 hover:text-white"
              >
                Reset filters
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {searchScope !== "labels" ? (
                <div className="rounded-xl border border-white/12 bg-white/[0.03] p-3">
                  <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/45">Boards</p>
                  <div className="max-h-[280px] space-y-1 overflow-auto pr-1">
                    {modalFolderResults.length ? (
                      modalFolderResults.map((folder) => (
                        <button
                          key={`search-folder-${folder.key}`}
                          type="button"
                          onClick={() => {
                            setActiveFolder(folder.key);
                            setIsTopSearchOpen(false);
                          }}
                          className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-white/6 px-2.5 py-2 text-left text-sm text-white/85 transition hover:border-white/35 hover:bg-white/12"
                        >
                          <span>{folder.label}</span>
                          <span className="text-xs text-white/55">{folder.count}</span>
                        </button>
                      ))
                    ) : (
                      <p className="rounded-lg border border-white/10 bg-white/4 px-2.5 py-2 text-xs text-white/50">No board match</p>
                    )}
                  </div>
                </div>
              ) : null}

              {searchScope !== "folders" ? (
                <div className="rounded-xl border border-white/12 bg-white/[0.03] p-3">
                  <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-white/45">Labels</p>
                  <div className="max-h-[280px] space-y-1 overflow-auto pr-1">
                    {modalLabelResults.length ? (
                      modalLabelResults.map((entry) => (
                        <button
                          key={`search-label-${entry.value}`}
                          type="button"
                          onClick={() => {
                            setActiveFilterLabel(entry.value);
                            setIsTopSearchOpen(false);
                          }}
                          className="flex w-full items-center rounded-lg border border-white/10 bg-white/6 px-2.5 py-2 text-left text-sm text-white/85 transition hover:border-white/35 hover:bg-white/12"
                        >
                          {entry.label}
                        </button>
                      ))
                    ) : (
                      <p className="rounded-lg border border-white/10 bg-white/4 px-2.5 py-2 text-xs text-white/50">No label match</p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeItem ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/92 p-2 md:p-6"
          onClick={() => setActiveItemId(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image lightbox"
        >
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setActiveItemId(null);
            }}
            aria-label="Close lightbox"
            className="absolute right-4 top-4 z-50 inline-flex h-11 w-11 items-center justify-center rounded-none border border-white/25 bg-black/60 text-white transition hover:border-white/60 hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
              <path
                fill="currentColor"
                d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.12L10.58 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.88a1 1 0 0 0 0-1.41Z"
              />
            </svg>
          </button>

          {navigableItems.length > 1 ? (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  goToPrevious();
                }}
                aria-label="Previous image"
                className="absolute left-2 top-1/2 z-50 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-none border border-white/25 bg-black/60 text-white transition hover:border-white/60 hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 md:left-5"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px]">
                  <path fill="currentColor" d="M14.7 5.3a1 1 0 0 1 0 1.4L9.41 12l5.3 5.3a1 1 0 1 1-1.42 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.42 0Z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  goToNext();
                }}
                aria-label="Next image"
                className="absolute right-2 top-1/2 z-50 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-none border border-white/25 bg-black/60 text-white transition hover:border-white/60 hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 md:right-5"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[18px] w-[18px]">
                  <path fill="currentColor" d="M9.3 5.3a1 1 0 0 0 0 1.4l5.29 5.3-5.3 5.3a1 1 0 1 0 1.42 1.4l6-6a1 1 0 0 0 0-1.4l-6-6a1 1 0 0 0-1.42 0Z" />
                </svg>
              </button>
            </>
          ) : null}

          <div className="pointer-events-none absolute bottom-3 right-4 z-50 text-right tabular-nums md:bottom-5 md:right-6">
            <div className="flex justify-end">
              <div className="group relative pointer-events-auto">
                <button
                  type="button"
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex items-center rounded-none border border-white/30 bg-black/55 px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] text-white/80 transition hover:border-white/55 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                  aria-label="View image details"
                >
                  Details
                </button>
                <div className="pointer-events-none absolute bottom-full right-0 mb-2 hidden min-w-[260px] rounded-md border border-white/20 bg-black/90 px-3 py-2 text-right text-[11px] text-white/80 shadow-[0_10px_28px_rgba(0,0,0,0.55)] group-hover:block group-focus-within:block">
                  <p className="whitespace-nowrap text-white/90">
                    {formatDimensions(activeItem.width, activeItem.height)}
                    {activeIndex >= 0 ? ` • ${activeIndex + 1}/${navigableItems.length}` : ""}
                  </p>
                  <p className="whitespace-nowrap">Weight: {formatMegabytes(activeItem.byteSize)}</p>
                  {activeItem.wasCompressed ? (
                    <p className="mt-0.5 whitespace-nowrap text-emerald-200/90">
                      Compressed • Original {formatDimensions(activeItem.originalWidth, activeItem.originalHeight)} • {formatMegabytes(activeItem.originalByteSize)}
                    </p>
                  ) : (
                    <p className="mt-0.5 whitespace-nowrap text-white/60">Not compressed</p>
                  )}
                </div>
              </div>
            </div>
          </div>
          <form
            className="absolute bottom-3 left-4 z-50 flex w-[min(520px,calc(100vw-11rem))] items-end gap-3 md:bottom-5 md:left-6"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void saveItemTitle(activeItem, activeItemTitleDraft);
            }}
          >
            <input
              value={activeItemTitleDraft}
              onChange={(event) => setActiveItemTitleDraft(event.target.value)}
              placeholder="Click to name this image"
              maxLength={120}
              className="min-w-0 flex-1 border-b border-white/30 bg-transparent px-0 py-1 text-left text-sm text-white/95 outline-none placeholder:text-white/45 focus:border-white/60"
            />
            <p className="shrink-0 whitespace-nowrap text-[11px] text-white/55">{savingTitleItemId === activeItem.id ? "Saving..." : "Press Enter to save"}</p>
          </form>

          <div className="w-full max-w-[1700px]" onClick={(event) => event.stopPropagation()}>
            <div className="relative mx-auto flex max-h-[85vh] justify-center overflow-hidden rounded-2xl bg-black/40 shadow-[0_30px_100px_rgba(0,0,0,0.65)]">
              <Image
                src={activeItem.src}
                alt=""
                width={activeItem.width}
                height={activeItem.height}
                unoptimized
                sizes="100vw"
                priority
                className="h-auto max-h-[85vh] w-auto max-w-full object-contain"
              />
            </div>
          </div>
          {activeItem.labels.length ? (
            <div
              className="absolute bottom-3 left-1/2 z-50 flex w-[min(720px,calc(100vw-20rem))] -translate-x-1/2 flex-wrap justify-center gap-1.5"
              onClick={(event) => event.stopPropagation()}
            >
              {activeItem.labels.map((label) => (
                <div
                  key={`lightbox-${activeItem.id}-${label}`}
                  data-label-context-menu="true"
                  data-label-context-value={label}
                  data-label-context-system="false"
                  className="inline-flex items-center rounded-none border border-white/30 bg-black/45 text-white/85 transition hover:border-white/60"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveFilterLabel(label);
                      setActiveItemId(null);
                    }}
                    className="px-3 py-1 text-xs leading-none"
                  >
                    #{label}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove #${label} from this image`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (savingLabelItemId === activeItem.id) return;
                      void removeLabelFromItem(activeItem, label);
                    }}
                    disabled={savingLabelItemId === activeItem.id}
                    className="mr-1 inline-flex h-4 w-4 items-center justify-center rounded-none text-white/70 transition hover:bg-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3 w-3">
                      <path
                        fill="currentColor"
                        d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.12L10.58 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.88a1 1 0 0 0 0-1.41Z"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
        </>
      ) : null}

      {isCanvasMode ? (
        <>
          <div
            ref={canvasSurfaceRef}
            className={`canvas-surface fixed inset-0 z-[70] overflow-hidden touch-none ${
              canvasInteractionMode === "pan" || canvasInteractionMode === "pinch" || canvasInteractionMode === "drag"
                ? "cursor-grabbing"
                : isCanvasHandMode
                  ? "cursor-grab"
                  : "cursor-default"
            }`}
            style={{ backgroundColor: canvasBackgroundColor }}
            onPointerDown={handleCanvasBackgroundPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerEnd}
            onPointerCancel={handleCanvasPointerEnd}
            onWheel={handleCanvasWheel}
          >
            <div
              className="absolute left-0 top-0 will-change-transform"
              style={{
                transform: `translate(${canvasViewport.x}px, ${canvasViewport.y}px) scale(${canvasViewport.scale})`,
                transformOrigin: "0 0",
              }}
            >
              {canvasItems.map((item) => {
                const layout = canvasLayouts[item.id];
                if (!layout) return null;
                const isSelected = selectedCanvasItemSet.has(item.id);
                const showResizeHandles = singleSelectedCanvasItemId === item.id;
                return (
                  <article
                    key={`canvas-${item.id}`}
                    className="absolute"
                    style={{
                      left: `${layout.x}px`,
                      top: `${layout.y}px`,
                      width: `${layout.width}px`,
                      height: `${layout.height}px`,
                      zIndex: layout.z,
                    }}
                    onPointerDown={(event) => handleCanvasItemPointerDown(event, item.id)}
                  >
                    <div className="relative h-full w-full bg-black/25">
                      <div className={`h-full w-full overflow-hidden rounded-lg border ${isSelected ? "border-zinc-300" : "border-transparent"}`}>
                        <Image
                          src={item.src}
                          alt={item.title || "Canvas image"}
                          width={Math.max(Math.round(layout.width), 1)}
                          height={Math.max(Math.round(layout.height), 1)}
                          unoptimized
                          sizes="(max-width: 768px) 90vw, 420px"
                          onLoad={() => markCanvasImageLoaded(item.id)}
                          className={`pointer-events-none h-full w-full select-none object-cover transition duration-300 ${
                            canvasLoadedImageIds.has(item.id) ? "opacity-100" : "opacity-0"
                          }`}
                        />
                      </div>

                      {showResizeHandles
                        ? (["nw", "ne", "sw", "se"] as CanvasHandle[]).map((handle) => (
                            <button
                              key={`${item.id}-${handle}`}
                              type="button"
                              aria-label={`Resize image (${handle})`}
                              onPointerDown={(event) => handleCanvasResizePointerDown(event, item.id, handle)}
                              style={{ transform: canvasHandleTransform(handle, canvasViewport.scale) }}
                              className={`canvas-resize-handle absolute h-3 w-3 border border-zinc-300 bg-zinc-100 shadow-[0_4px_10px_rgba(0,0,0,0.4)] ${
                                handle === "nw"
                                  ? "left-0 top-0 cursor-nwse-resize"
                                  : handle === "ne"
                                    ? "right-0 top-0 cursor-nesw-resize"
                                    : handle === "sw"
                                      ? "bottom-0 left-0 cursor-nesw-resize"
                                      : "bottom-0 right-0 cursor-nwse-resize"
                              }`}
                            />
                          ))
                        : null}
                    </div>
                  </article>
                );
              })}
            </div>
            {canvasSelectionBox ? (
              <div
                className="pointer-events-none absolute border border-zinc-200/85 bg-zinc-100/8"
                style={{
                  left: `${canvasSelectionBox.x}px`,
                  top: `${canvasSelectionBox.y}px`,
                  width: `${canvasSelectionBox.width}px`,
                  height: `${canvasSelectionBox.height}px`,
                }}
              />
            ) : null}
            {selectedCanvasOverlayRects.length ? (
              <div className="pointer-events-none absolute inset-0 z-[2]">
                {selectedCanvasOverlayRects.map((rect) => (
                  <div
                    key={`selection-overlay-${rect.itemId}`}
                    className="absolute border-2 border-zinc-100/95 bg-zinc-200/12 shadow-[0_0_0_1px_rgba(255,255,255,0.42),0_0_16px_rgba(255,255,255,0.24)]"
                    style={{
                      left: `${rect.x}px`,
                      top: `${rect.y}px`,
                      width: `${rect.width}px`,
                      height: `${rect.height}px`,
                    }}
                  />
                ))}
                {selectedCanvasOverlayRects
                  .filter((rect) => rect.isTiny)
                  .map((rect) => (
                    <div
                      key={`selection-dot-${rect.itemId}`}
                      className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 border border-white/90 bg-zinc-100 shadow-[0_0_10px_rgba(255,255,255,0.85)]"
                      style={{
                        left: `${rect.centerX}px`,
                        top: `${rect.centerY}px`,
                      }}
                    />
                  ))}
                {selectedCanvasGroupOverlay ? (
                  <>
                    <div
                      className="absolute border-2 border-dashed border-zinc-100/90 bg-zinc-100/8 shadow-[0_0_0_1px_rgba(255,255,255,0.3)]"
                      style={{
                        left: `${selectedCanvasGroupOverlay.x}px`,
                        top: `${selectedCanvasGroupOverlay.y}px`,
                        width: `${selectedCanvasGroupOverlay.width}px`,
                        height: `${selectedCanvasGroupOverlay.height}px`,
                      }}
                    />
                    <div
                      className="absolute -translate-y-full border border-zinc-100/95 bg-black/72 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-100"
                      style={{
                        left: `${selectedCanvasGroupOverlay.x}px`,
                        top: `${selectedCanvasGroupOverlay.y - 6}px`,
                      }}
                    >
                      {selectedCanvasItemIds.length} selected
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="pointer-events-none fixed inset-0 z-[71]">
            <div
              className="pointer-events-auto absolute left-4 top-4"
              onMouseEnter={() => setIsCanvasHelpHovered(true)}
              onMouseLeave={() => setIsCanvasHelpHovered(false)}
            >
              <div className="relative min-h-9">
                <div
                  className={`absolute left-0 top-0 flex w-[min(30rem,calc(100vw-2.25rem))] origin-left items-center rounded-none border border-white/20 bg-black/62 pl-10 pr-3 py-2.5 text-[12px] leading-relaxed text-white/88 backdrop-blur-md transition-[opacity,transform] duration-300 ease-out ${
                    showCanvasHelpMessage
                      ? "pointer-events-auto translate-y-0 scale-100 opacity-100"
                      : "pointer-events-none -translate-y-1 scale-95 opacity-0"
                  }`}
                >
                  <p className="min-w-0 whitespace-normal">
                    Paste images, drag on empty canvas to multi-select, shift/cmd/ctrl to add or toggle selection, drag selected images together (hold Shift to lock axis), hold Space for hand-pan, and scroll or pinch to zoom.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Show canvas help"
                  onClick={() => setIsCanvasHelpExpanded(true)}
                  onFocus={() => setIsCanvasHelpHovered(true)}
                  onBlur={() => setIsCanvasHelpHovered(false)}
                  className={`absolute left-0 top-0 inline-flex h-9 w-9 appearance-none items-center justify-center rounded-none text-white/80 transition-colors duration-200 hover:text-white ${
                    showCanvasHelpMessage
                      ? "border-0 bg-transparent shadow-none backdrop-blur-none"
                      : "border border-white/20 bg-black/62 backdrop-blur-md"
                  }`}
                >
                  <InfoIcon className="h-4 w-4 invert" />
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={exitCanvasMode}
            className="fixed bottom-5 right-5 z-[72] rounded-none border border-white/25 bg-black/70 px-4 py-2 text-xs font-medium tracking-[0.08em] text-white shadow-[0_14px_34px_rgba(0,0,0,0.55)] backdrop-blur-md transition hover:border-white/45 hover:bg-black/82"
          >
            Exit Canvas
          </button>
          <div ref={canvasColorPickerRef} className="fixed right-5 top-4 z-[72]">
            <div className="flex items-center border border-white/25 bg-black/70 px-1.5 py-1 text-white shadow-[0_14px_34px_rgba(0,0,0,0.55)] backdrop-blur-md">
              <button
                type="button"
                aria-label="Choose canvas background color"
                onClick={() => setIsCanvasColorPickerOpen((current) => !current)}
                className="inline-flex h-4 w-4 items-center justify-center bg-transparent p-0 transition"
              >
                <span className="h-full w-full" style={{ backgroundColor: canvasBackgroundColor }} />
              </button>
            </div>
            {isCanvasColorPickerOpen ? (
              <div className="absolute right-0 top-[calc(100%+0.45rem)] w-[238px] border border-white/20 bg-[#171a1f]/98 p-2.5 shadow-[0_18px_44px_rgba(0,0,0,0.55)] backdrop-blur-xl">
                <div
                  ref={canvasColorPlaneRef}
                  onPointerDown={(event) => {
                    const plane = canvasColorPlaneRef.current;
                    if (!plane) return;
                    event.preventDefault();
                    plane.setPointerCapture(event.pointerId);
                    applyCanvasColorFromPlane(event.clientX, event.clientY, plane);
                  }}
                  onPointerMove={(event) => {
                    if (!(event.buttons & 1)) return;
                    const plane = canvasColorPlaneRef.current;
                    if (!plane) return;
                    applyCanvasColorFromPlane(event.clientX, event.clientY, plane);
                  }}
                  onPointerUp={(event) => {
                    const plane = canvasColorPlaneRef.current;
                    if (plane?.hasPointerCapture(event.pointerId)) {
                      plane.releasePointerCapture(event.pointerId);
                    }
                  }}
                  className="relative h-36 w-full cursor-crosshair border border-white/25"
                  style={{ backgroundColor: `hsl(${Math.round(canvasHue)} 100% 50%)` }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
                  <span
                    className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 border border-white bg-black/20 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                    style={{
                      left: `${canvasSaturation * 100}%`,
                      top: `${(1 - canvasValue) * 100}%`,
                    }}
                  />
                </div>

                <div className="mt-2 flex items-center gap-2">
                  <span className="h-7 w-7 border border-white/25 bg-black/30" style={{ backgroundColor: canvasBackgroundColor }} />
                  <input
                    type="range"
                    min={0}
                    max={360}
                    value={Math.round(canvasHue)}
                    onChange={(event) => {
                      const hue = Number(event.target.value);
                      const [red, green, blue] = hsvToRgb(hue, canvasSaturation, canvasValue);
                      setCanvasBackgroundColor(rgbToHex(red, green, blue));
                    }}
                    className="canvas-color-hue h-2 w-full cursor-pointer appearance-none border border-white/20 bg-white/10"
                    style={{
                      backgroundImage:
                        "linear-gradient(90deg,#ff0000 0%,#ffff00 16.7%,#00ff00 33.4%,#00ffff 50%,#0000ff 66.7%,#ff00ff 83.4%,#ff0000 100%)",
                    }}
                  />
                </div>

                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {([
                    ["R", canvasRed, "r"],
                    ["G", canvasGreen, "g"],
                    ["B", canvasBlue, "b"],
                  ] as const).map(([label, channelValue, channelKey]) => (
                    <label key={label} className="text-center">
                      <input
                        type="number"
                        min={0}
                        max={255}
                        value={channelValue}
                        onChange={(event) => updateCanvasRgbChannel(channelKey, event.target.value)}
                        className="w-full border border-white/22 bg-black/36 px-1.5 py-1 text-center text-[12px] text-white outline-none focus:border-white/45"
                      />
                      <span className="mt-1 block text-[9px] uppercase tracking-[0.08em] text-white/62">{label}</span>
                    </label>
                  ))}
                </div>

                <form
                  className="mt-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    applyCanvasHexDraft();
                  }}
                >
                  <label className="block text-[9px] uppercase tracking-[0.08em] text-white/62">
                    Hex
                    <input
                      value={canvasHexDraft}
                      onChange={(event) => setCanvasHexDraft(event.target.value)}
                      placeholder="#111317"
                      className="mt-1 w-full border border-white/22 bg-black/36 px-1.5 py-1 text-[12px] text-white outline-none focus:border-white/45"
                    />
                  </label>
                </form>

                <button
                  type="button"
                  onClick={() => setCanvasBackgroundColor(DEFAULT_CANVAS_BACKGROUND)}
                  disabled={canvasBackgroundColor.toLowerCase() === DEFAULT_CANVAS_BACKGROUND}
                  className="mt-2 w-full border border-white/22 bg-white/8 px-2 py-1 text-[10px] text-white/85 transition hover:border-white/35 hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Reset
                </button>

              </div>
            ) : null}
          </div>

          {notice ? (
            <div className="fixed left-1/2 top-4 z-[73] -translate-x-1/2 rounded-lg border border-rose-400/50 bg-rose-900/60 px-3 py-2 text-xs text-rose-100 shadow-[0_10px_30px_rgba(0,0,0,0.45)] backdrop-blur-md">
              {notice}
            </div>
          ) : null}

        </>
      ) : null}

      {!isCanvasMode && labelContextMenu ? (
        <div
          ref={labelContextMenuRef}
          className="fixed z-[80] min-w-[164px] rounded-none border border-white/20 bg-black/92 p-1 shadow-[0_16px_40px_rgba(0,0,0,0.5)] backdrop-blur-md"
          style={{ left: `${labelContextMenu.x}px`, top: `${labelContextMenu.y}px` }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            onClick={() => requestRenameLabel(labelContextMenu.label)}
            disabled={deletingLabel === labelContextMenu.label || renamingLabel === labelContextMenu.label}
            className="flex w-full items-center justify-between rounded-none px-2 py-1.5 text-left text-xs text-white/90 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span>Rename</span>
            <span className="text-[10px] text-white/55">
              {renamingLabel === labelContextMenu.label ? "..." : ""}
            </span>
          </button>
          <button
            type="button"
            onClick={() => requestDeleteLabel(labelContextMenu.label)}
            disabled={deletingLabel === labelContextMenu.label || renamingLabel === labelContextMenu.label}
            className="flex w-full items-center justify-between rounded-none px-2 py-1.5 text-left text-xs text-rose-200 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span>Delete</span>
            <span className="text-[10px] text-rose-200/70">
              {deletingLabel === labelContextMenu.label ? "..." : ""}
            </span>
          </button>
        </div>
      ) : null}

      {!isCanvasMode && labelActionPopover ? (
        <div
          ref={labelActionPopoverRef}
          className="fixed z-[81] min-w-[164px] rounded-none border border-white/22 bg-black/94 p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.5)] backdrop-blur-md"
          style={{ left: `${labelActionPopover.x}px`, top: `${labelActionPopover.y}px` }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {labelActionPopover.mode === "rename" ? (
            <form
              className="w-[220px] space-y-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                submitRenameLabel();
              }}
            >
              <p className="text-[11px] uppercase tracking-[0.12em] text-white/55">Rename label</p>
              <input
                value={labelActionPopover.draft}
                onChange={(event) =>
                  setLabelActionPopover((current) =>
                    current && current.mode === "rename"
                      ? {
                          ...current,
                          draft: event.target.value,
                        }
                      : current,
                  )
                }
                autoFocus
                className="w-full rounded-none border border-white/30 bg-black/55 px-2 py-1 text-xs text-white outline-none placeholder:text-white/45 focus:border-white/55"
              />
              <div className="flex gap-1">
                <button
                  type="submit"
                  disabled={renamingLabel === labelActionPopover.label}
                  className="rounded-none border border-white/35 bg-white/10 px-2 py-1 text-[11px] text-white transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {renamingLabel === labelActionPopover.label ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setLabelActionPopover(null)}
                  className="rounded-none border border-white/25 px-2 py-1 text-[11px] text-white/75 transition hover:border-white/45 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-white/82">Delete label?</p>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={submitDeleteLabel}
                  disabled={deletingLabel === labelActionPopover.label}
                  className="rounded-none border border-white/35 bg-white/10 px-2 py-1 text-[11px] text-white transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {deletingLabel === labelActionPopover.label ? "Deleting..." : "Yes"}
                </button>
                <button
                  type="button"
                  onClick={() => setLabelActionPopover(null)}
                  className="rounded-none border border-white/25 px-2 py-1 text-[11px] text-white/75 transition hover:border-white/45 hover:text-white"
                >
                  No
                </button>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
