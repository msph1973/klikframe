import { handle } from "hono/vercel";
import { createApp } from "@/lib/http/app";

/**
 * Single Hono composition root (ARCHITECTURE.md §3.2). All `/api/v1`
 * routes are registered inside `createApp()`; this file only adapts the
 * Hono app to Next.js Route Handlers and must stay free of business logic.
 */
const app = createApp();

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
