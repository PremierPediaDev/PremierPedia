"use strict";

const express = require("express");
const dotenv = require("dotenv");
const { buildItemsFromTree, validateRelativePath } = require("./lib/docs");
const fileTypes = require("./file-types");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const [environmentOwner, environmentRepository] = (process.env.GITHUB_REPOSITORY || "").split("/");
const OWNER = process.env.GITHUB_OWNER || environmentOwner || "PremierPediaDev";
const REPOSITORY = process.env.GITHUB_REPO_NAME || environmentRepository || process.env.GITHUB_REPOSITORY || "PremierPedia";
const DOCS_PATH = normalizeDocsPath(process.env.GITHUB_DOCS_PATH || "PremierPedia");
const ROOT = __dirname;
const API_BASE = "https://api.github.com";
const createdOnCache = new Map();
const createdOnRequests = new Map();
const githubHeaders = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "PremierPedia"
};

app.use(express.json({ limit: "100mb" }));

app.get("/", (_request, response) => response.sendFile(`${ROOT}/index.html`));
app.get("/index.html", (_request, response) => response.sendFile(`${ROOT}/index.html`));
app.get("/index.css", (_request, response) => response.sendFile(`${ROOT}/index.css`));
app.get("/index.js", (_request, response) => response.sendFile(`${ROOT}/index.js`));
app.get("/file-types.js", (_request, response) => response.sendFile(`${ROOT}/file-types.js`));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/docs", async (_request, response, next) => {
  try {
    const repository = await githubRequest(`/repos/${OWNER}/${REPOSITORY}`);
    const branch = process.env.GITHUB_BRANCH || repository.default_branch;
    const treeData = await githubRequest(
      `/repos/${OWNER}/${REPOSITORY}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    );
    if (treeData.truncated) {
      throw new HttpError(502, "GitHub returned an incomplete repository tree.");
    }

    const items = buildItemsFromTree(treeData.tree || [], DOCS_PATH);
    for (let index = 0; index < items.length; index += 8) {
      await Promise.all(items.slice(index, index + 8).map(async (item) => {
        item.createdOn = await getCreatedOn(item.path, branch);
      }));
    }
    response.json({ docsPath: DOCS_PATH, branch, items });
  } catch (error) {
    next(error);
  }
});

app.get("/api/docs/file", async (request, response, next) => {
  try {
    let relativePath;
    try {
      relativePath = validateRelativePath(request.query.path);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    const fullPath = `${DOCS_PATH}/${relativePath}`;
    const branch = await getBranch();
    let file = await githubRequest(
      `/repos/${OWNER}/${REPOSITORY}/contents/${encodeGithubPath(fullPath)}?ref=${encodeURIComponent(branch)}`
    );
    if (file.type !== "file") throw new HttpError(404, "The requested document was not found.");

    if (file.encoding !== "base64" || typeof file.content !== "string") {
      if (typeof file.sha !== "string") {
        throw new HttpError(502, "GitHub did not return a downloadable file.");
      }
      file = await githubRequest(`/repos/${OWNER}/${REPOSITORY}/git/blobs/${encodeURIComponent(file.sha)}`);
    }
    if (file.encoding !== "base64" || typeof file.content !== "string") {
      throw new HttpError(502, "GitHub did not return a downloadable file.");
    }

    const content = Buffer.from(file.content.replace(/\s/g, ""), "base64");
    const contentType = getInlineContentType(relativePath);
    const filename = encodeURIComponent(relativePath.split("/").at(-1)).replace(/['()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
    const fileResponse = response
      .set("Content-Type", contentType || "application/octet-stream")
      .set("Content-Disposition", `${contentType ? "inline" : "attachment"}; filename*=UTF-8''${filename}`)
      .set("X-Content-Type-Options", "nosniff")
      .set("Cache-Control", "private, no-store");
    if (contentType && /^(?:text\/html|image\/svg\+xml)/i.test(contentType)) {
      fileResponse.set("Content-Security-Policy", "sandbox");
    }
    fileResponse.send(content);
  } catch (error) {
    next(error);
  }
});

app.put("/api/docs/files", requireGithubToken, async (request, response, next) => {
  try {
    const relativePath = validateRelativePath(request.body?.path);
    const contentBase64 = request.body?.contentBase64;
    if (typeof contentBase64 !== "string" || !isBase64(contentBase64)) {
      throw new HttpError(400, "File content must be provided as valid base64.");
    }

    const fullPath = `${DOCS_PATH}/${relativePath}`;
    const branch = await getBranch();
    const urlPath = encodeGithubPath(fullPath);
    let existingSha;
    try {
      const existing = await githubRequest(`/repos/${OWNER}/${REPOSITORY}/contents/${urlPath}?ref=${encodeURIComponent(branch)}`);
      existingSha = existing.sha;
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 404) throw error;
    }

    const result = await githubRequest(`/repos/${OWNER}/${REPOSITORY}/contents/${urlPath}`, {
      method: "PUT",
      body: {
        message: `${existingSha ? "Update" : "Upload"} ${relativePath}`,
        content: contentBase64,
        branch,
        ...(existingSha ? { sha: existingSha } : {})
      }
    });
    invalidateCreatedOn(branch, fullPath);
    response.json({ path: relativePath, sha: result.content?.sha, commit: result.commit?.sha });
  } catch (error) {
    next(error);
  }
});

app.post("/api/docs/folders", requireGithubToken, async (request, response, next) => {
  try {
    const relativePath = validateRelativePath(request.body?.path);
    const branch = await getBranch();
    const treeData = await githubRequest(
      `/repos/${OWNER}/${REPOSITORY}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    );
    if (treeData.truncated) {
      throw new HttpError(502, "GitHub returned an incomplete repository tree.");
    }

    const targetPath = `${DOCS_PATH}/${relativePath}`;
    const tree = treeData.tree || [];
    if (tree.some((entry) =>
      entry.path === targetPath || entry.path.startsWith(`${targetPath}/`)
    )) {
      throw new HttpError(409, "A file or folder already exists at that path.");
    }

    const segments = relativePath.split("/");
    const parentPaths = segments.slice(0, -1).map((_segment, index) =>
      `${DOCS_PATH}/${segments.slice(0, index + 1).join("/")}`
    );
    if (tree.some((entry) => entry.type === "blob" && parentPaths.includes(entry.path))) {
      throw new HttpError(409, "A file exists where a parent folder is required.");
    }

    await githubRequest(`/repos/${OWNER}/${REPOSITORY}/contents/${encodeGithubPath(`${targetPath}/.gitkeep`)}`, {
      method: "PUT",
      body: {
        message: `Create folder ${relativePath}`,
        content: "",
        branch
      }
    });
    invalidateCreatedOn(branch, `${targetPath}/.gitkeep`);
    response.status(201).json({ path: relativePath });
  } catch (error) {
    next(error);
  }
});

