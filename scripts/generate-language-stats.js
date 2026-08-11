const fs = require("fs");
const path = require("path");
const https = require("https");

const USERNAME = "Haruto69";
const OUTPUT_PATH = path.join("assets", "language-stats.svg");

const COLORS = {
  TypeScript: "#3178c6",
  JavaScript: "#f7df1e",
  Java: "#f89820",
  Python: "#3776ab",
  HTML: "#e34c26",
  CSS: "#663399",
  Shell: "#89e051",
  Mermaid: "#ff3670",
  C: "#555555",
  "C++": "#f34b7d"
};

function requestJson(url) {
  const token = process.env.GITHUB_TOKEN;
  const headers = {
    "User-Agent": "Haruto69-profile-readme",
    "Accept": "application/vnd.github+json"
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        if (res.statusCode >= 300) {
          reject(new Error(`GitHub API error ${res.statusCode}: ${data}`));
          return;
        }
        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function svgCard(rows, total) {
  const W = 940;
  const H = 600;
  const barW = 710;
  const rowGap = 57;
  const startY = 158;
  const maxPct = Math.max(...rows.map(([, value]) => value / total * 100), 40);

  const rowSvg = rows.map(([name, value], index) => {
    const pct = value / total * 100;
    const y = startY + index * rowGap;
    const fillW = Math.max(3, Math.round(barW * pct / maxPct));
    const color = COLORS[name] || "#b388ff";

    return `
<text x="74" y="${y + 18}" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="17" font-weight="700">${escapeXml(name)}</text>
<text x="840" y="${y + 18}" fill="#d9e6ff" font-family="Segoe UI, Arial, sans-serif" font-size="17" font-weight="700" text-anchor="end">${pct.toFixed(1)}%</text>
<rect x="74" y="${y + 27}" width="${barW}" height="22" rx="11" fill="#151629" stroke="#303453"/>
<rect x="74" y="${y + 27}" width="${fillW}" height="22" rx="11" fill="${color}">
  <animate attributeName="width" from="0" to="${fillW}" dur="0.9s" fill="freeze"/>
</rect>`;
  }).join("\n");

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
<title id="title">Language Footprint</title>
<desc id="desc">Language breakdown generated from GitHub repository language data.</desc>
<defs>
  <linearGradient id="cardBg" x1="0" y1="0" x2="${W}" y2="${H}" gradientUnits="userSpaceOnUse">
    <stop stop-color="#0a0a1a"/>
    <stop offset="0.52" stop-color="#111327"/>
    <stop offset="1" stop-color="#061827"/>
  </linearGradient>
  <linearGradient id="accent" x1="74" y1="64" x2="866" y2="64" gradientUnits="userSpaceOnUse">
    <stop stop-color="#6a1b9a"/>
    <stop offset="1" stop-color="#00d9ff"/>
  </linearGradient>
  <filter id="softGlow" x="-20%" y="-200%" width="140%" height="500%">
    <feGaussianBlur stdDeviation="3" result="blur"/>
    <feMerge>
      <feMergeNode in="blur"/>
      <feMergeNode in="SourceGraphic"/>
    </feMerge>
  </filter>
</defs>

<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="26" fill="url(#cardBg)" stroke="#6a1b9a" stroke-opacity="0.8"/>
<rect x="74" y="64" width="792" height="5" rx="2.5" fill="url(#accent)" filter="url(#softGlow)"/>

<text x="74" y="118" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif" font-size="34" font-weight="700">Language Footprint</text>
<text x="74" y="145" fill="#9befff" font-family="Segoe UI, Arial, sans-serif" font-size="16">Based on GitHub language data from public repositories</text>
${rowSvg}
</svg>
`;
}

async function main() {
  const repos = await requestJson(`https://api.github.com/users/${USERNAME}/repos?per_page=100&type=owner&sort=updated`);

  const totals = {};
  for (const repo of repos) {
    if (repo.fork || repo.archived) continue;

    const languages = await requestJson(repo.languages_url);
    for (const [language, bytes] of Object.entries(languages)) {
      totals[language] = (totals[language] || 0) + bytes;
    }
  }

  const total = Object.values(totals).reduce((sum, value) => sum + value, 0);
  const rows = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, svgCard(rows, total), "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
