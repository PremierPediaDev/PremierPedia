"use strict";

const REPOSITORY_OWNER = "PremierPediaDev";
const REPOSITORY_NAME = "PremierPedia";
const REPOSITORY_BRANCH = "main";
const DOCUMENTS_PATH = "PremierPedia";
const GITHUB_API = "https://api.github.com";
const RAW_GITHUB = "https://raw.githubusercontent.com";
const createdOnCache = new Map();
const isGitHubPages = window.location.hostname.endsWith("github.io");

const state = {
  items: [],
  docsPath: DOCUMENTS_PATH,
  currentFolder: "",
  selected: new Set(),
  searchTerm: "",
  fileFilter: "folder",
  fileSort: "name-asc",
  activity: null,
  isDemoAdmin: false,
  draggedPaths: []
};

const ui = {
  search: document.getElementById("searchInput"),
  fileFilter: document.getElementById("fileFilter"),
  fileSort: document.getElementById("fileSort"),
  rows: document.getElementById("fileRows"),
  breadcrumbs: document.getElementById("breadcrumbs"),
  itemCount: document.getElementById("itemCount"),
  selectionStatus: document.getElementById("selectionStatus"),
  refresh: document.getElementById("refreshButton"),
  demoSignIn: document.getElementById("demoSignInButton"),
  moveHere: document.getElementById("moveHereButton"),
  createFolder: document.getElementById("createFolderButton"),
  upload: document.getElementById("uploadButton"),
  uploadFolder: document.getElementById("uploadFolderButton"),
  remove: document.getElementById("removeButton"),
  fileInput: document.getElementById("fileInput"),
  folderInput: document.getElementById("folderInput"),
  selectAll: document.getElementById("selectAll"),
  empty: document.getElementById("emptyState"),
  emptyMessage: document.querySelector("#emptyState p"),
  toast: document.getElementById("toast"),
  activityPanel: document.getElementById("activityPanel"),
  activityTitle: document.getElementById("activityTitle"),
  activitySummary: document.getElementById("activitySummary"),
  activityItems: document.getElementById("activityItems"),
  activityClose: document.getElementById("activityClose")
};

let toastTimer;

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  refreshRepository();
});