app.post("/api/docs/move", requireGithubToken, async (request, response, next) => {
  try {
    const requestedPaths = request.body?.paths;
    if (!Array.isArray(requestedPaths) || requestedPaths.length === 0) {
      throw new HttpError(400, "Select one or more files or folders to move.");
    }
    const paths = [...new Set(requestedPaths.map(validateRelativePath))];
    const destination = request.body?.destination === ""
      ? ""
      : validateRelativePath(request.body?.destination);
    const repository = await githubRequest(`/repos/${OWNER}/${REPOSITORY}`);
    const branch = process.env.GITHUB_BRANCH || repository.default_branch;
    const treeData = await githubRequest(
      `/repos/${OWNER}/${REPOSITORY}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    );
    if (treeData.truncated) throw new HttpError(502, "GitHub returned an incomplete repository tree.");
    const tree = (treeData.tree || []).filter((entry) =>
      entry.type === "blob" && entry.path.startsWith(`${DOCS_PATH}/`)
    );
    const rootPaths = paths.filter((path) => !paths.some((parent) =>
      parent !== path && path.startsWith(`${parent}/`)
    ));
    const movingEntries = [];
    const sourceRoots = [];

    for (const path of rootPaths) {
      const source = `${DOCS_PATH}/${path}`;
      const entries = tree.filter((entry) => entry.path === source || entry.path.startsWith(`${source}/`));
      if (entries.length === 0) throw new HttpError(404, `No file or folder was found at ${path}.`);
      sourceRoots.push({ path, source, entries });
      movingEntries.push(...entries);
    }

    const movingPaths = new Set(movingEntries.map((entry) => entry.path));
    const remappedEntries = [];
    const destinationPaths = new Set();
    for (const root of sourceRoots) {
      if (destination === root.path || destination.startsWith(`${root.path}/`)) {
        throw new HttpError(400, `Cannot move ${root.path} into itself or one of its subfolders.`);
      }
      const targetRoot = [DOCS_PATH, destination, root.path.split("/").at(-1)].filter(Boolean).join("/");
      for (const entry of root.entries) {
        const suffix = entry.path.slice(root.source.length);
        const targetPath = `${targetRoot}${suffix}`;
        if (destinationPaths.has(targetPath)) throw new HttpError(409, "The selected items would produce duplicate destination paths.");
        destinationPaths.add(targetPath);
        const existingTarget = tree.find((candidate) => !movingPaths.has(candidate.path) && (
          candidate.path === targetPath ||
          targetPath.startsWith(`${candidate.path}/`) ||
          candidate.path.startsWith(`${targetPath}/`)
        ));
        if (existingTarget) throw new HttpError(409, `A file already exists at ${targetPath.slice(DOCS_PATH.length + 1)}.`);
        remappedEntries.push({
          path: targetPath,
          mode: entry.mode,
          type: entry.type,
          sha: entry.sha
        });
      }
    }

    const ref = await githubRequest(`/repos/${OWNER}/${REPOSITORY}/git/ref/heads/${encodeGithubPath(branch)}`);
    const baseTree = await githubRequest(`/repos/${OWNER}/${REPOSITORY}/git/trees/${encodeURIComponent(ref.object.sha)}`);
    const updatedTree = await githubRequest(`/repos/${OWNER}/${REPOSITORY}/git/trees`, {
      method: "POST",
      body: {
        base_tree: baseTree.sha,
        tree: [
          ...movingEntries.map((entry) => ({
            path: entry.path,
            mode: entry.mode,
            type: entry.type,
            sha: null
          })),
          ...remappedEntries
        ]
      }
    });
    const commit = await githubRequest(`/repos/${OWNER}/${REPOSITORY}/git/commits`, {
      method: "POST",
      body: {
        message: `Move ${rootPaths.length} item${rootPaths.length === 1 ? "" : "s"} into ${destination || DOCS_PATH}`,
        tree: updatedTree.sha,
        parents: [ref.object.sha]
      }
    });
    await githubRequest(`/repos/${OWNER}/${REPOSITORY}/git/refs/heads/${encodeGithubPath(branch)}`, {
      method: "PATCH",
      body: { sha: commit.sha }
    });
    for (const entry of [...movingEntries, ...remappedEntries]) invalidateCreatedOn(branch, entry.path);
    response.json({
      movedCount: movingEntries.filter((entry) => !entry.path.endsWith("/.gitkeep")).length,
      destination
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/docs/rename", requireGithubToken, async (request, response, next) => {
  try {
    const relativePath = validateRelativePath(request.body?.path);
    const name = request.body?.name;
    if (typeof name !== "string" || name.length === 0 || name.length > 255 ||
      name !== name.trim() || name === "." || name === ".." ||
      name.includes("/") || name.includes("\\") || name.includes("\0")) {
      throw new HttpError(400, "Enter a valid new name without path separators.");
    }

    const source = `${DOCS_PATH}/${relativePath}`;
    const parentPath = relativePath.includes("/")
      ? relativePath.slice(0, relativePath.lastIndexOf("/"))
      : "";
    const targetRelativePath = [parentPath, name].filter(Boolean).join("/");
    const target = `${DOCS_PATH}/${targetRelativePath}`;
    if (source === target) {
      throw new HttpError(400, "The new name must be different from the current name.");
    }

    const branch = await getBranch();
    const treeData = await githubRequest(
      `/repos/${OWNER}/${REPOSITORY}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    );
    if (treeData.truncated) throw new HttpError(502, "GitHub returned an incomplete repository tree.");
    const tree = (treeData.tree || []).filter((entry) =>
      entry.type === "blob" && entry.path.startsWith(`${DOCS_PATH}/`)
    );
    const sourceEntries = tree.filter((entry) =>
      entry.path === source || entry.path.startsWith(`${source}/`)
    );
    if (!sourceEntries.length) throw new HttpError(404, `No file or folder was found at ${relativePath}.`);

    const movingPaths = new Set(sourceEntries.map((entry) => entry.path));
    const conflict = tree.find((entry) => !movingPaths.has(entry.path) && (
      entry.path === target ||
      entry.path.startsWith(`${target}/`) ||
      target.startsWith(`${entry.path}/`)
    ));
    if (conflict) throw new HttpError(409, `A file or folder already exists at ${targetRelativePath}.`);

    const remappedEntries = sourceEntries.map((entry) => ({
      path: `${target}${entry.path.slice(source.length)}`,
      mode: entry.mode,
      type: entry.type,
      sha: entry.sha
    }));
    const ref = await githubRequest(`/repos/${OWNER}/${REPOSITORY}/git/ref/heads/${encodeGithubPath(branch)}`);
    const baseTree = await githubRequest(`/repos/${OWNER}/${REPOSITORY}/git/trees/${encodeURIComponent(ref.object.sha)}`);
    const updatedTree = await githubRequest(`/repos/${OWNER}/${REPOSITORY}/git/trees`, {
      method: "POST",
      body: {
        base_tree: baseTree.sha,
        tree: [
          ...sourceEntries.map((entry) => ({
            path: entry.path,
            mode: entry.mode,
            type: entry.type,
            sha: null
          })),
          ...remappedEntries
        ]
      }
    });
    const commit = await githubRequest(`/repos/${OWNER}/${REPOSITORY}/git/commits`, {
      method: "POST",
      body: {
        message: `Rename ${relativePath} to ${targetRelativePath}`,
        tree: updatedTree.sha,
        parents: [ref.object.sha]
      }
    });
    await githubRequest(`/repos/${OWNER}/${REPOSITORY}/git/refs/heads/${encodeGithubPath(branch)}`, {
      method: "PATCH",
      body: { sha: commit.sha }
    });
    for (const entry of [...sourceEntries, ...remappedEntries]) invalidateCreatedOn(branch, entry.path);
    response.json({ path: targetRelativePath });
  } catch (error) {
    next(error);
  }
});

