import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const token = process.env.GITHUB_TOKEN;
const username = process.env.GITHUB_USERNAME;

if (!token) {
  throw new Error("GITHUB_TOKEN is required to retrieve GitHub contribution data.");
}

if (!username) {
  throw new Error("GITHUB_USERNAME is required to retrieve GitHub contribution data.");
}

if (!/^[A-Za-z0-9-]{1,39}$/.test(username)) {
  throw new Error("GITHUB_USERNAME is not a valid GitHub login.");
}

const DAY_MS = 24 * 60 * 60 * 1000;
const endDate = new Date();
const endDay = endDate.toISOString().slice(0, 10);
const startDate = new Date(`${endDay}T00:00:00.000Z`);
startDate.setUTCDate(startDate.getUTCDate() - 30);
const startDay = startDate.toISOString().slice(0, 10);

const from = `${startDay}T00:00:00.000Z`;
const to = `${endDay}T23:59:59.999Z`;

const query = `
  query ActivitySignal($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "Haruto69-activity-signal-generator",
    "X-GitHub-Api-Version": "2022-11-28",
  },
  body: JSON.stringify({ query, variables: { login: username, from, to } }),
});

if (!response.ok) {
  throw new Error(`GitHub GraphQL request failed with HTTP ${response.status}.`);
}

const payload = await response.json();

if (payload.errors?.length) {
  const message = String(payload.errors[0]?.message ?? "Unknown GraphQL error").replaceAll(token, "[REDACTED]");
  throw new Error(`GitHub GraphQL returned an error: ${message}`);
}

const weeks = payload.data?.user?.contributionsCollection?.contributionCalendar?.weeks;

if (!Array.isArray(weeks)) {
  throw new Error(`No contribution calendar was returned for ${username}.`);
}

const returnedDays = new Map(
  weeks
    .flatMap((week) => week.contributionDays ?? [])
    .filter((day) => typeof day.date === "string" && Number.isInteger(day.contributionCount))
    .map((day) => [day.date, day.contributionCount]),
);

const days = Array.from({ length: 31 }, (_, index) => {
  const date = new Date(startDate.getTime() + index * DAY_MS).toISOString().slice(0, 10);
  if (!returnedDays.has(date)) {
    throw new Error(`GitHub did not return an explicit contribution value for ${date}.`);
  }
  return { date, count: returnedDays.get(date) };
});

if (days.length !== 31 || days[0].date !== startDay || days.at(-1).date !== endDay) {
  throw new Error("The normalized contribution window is not exactly 31 chronological days.");
}

const total = days.reduce((sum, day) => sum + day.count, 0);
const peak = Math.max(...days.map((day) => day.count));
const peakDate = days.find((day) => day.count === peak)?.date;
const average = (total / days.length).toFixed(1);

const WIDTH = 1200;
const HEIGHT = 320;
const plot = { left: 72, right: 1140, top: 100, bottom: 244 };
const plotWidth = plot.right - plot.left;
const plotHeight = plot.bottom - plot.top;
const scaleMax = Math.max(peak, 1);
const xFor = (index) => plot.left + (index / 30) * plotWidth;
const yFor = (count) => plot.bottom - (count / scaleMax) * plotHeight;
const fmt = (value) => Number(value.toFixed(2));
const points = days.map((day, index) => ({ ...day, x: fmt(xFor(index)), y: fmt(yFor(day.count)) }));
const pointList = points.map((point) => `${point.x},${point.y}`).join(" ");
const areaPath = `M ${points[0].x} ${plot.bottom} ${points.map((point) => `L ${point.x} ${point.y}`).join(" ")} L ${points.at(-1).x} ${plot.bottom} Z`;
const labelIndexes = [0, 7, 15, 23, 30];
const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const formatDate = (isoDate) => {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  return `${String(date.getUTCDate()).padStart(2, "0")} ${monthNames[date.getUTCMonth()]}`;
};

const gridLines = Array.from({ length: 5 }, (_, index) => {
  const y = fmt(plot.top + (index / 4) * plotHeight);
  return `<line x1="${plot.left}" y1="${y}" x2="${plot.right}" y2="${y}" />`;
}).join("");

const dateMarkers = labelIndexes.map((index) => {
  const point = points[index];
  const anchor = index === 0 ? "start" : index === 30 ? "end" : "middle";
  return `<g><line x1="${point.x}" y1="${plot.top}" x2="${point.x}" y2="${plot.bottom}"/><text x="${point.x}" y="274" text-anchor="${anchor}">${formatDate(point.date)}</text></g>`;
}).join("");

const pointElements = points.map((point, index) => {
  const latest = index === points.length - 1;
  return `<circle class="point${latest ? " latest" : ""}" data-date="${point.date}" data-count="${point.count}" cx="${point.x}" cy="${point.y}" r="${latest ? 5 : 2.8}"/>`;
}).join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-labelledby="title desc">
  <title id="title">Activity Signal for ${username}</title>
  <desc id="desc">GitHub contribution activity for ${username} across the last 31 days, from ${startDay} through ${endDay}.</desc>
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#11161d"/><stop offset=".58" stop-color="#0d1117"/><stop offset="1" stop-color="#150f1f"/></linearGradient>
    <linearGradient id="line" x1="0" x2="1"><stop stop-color="#00d9ff"/><stop offset=".72" stop-color="#b388ff"/><stop offset="1" stop-color="#00d9ff"/></linearGradient>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#6a1b9a" stop-opacity=".42"/><stop offset="1" stop-color="#6a1b9a" stop-opacity=".02"/></linearGradient>
    <linearGradient id="sweep" x1="0" x2="1"><stop stop-color="#00d9ff" stop-opacity="0"/><stop offset=".5" stop-color="#00d9ff" stop-opacity=".18"/><stop offset="1" stop-color="#b388ff" stop-opacity="0"/></linearGradient>
    <filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    <clipPath id="plot-clip"><rect x="${plot.left}" y="${plot.top}" width="${plotWidth}" height="${plotHeight}"/></clipPath>
  </defs>
  <style>
    .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}.grid line,.dates line{stroke:#30363d;stroke-width:1}.dates line{opacity:.45}.dates text{fill:#8b949e;font:9px ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;letter-spacing:1px}.area{fill:url(#area)}.activity-line{fill:none;stroke:url(#line);stroke-width:3;stroke-linejoin:round;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;animation:draw 2.8s ease-out forwards}.point{fill:#0d1117;stroke:#00d9ff;stroke-width:1.5}.latest{fill:#b388ff;stroke:#00d9ff;stroke-width:2;filter:url(#glow);animation:pulse 3s ease-in-out infinite}.signal-sweep{animation:sweep 9s ease-in-out infinite}.status{animation:status 3.4s ease-in-out infinite}
    @keyframes draw{to{stroke-dashoffset:0}}@keyframes pulse{0%,100%{opacity:.55;transform:scale(.85);transform-origin:${points.at(-1).x}px ${points.at(-1).y}px}50%{opacity:1;transform:scale(1.25);transform-origin:${points.at(-1).x}px ${points.at(-1).y}px}}@keyframes sweep{0%,100%{transform:translateX(-180px);opacity:0}20%,80%{opacity:.6}50%{transform:translateX(1190px);opacity:.18}}@keyframes status{0%,100%{opacity:.4}50%{opacity:1}}
    @media(prefers-reduced-motion:reduce){.activity-line{stroke-dashoffset:0}.activity-line,.latest,.signal-sweep,.status{animation:none}}
  </style>
  <rect x="1" y="1" width="1198" height="318" rx="12" fill="url(#panel)" stroke="#30363d"/>
  <path d="M1 42V13Q1 1 13 1h130M1057 1h130q12 0 12 12v29M1 278v29q0 12 12 12h130M1057 319h130q12 0 12-12v-29" fill="none" stroke="url(#line)" stroke-width="1.5"/>
  <g class="mono"><text x="28" y="34" fill="#00d9ff" font-size="13" letter-spacing="2">ACTIVITY SIGNAL // LAST 31 DAYS</text><text x="1172" y="24" text-anchor="end" fill="#8b949e" font-size="9" letter-spacing="1.2">SOURCE // GITHUB CONTRIBUTIONS</text><text x="1172" y="39" text-anchor="end" fill="#8b949e" font-size="9" letter-spacing="1.2">WINDOW // 31 DAYS</text><circle cx="1032" cy="35" r="3" fill="#00d9ff" class="status" filter="url(#glow)"/></g>
  <g class="mono" font-size="10" letter-spacing="1.1"><text x="72" y="72" fill="#c9d1d9">TOTAL // ${total}</text><text x="290" y="72" fill="#c9d1d9">PEAK // ${peak}</text><text x="486" y="72" fill="#c9d1d9">AVG / DAY // ${average}</text><text x="738" y="72" fill="#c9d1d9">PEAK DATE // ${peakDate}</text><text x="1140" y="72" text-anchor="end" fill="#00d9ff">SIGNAL // LIVE</text></g>
  <g class="grid">${gridLines}</g><g class="dates">${dateMarkers}</g>
  <g clip-path="url(#plot-clip)"><path class="area" d="${areaPath}"/><polyline class="activity-line" pathLength="1" points="${pointList}"/>${pointElements}<rect class="signal-sweep" x="${plot.left - 150}" y="${plot.top}" width="150" height="${plotHeight}" fill="url(#sweep)"/></g>
  <g class="mono" fill="#6e7681" font-size="8" letter-spacing="1.2"><text x="28" y="301">CHRONOLOGY // OLDEST → NEWEST</text><text x="1172" y="301" text-anchor="end">DATA POINTS // 31</text></g>
</svg>\n`;

const outputPath = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets", "activity-signal.svg");
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, svg, "utf8");

console.log(`Generated ${outputPath}`);
console.log(`Window: ${startDay} through ${endDay} (${days.length} days)`);
console.log(`Total: ${total}; peak: ${peak} on ${peakDate}; average/day: ${average}`);