function bindEvents() {
  ui.search.addEventListener("input", (event) => {
    state.searchTerm = event.target.value.trim().toLocaleLowerCase();
    render();
  });
  ui.fileFilter.addEventListener("change", (event) => {
    state.fileFilter = event.target.value;
    render();
  });
  ui.fileSort.addEventListener("change", (event) => {
    state.fileSort = event.target.value;
    if (state.fileSort.startsWith("createdOn")) loadCreatedDatesForCurrentItems();
    render();
  });
  ui.refresh.addEventListener("click", refreshRepository);
  ui.demoSignIn.addEventListener("click", toggleDemoAdmin);
  ui.moveHere.addEventListener("click", handleMoveSelected);
  ui.createFolder.addEventListener("click", handleCreateFolder);
  ui.upload.addEventListener("click", () => ui.fileInput.click());
  ui.uploadFolder.addEventListener("click", () => ui.folderInput.click());
  ui.fileInput.addEventListener("change", (event) => handleUpload(event, false));
  ui.folderInput.addEventListener("change", (event) => handleUpload(event, true));
  ui.remove.addEventListener("click", handleRemoveSelected);
  ui.selectAll.addEventListener("change", toggleSelectAll);
  ui.activityClose.addEventListener("click", () => {
    if (state.activity?.busy) return;
    state.activity = null;
    renderActivity();
  });

  ui.rows.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "checkbox") return;

    if (input.checked) state.selected.add(input.dataset.path);
    else state.selected.delete(input.dataset.path);
    render();
  });

  ui.rows.addEventListener("click", (event) => {
    const downloadButton = event.target.closest("[data-download-path]");
    if (downloadButton) {
      event.preventDefault();
      handleDownload(downloadButton.dataset.downloadPath, downloadButton.dataset.downloadName);
      return;
    }

    const folderButton = event.target.closest("[data-folder-path]");
    if (folderButton) {
      navigateToFolder(folderButton.dataset.folderPath);
      return;
    }

    const fileButton = event.target.closest("[data-file-path]");
    if (fileButton) {
      window.open(getFileUrl(fileButton.dataset.filePath), "_blank", "noopener,noreferrer");
    }
  });

  ui.rows.addEventListener("dragstart", (event) => {
    const row = event.target.closest("tr[data-path]");
    if (!row || !state.isDemoAdmin || isGitHubPages) return;
    const path = row.dataset.path;
    const draggedItem = state.items.find((item) => item.relativePath === path);
    const candidates = state.selected.has(path) ? getSelectedItems() : [draggedItem].filter(Boolean);
    state.draggedPaths = getRootItems(candidates).map((item) => item.relativePath);
    if (!state.draggedPaths.length) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", JSON.stringify(state.draggedPaths));
    row.classList.add("is-dragging");
  });

  ui.rows.addEventListener("dragover", (event) => {
    const row = event.target.closest("tr[data-folder-path]");
    if (!row || !canDropOn(row.dataset.folderPath)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    row.classList.add("is-drop-target");
  });

  ui.rows.addEventListener("dragleave", (event) => {
    const row = event.target.closest("tr[data-folder-path]");
    if (row && !row.contains(event.relatedTarget)) row.classList.remove("is-drop-target");
  });

  ui.rows.addEventListener("drop", (event) => {
    const row = event.target.closest("tr[data-folder-path]");
    if (!row || !canDropOn(row.dataset.folderPath)) return;
    event.preventDefault();
    clearDragStyles();
    moveItems(state.draggedPaths, row.dataset.folderPath);
  });

  ui.rows.addEventListener("dragend", clearDragStyles);

  ui.breadcrumbs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-folder-path]");
    if (!button) return;
    navigateToFolder(button.dataset.folderPath);
  });

  ui.breadcrumbs.addEventListener("dragover", (event) => {
    const button = event.target.closest("[data-folder-path]");
    if (!button || !canDropOn(button.dataset.folderPath)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    button.classList.add("is-drop-target");
  });

  ui.breadcrumbs.addEventListener("dragleave", (event) => {
    const button = event.target.closest("[data-folder-path]");
    if (button && !button.contains(event.relatedTarget)) button.classList.remove("is-drop-target");
  });

  ui.breadcrumbs.addEventListener("drop", (event) => {
    const button = event.target.closest("[data-folder-path]");
    if (!button || !canDropOn(button.dataset.folderPath)) return;
    event.preventDefault();
    clearDragStyles();
    moveItems(state.draggedPaths, button.dataset.folderPath);
  });

  ui.breadcrumbs.addEventListener("dragend", clearDragStyles);
}

function navigateToFolder(path) {
  state.currentFolder = path;
  state.searchTerm = "";
  ui.search.value = "";
  state.fileFilter = "folder";
  ui.fileFilter.value = "folder";
  render();
}

function toggleDemoAdmin() {
  state.isDemoAdmin = !state.isDemoAdmin;
  document.body.classList.toggle("is-demo-admin", state.isDemoAdmin);
  ui.demoSignIn.textContent = state.isDemoAdmin ? "Demo Admin Sign Out" : "Demo Admin Sign In";
  ui.demoSignIn.setAttribute("aria-pressed", String(state.isDemoAdmin));
  ui.createFolder.hidden = !state.isDemoAdmin;
  ui.upload.hidden = !state.isDemoAdmin;
  ui.uploadFolder.hidden = !state.isDemoAdmin;
  ui.remove.hidden = !state.isDemoAdmin;
  render();
}

async function refreshRepository({ preserveFolder = false } = {}) {
  ui.refresh.disabled = true;
  ui.emptyMessage.textContent = "Loading documents...";
  try {
    const repository = await fetchRepositoryItems();
    state.items = repository.items;
    renderFileFilters();
    if (!preserveFolder) state.currentFolder = "";
    state.selected = new Set([...state.selected].filter((path) =>
      state.items.some((item) => item.relativePath === path)
    ));
    render();
    hideToast();
    repository.createdDateErrors = await loadCreatedDates(state.items);
    render();
    if (repository.createdDateErrors) {
      showToast(`Files loaded, but creation dates could not be retrieved for ${repository.createdDateErrors} item${repository.createdDateErrors === 1 ? "" : "s"}.`);
    }
  } catch (error) {
    console.error(error);
    state.items = [];
    render();
    ui.emptyMessage.textContent = "Repository contents could not be loaded. Try Refresh again.";
    showToast(error.message);
  } finally {
    ui.refresh.disabled = false;
  }
}

