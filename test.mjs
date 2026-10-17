// Protocol-level tests against the running server (MCP 2025-11-25 Streamable HTTP + MCP Apps metadata).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
const PORT = 3111, BASE = `http://127.0.0.1:${PORT}`;
const proc = spawn("node", ["server.js"], { env: { ...process.env, PORT }, stdio: "pipe" });
await new Promise((r) => setTimeout(r, 2500));

const ACCEPT = "application/json, text/event-stream";
let rid = 1;
// Reads a response that is either JSON or SSE; returns all JSON-RPC messages seen. onMsg may reply to server requests.
async function readMessages(res, onMsg, stopWhen) {
  if ((res.headers.get("content-type") || "").includes("application/json")) { const j = await res.json(); onMsg?.(j); return [j]; }
  const out = [], dec = new TextDecoder(); let buf = "";
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const raw = buf.slice(0, i); buf = buf.slice(i + 2);
      const id = (raw.match(/^id: (.*)$/m) || [])[1], data = raw.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
      if (!data) continue; const m = JSON.parse(data); m._eventId = id; out.push(m); await onMsg?.(m);
      if (stopWhen?.(m)) return out;
    }
  }
  return out;
}
class Client {
  constructor(caps = {}) { this.caps = caps; }
  headers(extra = {}) { return { "Content-Type": "application/json", Accept: ACCEPT, ...(this.sid ? { "MCP-Session-Id": this.sid } : {}), ...(this.sid ? { "MCP-Protocol-Version": "2025-11-25" } : {}), ...extra }; }
  async init() {
    const r = await fetch(`${BASE}/mcp`, { method: "POST", headers: this.headers(), body: JSON.stringify({ jsonrpc: "2.0", id: rid++, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: this.caps, clientInfo: { name: "test", version: "1" } } }) });
    this.sid = r.headers.get("mcp-session-id"); const [m] = await readMessages(r); this.initResult = m.result;
    const n = await fetch(`${BASE}/mcp`, { method: "POST", headers: this.headers(), body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    assert.equal(n.status, 202, "notification must get 202"); return this;
  }
  async rpc(method, params = {}, handler) {
    const id = rid++, r = await fetch(`${BASE}/mcp`, { method: "POST", headers: this.headers(), body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
    const msgs = await readMessages(r, async (m) => { if (m.method && m.id !== undefined && handler) { const result = await handler(m); await fetch(`${BASE}/mcp`, { method: "POST", headers: this.headers(), body: JSON.stringify({ jsonrpc: "2.0", id: m.id, result }) }); } }, (m) => m.id === id && (m.result || m.error));
    return msgs.find((m) => m.id === id);
  }
  async call(name, args = {}, handler) { const r = await this.rpc("tools/call", { name, arguments: args }, handler); if (r.error) throw new Error(r.error.message); return r.result; }
  async json(name, args, handler) { const r = await this.call(name, args, handler); return JSON.parse(r.content[0].text); }
}
const api = (p, b) => fetch(`${BASE}${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b || {}) });
import { readFileSync } from "node:fs";
const results = []; const ok = (name) => { results.push(name); console.log("  ✓", name); };

try {
  // ---- Transport security & lifecycle (spec: Streamable HTTP) ----
  let r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: ACCEPT, Origin: "https://evil.example" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  assert.equal(r.status, 403); ok("foreign Origin is rejected with 403 (DNS-rebinding protection)");
  r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: ACCEPT }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(r.status, 400); ok("non-initialize request without a session gets 400");

  const c = await new Client({ elicitation: {}, extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app"] } } }).init();
  assert.ok(c.sid && /^[\x21-\x7e]+$/.test(c.sid)); ok("session id issued (visible ASCII) in MCP-Session-Id");
  assert.equal(c.initResult.protocolVersion, "2025-11-25"); ok("negotiates protocol 2025-11-25");
  assert.ok(c.initResult.capabilities.resources.subscribe); ok("server advertises resource subscriptions");

  r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { ...c.headers(), "MCP-Protocol-Version": "1999-01-01" }, body: JSON.stringify({ jsonrpc: "2.0", id: 99, method: "tools/list" }) });
  assert.equal(r.status, 400); ok("unsupported MCP-Protocol-Version gets 400");
  r = await fetch(`${BASE}/mcp`, { method: "POST", headers: { ...c.headers(), "MCP-Session-Id": "nope" }, body: JSON.stringify({ jsonrpc: "2.0", id: 98, method: "tools/list" }) });
  assert.equal(r.status, 404); ok("unknown session id gets 404");

  // ---- Tools, MCP Apps metadata ----
  const tools = (await c.rpc("tools/list")).result.tools; const by = Object.fromEntries(tools.map((t) => [t.name, t]));
  assert.equal(tools.length, 8); ok("8 tools registered");
  assert.equal(by.get_wellbeing_summary._meta.ui.resourceUri, "ui://hearth/dashboard"); ok("tool linked to ui:// resource via _meta.ui.resourceUri");
  assert.deepEqual(by.app_refresh._meta.ui.visibility, ["app"]); ok("app_refresh is app-only (visibility: [\"app\"])");
  const ui = (await c.rpc("resources/read", { uri: "ui://hearth/dashboard" })).result.contents[0];
  assert.equal(ui.mimeType, "text/html;profile=mcp-app"); assert.ok(ui.text.includes("ui/initialize")); ok("ui:// resource served as text/html;profile=mcp-app");
  const sc = (await c.call("get_wellbeing_summary", { days: 7 }));
  assert.ok(sc.structuredContent.summary && sc.content[0].text.includes("Adherence")); ok("UI tool returns text fallback + structuredContent");

  // ---- Business logic ----
  assert.equal((await c.json("list_today")).doses.length, 3);
  assert.equal((await c.json("log_dose", { medication: "metformin" })).ok, true);
  assert.equal((await c.json("log_dose", { medication: "metformin" })).ok, false);
  assert.equal((await c.json("add_medication", { name: "Vitamin D", dose: "1000 IU", times: ["25:00"] })).ok, false);
  const bad = await c.rpc("tools/call", { name: "record_checkin", arguments: { mood: 9 } }); assert.ok(bad.error || bad.result.isError); ok("input validation (bad time, bad mood, double log)");

  // ---- Personalised routine baseline ----
  await api("/api/demo/advance", { minutes: 70 }); // 09:10, no activity, past 08:18 threshold
  const summ = async () => (await c.call("get_wellbeing_summary", { days: 7 })).structuredContent.summary;
  let s = await summ();
  assert.ok(s.flags.some((f) => f.code === "NO_MORNING_ACTIVITY")); assert.equal(s.baseline.alert_after, "08:18"); ok("adaptive baseline flags missing morning activity (usual 07:18, alert after 08:18)");
  await c.json("record_home_signal", { kind: "morning_activity" });
  s = await summ();
  assert.ok(s.flags.some((f) => f.code === "LATE_START")); ok("late start detected after the fact");

  // ---- Elicitation: consent before proactive alerts ----
  let asked = null;
  let n = await c.json("notify_caregiver", { reason: "Lisinopril not taken yet.", severity: "attention" }, async (m) => { asked = m; assert.equal(m.method, "elicitation/create"); return { action: "decline" }; });
  assert.ok(asked && n.declined === true); assert.equal(JSON.parse((await c.rpc("resources/read", { uri: "hearth://live" })).result.contents[0].text).outbox.length, 0);
  ok("proactive alert asks consent via elicitation; decline sends nothing");
  n = await c.json("notify_caregiver", { reason: "Lisinopril not taken yet.", severity: "attention" }, async () => ({ action: "accept", content: { share: true } }));
  assert.equal(n.ok, true); ok("accepting consent sends the alert");
  n = await c.json("notify_caregiver", { reason: "Amina asked for a call.", severity: "attention", requested_by_person: true }, async () => { throw new Error("must not ask"); });
  assert.equal(n.ok, true); ok("explicit request skips consent");
  n = await c.json("notify_caregiver", { reason: "Possible fall reported.", severity: "urgent" }, async () => { throw new Error("must not ask"); });
  assert.equal(n.ok, true); ok("urgent alerts skip consent");

  // ---- Server push over GET SSE + resumability ----
  await c.rpc("resources/subscribe", { uri: "hearth://live" });
  const ac = new AbortController();
  const g = await fetch(`${BASE}/mcp`, { headers: { Accept: "text/event-stream", "MCP-Session-Id": c.sid, "MCP-Protocol-Version": "2025-11-25" }, signal: ac.signal });
  assert.equal(g.status, 200); assert.ok((g.headers.get("content-type") || "").includes("text/event-stream"));
  const live = readMessages(g, null, (m) => m.method === "notifications/resources/updated").catch(() => []);
  await new Promise((r2) => setTimeout(r2, 200)); await c.json("record_checkin", { mood: 3, note: "ok" });
  const got = await Promise.race([live, new Promise((r2) => setTimeout(() => r2([]), 3000))]); ac.abort();
  assert.ok(got.length && got[0].method === "notifications/resources/updated" && got[0].params.uri === "hearth://live"); ok("subscribed client is pushed notifications/resources/updated over GET SSE");
  const lastId = got[0]._eventId; assert.ok(lastId); ok("SSE events carry ids (resumable)");
  await c.json("record_checkin", { mood: 4, note: "while disconnected" });
  await new Promise((r2) => setTimeout(r2, 200));
  const ac2 = new AbortController();
  const g2 = await fetch(`${BASE}/mcp`, { headers: { Accept: "text/event-stream", "MCP-Session-Id": c.sid, "MCP-Protocol-Version": "2025-11-25", "Last-Event-ID": lastId }, signal: ac2.signal });
  const replay = await Promise.race([readMessages(g2, null, (m) => m.method === "notifications/resources/updated").catch(() => []), new Promise((r2) => setTimeout(() => r2([]), 3000))]); ac2.abort();
  assert.ok(replay.length >= 1 && replay[0].method === "notifications/resources/updated"); ok("reconnect with Last-Event-ID replays the missed notification");

  // ---- Agent Skill format ----
  const skill = readFileSync(new URL("./skills/hearth-care/SKILL.md", import.meta.url), "utf8");
  const fm = skill.match(/^---\n([\s\S]*?)\n---/)[1];
  assert.equal((fm.match(/^name: (.+)$/m) || [])[1], "hearth-care"); assert.ok(/^[a-z0-9-]{1,64}$/.test("hearth-care"));
  assert.ok(((fm.match(/^description: (.+)$/m) || [])[1] || "").length > 20 && fm.length < 1100); ok("SKILL.md has valid Agent Skills frontmatter (name matches folder, description present)");

  // ---- Session termination ----
  r = await fetch(`${BASE}/mcp`, { method: "DELETE", headers: c.headers() }); assert.ok([200, 204].includes(r.status));
  r = await fetch(`${BASE}/mcp`, { method: "POST", headers: c.headers(), body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/list" }) });
  assert.equal(r.status, 404); ok("DELETE ends the session; later requests get 404");
  console.log(`\nALL ${results.length} CHECKS PASSED`);
} catch (e) { console.error("\nFAIL:", e.message, "\n", e.stack?.split("\n").slice(1, 4).join("\n")); process.exitCode = 1; }
finally { proc.kill(); setTimeout(() => process.exit(), 100); }
