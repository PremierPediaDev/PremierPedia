(function (root, factory) {
  const fileTypes = factory();
  if (typeof module === "object" && module.exports) module.exports = fileTypes;
  if (root) root.PremierPediaFileTypes = fileTypes;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  "use strict";

  const mimeTypes = Object.freeze({
    txt: "text/plain; charset=utf-8",
    text: "text/plain; charset=utf-8",
    log: "text/plain; charset=utf-8",
    md: "text/plain; charset=utf-8",
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    css: "text/css; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    json: "application/json; charset=utf-8",
    xml: "application/xml; charset=utf-8",
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    avif: "image/avif",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    zip: "application/zip",
    rar: "application/vnd.rar",
    "7z": "application/x-7z-compressed",
    tar: "application/x-tar",
    gz: "application/gzip",
    js: "text/javascript; charset=utf-8",
    mjs: "text/javascript; charset=utf-8",
    cjs: "text/javascript; charset=utf-8",
    ts: "text/plain; charset=utf-8"
  });

  const iconTypes = Object.freeze({
    pdf: "pdf",
    txt: "text",
    text: "text",
    log: "text",
    md: "text",
    doc: "word",
    docx: "word",
    xls: "spreadsheet",
    xlsx: "spreadsheet",
    ppt: "presentation",
    pptx: "presentation",
    csv: "csv",
    jpg: "image",
    jpeg: "image",
    png: "image",
    gif: "image",
    webp: "image",
    svg: "image",
    bmp: "image",
    avif: "image",
    mp3: "audio",
    wav: "audio",
    ogg: "audio",
    m4a: "audio",
    mp4: "video",
    webm: "video",
    mov: "video",
    avi: "video",
    zip: "archive",
    rar: "archive",
    "7z": "archive",
    tar: "archive",
    gz: "archive",
    json: "data",
    xml: "data",
    html: "code",
    htm: "code",
    css: "code",
    js: "code",
    mjs: "code",
    cjs: "code",
    ts: "code"
  });

  const openableExtensions = new Set([
    "txt", "text", "log", "md", "html", "htm", "csv", "json", "xml",
    "pdf", "jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif",
    "mp3", "wav", "ogg", "m4a", "mp4", "webm", "mov", "avi", "css"
  ]);
  const openableMimeTypes = new Set([
    "text/plain", "text/html", "text/css", "text/csv", "application/json",
    "application/xml", "text/xml", "application/pdf", "image/jpeg", "image/png",
    "image/gif", "image/webp", "image/svg+xml", "image/bmp", "image/avif",
    "audio/mpeg", "audio/wav", "audio/x-wav", "audio/ogg", "audio/mp4",
    "video/mp4", "video/webm", "video/quicktime", "video/x-msvideo"
  ]);

  function getExtension(filename) {
    const name = String(filename || "").split(/[\\/]/).at(-1);
    const separator = name.lastIndexOf(".");
    if (separator <= 0 || separator === name.length - 1) return "";
    return name.slice(separator + 1).toLowerCase();
  }

  function normalizeMimeType(mimeType) {
    return typeof mimeType === "string" ? mimeType.split(";", 1)[0].trim().toLowerCase() : "";
  }

  function getMimeType(filename) {
    return mimeTypes[getExtension(filename)] || null;
  }

  function isBrowserOpenable(filename, mimeType) {
    const normalizedMimeType = normalizeMimeType(mimeType);
    if (normalizedMimeType && normalizedMimeType !== "application/octet-stream") {
      return openableMimeTypes.has(normalizedMimeType);
    }
    return openableExtensions.has(getExtension(filename));
  }

  function getIconType(filename) {
    return iconTypes[getExtension(filename)] || "generic";
  }

  return Object.freeze({ getExtension, getMimeType, getIconType, isBrowserOpenable });
});