async function fetchRepositoryItems() {
  const treeUrl = `${GITHUB_API}/repos/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/git/trees/${encodeURIComponent(REPOSITORY_BRANCH)}?recursive=1`;
  const treeData = await fetchJson(treeUrl);
  if (treeData.truncated) throw new Error("GitHub returned an incomplete repository tree.");
  if (!Array.isArray(treeData.tree)) throw new Error("GitHub did not return a repository file tree.");

  const files = treeData.tree.filter((entry) =>
    entry.type === "blob" && entry.path.startsWith(`${DOCUMENTS_PATH}/`)
  );
  const items = new Map();
  for (const file of files) {
    const relativePath = file.path.slice(DOCUMENTS_PATH.length + 1);
    const segments = relativePath.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      const folderPath = segments.slice(0, index).join("/");
      if (!items.has(folderPath)) {
        items.set(folderPath, {
          name: segments[index - 1],
          path: `${DOCUMENTS_PATH}/${folderPath}`,
          relativePath: folderPath,
          parentPath: segments.slice(0, index - 1).join("/"),
          kind: "folder",
          hasGitkeep: false,
          typeLabel: "Folder",
          size: null,
          sha: null,
          createdOn: null
        });
      }
    }

    if (segments.at(-1) === ".gitkeep") {
      const folder = items.get(segments.slice(0, -1).join("/"));
      if (folder) folder.hasGitkeep = true;
      continue;
    }
    const filename = segments.at(-1);
    const extensionStart = filename.lastIndexOf(".");
    const typeLabel = extensionStart <= 0 || extensionStart === filename.length - 1
      ? "FILE"
      : filename.slice(extensionStart + 1).toUpperCase();
    items.set(relativePath, {
      name: filename,
      path: file.path,
      relativePath,
      parentPath: segments.slice(0, -1).join("/"),
      kind: "file",
      typeLabel,
      size: Number.isFinite(file.size) ? file.size : null,
      sha: file.sha,
      createdOn: createdOnCache.get(`${file.path}:${file.sha}`) || null
    });
  }

  const result = [...items.values()].sort((left, right) =>
    left.parentPath.localeCompare(right.parentPath) ||
    (left.kind === right.kind ? 0 : left.kind === "folder" ? -1 : 1) ||
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" })
  );
  return { items: result };
}

async function loadCreatedDatesForCurrentItems() {
  ui.fileSort.disabled = true;
  showToast("Loading creation dates from GitHub...");
  try {
    const errors = await loadCreatedDates(state.items);
    if (errors) {
      showToast(`Creation dates could not be retrieved for ${errors} item${errors === 1 ? "" : "s"}.`);
    } else {
      hideToast();
    }
  } finally {
    ui.fileSort.disabled = false;
    render();
  }
}

async function loadCreatedDates(items) {
  const pendingItems = items.filter((item) => !item.createdOn);
  const errors = [];
  for (let index = 0; index < pendingItems.length; index += 5) {
    const batch = pendingItems.slice(index, index + 5);
    const results = await Promise.allSettled(batch.map(async (item) => {
      const url = new URL(`${GITHUB_API}/repos/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/commits`);
      url.searchParams.set("path", item.path);
      url.searchParams.set("sha", REPOSITORY_BRANCH);
      url.searchParams.set("per_page", "1");
      const commits = await fetchJson(url);
      const createdOn = commits[0]?.commit?.committer?.date ||
        commits[0]?.commit?.author?.date ||
        commits[0]?.committer?.date ||
        commits[0]?.author?.date ||
        null;
      item.createdOn = createdOn;
      if (item.kind === "file") createdOnCache.set(`${item.path}:${item.sha}`, createdOn);
    }));
    results.forEach((result, resultIndex) => {
      if (result.status === "rejected") {
        errors.push({ item: batch[resultIndex].name, error: result.reason });
        console.error(`Could not load creation date for ${batch[resultIndex].path}:`, result.reason);
      }
    });
    render();
  }
  return errors.length;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || `GitHub request failed (${response.status}).`);
  }
  return payload;
}

