# fal.ai model documentation summary

## Your original model: `110602490-sdxl-turbo-realtime`

- **Type:** Realtime (WebSocket) app.
- **HTTP/queue:** There is **no documented HTTP or queue endpoint** for this ID. The only documented model under owner `110602490` is **`110602490/freepik-fast-sdxl`**, which is **text-to-image only** (no `image_url`), so it can’t do Excalidraw → image.
- **Conclusion:** `110602490-sdxl-turbo-realtime` is built for **WebSocket realtime** only. Calling it via HTTP (e.g. `fal.run()`) is why you weren’t getting results.

## Recommended replacement: `fal-ai/fast-sdxl/image-to-image`

- **Docs:** https://fal.ai/models/fal-ai/fast-sdxl/image-to-image/api  
- **Type:** Image-to-image over **HTTP/queue** (and streaming). No WebSocket required.
- **Input:** `image_url` (required), `prompt` (required), `strength` (default 0.95), `seed`, `sync_mode`, plus optional params (e.g. `negative_prompt`, `image_size`).
- **Output:** `images: [{ url, width, height, content_type }]`, plus `timings`, `seed`, `prompt`.
- **Client:** Official docs use **`@fal-ai/client`** with `fal.subscribe("fal-ai/fast-sdxl/image-to-image", { input: { ... } })`.  
  The deprecated **`@fal-ai/serverless-client`** uses a different URL shape (subdomain) and doesn’t support slash-style IDs like `fal-ai/fast-sdxl/image-to-image`, so it can’t call this endpoint correctly.

## Other findings

- **fal-ai/fast-turbo-diffusion/image-to-image** also has `image_url`, `prompt`, `strength`, `sync_mode`, but the docs mark it as **deprecated** (“no longer supported”).
- **110602490/freepik-fast-sdxl** is HTTP-only, text-to-image only (no `image_url`), so it doesn’t match your use case.
- fal’s current API uses **`https://fal.run`** (sync) and **`https://queue.fal.run`** (queue). The old **`gateway.alpha.fal.ai`** host may be deprecated or behave differently.

## Recommendation (implemented)

- The app uses **`fal-ai/fast-lcm-diffusion/image-to-image`** (LCM = Latent Consistency Model) for **fast** generation: ~6 inference steps vs standard SDXL’s ~25, “run SDXL at the speed of light”. Same API: `image_url`, `prompt`, `strength`, `seed`, `sync_mode`; same output: `images[].url`.
- Full URL: **`https://fal.run/fal-ai/fast-lcm-diffusion/image-to-image`**, called via `fal.run()` from `@fal-ai/serverless-client`.
- The **proxy** (`app/api/fal/proxy/route.ts`) is a custom implementation that allows **fal.ai**, **fal.run**, and **queue.fal.run** target URLs.
