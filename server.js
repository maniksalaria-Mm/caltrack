// One server = your app + the AI endpoint. Deploy once, open the URL on your iPhone.
import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set("trust proxy", 1);
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "public")));

// Tried in order; set MODEL in Render's Environment to force a specific one.
const MODELS = [process.env.MODEL, "claude-sonnet-5-5", "claude-sonnet-4-6", "claude-sonnet-4-5"].filter(Boolean);
const API_KEY = (process.env.ANTHROPIC_API_KEY || "").trim();
const ACCESS_CODE = (process.env.ACCESS_CODE || "").trim(); // optional: stops strangers using your API key

const SYSTEM = `You are a nutrition analyst. Estimate the TOTAL nutrition of the meal for the portion described or shown. You know regional cuisines well, including Indian dishes (dal, roti, biryani, dosa, sabzi, paneer, etc.). Always estimate sodium, sugar and fiber too; do not return 0 for a real dish unless it is truly zero. Reply with ONLY a JSON object, no markdown: {"name":string,"calories":int,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number,"sugar_g":number,"sodium_mg":number}`;

async function askClaude(model, content) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 500, system: SYSTEM, messages: [{ role: "user", content }] }),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

app.post("/analyze", rateLimit({ windowMs: 60_000, max: 15 }), async (req, res) => {
  if (ACCESS_CODE && (req.get("x-access-code") || "").trim() !== ACCESS_CODE) return res.status(401).json({ error: "auth" });
  if (!API_KEY) { console.error("ANTHROPIC_API_KEY is not set"); return res.status(500).json({ error: "no_api_key" }); }
  const { image, note } = req.body ?? {};
  if (!image && !note) return res.status(400).json({ error: "bad request" });
  const content = [];
  if (typeof image === "string") {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } });
  }
  content.push({ type: "text", text: (image ? "Analyze the meal in the photo." : "Meal description:") +
    (note ? `\nUser note: ${String(note).slice(0, 300)}` : "") });
  try {
    let last;
    for (const model of MODELS) {
      last = await askClaude(model, content);
      if (last.ok) {
        const text = (last.data.content || []).find(b => b.type === "text")?.text ?? "";
        return res.json({ text });
      }
      const type = last.data?.error?.type, message = last.data?.error?.message;
      console.error(`Anthropic error (model ${model}): ${last.status} ${type}: ${message}`);
      // Only a wrong model name is worth retrying with the next model.
      const modelProblem = last.status === 404 || /model/i.test(message || "");
      if (!modelProblem) break;
    }
    res.status(502).json({ error: last?.data?.error?.type || "upstream", message: last?.data?.error?.message || "" });
  } catch (e) {
    console.error("Request to Anthropic failed:", e?.message);
    res.status(502).json({ error: "upstream" });
  }
});

app.listen(process.env.PORT || 3000, () => console.log("CalTrack running"));
