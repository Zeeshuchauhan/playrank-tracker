
// pages/api/bulk-check.js
// Checks multiple keywords for a single app sequentially

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { keywords, packageId } = req.body;
  if (!keywords || !packageId) return res.status(400).json({ error: "keywords[] and packageId required" });

  const results = {};

  for (const keyword of keywords) {
    try {
      const url = `${getBaseUrl(req)}/api/check-rank`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword, packageId }),
      });
      const data = await r.json();
      results[keyword] = data;
    } catch (e) {
      results[keyword] = { rank: null, found: false, error: e.message };
    }

    // Small delay between requests to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 800));
  }

  return res.status(200).json({ results });
}

function getBaseUrl(req) {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}
