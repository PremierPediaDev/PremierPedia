"use strict";

function normalizeDocsPath(value) {
  const normalized = String(value || "").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("GITHUB_DOCS_PATH must be a valid repository-relative directory.");
  }
  return normalized;
}

function normalizeFolderPath(value, docsPath = "PremierPedia") {
  if (value === null || value === undefined || value === "") return "";
  const sanitized = String(value).replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
  if (!sanitized) return "";
  const segments = sanitized.split("/").filter((segment) => segment && segment !== "." && segment !== "..");
  if (!segments.length) return "";
  const normalized = segments.join("/");
  if (normalized === docsPath) return "";
  return normalized.startsWith(`${docsPath}/`) ? normalized.slice(docsPath.length + 1) : normalized;
}

function getParentFolderPath(value, docsPath = "PremierPedia") {
  const normalized = normalizeFolderPath(value, docsPath);
  if (!normalized) return "";
  const segments = normalized.split("/");
  segments.pop();
  return segments.join("/");
}

function getDisplayFolderPath(currentFolder, docsPath = "PremierPedia") {
  const normalized = normalizeFolderPath(currentFolder, docsPath);
  return normalized ? `${docsPath}/${normalized}/` : `${docsPath}/`;
}

function buildFolderSizeMap(items) {
  const folderSizes = new Map();
  const folders = items.filter((item) => item.kind === "folder");

  const getFolderSize = (folderPath) => {
    if (folderSizes.has(folderPath)) return folderSizes.get(folderPath);

    let total = 0;
    for (const item of items) {
      if (item.kind === "file" && item.parentPath === folderPath) {
        total += Number(item.size) || 0;
      }
    }

    for (const folder of folders) {
      if (folder.parentPath === folderPath) {
        total += getFolderSize(folder.relativePath);
      }
    }

    folderSizes.set(folderPath, total);
    return total;
  };

  for (const folder of folders) {
    getFolderSize(folder.relativePath);
  }

  return folderSizes;
}

function buildItemsFromTree(tree, docsPath) {
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

    if (segments.at(-1) === ".gitkeep") continue;

    items.set(relativePath, {
      name: segments.at(-1),
      path: file.path,
      relativePath,
      parentPath: segments.length > 1 ? segments.slice(0, -1).join("/") : "",
      kind: "file",
      typeLabel: getTypeLabel(file.path),
      size: Number.isFinite(file.size) ? file.size : null,
      sha: file.sha
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

module.exports = {
  buildFolderSizeMap,
  buildItemsFromTree,
  getDisplayFolderPath,
  getParentFolderPath,
  getTypeLabel,
  normalizeDocsPath,
  normalizeFolderPath,
  validateRelativePath
};
