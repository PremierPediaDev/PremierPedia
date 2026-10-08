"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildItemsFromTree, getTypeLabel, validateRelativePath } = require("../lib/docs");
const { getInlineContentType, normalizeDocsPath } = require("../server");
const fileTypes = require("../file-types");

test("empty GitHub tree produces a valid empty docs listing", () => {
  assert.deepEqual(buildItemsFromTree([], "docs"), []);
});

test("recursive tree entries produce parent folders and file metadata", () => {
  const items = buildItemsFromTree([
    { path: "docs/Policies/installation.pdf", type: "blob", size: 1200, sha: "file-sha" },
    { path: "docs/Policies/Nested/guide.txt", type: "blob", size: 12, sha: "nested-sha" }
  ], "docs");

  assert.deepEqual(items.map(({ path, kind }) => [path, kind]), [
    ["docs/Policies", "folder"],
    ["docs/Policies/Nested", "folder"],
    ["docs/Policies/installation.pdf", "file"],
    ["docs/Policies/Nested/guide.txt", "file"]
  ]);
  assert.equal(items.find((item) => item.name === "installation.pdf").size, 1200);
  assert.equal(items.find((item) => item.name === "guide.txt").parentPath, "Policies/Nested");
});

test("gitkeep markers create folders without appearing as files", () => {
  const items = buildItemsFromTree([
    { path: "docs/Empty/.gitkeep", type: "blob", size: 0, sha: "marker-sha" },
    { path: "docs/Visible/.gitkeep-not", type: "blob", size: 1, sha: "file-sha" }
  ], "docs");

  assert.deepEqual(items.map(({ relativePath, kind }) => [relativePath, kind]), [
    ["Empty", "folder"],
    ["Visible", "folder"],
    ["Visible/.gitkeep-not", "file"]
  ]);
});

test("file type labels and safe relative-path validation work", () => {
  assert.equal(getTypeLabel("docs/file.PDF"), "PDF");
  assert.equal(getTypeLabel("docs/no-extension"), "FILE");
  assert.equal(validateRelativePath("Policies/installation.pdf"), "Policies/installation.pdf");
  for (const invalid of ["", "../secrets", "Policies/../../secrets", "/absolute", "bad\\path"]) {
    assert.throws(() => validateRelativePath(invalid));
  }
});

test("the renamed repository folder is a valid docs root", () => {
  assert.equal(normalizeDocsPath("PremierPedia"), "PremierPedia");
});

test("browser-safe file formats are served inline and unknown formats download", () => {
  assert.equal(getInlineContentType("guide.txt"), "text/plain; charset=utf-8");
  assert.equal(getInlineContentType("manual.pdf"), "application/pdf");
  assert.equal(getInlineContentType("clip.mp4"), "video/mp4");
  assert.equal(getInlineContentType("photo.webp"), "image/webp");
  assert.equal(getInlineContentType("script.html"), "text/html; charset=utf-8");
  assert.equal(getInlineContentType("icon.svg"), "image/svg+xml");
  assert.equal(getInlineContentType("report.docx"), null);
  assert.equal(getInlineContentType("remote.rdp"), null);
});

test("file types classify displayable files and provide specific icons", () => {
  for (const extension of [
    "pdf", "txt", "html", "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp",
    "mp3", "wav", "ogg", "mp4", "webm", "mov", "json", "xml", "csv"
  ]) {
    assert.equal(fileTypes.isBrowserOpenable(`multiple.parts.${extension.toUpperCase()}`), true, extension);
  }
  for (const extension of ["doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "rar", "7z", "tar", "gz"]) {
    assert.equal(fileTypes.isBrowserOpenable(`file.${extension}`), false, extension);
  }
  assert.equal(fileTypes.isBrowserOpenable("Annual.report.PDF"), true);
  assert.equal(fileTypes.isBrowserOpenable("notes.unknown"), false);
  assert.equal(fileTypes.isBrowserOpenable("no-extension"), false);
  assert.equal(fileTypes.isBrowserOpenable("photo.jpg", "image/png"), true);
  assert.equal(fileTypes.isBrowserOpenable("photo.png", "application/vnd.ms-excel"), false);
  const iconTypesByExtension = {
    pdf: "pdf", txt: "text", doc: "word", docx: "word",
    xls: "spreadsheet", xlsx: "spreadsheet", ppt: "presentation", pptx: "presentation",
    csv: "csv", jpg: "image", jpeg: "image", png: "image", gif: "image", webp: "image",
    svg: "image", mp3: "audio", wav: "audio", ogg: "audio", mp4: "video", webm: "video",
    mov: "video", zip: "archive", rar: "archive", "7z": "archive", tar: "archive",
    gz: "archive", json: "data", xml: "data", html: "code", css: "code", js: "code", ts: "code"
  };
  for (const [extension, iconType] of Object.entries(iconTypesByExtension)) {
    assert.equal(fileTypes.getIconType(`file.with.dots.${extension.toUpperCase()}`), iconType, extension);
  }
  assert.equal(fileTypes.getIconType("no-extension"), "generic");
  assert.equal(fileTypes.getIconType("folder"), "generic");
});
