import express from "express";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest, SubscribeRequestSchema, UnsubscribeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { createStore } from "./src/store.js";
import { createEventStore } from "./src/eventStore.js";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1"; // spec: bind to localhost when running locally
const store = createStore();
const eventStore = createEventStore();
const sessions = new Map();
const DASHBOARD_URI = "ui://hearth/dashboard";
const UI_MIME = "text/html;profile=mcp-app";
const dashboardHtml = readFileSync(new URL("./ui/dashboard.html", import.meta.url), "utf8");
const LIVE = "hearth://live";

const reply = (o, structured) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o) }], ...(structured ? { structuredContent: structured } : {}) });
const readOnly = { readOnlyHint: true, openWorldHint: false };
const write = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const uiMeta = (visibility) => ({ ui: { resourceUri: DASHBOARD_URI, ...(visibility ? { visibility } : {}) } });

function buildServer(ctx) {
  const s = new McpServer({ name: "hearth-care", version: "2.0.0" }, { capabilities: { resources: { subscribe: true, listChanged: true }, logging: {} } });

  s.registerTool("list_today", { title: "Today's medication schedule", description: "List today's doses with status (upcoming, due, taken, missed).", inputSchema: {}, annotations: readOnly },
    async () => reply({ now: store.nowLabel(), doses: store.listToday() }));

  s.registerTool("add_medication", { title: "Add a medication", description: "Add a medication with a dose and daily times (HH:MM, 24h). Only add what the person or caregiver explicitly states; never suggest medications.",
    inputSchema: { name: z.string().min(2).max(60), dose: z.string().min(1).max(40), times: z.array(z.string()).min(1).max(6) }, annotations: write },
    async (a) => reply(store.addMedication(a)));

  s.registerTool("log_dose", { title: "Log a taken dose", description: "Record that the person took a medication (matched by name).",
    inputSchema: { medication: z.string().min(2).max(60) }, annotations: write }, async ({ medication }) => reply(store.logDose(medication)));

  s.registerTool("record_checkin", { title: "Record a mood check-in", description: "Store how the person feels, 1 (very low) to 5 (very good), with an optional short note in their own words.",
    inputSchema: { mood: z.number().int().min(1).max(5), note: z.string().max(200).optional() }, annotations: write }, async ({ mood, note }) => reply(store.checkin(mood, note)));

  s.registerTool("record_home_signal", { title: "Record a home activity signal", description: "Store an activity signal from a home routine or device (simulated; designed to map to Ring/IoT events). Kinds: morning_activity, door_open, kitchen_motion.",
    inputSchema: { kind: z.enum(["morning_activity", "door_open", "kitchen_motion"]) }, annotations: write }, async ({ kind }) => reply(store.signal(kind)));

  // MCP Apps: this tool is linked to a ui:// resource. Hosts that support the extension render the dashboard inline;
  // every other host just gets the text content (graceful degradation).
  const summaryTool = async ({ days }) => {
    const summary = store.summary(days ?? 7), snap = store.snapshot();
    const line = `Adherence ${summary.adherence_percent}%, mood ${summary.mood_average} (${summary.mood_trend}). ` + (summary.flags.length ? summary.flags.map((f) => f.text).join(" ") : "No flags.");
    return reply(line, { summary, today: snap.today, moods: snap.moods, now: snap.now });
  };
  s.registerTool("get_wellbeing_summary", { title: "Wellbeing summary for the caregiver", description: "Adherence, mood trend, personalised routine baseline and flags over the last N days (1-14). Renders an interactive dashboard in hosts that support MCP Apps.",
    inputSchema: { days: z.number().int().min(1).max(14).default(7) }, annotations: readOnly, _meta: uiMeta() }, summaryTool);

  s.registerTool("app_refresh", { title: "Refresh dashboard data (app only)", description: "Used by the dashboard view to refresh itself. Hidden from the model.",
    inputSchema: {}, annotations: readOnly, _meta: uiMeta(["app"]) }, async () => summaryTool({ days: 7 }));

  s.registerTool("notify_caregiver", { title: "Notify the caregiver", description: "Send a message to the caregiver. severity: info | attention | urgent. Set requested_by_person=true when the person explicitly asked. For proactive 'attention' alerts Hearth asks the person for consent first (MCP elicitation). NOT an emergency service: for emergencies tell the person to call their local emergency number.",
    inputSchema: { reason: z.string().min(5).max(300), severity: z.enum(["info", "attention", "urgent"]), requested_by_person: z.boolean().default(false) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
    async (a, extra) => {
      const needsConsent = a.severity === "attention" && !a.requested_by_person && s.server.getClientCapabilities()?.elicitation;
      if (needsConsent) {
        const r = await s.server.elicitInput({
          message: `I noticed something: ${a.reason} Shall I let Salma know?`,
          requestedSchema: { type: "object", properties: { share: { type: "boolean", title: "Tell Salma", default: true } }, required: ["share"] },
        }, { relatedRequestId: extra.requestId });
        if (r.action !== "accept" || !r.content?.share) return reply({ ok: false, declined: true, message: "The person declined. Nothing was sent." });
      }
      return reply(store.notify({ reason: a.reason, severity: a.severity }));
    });

  s.registerResource("care-policy", "hearth://policy", { title: "Care and privacy policy", mimeType: "text/markdown" }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text:
    "# Hearth policy\n- Not a medical device; never gives medical advice or changes doses.\n- Proactive alerts need the person's consent (elicitation). Emergencies and explicit requests do not.\n- The caregiver only receives what notify_caregiver sends.\n- Emergencies: the person is told to call the local emergency number first." }] }));

  s.registerResource("live-state", LIVE, { title: "Live care state", description: "Subscribe to be pushed an update whenever something changes.", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(store.snapshot()) }] }));

  s.registerResource("dashboard-ui", DASHBOARD_URI, { title: "Hearth caregiver dashboard", description: "Interactive dashboard (MCP App view).", mimeType: UI_MIME },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: UI_MIME, text: dashboardHtml, _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }] }));

  s.server.setRequestHandler(SubscribeRequestSchema, async (r) => { ctx.subs.add(r.params.uri); return {}; });
  s.server.setRequestHandler(UnsubscribeRequestSchema, async (r) => { ctx.subs.delete(r.params.uri); return {}; });
  return s;
}

