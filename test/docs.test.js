"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildItemsFromTree, getTypeLabel, validateRelativePath } = require("../lib/docs");

test("empty GitHub tree produces a valid empty docs listing", () => {
  assert.deepEqual(buildItemsFromTree([], "docs", {
    owner: "PremierPediaDev",
    repository: "PremierPedia",
    branch: "main"
  }), []);
});

test("recursive tree entries produce parent folders and file metadata", () => {
  const items = buildItemsFromTree([
    { path: "docs/Policies/installation.pdf", type: "blob", size: 1200, sha: "file-sha" },
    { path: "docs/Policies/Nested/guide.txt", type: "blob", size: 12, sha: "nested-sha" }
  ], "docs", { owner: "PremierPediaDev", repository: "PremierPedia", branch: "main" });

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
  ], "docs", { owner: "PremierPediaDev", repository: "PremierPedia", branch: "main" });

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
