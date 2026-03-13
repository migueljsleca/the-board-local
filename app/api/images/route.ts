import { NextResponse } from "next/server";
import { createImage, listBoardData } from "@/lib/image-db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const boardData = await listBoardData();
    return NextResponse.json(boardData);
  } catch {
    return NextResponse.json({ error: "Failed to load images." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("image");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Image file is required." }, { status: 400 });
    }

    const width = Number(formData.get("width"));
    const height = Number(formData.get("height"));
    const rawFolderId = formData.get("folderId");
    if (rawFolderId !== null && typeof rawFolderId !== "string") {
      return NextResponse.json({ error: "folderId must be a string." }, { status: 400 });
    }
    const folderId = rawFolderId && rawFolderId.trim() ? rawFolderId : null;
    const image = await createImage({ file, width, height, folderId });
    return NextResponse.json({ image }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to store image." }, { status: 500 });
  }
}
