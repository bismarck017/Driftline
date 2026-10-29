import { NextResponse } from "next/server";

// allows this repo to build as a static export for GitHub Pages
export const dynamic = "force-static";

export async function GET() {
  return NextResponse.json({ message: "Hello, world!" });
}