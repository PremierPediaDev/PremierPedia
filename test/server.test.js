"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { app, DOCS_PATH, getCommitDate } = require("../server");

test("document listing includes latest commit timestamps for files and folders", async (context) => {
  const originalFetch = global.fetch;
  const requestedCommitQueries = [];
  global.fetch = async (url) => {
    const requestUrl = new URL(url);
    if (requestUrl.pathname === "/repos/PremierPediaDev/PremierPedia") {
      return new Response(JSON.stringify({ default_branch: "main" }));
    }
    if (requestUrl.pathname === "/repos/PremierPediaDev/PremierPedia/git/trees/main") {
      return new Response(JSON.stringify({
        tree: [{ path: `${DOCS_PATH}/Policies/guide.txt`, type: "blob", size: 14, sha: "guide-sha" }]
      }));
    }
    if (requestUrl.pathname === "/repos/PremierPediaDev/PremierPedia/commits") {
      requestedCommitQueries.push(requestUrl.searchParams);
      return new Response(JSON.stringify([{
        commit: { committer: { date: "2024-03-09T15:07:05Z" } }
      }]));
    }
    throw new Error(`Unexpected GitHub API request: ${url}`);
  };

  const server = app.listen(0);
  await once(server, "listening");
  context.after(async () => {
    global.fetch = originalFetch;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const response = await get(`http://127.0.0.1:${server.address().port}/api/docs`);
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.items.find((item) => item.kind === "file").createdOn, "2024-03-09T15:07:05Z");
  assert.equal(payload.items.find((item) => item.kind === "folder").createdOn, "2024-03-09T15:07:05Z");
  assert.deepEqual(
    requestedCommitQueries.map((query) => query.get("path")).sort(),
    [`${DOCS_PATH}/Policies`, `${DOCS_PATH}/Policies/guide.txt`].sort()
  );
  for (const query of requestedCommitQueries) {
    assert.equal(query.get("sha"), "main");
    assert.equal(query.get("per_page"), "1");
  }
});

test("commit timestamp supports nested and top-level GitHub commit payloads", () => {
  assert.equal(getCommitDate({
    commit: { committer: { date: "2024-03-09T15:07:05Z" } }
  }), "2024-03-09T15:07:05Z");
  assert.equal(getCommitDate({
    author: { date: "2024-03-09T15:07:05Z" }
  }), "2024-03-09T15:07:05Z");
  assert.equal(getCommitDate({}), null);
});

test("move API creates one commit that removes source and adds destination paths", async (context) => {
  const originalFetch = global.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-write-token";
  const requests = [];
  global.fetch = async (url, options = {}) => {
    const requestUrl = new URL(url);
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ method: options.method || "GET", path: requestUrl.pathname, body });
    if (requestUrl.pathname === "/repos/PremierPediaDev/PremierPedia") {
      return new Response(JSON.stringify({ default_branch: "main" }));
    }
    if (requestUrl.pathname.endsWith("/git/trees/main")) {
      return new Response(JSON.stringify({
        tree: [
          { path: `${DOCS_PATH}/source.txt`, type: "blob", mode: "100644", sha: "source-sha" },
          { path: `${DOCS_PATH}/second.txt`, type: "blob", mode: "100644", sha: "second-sha" },
          { path: `${DOCS_PATH}/destination/existing.txt`, type: "blob", mode: "100644", sha: "existing-sha" }
        ]
      }));
    }
    if (requestUrl.pathname.endsWith("/git/ref/heads/main")) {
      return new Response(JSON.stringify({ object: { sha: "parent-sha" } }));
    }
    if (requestUrl.pathname.endsWith("/git/trees/parent-sha")) {
      return new Response(JSON.stringify({ sha: "base-tree-sha" }));
    }
    if (requestUrl.pathname.endsWith("/git/trees") && options.method === "POST") {
      return new Response(JSON.stringify({ sha: "moved-tree-sha" }));
    }
    if (requestUrl.pathname.endsWith("/git/commits") && options.method === "POST") {
      return new Response(JSON.stringify({ sha: "move-commit-sha" }));
    }
    if (requestUrl.pathname.endsWith("/git/refs/heads/main") && options.method === "PATCH") {
      return new Response(JSON.stringify({ object: { sha: "move-commit-sha" } }));
    }
    throw new Error(`Unexpected GitHub API request: ${options.method || "GET"} ${url}`);
  };

  const server = app.listen(0);
  await once(server, "listening");
  context.after(async () => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const response = await postJson(`http://127.0.0.1:${server.address().port}/api/docs/move`, {
    paths: ["source.txt", "second.txt"],
    destination: "destination"
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { movedCount: 2, destination: "destination" });
  const treeRequest = requests.find((request) =>
    request.method === "POST" && request.path.endsWith("/git/trees")
  );
  assert.deepEqual(treeRequest.body.tree, [
    { path: `${DOCS_PATH}/source.txt`, mode: "100644", type: "blob", sha: null },
    { path: `${DOCS_PATH}/second.txt`, mode: "100644", type: "blob", sha: null },
    { path: `${DOCS_PATH}/destination/source.txt`, mode: "100644", type: "blob", sha: "source-sha" },
    { path: `${DOCS_PATH}/destination/second.txt`, mode: "100644", type: "blob", sha: "second-sha" }
  ]);
  assert.equal(requests.filter((request) => request.method === "POST" &&
    request.path.endsWith("/git/commits")).length, 1);
});

test("move API rejects moving a folder into itself", async (context) => {
  const originalFetch = global.fetch;
  const originalToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-write-token";
  global.fetch = async (url) => {
    const requestUrl = new URL(url);
    if (requestUrl.pathname === "/repos/PremierPediaDev/PremierPedia") {
      return new Response(JSON.stringify({ default_branch: "main" }));
    }
    if (requestUrl.pathname.endsWith("/git/trees/main")) {
      return new Response(JSON.stringify({
        tree: [{ path: `${DOCS_PATH}/folder/file.txt`, type: "blob", mode: "100644", sha: "file-sha" }]
      }));
    }
    throw new Error(`Unexpected GitHub API request: ${url}`);
  };
  const server = app.listen(0);
  await once(server, "listening");
  context.after(async () => {
    global.fetch = originalFetch;
    if (originalToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalToken;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });
  const response = await postJson(`http://127.0.0.1:${server.address().port}/api/docs/move`, {
    paths: ["folder"],
    destination: "folder/child"
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /into itself/);
});

test("file endpoint serves supported documents inline and other formats as downloads", async (context) => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const requestUrl = new URL(url);
    if (requestUrl.pathname.endsWith("/contents/" + DOCS_PATH + "/Policies/guide.txt")) {
      return new Response(JSON.stringify({
        type: "file",
        encoding: "base64",
        content: Buffer.from("Sample document").toString("base64"),
        sha: "guide-sha"
      }));
    }
    if (requestUrl.pathname.endsWith("/contents/" + DOCS_PATH + "/Policies/archive.rdp")) {
      return new Response(JSON.stringify({
        type: "file",
        encoding: "base64",
        content: Buffer.from("remote file").toString("base64"),
        sha: "archive-sha"
      }));
    }
    if (requestUrl.pathname.endsWith("/contents/" + DOCS_PATH + "/Policies/empty.txt")) {
      return new Response(JSON.stringify({
        type: "file",
        encoding: "base64",
        content: "",
        sha: "empty-sha"
      }));
    }
    if (requestUrl.pathname.endsWith("/repos/PremierPediaDev/PremierPedia")) {
      return new Response(JSON.stringify({ default_branch: "main" }));
    }
    throw new Error(`Unexpected GitHub API request: ${url}`);
  };

  const server = app.listen(0);
  await once(server, "listening");
  context.after(async () => {
    global.fetch = originalFetch;
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  const port = server.address().port;
  const textFile = await get(`http://127.0.0.1:${port}/api/docs/file?path=Policies%2Fguide.txt`);
  assert.equal(textFile.status, 200);
  assert.match(textFile.headers["content-type"], /^text\/plain/);
  assert.match(textFile.headers["content-disposition"], /^inline;/);
  assert.equal(textFile.body, "Sample document");

  const unsupportedFile = await get(`http://127.0.0.1:${port}/api/docs/file?path=Policies%2Farchive.rdp`);
  assert.equal(unsupportedFile.status, 200);
  assert.equal(unsupportedFile.headers["content-type"], "application/octet-stream");
  assert.match(unsupportedFile.headers["content-disposition"], /^attachment;/);
  assert.equal(unsupportedFile.body, "remote file");

  const emptyFile = await get(`http://127.0.0.1:${port}/api/docs/file?path=Policies%2Fempty.txt`);
  assert.equal(emptyFile.status, 200);
  assert.equal(emptyFile.body, "");
});

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    }).on("error", reject);
  });
}

function postJson(url, payload) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode,
        json: async () => JSON.parse(Buffer.concat(chunks).toString("utf8"))
      }));
    });
    request.on("error", reject);
    request.end(JSON.stringify(payload));
  });
}
