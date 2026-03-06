import { NextRequest, NextResponse } from "next/server";

const TARGET_URL_HEADER = "x-fal-target-url";
const FAL_KEY =
  process.env.FAL_KEY ||
  process.env.NEXT_PUBLIC_FAL_KEY;
const FAL_KEY_ID = process.env.FAL_KEY_ID || process.env.NEXT_PUBLIC_FAL_KEY_ID;
const FAL_KEY_SECRET =
  process.env.FAL_KEY_SECRET || process.env.NEXT_PUBLIC_FAL_KEY_SECRET;

function getFalKey(): string | undefined {
  if (FAL_KEY) return FAL_KEY;
  if (FAL_KEY_ID && FAL_KEY_SECRET) return `${FAL_KEY_ID}:${FAL_KEY_SECRET}`;
  return undefined;
}

/** Allow fal.ai and fal.run. Returns normalized URL or null if invalid. */
function normalizeTargetUrl(raw: string): string | null {
  const url = raw.trim();
  if (!url) return null;
  // Accept any URL that references fal.ai or fal.run (client may send path-only or full URL)
  const isFal = url.includes("fal.run") || url.includes("fal.ai");
  if (!isFal) return null;
  try {
    const withProtocol =
      url.startsWith("http://") || url.startsWith("https://")
        ? url
        : url.startsWith("/")
          ? `https://fal.run${url}`
          : `https://${url}`;
    const parsed = new URL(withProtocol);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith("fal.ai") && !host.endsWith("fal.run")) return null;
    return withProtocol;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  return proxyRequest(request);
}

export async function POST(request: NextRequest) {
  return proxyRequest(request);
}

async function proxyRequest(request: NextRequest) {
  if (process.env.NODE_ENV === "development") {
    console.log("[fal proxy] request received", request.method);
  }
  const targetUrl = request.headers.get(TARGET_URL_HEADER);
  if (!targetUrl) {
    return NextResponse.json(
      { error: `Missing ${TARGET_URL_HEADER} header` },
      { status: 400 }
    );
  }
  const normalizedUrl = normalizeTargetUrl(targetUrl);
  if (!normalizedUrl) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[fal proxy] rejected targetUrl:", JSON.stringify(targetUrl?.slice(0, 200)));
    }
    return NextResponse.json(
      { error: `Invalid ${TARGET_URL_HEADER}: must be fal.ai or fal.run` },
      { status: 412 }
    );
  }

  const falKey = getFalKey();
  if (!falKey) {
    return NextResponse.json(
      { error: "Missing fal.ai credentials (FAL_KEY)" },
      { status: 401 }
    );
  }

  const headers: Record<string, string> = {
    authorization: request.headers.get("authorization") || `Key ${falKey}`,
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": request.headers.get("user-agent") || "",
  };
  request.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k.startsWith("x-fal-") && k !== TARGET_URL_HEADER.toLowerCase()) {
      headers[k] = value;
    }
  });

  const body =
    request.method.toUpperCase() !== "GET"
      ? await request.text()
      : undefined;

  const UPSTREAM_TIMEOUT_MS = 120_000; // 2 min so fal has time to process
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  if (process.env.NODE_ENV === "development") {
    console.log("[fal proxy] forwarding to", normalizedUrl.slice(0, 60) + "...", "key present:", !!falKey, "body length:", body?.length ?? 0);
  }

  let res: Response;
  try {
    res = await fetch(normalizedUrl, {
      method: request.method,
      headers,
      body: body || undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message.includes("abort") || message.includes("timeout");
    if (process.env.NODE_ENV === "development") {
      console.warn("[fal proxy] upstream fetch failed:", message);
    }
    return NextResponse.json(
      { error: isTimeout ? "Upstream request timed out (fal.run took too long)" : message },
      { status: 504 }
    );
  }
  clearTimeout(timeoutId);

  if (process.env.NODE_ENV === "development" && !res.ok) {
    const errText = await res.clone().text();
    let errBody: unknown = errText;
    try {
      errBody = errText ? JSON.parse(errText) : null;
    } catch {
      errBody = errText.slice(0, 400);
    }
    console.warn("[fal proxy] upstream error", res.status, errBody);
  }

  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  }
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "content-type": contentType },
  });
}
