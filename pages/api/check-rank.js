// pages/api/check-rank.js
// Scrapes Google Play Store search results to find the real rank of an app

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { keyword, packageId } = req.body;
  if (!keyword || !packageId) return res.status(400).json({ error: "keyword and packageId required" });

  try {
    const results = await scrapePlayStoreRank(keyword, packageId);
    return res.status(200).json(results);
  } catch (err) {
    console.error("Scrape error:", err.message);
    return res.status(500).json({ error: err.message, rank: null, found: false });
  }
}

async function scrapePlayStoreRank(keyword, packageId) {
  const encodedKeyword = encodeURIComponent(keyword);

  // Try multiple scraping strategies
  const strategies = [
    () => scrapeViaSearchAPI(keyword, packageId),
    () => scrapeViaHTML(encodedKeyword, packageId),
  ];

  let lastError;
  for (const strategy of strategies) {
    try {
      const result = await strategy();
      if (result) return result;
    } catch (e) {
      lastError = e;
    }
  }

  return { rank: null, found: false, totalScanned: 0, error: lastError?.message || "Not found in top 30" };
}

// Strategy 1: Use Play Store search JSON endpoint (itemprop based)
async function scrapeViaSearchAPI(keyword, packageId) {
  const url = `https://play.google.com/store/search?q=${encodeURIComponent(keyword)}&c=apps&hl=en&gl=US`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
    },
    redirect: "follow",
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();

  // Extract package IDs from href links like /store/apps/details?id=com.example
  const packageRegex = /\/store\/apps\/details\?id=([a-zA-Z0-9._]+)/g;
  const found = [];
  let match;
  const seen = new Set();

  while ((match = packageRegex.exec(html)) !== null) {
    const pkg = match[1];
    if (!seen.has(pkg)) {
      seen.add(pkg);
      found.push(pkg);
    }
  }

  // Remove the search keyword's own page if it appears
  const appResults = found.filter(p => !p.includes("collection") && !p.includes("genre"));

  const rank = appResults.findIndex(p => p === packageId);

  if (rank !== -1) {
    return {
      rank: rank + 1,
      found: true,
      totalScanned: appResults.length,
      results: appResults.slice(0, 30),
    };
  }

  // Not found in top results
  return {
    rank: null,
    found: false,
    totalScanned: appResults.length,
    results: appResults.slice(0, 30),
  };
}

// Strategy 2: Try alternate HTML scraping with different UA
async function scrapeViaHTML(encodedKeyword, packageId) {
  const url = `https://play.google.com/store/search?q=${encodedKeyword}&c=apps&hl=en_US`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Accept": "text/html",
      "Accept-Language": "en-US,en;q=0.5",
    },
  });

  const html = await response.text();

  // Extract all unique package IDs
  const ids = [];
  const seen = new Set();
  const re = /details\?id=([a-zA-Z0-9._]+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  }

  const rank = ids.findIndex(p => p === packageId);
  return {
    rank: rank !== -1 ? rank + 1 : null,
    found: rank !== -1,
    totalScanned: ids.length,
    results: ids.slice(0, 30),
  };
}
