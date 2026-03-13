# The Board Local

The Board Local is a Next.js image board for collecting, organizing, and arranging visual references.

It is built around a fast local workflow:

- Upload images directly into the app
- Organize references into boards
- Add, rename, and remove labels across your library
- Search by board name, label, or image text
- Switch between masonry browsing and a freeform canvas
- Drag, resize, multi-select, and reorder images on the canvas
- Persist canvas layout and image metadata locally
- Compress large uploads automatically to reduce storage cost

## Project Layout

This repository contains the actual app inside:

`the-board-local/`

That nested folder is the Next.js application source.

## Stack

- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- Sharp for image processing and compression

## Local Development

From the app directory:

```bash
cd the-board-local
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Data Storage

The app stores its local data in the app directory:

- `data/images.json` for board and image metadata
- `public/uploads/` for uploaded assets

## Main Routes

- `/` landing page
- `/main` board workspace
- `/api/images` image upload and listing endpoints
- `/api/folders` board creation and listing endpoints

## Current State

This repo is currently structured as a wrapper repository with the application living in the nested `the-board-local/` directory.
