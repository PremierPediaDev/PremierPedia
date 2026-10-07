"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const { app, DOCS_PATH } = require("../server");

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