const origins = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`, ...(process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean)];
const hosts = [`localhost:${PORT}`, `127.0.0.1:${PORT}`, ...(process.env.ALLOWED_HOSTS || "").split(",").filter(Boolean)];
const rpcError = (res, status, code, message) => res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });

async function createSession() {
  const ctx = { subs: new Set(), server: null, transport: null };
  ctx.server = buildServer(ctx);
  ctx.transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(), eventStore,
    enableDnsRebindingProtection: true, allowedOrigins: origins, allowedHosts: hosts,
    onsessioninitialized: (id) => sessions.set(id, ctx),
  });
  ctx.transport.onclose = () => { if (ctx.transport.sessionId) sessions.delete(ctx.transport.sessionId); };
  await ctx.server.connect(ctx.transport);
  return ctx;
}

// Push: when state changes, notify every session that subscribed to hearth://live (delivered over the GET SSE stream).
store.onChange(() => { for (const c of sessions.values()) if (c.subs.has(LIVE)) c.server.server.sendResourceUpdated({ uri: LIVE }).catch(() => {}); });

const app = express();
// Spec: servers MUST validate Origin on every incoming connection (403 if present and not allowed).
app.use("/mcp", (req, res, next) => { const o = req.headers.origin; if (o && !origins.includes(o)) return rpcError(res, 403, -32000, "Forbidden: invalid Origin"); next(); });
app.use(express.json());
app.use(express.static("public"));

app.post("/mcp", async (req, res) => {
  try {
    const sid = req.headers["mcp-session-id"];
    let ctx = sid ? sessions.get(sid) : null;
    if (sid && !ctx) return rpcError(res, 404, -32001, "Session not found. Send a new initialize request.");
    if (!ctx) { if (!isInitializeRequest(req.body)) return rpcError(res, 400, -32000, "Missing MCP-Session-Id. Initialize first."); ctx = await createSession(); }
    await ctx.transport.handleRequest(req, res, req.body);
  } catch (e) { console.error(e); if (!res.headersSent) rpcError(res, 500, -32603, "Internal error"); }
});
const bySession = async (req, res) => {
  const sid = req.headers["mcp-session-id"];
  if (!sid) return rpcError(res, 400, -32000, "Missing MCP-Session-Id.");
  const ctx = sessions.get(sid);
  if (!ctx) return rpcError(res, 404, -32001, "Session not found.");
  await ctx.transport.handleRequest(req, res);
};
app.get("/mcp", bySession);      // server -> client SSE stream (notifications, resumable with Last-Event-ID)
app.delete("/mcp", bySession);   // explicit session termination

// Demo-only helpers for the simulator (not MCP tools)
app.post("/api/demo/advance", (q, r) => { store.advance(Math.max(0, Math.min(1440, Number(q.body.minutes) || 0))); r.json({ ok: true }); });
app.post("/api/demo/reset", (_q, r) => { store.reset(); r.json({ ok: true }); });

if (process.env.NODE_ENV !== "test") app.listen(PORT, HOST, () => console.log(`Hearth MCP  http://${HOST}:${PORT}/mcp   simulator: http://${HOST}:${PORT}`));
export default app;