function getVisibleItems() {
  if (state.searchTerm) {
    return sortItems(state.items.filter((item) => {
      if (item.kind !== "file" || !item.name.toLocaleLowerCase().includes(state.searchTerm)) return false;
      return state.fileFilter === "folder" || state.fileFilter === "all" || item.typeLabel === state.fileFilter;
    }));
  }

  const items = state.fileFilter === "folder"
    ? state.items.filter((item) => item.parentPath === state.currentFolder)
    : state.items.filter((item) => item.kind === "file" &&
      (state.fileFilter === "all" || item.typeLabel === state.fileFilter));
  return sortItems(items);
}

function render() {
  const items = getVisibleItems();
  renderBreadcrumbs();
  renderRows(items);
  renderSelectionState(items);
  renderActivity();
}

function renderFileFilters() {
  const selected = state.fileFilter;
  const types = [...new Set(state.items
    .filter((item) => item.kind === "file")
    .map((item) => item.typeLabel))]
    .sort((left, right) => left.localeCompare(right));
  ui.fileFilter.replaceChildren(
    new Option("-- None --", "folder"),
    new Option("All files", "all"),
    ...types.map((type) => new Option(`${type} files`, type))
  );
  ui.fileFilter.value = [...ui.fileFilter.options].some((option) => option.value === selected)
    ? selected
    : "folder";
  state.fileFilter = ui.fileFilter.value;
}

