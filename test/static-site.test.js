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
  assert.match(html, /src="\.\/file-types\.js"/);
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
  assert.match(css, /\.header-search-tools \.search-input\s*\{[^}]*min-height:\s*38px;/s);
  assert.match(css, /\.button-icon\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;/s);
});

test("header contains compact search, refresh, theme toggle, and sign-in controls", () => {
  const header = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  assert.match(header, /class="brand-wordmark">PremierPedia/);
  assert.match(header, /id="searchInput"[^>]*placeholder="Search files"/);
  assert.match(header, /id="refreshButton"/);
  assert.match(header, /id="themeToggleButton"[^>]*aria-pressed="false"/);
  assert.match(header, /class="header-sign-in-label">Sign in/);
  assert.match(header, /class="header-utilities"/);
  assert.doesNotMatch(html.slice(html.indexOf("<main")), /id="searchInput"/);
  assert.match(javascript, /ui\.themeToggle\.addEventListener\("click", toggleTheme\)/);
  assert.match(javascript, /function toggleTheme\(\)/);
  assert.match(javascript, /document\.body\.classList\.toggle\("is-dark-mode", state\.isDarkMode\)/);
  assert.match(css, /body\.is-dark-mode\s*\{/);
});

test("file links open displayable formats safely and download other types", () => {
  assert.match(javascript, /fileTypes\.isBrowserOpenable\(path, fileButton\.dataset\.mimeType\)/);
  assert.match(javascript, /window\.open\(getFileUrl\(path\), "_blank", "noopener,noreferrer"\)/);
  assert.match(javascript, /handleDownload\(path, fileButton\.dataset\.fileName\)/);
  assert.match(javascript, /return `\$\{RAW_GITHUB\}\/\$\{REPOSITORY_OWNER\}\/\$\{REPOSITORY_NAME\}/);
  assert.match(javascript, /fileIcon\(item\.name\)/);
});

test("drag-and-drop uses the full selection, restores placeholders, and confirms moves", () => {
  assert.match(html, /<dialog id="moveConfirmationDialog"/);
  assert.match(html, /id="cancelMoveButton"[^>]*autofocus/);
  assert.match(javascript, /state\.draggedPaths = getRootItems\(candidates\)/);
  assert.match(javascript, /state\.draggedRowPaths = candidates\.map/);
  assert.match(javascript, /dataTransfer\.setDragImage\(image, 16, 16\)/);
  assert.match(javascript, /const paths = \[\.\.\.state\.draggedPaths\];\s*clearDragStyles\(\);\s*requestMoveConfirmation\(paths,/);
  assert.match(javascript, /ui\.moveConfirmation\.addEventListener\("close"/);
  assert.match(javascript, /function confirmPendingMove\(\)/);
  assert.match(javascript, /function clearDragStyles\(\)/);
  assert.match(css, /\.file-table tbody tr\.is-dragging > td::after/);
  assert.match(css, /\.drag-count-indicator/);
  assert.match(css, /\.confirmation-dialog::backdrop/);
});

test("move and folder upload controls preserve selection across navigation", () => {
  assert.match(html, /id="moveHereButton"/);
  assert.doesNotMatch(html, /id="renameButton"/);
  assert.match(html, /id="uploadFolderButton"/);
  assert.match(html, /id="folderInput"[^>]*webkitdirectory/);
  assert.match(html, /id="selectionStatus"/);
  assert.match(css, /\.file-table tbody tr\.is-selected/);
  assert.match(css, /\.activity-panel\.is-minimized \.activity-items\s*\{\s*display:\s*none;/);
  assert.match(javascript, /ui\.folderInput\.addEventListener\("change", \(event\) => handleUpload\(event, true\)\)/);
  assert.match(javascript, /finishActivity\("Files Moved"/);
  assert.match(javascript, /finishActivity\("Files Deleted"/);
  assert.match(javascript, /"Upload Completed"/);
  assert.match(javascript, /async function handleRenameItem\(path\)/);
  assert.match(javascript, /className = "inline-rename-button"/);
  assert.match(javascript, /renameButton\.dataset\.renamePath = item\.relativePath/);
  assert.match(javascript, /apiRequest\("\/api\/docs\/rename"/);
  const folderNavigation = javascript.slice(
    javascript.indexOf("ui.rows.addEventListener(\"click\""),
    javascript.indexOf("function toggleDemoAdmin")
  );
  assert.match(folderNavigation, /if \(event\.target\.closest\('input\[type="checkbox"\]'\)\) return/);
  assert.match(folderNavigation, /event\.target\.closest\("button\[data-folder-path\]"\)/);
  assert.match(javascript, /selectionFolder: null/);
  assert.match(javascript, /checkbox\.disabled = selectionLocked/);
  assert.match(javascript, /state\.selectionFolder !== state\.currentFolder/);
  assert.match(javascript, /ui\.createFolder\.hidden = !state\.isDemoAdmin \|\| destinationMode/);
});

test("toolbar controls use compact dimensions and search input is shorter", () => {
  assert.match(css, /\.search-input\s*\{[^}]*min-height:\s*36px;/s);
  assert.match(css, /\.button\s*\{[^}]*min-height:\s*34px;[^}]*padding:\s*0 10px;/s);
  assert.match(css, /\.toolbar\s*\{[^}]*padding:\s*12px 16px;/s);
});

test("reload uses one curved arrow and admin rows support drag-and-drop moves", () => {
  const reloadButton = html.match(/<button id="refreshButton"[\s\S]*?<\/button>/)?.[0];
  assert.ok(reloadButton);
  assert.match(reloadButton, /<path d="M20 11a8 8 0 1 1-2\.34-5\.66L20 8"/);
  assert.match(reloadButton, /<path d="M20 4v4h-4"/);
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
  assert.match(javascript, /month: "short"/);
  assert.match(javascript, /hour: "numeric"/);
  assert.match(javascript, /minute: "2-digit"/);
  assert.match(css, /\.created-on-cell \.relative-date/);
  assert.match(css, /\.created-on-cell > span:first-child\s*\{[^}]*font-size:\s*0\.84rem;[^}]*font-weight:\s*600;/s);
  assert.match(css, /\.created-on-cell \.relative-date\s*\{[^}]*font-size:\s*0\.65rem;/s);
});

test("folders stay before files for every sort mode", () => {
  const sortItems = javascript.slice(
    javascript.indexOf("function sortItems(items)"),
    javascript.indexOf("function compareNullable")
  );
  assert.match(sortItems, /if \(left\.kind !== right\.kind\)\s*\{\s*return left\.kind === "folder" \? -1 : 1;\s*\}/);
  assert.doesNotMatch(sortItems, /state\.fileSort === "name-asc"[^}]+left\.kind/);
});
