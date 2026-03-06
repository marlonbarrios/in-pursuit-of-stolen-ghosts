import { NextResponse } from "next/server";

/**
 * GET /api/fal/test — Call fal from the server with FAL_KEY to verify:
 * 1. FAL_KEY is set and valid
 * 2. The image-to-image model responds
 * No proxy involved. Open in browser or: curl http://localhost:3000/api/fal/test
 */
const MODEL = "https://fal.run/fal-ai/fast-lcm-diffusion/image-to-image";

export async function GET() {
  const key = process.env.FAL_KEY || process.env.NEXT_PUBLIC_FAL_KEY;
  if (!key) {
    return NextResponse.json(
      { ok: false, error: "Missing FAL_KEY (and NEXT_PUBLIC_FAL_KEY)" },
      { status: 500 }
    );
  }

  // Minimal valid payload: tiny 1x1 red pixel PNG as data URL (required by model)
  const minimalImage =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  try {
    const res = await fetch(`${MODEL}/`, {
      method: "POST",
      headers: {
        Authorization: `Key ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image_url: minimalImage,
        prompt: "a red dot",
        strength: 0.5,
        seed: 42,
        sync_mode: true,
      }),
    });

    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 500) };
    }

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "fal.run returned error",
          status: res.status,
          body: data,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "FAL_KEY works and model responded",
      status: res.status,
      hasImage: !!(data as Record<string, unknown>)?.images?.[0] ?? (data as Record<string, unknown>)?.image,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: "Request failed", message },
      { status: 502 }
    );
  }
}