function sortItems(items) {
  const [sortKey, direction] = state.fileSort.split("-");
  const multiplier = direction === "desc" ? -1 : 1;
  return items.sort((left, right) => {
    if (state.fileSort === "name-asc" && !state.searchTerm &&
      state.fileFilter === "folder" && left.kind !== right.kind) {
      return left.kind === "folder" ? -1 : 1;
    }

    let result = 0;
    if (sortKey === "type") {
      result = (left.typeLabel || "").localeCompare(right.typeLabel || "", undefined, { sensitivity: "base" });
    } else if (sortKey === "size") {
      result = compareNullable(left.size, right.size);
    } else if (sortKey === "createdOn") {
      result = compareNullable(
        left.createdOn ? Date.parse(left.createdOn) : null,
        right.createdOn ? Date.parse(right.createdOn) : null
      );
    } else {
      result = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    }
    if (result && (
      (sortKey === "size" && (left.size == null || right.size == null)) ||
      (sortKey === "createdOn" && (!left.createdOn || !right.createdOn))
    )) {
      return result;
    }
    return result ? result * multiplier : left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

function compareNullable(left, right) {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

function renderBreadcrumbs() {
  const crumbs = [{ label: state.docsPath, path: "" }];
  if (state.currentFolder) {
    const segments = state.currentFolder.split("/");
    let path = "";
    for (const segment of segments) {
      path = path ? `${path}/${segment}` : segment;
      crumbs.push({ label: segment, path });
    }
  }

  ui.breadcrumbs.innerHTML = crumbs.map((crumb, index) => {
    const current = index === crumbs.length - 1;
    const button = `<button type="button" class="breadcrumb-button" data-folder-path="${escapeHtml(crumb.path)}"${current ? ' aria-current="page"' : ""}>${escapeHtml(crumb.label)}</button>`;
    return `${button}${current ? "" : '<span class="breadcrumb-separator">/</span>'}`;
  }).join("");
}

function renderRows(items) {
  ui.rows.replaceChildren();
  ui.empty.classList.toggle("visible", items.length === 0);
  ui.emptyMessage.textContent = state.searchTerm
    ? "No files match your search."
    : state.fileFilter !== "folder" ? "No files match this filter." : "No documents found.";
  ui.itemCount.textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
  if (!items.length) return;

  const rows = items.map((item) => {
    const row = document.createElement("tr");
    row.draggable = state.isDemoAdmin && !isGitHubPages;
    row.dataset.path = item.relativePath;
    if (item.kind === "folder") row.dataset.folderPath = item.relativePath;
    const checkboxCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.path = item.relativePath;
    checkbox.checked = state.selected.has(item.relativePath);
    row.classList.toggle("is-selected", checkbox.checked);
    checkbox.setAttribute("aria-label", `Select ${item.name}`);
    checkboxCell.append(checkbox);

    const nameCell = document.createElement("td");
    nameCell.className = "name-cell";
    const nameButton = document.createElement("button");
    nameButton.type = "button";
    nameButton.className = "name-button";
    nameButton.innerHTML = `${item.kind === "folder" ? folderIcon() : fileIcon()}<span>${escapeHtml(item.name)}</span>`;
    if (item.kind === "folder") nameButton.dataset.folderPath = item.relativePath;
    else nameButton.dataset.filePath = item.relativePath;
    nameCell.append(nameButton);
    if (state.searchTerm && item.kind === "file") {
      const location = document.createElement("div");
      location.className = "item-location";
      location.textContent = item.parentPath || state.docsPath;
      nameCell.append(location);
    }

    const typeCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "type-badge";
    badge.textContent = item.kind === "folder" ? "Folder" : item.typeLabel;
    typeCell.append(badge);

    const sizeCell = document.createElement("td");
    sizeCell.className = "size-cell";
    sizeCell.textContent = item.kind === "folder" ? "—" : formatSize(item.size);
    const createdOnCell = document.createElement("td");
    createdOnCell.className = "created-on-cell";
    const dateValue = formatDateTime(item.createdOn);
    const dateText = document.createElement("span");
    dateText.textContent = dateValue;
    createdOnCell.append(dateText);
    if (item.createdOn && dateValue !== "—") {
      const relativeDate = document.createElement("span");
      relativeDate.className = "relative-date";
      relativeDate.textContent = formatRelativeTime(item.createdOn);
      createdOnCell.append(relativeDate);
    }
    const actionCell = document.createElement("td");
    actionCell.className = "action-cell";
    if (item.kind === "file") {
      const downloadLink = document.createElement("a");
      downloadLink.className = "download-button";
      downloadLink.href = getFileUrl(item.relativePath);
      downloadLink.download = item.name;
      downloadLink.dataset.downloadPath = item.relativePath;
      downloadLink.dataset.downloadName = item.name;
      downloadLink.setAttribute("aria-label", `Download ${item.name}`);
      downloadLink.title = `Download ${item.name}`;
      downloadLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      actionCell.append(downloadLink);
    }
    row.append(checkboxCell, nameCell, typeCell, sizeCell, createdOnCell, actionCell);
    return row;
  });
  ui.rows.append(...rows);
}

function renderSelectionState(items = getVisibleItems()) {
  const selectedCount = items.filter((item) => state.selected.has(item.relativePath)).length;
  const selectedItems = [...state.selected]
    .map((path) => state.items.find((item) => item.relativePath === path))
    .filter(Boolean);
  const selectedOutsideFolder = selectedItems.filter((item) => item.parentPath !== state.currentFolder).length;
  ui.selectAll.checked = items.length > 0 && selectedCount === items.length;
  ui.selectAll.indeterminate = selectedCount > 0 && selectedCount < items.length;
  ui.remove.disabled = state.selected.size === 0;
  ui.selectionStatus.textContent = state.selected.size
    ? `${state.selected.size} selected${selectedOutsideFolder ? ` · ${selectedOutsideFolder} in other folders` : ""}`
    : "";
  const canMove = state.isDemoAdmin && selectedItems.some((item) => canMoveItem(item, state.currentFolder));
  ui.moveHere.hidden = !canMove;
  ui.moveHere.textContent = `Move Here (${state.selected.size})`;
  ui.moveHere.disabled = !canMove || isGitHubPages;
  ui.moveHere.title = isGitHubPages
    ? "Moving files requires the optional write-enabled API server."
    : `Move selected items into ${state.currentFolder || DOCUMENTS_PATH}`;
}

function toggleSelectAll(event) {
  for (const item of getVisibleItems()) {
    if (event.target.checked) state.selected.add(item.relativePath);
    else state.selected.delete(item.relativePath);
  }
  render();
}

async function handleUpload(event, includeDirectoryPath = false) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  beginActivity("Uploading files", files.map((file) => ({
    name: includeDirectoryPath ? file.webkitRelativePath : file.name,
    status: "Waiting",
    progress: 0
  })));
  renderActivity();
  ui.fileInput.value = "";
  ui.folderInput.value = "";
  ui.upload.disabled = true;
  ui.uploadFolder.disabled = true;
  let uploaded = 0;
  const failures = [];
  try {
    for (const [index, file] of files.entries()) {
      const filePath = includeDirectoryPath ? file.webkitRelativePath : file.name;
      const path = [state.currentFolder, filePath].filter(Boolean).join("/");
      updateActivity(index, { status: "Uploading", progress: 0 });
      try {
        await uploadFile(path, file, (progress) => updateActivity(index, { progress }));
        uploaded += 1;
        updateActivity(index, { status: "Uploaded", progress: 100 });
      } catch (error) {
        failures.push({ file: file.name, error });
        updateActivity(index, { status: `Failed: ${error.message}`, progress: 0 });
      }
      state.activity.summary = `Processed ${index + 1} of ${files.length} files.`;
      renderActivity();
    }
    await refreshRepository({ preserveFolder: true });
    finishActivity(
      failures.length ? "Upload Completed with Errors" : "Upload Completed",
      failures.length
        ? `Uploaded ${uploaded} of ${files.length} files; ${failures.length} failed.`
        : `Uploaded ${uploaded} file${uploaded === 1 ? "" : "s"}.`
    );
  } catch (error) {
    finishActivity("Upload Failed", error.message);
    showToast(error.message);
  } finally {
    ui.upload.disabled = false;
    ui.uploadFolder.disabled = false;
  }
}

function beginActivity(title, items) {
  state.activity = { title, summary: "Starting...", busy: true, minimized: false, items };
  renderActivity();
}

function updateActivity(index, updates) {
  if (!state.activity) return;
  state.activity.items[index] = { ...state.activity.items[index], ...updates };
  renderActivity();
}

function finishActivity(title, summary) {
  if (!state.activity) return;
  state.activity.title = title;
  state.activity.summary = summary;
  state.activity.busy = false;
  state.activity.minimized = true;
  renderActivity();
}

async function uploadFile(path, file, onProgress) {
  if (isGitHubPages) {
    throw new Error("Uploads require the optional write-enabled API server; GitHub Pages is static and read-only.");
  }
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", "/api/docs/files");
    request.setRequestHeader("Content-Type", "application/json");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    });
    request.addEventListener("load", () => {
      let payload;
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        reject(new Error(`Upload server returned an invalid response (${request.status}).`));
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        reject(new Error(payload.error || `Upload failed (${request.status}).`));
        return;
      }
      resolve(payload);
    });
    request.addEventListener("error", () => reject(new Error("Network error while uploading the file.")));
    request.addEventListener("abort", () => reject(new Error("File upload was interrupted.")));
    fileToBase64(file)
      .then((contentBase64) => request.send(JSON.stringify({ path, contentBase64 })))
      .catch(reject);
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(reader.error || new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });
}

