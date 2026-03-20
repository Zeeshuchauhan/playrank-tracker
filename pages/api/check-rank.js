export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { keyword, packageId } = req.body;
  if (!keyword || !packageId) return res.status(400).json({ error: "keyword and packageId required" });

  try {
    const result = await scrapeRank(keyword, packageId);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ rank: null, found: false, error: err.message, totalScanned: 0 });
  }
}

async function scrapeRank(keyword, packageId) {
  const url = `https://play.google.com/store/search?q=${encodeURIComponent(keyword)}&c=apps&hl=en&gl=US`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Upgrade-Insecure-Requests": "1",
    },
  });

  if (!response.ok) throw new Error(`Play Store returned HTTP ${response.status}`);

  const html = await response.text();

  const seen = new Set();
  const packages = [];
  const re = /\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const pkg = m[1];
    if (!seen.has(pkg)) {
      seen.add(pkg);
      packages.push(pkg);
    }
  }

  const idx = packages.findIndex(p => p === packageId);

  return {
    rank: idx !== -1 ? idx + 1 : null,
    found: idx !== -1,
    totalScanned: packages.length,
    checkedAt: new Date().toISOString(),
  };
}
