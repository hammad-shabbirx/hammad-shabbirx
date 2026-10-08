/**
 * Render an all-time GitHub stats card (SVG) that includes private work.
 *
 *   GH_TOKEN=<token> GH_USER=<login> node stats-card.mjs dist/github-stats.svg
 *
 * Public stats services only see public repositories. This queries the
 * GitHub GraphQL API directly:
 *   - with a personal access token (secret STATS_TOKEN, scopes: repo,
 *     read:user) commits/PRs/reviews/issues include private and
 *     organization repositories;
 *   - with the default workflow token, private work still shows up in the
 *     totals as "private contributions" (requires "Private contributions"
 *     to be enabled on the profile), just without the per-type breakdown.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const token = process.env.GH_TOKEN;
const login = process.env.GH_USER;
const out = process.argv[2] || "dist/github-stats.svg";
if (!token || !login) throw new Error("GH_TOKEN and GH_USER are required");

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-stats-card",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(`GraphQL error: ${JSON.stringify(json.errors || json)}`);
  }
  return json.data;
}

const base = await gql(
  `query($login: String!) {
    user(login: $login) {
      name
      createdAt
      contributionsCollection { contributionYears }
      repositoriesContributedTo(
        first: 1
        includeUserRepositories: true
        contributionTypes: [COMMIT, PULL_REQUEST, ISSUE, PULL_REQUEST_REVIEW, REPOSITORY]
      ) { totalCount }
    }
  }`,
  { login },
);

const user = base.user;
const totals = { contributions: 0, commits: 0, prs: 0, reviews: 0, issues: 0, restricted: 0 };
for (const year of user.contributionsCollection.contributionYears) {
  const from = `${year}-01-01T00:00:00Z`;
  const to = `${year}-12-31T23:59:59Z`;
  const { user: y } = await gql(
    `query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          totalCommitContributions
          totalPullRequestContributions
          totalPullRequestReviewContributions
          totalIssueContributions
          restrictedContributionsCount
          contributionCalendar { totalContributions }
        }
      }
    }`,
    { login, from, to },
  );
  const c = y.contributionsCollection;
  totals.contributions += c.contributionCalendar.totalContributions;
  totals.commits += c.totalCommitContributions;
  totals.prs += c.totalPullRequestContributions;
  totals.reviews += c.totalPullRequestReviewContributions;
  totals.issues += c.totalIssueContributions;
  totals.restricted += c.restrictedContributionsCount;
}

const fmt = (n) => n.toLocaleString("en-US");
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);
const first = (user.name || login).split(" ")[0];

const rows = [
  ["Commits", totals.commits],
  ["Pull Requests", totals.prs],
  ["Code Reviews", totals.reviews],
  ["Issues", totals.issues],
  ["Repos Contributed To", user.repositoriesContributedTo.totalCount],
];
// Without a personal token, private work is only available as a total.
if (totals.restricted > 0) rows.push(["Private Contributions", totals.restricted]);

const rowH = 26;
const top = 66;
const height = Math.max(195, top + rows.length * rowH + 14);
const rowsSvg = rows
  .map(
    ([label, value], i) => `
    <g transform="translate(25, ${top + i * rowH})">
      <circle cx="6" cy="-5" r="4.5" fill="#bf91f3" />
      <text x="20" y="0" class="label">${esc(label)}:</text>
      <text x="215" y="0" class="value">${fmt(value)}</text>
    </g>`,
  )
  .join("");

const since = new Date(user.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" });
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="${height}" viewBox="0 0 495 ${height}" role="img" aria-label="${esc(first)}'s GitHub stats">
  <style>
    .title { font: 600 19px 'Segoe UI', Ubuntu, sans-serif; fill: #70a5fd; }
    .label { font: 600 14px 'Segoe UI', Ubuntu, sans-serif; fill: #38bdae; }
    .value { font: 700 14px 'Segoe UI', Ubuntu, sans-serif; fill: #c0caf5; }
    .big { font: 800 30px 'Segoe UI', Ubuntu, sans-serif; fill: #70a5fd; }
    .small { font: 600 12px 'Segoe UI', Ubuntu, sans-serif; fill: #38bdae; }
    .muted { font: 400 11px 'Segoe UI', Ubuntu, sans-serif; fill: #8b93b8; }
  </style>
  <rect x="0.5" y="0.5" width="494" height="${height - 1}" rx="6" fill="#1a1b27" />
  <text x="25" y="38" class="title">${esc(first)}'s GitHub Stats</text>
  ${rowsSvg}
  <g transform="translate(395, ${height / 2 - 8})">
    <circle r="56" fill="none" stroke="#2a2e45" stroke-width="7" />
    <circle r="56" fill="none" stroke="#bf91f3" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="300 352" transform="rotate(-90)" />
    <text y="6" text-anchor="middle" class="big">${fmt(totals.contributions)}</text>
    <text y="26" text-anchor="middle" class="small">contributions</text>
    <text y="80" text-anchor="middle" class="muted">all time · since ${esc(since)}</text>
  </g>
</svg>
`;

await mkdir(dirname(out), { recursive: true });
await writeFile(out, svg);
console.log(`Wrote ${out}`, totals, "repos:", user.repositoriesContributedTo.totalCount);