async function handleMoveSelected() {
  const movable = getRootItems(getSelectedItems())
    .filter((item) => canMoveItem(item, state.currentFolder));
  if (!movable.length) return;
  if (isGitHubPages) {
    showToast("Moving files requires the optional write-enabled API server; GitHub Pages is static and read-only.");
    return;
  }

  return moveItems(movable.map((item) => item.relativePath), state.currentFolder);
}

async function moveItems(paths, destination) {
  const movable = getRootItems(paths
    .map((path) => state.items.find((item) => item.relativePath === path))
    .filter(Boolean))
    .filter((item) => canMoveItem(item, destination));
  if (!movable.length) return;
  if (isGitHubPages) {
    showToast("Moving files requires the optional write-enabled API server; GitHub Pages is static and read-only.");
    return;
  }

  const itemPaths = movable.map((item) => item.relativePath);
  beginActivity("Moving files", movable.map((item) => ({
    name: item.relativePath,
    status: "Waiting",
    progress: 0
  })));
  try {
    movable.forEach((_item, index) => updateActivity(index, { status: "Preparing", progress: 35 }));
    state.activity.summary = `Preparing ${movable.length} selected item${movable.length === 1 ? "" : "s"}...`;
    renderActivity();
    movable.forEach((_item, index) => updateActivity(index, { status: "Committing", progress: 70 }));
    state.activity.summary = `Committing move into ${destination || DOCUMENTS_PATH}...`;
    renderActivity();
    const response = await apiRequest("/api/docs/move", {
      method: "POST",
      body: JSON.stringify({ paths: itemPaths, destination })
    });
    movable.forEach((_item, index) => updateActivity(index, { status: "Moved", progress: 100 }));
    applyLocalMove(movable, destination);
    const createdDateErrors = await loadCreatedDates(state.items);
    for (const path of itemPaths) {
      for (const selectedPath of state.selected) {
        if (selectedPath === path || selectedPath.startsWith(`${path}/`)) state.selected.delete(selectedPath);
      }
    }
    render();
    finishActivity("Files Moved", `Moved ${response.movedCount} file${response.movedCount === 1 ? "" : "s"} into ${destination || DOCUMENTS_PATH}.`);
    if (createdDateErrors) {
      showToast(`Moved successfully, but creation dates could not be retrieved for ${createdDateErrors} item${createdDateErrors === 1 ? "" : "s"}.`);
    }
  } catch (error) {
    finishActivity("Move Failed", error.message);
    showToast(error.message);
  }
}

