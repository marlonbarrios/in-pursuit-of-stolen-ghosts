// Import React and necessary hooks
'use client'
import { useState, useEffect, useRef, useCallback } from 'react';

const seed = Math.floor(Math.random() * 100000);

// Fast LCM image-to-image — we call our proxy which adds FAL_KEY and forwards to fal.run
const IMAGE_TO_IMAGE_MODEL = 'https://fal.run/fal-ai/fast-lcm-diffusion/image-to-image';
const API_TIMEOUT_MS = 90000; // 90s
const THROTTLE_MS = 10; // send very quickly after drawing for fast feedback
const PROXY_URL = '/api/fal/proxy';

function getImageUrlFromResult(result: Record<string, unknown>): string | null {
  if (result?.error) return null;
  type Img = { url?: string; content?: string; content_type?: string };
  const toDataUrl = (content: string, contentType = "image/png"): string =>
    content.startsWith("data:") ? content : `data:${contentType};base64,${content}`;
  const takeFirst = (images: Img[] | undefined): string | null => {
    if (!images?.[0]) return null;
    const first = images[0];
    if (first.url) return first.url;
    if (typeof first.content === "string")
      return toDataUrl(first.content, (first.content_type as string) || "image/png");
    return null;
  };
  // Try common fal response shapes (data, then top-level images, then image, then output)
  const data = result?.data as Record<string, unknown> | undefined;
  if (data) {
    const out = takeFirst(data.images as Img[] | undefined);
    if (out) return out;
  }
  const topLevel = takeFirst(result?.images as Img[] | undefined);
  if (topLevel) return topLevel;
  const image = result?.image as Img | undefined;
  if (image?.url) return image.url;
  if (typeof image?.content === "string") return toDataUrl(image.content, (image.content_type as string) || "image/png");
  const output = result?.output as Record<string, unknown> | undefined;
  if (output) {
    const out = takeFirst(output?.images as Img[] | undefined);
    if (out) return out;
  }
  return null;
}

/** Only treat as displayable if URL is non-empty and looks like a real image (http or data:image). */
function isValidImageUrl(url: string | null): url is string {
  if (!url || typeof url !== 'string') return false;
  const s = url.trim();
  if (s.length < 10) return false;
  return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('data:image');
}