app.delete("/api/docs/files", requireGithubToken, async (request, response, next) => {
  try {
    const requestedPaths = request.body?.paths;
    if (!Array.isArray(requestedPaths) || requestedPaths.length === 0) {
      throw new HttpError(400, "Select one or more files or folders to remove.");
    }
    const paths = [...new Set(requestedPaths.map(validateRelativePath))];
    const repository = await githubRequest(`/repos/${OWNER}/${REPOSITORY}`);
    const branch = process.env.GITHUB_BRANCH || repository.default_branch;
    const treeData = await githubRequest(
      `/repos/${OWNER}/${REPOSITORY}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    );
    if (treeData.truncated) {
      throw new HttpError(502, "GitHub returned an incomplete repository tree.");
    }

    const requestedFullPaths = paths.map((item) => `${DOCS_PATH}/${item}`);
    const filesToDelete = (treeData.tree || [])
      .filter((entry) => entry.type === "blob" && entry.path.startsWith(`${DOCS_PATH}/`))
      .filter((entry) => requestedFullPaths.some((target) =>
        entry.path === target || entry.path.startsWith(`${target}/`)
      ))
      .sort((left, right) => right.path.length - left.path.length);
    if (filesToDelete.length === 0) {
      throw new HttpError(404, "No matching files were found in the docs directory.");
    }

    for (const file of filesToDelete) {
      await githubRequest(`/repos/${OWNER}/${REPOSITORY}/contents/${encodeGithubPath(file.path)}`, {
        method: "DELETE",
        body: {
          message: `Remove ${file.path.slice(DOCS_PATH.length + 1)}`,
          sha: file.sha,
          branch
        }
      });
      invalidateCreatedOn(branch, file.path);
    }
    response.json({ deletedCount: filesToDelete.length });
  } catch (error) {
    next(error);
  }
});

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "API endpoint not found." });
});

app.use((error, _request, response, _next) => {
  const status = error instanceof HttpError ? error.status : Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(error);
  response.status(status).json({
    error: status >= 500 && !(error instanceof HttpError)
      ? "The GitHub repository request failed."
      : error instanceof HttpError ? error.message : "Invalid request."
  });
});

function normalizeDocsPath(value) {
  const normalized = value.replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("GITHUB_DOCS_PATH must be a valid repository-relative directory.");
  }
  return normalized;
}

function requireGithubToken(_request, _response, next) {
  if (!process.env.GITHUB_TOKEN) {
    next(new HttpError(503, "Write operations are unavailable: configure GITHUB_TOKEN in the server environment."));
    return;
  }
  next();
}

async function getBranch() {
  if (process.env.GITHUB_BRANCH) return process.env.GITHUB_BRANCH;
  const repository = await githubRequest(`/repos/${OWNER}/${REPOSITORY}`);
  return repository.default_branch;
}

async function getCreatedOn(path, branch) {
  const cacheKey = `${branch}:${path}`;
  if (createdOnCache.has(cacheKey)) return createdOnCache.get(cacheKey);
  if (createdOnRequests.has(cacheKey)) return createdOnRequests.get(cacheKey);

  const request = (async () => {
    const query = new URLSearchParams({ path, sha: branch, per_page: "1" });
    let commits = await githubRequest(`/repos/${OWNER}/${REPOSITORY}/commits?${query}`);
    if (commits.length === 0) {
      query.delete("sha");
      commits = await githubRequest(`/repos/${OWNER}/${REPOSITORY}/commits?${query}`);
    }
    const createdOn = getCommitDate(commits[0]);
    createdOnCache.set(cacheKey, createdOn);
    return createdOn;
  })();
  createdOnRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    createdOnRequests.delete(cacheKey);
  }
}

function getCommitDate(commit) {
  return commit?.commit?.committer?.date ||
    commit?.commit?.author?.date ||
    commit?.committer?.date ||
    commit?.author?.date ||
    null;
}

function invalidateCreatedOn(branch, fullPath) {
  const segments = fullPath.split("/");
  const docsSegments = DOCS_PATH.split("/");
  while (segments.length >= docsSegments.length) {
    createdOnCache.delete(`${branch}:${segments.join("/")}`);
    if (segments.length === docsSegments.length) break;
    segments.pop();
  }
}

async function githubRequest(endpoint, options = {}) {
  const headers = { ...githubHeaders };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  if (options.body) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      method: options.method || "GET",
      headers,
      ...(options.body ? { body: JSON.stringify(options.body) } : {})
    });
  } catch (error) {
    throw new HttpError(502, `Unable to reach GitHub: ${error.message}`);
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload.message || response.statusText || "GitHub API request failed.";
    throw new HttpError(response.status, `GitHub API ${options.method || "GET"} ${endpoint}: ${message}`);
  }
  return payload;
}

function encodeGithubPath(value) {
  return value.split("/").map(encodeURIComponent).join("/");
}

function getInlineContentType(filePath) {
  if (!fileTypes.isBrowserOpenable(filePath)) return null;
  return fileTypes.getMimeType(filePath);
}

function isBase64(value) {
  return value.length % 4 === 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`PremierPedia listening on http://localhost:${PORT}`);
  });
}

module.exports = { app, DOCS_PATH, getCommitDate, getInlineContentType, normalizeDocsPath };