function applyLocalMove(roots, destination) {
  const movedItems = state.items.map((item) => {
    const root = roots.find((candidate) =>
      item.relativePath === candidate.relativePath ||
      item.relativePath.startsWith(`${candidate.relativePath}/`)
    );
    if (!root) return item;
    const suffix = item.relativePath.slice(root.relativePath.length);
    const relativePath = [destination, root.name].filter(Boolean).join("/") + suffix;
    return {
      ...item,
      path: `${DOCUMENTS_PATH}/${relativePath}`,
      relativePath,
      parentPath: relativePath.split("/").slice(0, -1).join("/"),
      createdOn: null
    };
  });
  state.items = movedItems.filter((item) =>
    item.kind !== "folder" || item.hasGitkeep ||
    movedItems.some((candidate) => candidate.relativePath.startsWith(`${item.relativePath}/`))
  );
}

function renderActivity() {
  if (!state.activity) {
    ui.activityPanel.hidden = true;
    ui.activityItems.replaceChildren();
    return;
  }

  ui.activityPanel.hidden = false;
  ui.activityPanel.classList.toggle("is-minimized", Boolean(state.activity.minimized));
  ui.activityTitle.textContent = state.activity.title;
  ui.activitySummary.textContent = state.activity.summary;
  ui.activityClose.disabled = state.activity.busy;
  ui.activityItems.replaceChildren(...state.activity.items.map((item) => {
    const row = document.createElement("div");
    row.className = "activity-item";
    const description = document.createElement("div");
    description.className = "activity-item-description";
    const name = document.createElement("span");
    name.className = "activity-item-name";
    name.textContent = item.name;
    const status = document.createElement("span");
    status.className = `activity-item-status${item.status.startsWith("Failed") ? " is-error" : item.status === "Uploaded" ? " is-done" : ""}`;
    status.textContent = item.status;
    description.append(name, status);
    row.append(description);
    if (Number.isFinite(item.progress)) {
      const progress = document.createElement("progress");
      progress.max = 100;
      progress.value = item.progress;
      progress.setAttribute("aria-label", `${item.name}: ${item.progress}% uploaded`);
      row.append(progress);
    }
    return row;
  }));
}

async function handleCreateFolder() {
  const name = window.prompt("Folder name");
  if (name === null || !name.trim()) return;
  beginActivity("Creating folder", [{
    name: [state.currentFolder, name.trim()].filter(Boolean).join("/"),
    status: "Creating",
    progress: 40
  }]);
  if (isGitHubPages) {
    finishActivity("Folder Creation Unavailable", "GitHub Pages is static and read-only.");
    return;
  }
  try {
    await apiRequest("/api/docs/folders", {
      method: "POST",
      body: JSON.stringify({ path: [state.currentFolder, name.trim()].filter(Boolean).join("/") })
    });
    await refreshRepository({ preserveFolder: true });
    finishActivity("Folder Created", `Created folder ${name.trim()}.`);
  } catch (error) {
    finishActivity("Folder Creation Failed", error.message);
    showToast(error.message);
  }
}

