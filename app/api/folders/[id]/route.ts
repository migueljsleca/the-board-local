import { NextResponse } from "next/server";
import { removeFolderById } from "@/lib/image-db";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const removed = await removeFolderById(id);
    if (!removed) {
      return NextResponse.json({ error: "Board not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete board." }, { status: 500 });
  }
}
