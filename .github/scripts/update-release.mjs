import fs from "node:fs";

const owner = "peeldok";
const repo = "Midi-Fighter-64-CFW";

const api =
  `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "MF64-Web-Release-Updater"
};

if (process.env.GH_TOKEN) {
  headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;
}

const response = await fetch(api, { headers });

if (!response.ok) {
  throw new Error(`GitHub API ${response.status}`);
}

const release = await response.json();
const assets = Array.isArray(release.assets) ? release.assets : [];

const asset =
  assets.find(a => /^latest\.hex$/i.test(a.name)) ||
  assets.find(a => /\.hex$/i.test(a.name));

if (!asset) {
  throw new Error("No HEX asset found");
}

const hexResponse = await fetch(asset.browser_download_url);

if (!hexResponse.ok) {
  throw new Error(`HEX download failed: ${hexResponse.status}`);
}

const hexData = Buffer.from(await hexResponse.arrayBuffer());

fs.mkdirSync("firmware", { recursive: true });
fs.writeFileSync("firmware/latest.hex", hexData);

const tag = release.tag_name || "";
const version = tag.replace(/^v/i, "") || release.name || "Latest";

const metadata = {
  version,
  tag,
  filename: asset.name,
  downloadUrl: "./firmware/latest.hex",
  releaseUrl: release.html_url || "",
  publishedAt: release.published_at || "",
  updatedAt: new Date().toISOString()
};

fs.writeFileSync(
  "release.json",
  JSON.stringify(metadata, null, 2) + "\n"
);

console.log(metadata);