async function handleRemoveSelected() {
  const selected = getSelectedRoots();
  if (!selected.length) return;
  if (isGitHubPages) {
    showToast("Deleting files requires the optional write-enabled API server.");
    return;
  }
  beginActivity("Deleting files", selected.map((item) => ({
    name: item.relativePath,
    status: "Waiting",
    progress: 0
  })));
  let deletedCount = 0;
  try {
    for (const [index, item] of selected.entries()) {
      updateActivity(index, { status: "Deleting", progress: 35 });
      state.activity.summary = `Deleting ${index + 1} of ${selected.length}: ${item.name}`;
      renderActivity();
      const response = await apiRequest("/api/docs/files", {
        method: "DELETE",
        body: JSON.stringify({ paths: [item.relativePath] })
      });
      deletedCount += response.deletedCount;
      updateActivity(index, { status: "Deleted", progress: 100 });
    }
    state.selected.clear();
    await refreshRepository({ preserveFolder: true });
    finishActivity("Files Deleted", `Deleted ${deletedCount} file${deletedCount === 1 ? "" : "s"}.`);
  } catch (error) {
    finishActivity("Delete Incomplete", `Deleted ${deletedCount} files before the operation failed: ${error.message}`);
    showToast(error.message);
  }
}

function getSelectedItems() {
  return [...state.selected]
    .map((path) => state.items.find((item) => item.relativePath === path))
    .filter(Boolean);
}

function getSelectedRoots() {
  return getRootItems(getSelectedItems());
}

function getRootItems(items) {
  return items.filter((item) => !items.some((parent) =>
    parent !== item && item.relativePath.startsWith(`${parent.relativePath}/`)
  ));
}

function canDropOn(destination) {
  return state.isDemoAdmin && !isGitHubPages &&
    state.draggedPaths.some((path) => {
      const item = state.items.find((candidate) => candidate.relativePath === path);
      return item && canMoveItem(item, destination);
    });
}

function clearDragStyles() {
  state.draggedPaths = [];
  document.querySelectorAll(".is-dragging, .is-drop-target").forEach((element) => {
    element.classList.remove("is-dragging", "is-drop-target");
  });
}

function canMoveItem(item, destination) {
  if (item.parentPath === destination) return false;
  if (item.kind === "folder" &&
    (destination === item.relativePath || destination.startsWith(`${item.relativePath}/`))) {
    return false;
  }
  return true;
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload;
}

async function handleDownload(path, filename) {
  state.activity = null;
  renderActivity();
  try {
    const response = await fetch(getFileUrl(path));
    if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  } catch (error) {
    console.error(error);
    showToast(error.message);
  }
}

function getFileUrl(relativePath) {
  const path = `${DOCUMENTS_PATH}/${relativePath}`.split("/").map(encodeURIComponent).join("/");
  return `${RAW_GITHUB}/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/${encodeURIComponent(REPOSITORY_BRANCH)}/${path}`;
}

function folderIcon() {
  return '<span class="item-icon folder" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H10l2 2h6.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5v-9Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M3 10.5h18" stroke="currentColor" stroke-width="1.7"/></svg></span>';
}

function fileIcon() {
  return '<span class="item-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M7 3.5h6l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 6 20V5A1.5 1.5 0 0 1 7.5 3.5Zm6 0v4h4" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 12h6M9 15h6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></span>';
}

function formatSize(size) {
  if (!Number.isFinite(size)) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("month")}/${part("day")}/${part("year")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

function formatRelativeTime(value) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "";
  const elapsed = Date.now() - timestamp;
  const units = [
    ["year", 365 * 24 * 60 * 60 * 1000],
    ["month", 30 * 24 * 60 * 60 * 1000],
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
    ["second", 1000]
  ];
  const [unit, duration] = units.find(([, size]) => Math.abs(elapsed) >= size) || units.at(-1);
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" })
    .format(Math.round(-elapsed / duration), unit);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 3200);
}

function hideToast() {
  ui.toast.hidden = true;
  clearTimeout(toastTimer);
}
