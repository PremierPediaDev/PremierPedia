"use strict";

const express = require("express");
const dotenv = require("dotenv");
const { buildItemsFromTree, validateRelativePath } = require("./lib/docs");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const [environmentOwner, environmentRepository] = (process.env.GITHUB_REPOSITORY || "").split("/");
const OWNER = process.env.GITHUB_OWNER || environmentOwner || "PremierPediaDev";
const REPOSITORY = process.env.GITHUB_REPO_NAME || environmentRepository || process.env.GITHUB_REPOSITORY || "PremierPedia";
const DOCS_PATH = normalizeDocsPath(process.env.GITHUB_DOCS_PATH || "PremierPedia");
const ROOT = __dirname;
const API_BASE = "https://api.github.com";
const uploadedOnCache = new Map();
const uploadedOnRequests = new Map();
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
    const files = items.filter((item) => item.kind === "file");
    for (let index = 0; index < files.length; index += 8) {
      await Promise.all(files.slice(index, index + 8).map(async (item) => {
        item.uploadedOn = await getUploadedOn(item.path, branch);
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
    response
      .set("Content-Type", contentType || "application/octet-stream")
      .set("Content-Disposition", `${contentType ? "inline" : "attachment"}; filename*=UTF-8''${filename}`)
      .set("X-Content-Type-Options", "nosniff")
      .set("Cache-Control", "private, no-store")
      .send(content);
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
    uploadedOnCache.delete(`${branch}:${fullPath}`);
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
    response.status(201).json({ path: relativePath });
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
      uploadedOnCache.delete(`${branch}:${file.path}`);
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

async function getUploadedOn(path, branch) {
  const cacheKey = `${branch}:${path}`;
  if (uploadedOnCache.has(cacheKey)) return uploadedOnCache.get(cacheKey);
  if (uploadedOnRequests.has(cacheKey)) return uploadedOnRequests.get(cacheKey);

  const request = (async () => {
    const query = new URLSearchParams({ path, sha: branch, per_page: "1" });
    let commits = await githubRequest(`/repos/${OWNER}/${REPOSITORY}/commits?${query}`);
    if (commits.length === 0) {
      query.delete("sha");
      commits = await githubRequest(`/repos/${OWNER}/${REPOSITORY}/commits?${query}`);
    }
    const uploadedOn = getCommitDate(commits[0]);
    uploadedOnCache.set(cacheKey, uploadedOn);
    return uploadedOn;
  })();
  uploadedOnRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    uploadedOnRequests.delete(cacheKey);
  }
}

function getCommitDate(commit) {
  return commit?.commit?.committer?.date ||
    commit?.commit?.author?.date ||
    commit?.committer?.date ||
    commit?.author?.date ||
    null;
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
  const extension = filePath.split("/").at(-1).split(".").at(-1).toLowerCase();
  const contentTypes = {
    txt: "text/plain; charset=utf-8",
    text: "text/plain; charset=utf-8",
    log: "text/plain; charset=utf-8",
    md: "text/plain; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    json: "application/json; charset=utf-8",
    xml: "application/xml; charset=utf-8",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    avif: "image/avif",
    bmp: "image/bmp",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime"
  };
  return contentTypes[extension] || null;
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
