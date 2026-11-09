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

const MODEL = "claude-sonnet-5-5";
const ACCESS_CODE = process.env.ACCESS_CODE || ""; // optional: stops strangers using your API key

const SYSTEM = `You are a nutrition analyst. Estimate the TOTAL nutrition of the meal for the portion described or shown. You know regional cuisines well, including Indian dishes (dal, roti, biryani, dosa, sabzi, paneer, etc.). Always estimate sodium, sugar and fiber too; do not return 0 for a real dish unless it is truly zero. Reply with ONLY a JSON object, no markdown: {"name":string,"calories":int,"protein_g":number,"carbs_g":number,"fat_g":number,"fiber_g":number,"sugar_g":number,"sodium_mg":number}`;

app.post("/analyze", rateLimit({ windowMs: 60_000, max: 15 }), async (req, res) => {
  if (ACCESS_CODE && req.get("x-access-code") !== ACCESS_CODE) return res.status(401).json({ error: "auth" });
  const { image, note } = req.body ?? {};
  if (!image && !note) return res.status(400).json({ error: "bad request" });
  const content = [];
  if (typeof image === "string") {
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } });
  }
  content.push({ type: "text", text: (image ? "Analyze the meal in the photo." : "Meal description:") +
    (note ? `\nUser note: ${String(note).slice(0, 300)}` : "") });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY,
                 "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 500, system: SYSTEM, messages: [{ role: "user", content }] }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: "upstream" });
    const text = (data.content || []).find(b => b.type === "text")?.text ?? "";
    res.json({ text });
  } catch { res.status(502).json({ error: "upstream" }); }
});

app.listen(process.env.PORT || 3000, () => console.log("CalTrack running"));
