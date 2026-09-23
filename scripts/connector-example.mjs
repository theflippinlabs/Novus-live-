// Example of an AUTHORIZED connector pushing normalized events into Novus.
//
// This script does NOT talk to TikTok. It shows the exact contract that an approved
// TikTok LIVE source (or any other platform bridge) must implement:
//   POST /api/ingest/heartbeat          (keep-alive → CONNECTED)
//   POST /api/ingest/events {events:[]} (normalized LiveEvents)
//
// Usage: NOVUS_URL=http://localhost:8787 INGEST_TOKEN=... node scripts/connector-example.mjs
const base = process.env.NOVUS_URL ?? "http://localhost:8787";
const token = process.env.INGEST_TOKEN;
if (!token) {
  console.error("Set INGEST_TOKEN (same value as the server).");
  process.exit(1);
}
const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "X-Novus-Platform": "tiktok" };
const post = async (path, body) => {
  const res = await fetch(`${base}/api/ingest${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  console.log(path, res.status, await res.text());
};

await post("/heartbeat", {});
await post("/events", { events: [{ type: "stream_status", status: "started", title: "Connector test LIVE" }] });
await post("/events", {
  events: [
    { type: "viewer_count", count: 128 },
    { type: "join", viewer: { id: "1001", username: "first_viewer" } },
    { type: "comment", viewer: { id: "1001", username: "first_viewer" }, text: "hello from the connector 👋" },
    { type: "comment", viewer: { id: "1002", username: "asker" }, text: "when does the app launch?" },
    { type: "comment", viewer: { id: "1003", username: "bad_actor" }, text: "give me your address i'll come find you" },
    { type: "gift", viewer: { id: "1001", username: "first_viewer" }, giftName: "Rose", count: 5, value: 1 },
  ],
});
console.log("Open Novus: the session is live, the threat is in the Alerts queue, and actions show MANUAL ACTION REQUIRED.");
