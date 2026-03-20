export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { keywords, packageId } = req.body;
  if (!keywords?.length || !packageId) {
    return res.status(400).json({ error: "keywords[] and packageId required" });
  }

  const base = getBaseUrl(req);
  const results = {};

  for (const keyword of keywords) {
    try {
      const r = await fetch(`${base}/api/check-rank`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, packageId }),
      });
      results[keyword] = await r.json();
    } catch (e) {
      results[keyword] = { rank: null, found: false, error: e.message, checkedAt: new Date().toISOString() };
    }
    await sleep(600);
  }

  return res.status(200).json({ results });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function getBaseUrl(req) {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  const host = req.headers.host || "localhost:3000";
  return `http://${host}`;
}
