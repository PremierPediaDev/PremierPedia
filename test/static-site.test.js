"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "index.css"), "utf8");
const javascript = fs.readFileSync(path.join(root, "index.js"), "utf8");

test("static site resolves assets and repository data without a local API server", () => {
  assert.match(html, /href="\.\/index\.css"/);
  assert.match(html, /src="\.\/index\.js"/);
  assert.match(javascript, /const REPOSITORY_OWNER = "PremierPediaDev"/);
  assert.match(javascript, /const REPOSITORY_NAME = "PremierPedia"/);
  assert.match(javascript, /const REPOSITORY_BRANCH = "main"/);
  assert.match(javascript, /const DOCUMENTS_PATH = "PremierPedia"/);
  assert.match(javascript, /https:\/\/api\.github\.com/);
  assert.match(javascript, /https:\/\/raw\.githubusercontent\.com/);
  assert.doesNotMatch(javascript, /fetch\(\s*["'`]\/api\//);
});

test("SVGs retain bounded default sizing if an icon class rule is missing", () => {
  assert.match(css, /svg\s*\{[^}]*width:\s*1rem;[^}]*height:\s*1rem;/s);
  assert.match(css, /\.search-wrap\s*>\s*\.search-icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
  assert.match(css, /\.button-icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
});

test("move and folder upload controls preserve selection across navigation", () => {
  assert.match(html, /id="moveHereButton"/);
  assert.match(html, /id="uploadFolderButton"/);
  assert.match(html, /id="folderInput"[^>]*webkitdirectory/);
  assert.match(html, /id="selectionStatus"/);
  assert.match(css, /\.file-table tbody tr\.is-selected/);
  assert.match(css, /\.activity-panel\.is-minimized \.activity-items\s*\{\s*display:\s*none;/);
  assert.match(javascript, /ui\.folderInput\.addEventListener\("change", \(event\) => handleUpload\(event, true\)\)/);
  assert.match(javascript, /finishActivity\("Files Moved"/);
  assert.match(javascript, /finishActivity\("Files Deleted"/);
  assert.match(javascript, /"Upload Completed"/);
  const folderNavigation = javascript.slice(
    javascript.indexOf("ui.rows.addEventListener(\"click\""),
    javascript.indexOf("function toggleDemoAdmin")
  );
  assert.doesNotMatch(folderNavigation, /state\.selected\.clear\(\)/);
});

test("reload uses one curved arrow and admin rows support drag-and-drop moves", () => {
  const reloadButton = html.match(/<button id="refreshButton"[\s\S]*?<\/button>/)?.[0];
  assert.ok(reloadButton);
  assert.match(reloadButton, /<path d="M20 12a8 8 0 1 1-8-8M8 8l4-4 4 4"/);
  assert.doesNotMatch(reloadButton, /M20 7v5h-5[\s\S]*M4 17/);
  assert.match(javascript, /ui\.rows\.addEventListener\("dragstart"/);
  assert.match(javascript, /ui\.rows\.addEventListener\("drop"/);
  assert.match(javascript, /ui\.breadcrumbs\.addEventListener\("drop"/);
  assert.match(javascript, /applyLocalMove\(movable, destination\)/);
  assert.match(css, /\.file-table tbody tr\.is-drop-target/);
});

test("created dates load for all items and render timestamps with relative ages", () => {
  assert.match(html, /<th>Created On<\/th>/);
  assert.match(html, /Created On \(newest\)/);
  assert.match(javascript, /const pendingItems = items\.filter\(\(item\) => !item\.createdOn\)/);
  assert.match(javascript, /url\.searchParams\.set\("path", item\.path\)/);
  assert.match(javascript, /const dateValue = formatDateTime\(item\.createdOn\)/);
  assert.match(javascript, /relativeDate\.textContent = formatRelativeTime\(item\.createdOn\)/);
  assert.match(javascript, /hourCycle: "h23"/);
  assert.match(javascript, /return `\$\{part\("month"\)\}\/\$\{part\("day"\)\}\/\$\{part\("year"\)\} \$\{part\("hour"\)\}:\$\{part\("minute"\)\}:\$\{part\("second"\)\}`/);
  assert.match(css, /\.created-on-cell \.relative-date/);
});
