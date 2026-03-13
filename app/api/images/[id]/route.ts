import { NextResponse } from "next/server";
import { removeImageById, updateImageById } from "@/lib/image-db";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const removed = await removeImageById(id);
    if (!removed) {
      return NextResponse.json({ error: "Image not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete image." }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const payload = (await request.json()) as { labels?: unknown; folderId?: unknown; title?: unknown; canvas?: unknown };
    if (payload.labels !== undefined && (!Array.isArray(payload.labels) || payload.labels.some((label) => typeof label !== "string"))) {
      return NextResponse.json({ error: "Labels must be an array of strings." }, { status: 400 });
    }
    if (payload.folderId !== undefined && payload.folderId !== null && typeof payload.folderId !== "string") {
      return NextResponse.json({ error: "folderId must be a string or null." }, { status: 400 });
    }
    if (payload.title !== undefined && typeof payload.title !== "string") {
      return NextResponse.json({ error: "title must be a string." }, { status: 400 });
    }
    if (payload.canvas !== undefined) {
      if (payload.canvas !== null && typeof payload.canvas !== "object") {
        return NextResponse.json({ error: "canvas must be an object or null." }, { status: 400 });
      }
      if (payload.canvas && typeof payload.canvas === "object") {
        const canvas = payload.canvas as Record<string, unknown>;
        const numericFields = ["x", "y", "width", "height", "z"] as const;
        for (const key of numericFields) {
          if (typeof canvas[key] !== "number" || !Number.isFinite(canvas[key])) {
            return NextResponse.json({ error: `canvas.${key} must be a finite number.` }, { status: 400 });
          }
        }
        if ((canvas.width as number) <= 0 || (canvas.height as number) <= 0) {
          return NextResponse.json({ error: "canvas width and height must be positive." }, { status: 400 });
        }
      }
    }
    if (payload.labels === undefined && payload.folderId === undefined && payload.title === undefined && payload.canvas === undefined) {
      return NextResponse.json({ error: "No supported fields to update." }, { status: 400 });
    }

    const result = await updateImageById(id, {
      labels: payload.labels as string[] | undefined,
      folderId: payload.folderId as string | null | undefined,
      title: payload.title as string | undefined,
      canvas: payload.canvas as { x: number; y: number; width: number; height: number; z: number } | null | undefined,
    });
    if (result.kind === "image-not-found") {
      return NextResponse.json({ error: "Image not found." }, { status: 404 });
    }
    if (result.kind === "folder-not-found") {
      return NextResponse.json({ error: "Board not found." }, { status: 400 });
    }
    return NextResponse.json({ image: result.image });
  } catch {
    return NextResponse.json({ error: "Failed to update image." }, { status: 500 });
  }
}
