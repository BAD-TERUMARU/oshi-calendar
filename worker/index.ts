import { events as bundledEvents } from "../src/data/events";
import type { CalendarEvent } from "../src/types";

const SNAPSHOT_KEY = "events-latest";
const DEFAULT_RANGE_MONTHS = 6;
const BUNDLED_SNAPSHOT_AT = "2026-08-22T00:00:00+09:00";

interface KVNamespaceLike {
  get<T = unknown>(key: string, type?: "json"): Promise<T | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

interface AssetFetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS?: AssetFetcher;
  EVENTS_KV?: KVNamespaceLike;
  COLLECTOR_URL?: string;
  DATA_RANGE_MONTHS?: string;
}

interface ScheduledController {
  scheduledTime: number;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface EventSnapshot {
  events: CalendarEvent[];
  fetchedAt: string;
  source: "bundled-snapshot" | "public-collector";
  range: { start: string; end: string };
  warnings?: string[];
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=900, s-maxage=3600",
      ...init.headers,
    },
  });
}

function tokyoDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addMonths(value: string, months: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + months, day));
  return date.toISOString().slice(0, 10);
}

function getRange(env: Env) {
  const start = tokyoDate();
  const parsed = Number(env.DATA_RANGE_MONTHS ?? DEFAULT_RANGE_MONTHS);
  const months = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 24) : DEFAULT_RANGE_MONTHS;
  return { start, end: addMonths(start, months) };
}

function isCalendarEvent(value: unknown): value is CalendarEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CalendarEvent>;
  return (
    typeof candidate.id === "string" &&
    (candidate.artist === "ocha" || candidate.artist === "morning" || candidate.artist === "karin") &&
    typeof candidate.title === "string" &&
    typeof candidate.startDate === "string" &&
    typeof candidate.eventType === "string" &&
    typeof candidate.ticketStatus === "string"
  );
}

function isInRange(event: CalendarEvent, range: { start: string; end: string }) {
  const eventEnd = event.endDate ?? event.startDate;
  return eventEnd >= range.start && event.startDate <= range.end;
}

function extractEvents(payload: unknown) {
  if (Array.isArray(payload) && payload.every(isCalendarEvent)) return payload;
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as { events?: unknown };
  return Array.isArray(candidate.events) && candidate.events.every(isCalendarEvent)
    ? candidate.events
    : null;
}

function bundledSnapshot(env: Env): EventSnapshot {
  const range = getRange(env);
  return {
    events: bundledEvents.filter((event) => isInRange(event, range)),
    fetchedAt: BUNDLED_SNAPSHOT_AT,
    source: "bundled-snapshot",
    range,
    warnings: ["公式情報を取得するコレクターが未設定のため、同梱スナップショットを表示しています。"],
  };
}

async function readSnapshot(env: Env) {
  if (env.EVENTS_KV) {
    const stored = await env.EVENTS_KV.get<EventSnapshot>(SNAPSHOT_KEY, "json");
    if (stored?.events?.every(isCalendarEvent)) return stored;
  }
  return bundledSnapshot(env);
}

async function refreshSnapshot(env: Env) {
  if (!env.EVENTS_KV || !env.COLLECTOR_URL) return;

  const response = await fetch(env.COLLECTOR_URL, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`collector returned ${response.status}`);

  const payload = await response.json();
  const collectedEvents = extractEvents(payload);
  if (!collectedEvents) throw new Error("collector returned an invalid event payload");

  const range = getRange(env);
  const snapshot: EventSnapshot = {
    events: collectedEvents.filter((event) => isInRange(event, range)),
    fetchedAt: new Date().toISOString(),
    source: "public-collector",
    range,
  };
  await env.EVENTS_KV.put(SNAPSHOT_KEY, JSON.stringify(snapshot), { expirationTtl: 60 * 60 * 24 * 14 });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/events") {
      return json(await readSnapshot(env));
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, dataRangeMonths: getRange(env), hasRemoteSnapshot: Boolean(env.EVENTS_KV) });
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not Found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContextLike) {
    context.waitUntil(
      refreshSnapshot(env).catch((error) => {
        console.error("Daily public-event refresh failed", error);
      }),
    );
  },
};