export default function Home() {
  const [input, setInput] = useState('male human form, human bodies,  aztec, mayan, yanomami, NOIR,  african, entangled with oil bubbles like hanging from heaven, inner lights,  blood, fire, network of tendrils, veins, umbilical cords, strange colors, abstract, complexity, organic, emerging organic, growth, black hole, metapatterns, phyllotaxis, diatoms, texture, voronoi, and depth, forces, photo-realistic');
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [strength, setStrength] = useState(1); // API max is 1. Lower = output closer to your drawing; higher = more change (more prompt).
  const [sceneData, setSceneData] = useState<any>(null);
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [_appState, setAppState] = useState<any>(null);
  const [excalidrawExportFns, setExcalidrawExportFns] = useState<any>(null);
  const [isClient, setIsClient] = useState<boolean>(false);
  const [Comp, setComp] = useState<any>(null);
  const [audioSrc] = useState('/ghost_stolen.mp3'); // Update this path to your audio file

  const requestIdRef = useRef(0);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPayloadRef = useRef<{ image_url: string; prompt: string; strength: number; seed: number } | null>(null);
  const inFlightRef = useRef(false);
  const lastGoodImageRef = useRef<string | null>(null);
  const previousGoodImageRef = useRef<string | null>(null);
  const lastSentSceneRef = useRef<string | null>(null);
  const sampleAndSendRef = useRef<() => void>(() => {});

  useEffect(() => {
    import('@excalidraw/excalidraw').then((comp) => setComp(comp.Excalidraw));
  }, []);

  useEffect(() => { setIsClient(true); }, []);

  useEffect(() => {
    import('@excalidraw/excalidraw').then((module) =>
      setExcalidrawExportFns({
        exportToBlob: module.exportToBlob,
        serializeAsJSON: module.serializeAsJSON
      })
    );
  }, []);

  useEffect(() => {
    return () => {
      if (throttleRef.current) clearTimeout(throttleRef.current);
    };
  }, []);

  const runRealtimeRequest = useCallback(async (payload: { image_url: string; prompt: string; strength: number; seed: number }) => {
    if (inFlightRef.current) {
      pendingPayloadRef.current = payload;
      return;
    }
    inFlightRef.current = true;
    setError(null);
    setIsGenerating(true);
    const id = ++requestIdRef.current;
    if (process.env.NODE_ENV === 'development') {
      console.log('[fal] sending request, requestId:', id);
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const body = JSON.stringify({
        image_url: payload.image_url,
        prompt: payload.prompt,
        strength: payload.strength,
        seed: payload.seed,
        sync_mode: true,
      });
      const res = await fetch(PROXY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-fal-target-url': IMAGE_TO_IMAGE_MODEL,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      let result: Record<string, unknown>;
      try {
        const text = await res.text();
        result = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        setError(res.ok ? 'Invalid response from server' : `Request failed (${res.status})`);
        return;
      }
      if (process.env.NODE_ENV === 'development') {
        console.log('[fal] response status:', res.status, 'keys:', Object.keys(result));
      }
      if (id !== requestIdRef.current) return;
      if (!res.ok) {
        const msg = (result?.error as string) || res.statusText || `Request failed (${res.status})`;
        setError(msg);
        console.error('[fal] error:', res.status, result);
        return;
      }
      if (result?.error) {
        setError(String(result.error));
        return;
      }
      const imageUrl = getImageUrlFromResult(result);
      if (process.env.NODE_ENV === 'development') {
        if (imageUrl) console.log('[fal] extracted image URL, length:', imageUrl.length);
        else console.warn('[fal] no image in response, keys:', Object.keys(result), 'data?.images?.[0]:', !!(result?.data as Record<string, unknown>)?.images?.[0]);
      }
      if (id !== requestIdRef.current) return;
      if (isValidImageUrl(imageUrl)) {
        previousGoodImageRef.current = lastGoodImageRef.current;
        setImage(imageUrl);
      } else if (!imageUrl) {
        setError('No image in response. Check console for response keys.');
      }
    } catch (err: unknown) {
      clearTimeout(timeoutId);
      const message = err instanceof Error ? err.message : String(err);
      const isAbort = message.includes('abort');
      setError(isAbort ? 'Request timed out. Try again.' : message);
      console.error('[fal] request failed:', err);
    } finally {
      setIsGenerating(false);
      inFlightRef.current = false;
      const next = pendingPayloadRef.current;
      pendingPayloadRef.current = null;
      if (next) {
        throttleRef.current = setTimeout(() => {
          throttleRef.current = null;
          runRealtimeRequest(next);
        }, THROTTLE_MS);
      }
    }
  }, []);

  const send = useCallback((payload: { image_url: string; prompt: string; strength: number; seed: number }) => {
    pendingPayloadRef.current = payload;
    if (throttleRef.current) return;
    if (inFlightRef.current) return;
    throttleRef.current = setTimeout(() => {
      throttleRef.current = null;
      const next = pendingPayloadRef.current;
      pendingPayloadRef.current = null;
      if (next) runRealtimeRequest(next);
    }, THROTTLE_MS);
  }, [runRealtimeRequest]);

  const baseArgs = {
    sync_mode: true,
    strength,
    seed,
  };

  async function getDataUrl(
    elements: readonly { type: string }[],
    appState: { viewBackgroundColor?: string },
    files: Record<string, unknown>
  ): Promise<string | undefined> {
    if (!elements?.length) return undefined;
    try {
      const blob = await excalidrawExportFns.exportToBlob({
        elements,
        exportPadding: 10,
        appState,
        files,
        getDimensions: () => ({ width: 512, height: 512 })
      });
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.error('[getDataUrl]', err);
      setError(err instanceof Error ? err.message : 'Export failed');
      return undefined;
    }
  }

  // Keep sample-and-send logic in a ref so the 10 ms interval always calls the latest
  useEffect(() => {
    sampleAndSendRef.current = async () => {
      if (!excalidrawAPI || !excalidrawExportFns) return;
      const elements = excalidrawAPI.getSceneElements?.() ?? [];
      const appState = excalidrawAPI.getAppState?.() ?? {};
      const files = excalidrawAPI.getFiles?.() ?? {};
      const newSceneData = excalidrawExportFns.serializeAsJSON(elements, appState, files, 'local');
      if (!elements?.length || newSceneData === lastSentSceneRef.current) return;
      const dataUrl = await getDataUrl(elements, appState, files);
      if (!dataUrl) return;
      lastSentSceneRef.current = newSceneData;
      send({ sync_mode: true, strength, seed, image_url: dataUrl, prompt: input });
    };
  }, [excalidrawAPI, excalidrawExportFns, strength, input, send]);

  // Sample Excalidraw every 1 ms and send when scene changed
  useEffect(() => {
    if (!excalidrawAPI) return;
    const intervalId = setInterval(() => sampleAndSendRef.current(), 1);
    return () => clearInterval(intervalId);
  }, [excalidrawAPI]);

  return (
    <main className="p-12 min-h-screen" style={{ backgroundColor: '#f9fafb' }}>
      <p className="text-xl mb-2">in pursuit of stolen ghosts | concept, programming, sound design and performance by <a href='https://marlonbarrios.github.io/'>marlon barrios solano</a></p>
      <p className="text-xl mb-2">VERSION 2.0 MARCH 2026</p>
      <label className="block text-sm font-medium mb-1">Prompt (guides the image generation)</label>
      <input className='border rounded-lg p-2 w-full mb-2' value={input} onChange={(e) => setInput(e.target.value)} placeholder="Describe what you want in the image"/>
      <p><input type="range" min="0.01" max="1" step="0.01" value={strength} onChange={(e) => setStrength(parseFloat(e.target.value))}/> | Strength: {strength} <span className="text-sm text-gray-500">(max 1 in API — lower = closer to your drawing; higher = more change / more prompt)</span></p>
      {error && (
        <p className="text-red-600 text-sm mb-2" role="alert">
          {error} — Check that FAL_KEY is set in .env.local and restart the dev server.
        </p>
      )}
      <div className='flex' style={{ backgroundColor: '#f9fafb' }}>
        <div className="w-[650px] h-[650px]">
          {
            isClient && excalidrawExportFns && (
              <Comp
                theme="light"
                excalidrawAPI={(api) => setExcalidrawAPI(api)}
                onChange={(elements, appState) => {
                  const newSceneData = excalidrawExportFns.serializeAsJSON(
                    elements,
                    appState,
                    excalidrawAPI.getFiles(),
                    'local'
                  );
                  if (newSceneData !== sceneData) {
                    setAppState(appState);
                    setSceneData(newSceneData);
                  }
                  // Generation is driven by the 10 ms sampler, not here
                }}
              />
            )
}
      <div className="audio-player mt-4">
      <audio controls src={audioSrc}>
        Your browser does not support the audio element.
      </audio>
    </div>

        </div>
        <div
          id="generated-image-panel"
          className="generated-image-panel relative min-w-[512px] flex flex-col rounded-lg p-4 flex-1 shrink-0"
          style={{ backgroundColor: '#e5e7eb', height: 560, minHeight: 560 }}
        >
          {/* Full-bleed light gray so this area is never black */}
          <div
            className="absolute inset-0 rounded-lg"
            style={{ backgroundColor: '#e5e7eb', zIndex: 0 }}
            aria-hidden
          />
          {/* Fixed-height status row */}
          <div className="relative z-10 h-6 flex items-center justify-center shrink-0" style={{ backgroundColor: '#e5e7eb' }}>
            <span className={isGenerating ? 'text-gray-600 text-sm' : 'text-sm text-transparent select-none'}>Generating…</span>
          </div>
          {/* Image or placeholder */}
          <div className="relative z-10 flex-1 min-h-0 flex items-center justify-center pt-1" style={{ backgroundColor: '#e5e7eb' }}>
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image}
                width={512}
                height={512}
                alt="Generated image"
                className="max-w-full max-h-full w-auto h-auto object-contain"
                style={{ backgroundColor: '#e5e7eb' }}
                onLoad={() => {
                  lastGoodImageRef.current = image;
                }}
                onError={() => {
                  const fallback = lastGoodImageRef.current;
                  if (fallback && fallback !== image) setImage(fallback);
                }}
              />
            ) : (
              <p className="text-gray-600 text-center px-4">Draw on the left — first image will appear here, then new ones replace it.</p>
            )}
          </div>
        </div>
      </div>
      
    </main>
  );
}
