"use strict";

function buildItemsFromTree(tree, docsPath, { owner, repository, branch }) {
  const files = tree.filter((entry) =>
    entry.type === "blob" && entry.path.startsWith(`${docsPath}/`)
  );
  const items = new Map();

  for (const file of files) {
    const relativePath = file.path.slice(docsPath.length + 1);
    const segments = relativePath.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const folderPath = segments.slice(0, index).join("/");
      if (!items.has(folderPath)) {
        items.set(folderPath, {
          name: segments[index - 1],
          path: `${docsPath}/${folderPath}`,
          relativePath: folderPath,
          parentPath: folderPath.includes("/") ? folderPath.slice(0, folderPath.lastIndexOf("/")) : "",
          kind: "folder",
          typeLabel: "Folder",
          size: null,
          sha: null,
          htmlUrl: null
        });
      }
    }

    items.set(relativePath, {
      name: segments.at(-1),
      path: file.path,
      relativePath,
      parentPath: segments.length > 1 ? segments.slice(0, -1).join("/") : "",
      kind: "file",
      typeLabel: getTypeLabel(file.path),
      size: Number.isFinite(file.size) ? file.size : null,
      sha: file.sha,
      htmlUrl: `https://github.com/${owner}/${repository}/blob/${encodeURIComponent(branch)}/${file.path.split("/").map(encodeURIComponent).join("/")}`
    });
  }

  return [...items.values()].sort((left, right) =>
    left.parentPath.localeCompare(right.parentPath) ||
    (left.kind === right.kind ? 0 : left.kind === "folder" ? -1 : 1) ||
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  );
}

function getTypeLabel(filePath) {
  const filename = filePath.split("/").pop() || "";
  const extensionStart = filename.lastIndexOf(".");
  if (extensionStart <= 0 || extensionStart === filename.length - 1) return "FILE";
  return filename.slice(extensionStart + 1).toUpperCase();
}

function validateRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1000) {
    throw new Error("A non-empty file path is required.");
  }
  if (value.includes("\\") || value.startsWith("/") || value.includes("\0")) {
    throw new Error("The file path is invalid.");
  }

  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("The file path is invalid.");
  }
  return segments.join("/");
}

module.exports = { buildItemsFromTree, getTypeLabel, validateRelativePath };
