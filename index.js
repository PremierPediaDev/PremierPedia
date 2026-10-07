"use strict";

const state = {
  items: [],
  docsPath: "docs",
  currentFolder: "",
  selected: new Set(),
  searchTerm: "",
  fileFilter: "folder",
  fileSort: "name-asc",
  activity: null,
  isDemoAdmin: false
};

const ui = {
  search: document.getElementById("searchInput"),
  fileFilter: document.getElementById("fileFilter"),
  fileSort: document.getElementById("fileSort"),
  rows: document.getElementById("fileRows"),
  breadcrumbs: document.getElementById("breadcrumbs"),
  itemCount: document.getElementById("itemCount"),
  refresh: document.getElementById("refreshButton"),
  demoSignIn: document.getElementById("demoSignInButton"),
  createFolder: document.getElementById("createFolderButton"),
  upload: document.getElementById("uploadButton"),
  remove: document.getElementById("removeButton"),
  fileInput: document.getElementById("fileInput"),
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
    state.selected.clear();
    render();
  });
  ui.fileSort.addEventListener("change", (event) => {
    state.fileSort = event.target.value;
    render();
  });
  ui.refresh.addEventListener("click", refreshRepository);
  ui.demoSignIn.addEventListener("click", toggleDemoAdmin);
  ui.createFolder.addEventListener("click", handleCreateFolder);
  ui.upload.addEventListener("click", () => ui.fileInput.click());
  ui.fileInput.addEventListener("change", handleUpload);
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
    renderSelectionState();
  });

  ui.rows.addEventListener("click", (event) => {
    const folderButton = event.target.closest("[data-folder-path]");
    if (folderButton) {
      state.currentFolder = folderButton.dataset.folderPath;
      state.selected.clear();
      render();
      return;
    }

    const fileButton = event.target.closest("[data-file-path]");
    if (fileButton) {
      window.open(getFileUrl(fileButton.dataset.filePath), "_blank", "noopener,noreferrer");
    }
  });

  ui.breadcrumbs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-folder-path]");
    if (!button) return;
    state.currentFolder = button.dataset.folderPath;
    state.selected.clear();
    render();
  });
}

function toggleDemoAdmin() {
  state.isDemoAdmin = !state.isDemoAdmin;
  document.body.classList.toggle("is-demo-admin", state.isDemoAdmin);
  ui.demoSignIn.textContent = state.isDemoAdmin ? "Demo Admin Sign Out" : "Demo Admin Sign In";
  ui.demoSignIn.setAttribute("aria-pressed", String(state.isDemoAdmin));
  ui.createFolder.hidden = !state.isDemoAdmin;
  ui.upload.hidden = !state.isDemoAdmin;
  ui.remove.hidden = !state.isDemoAdmin;
  if (!state.isDemoAdmin) state.selected.clear();
  render();
}

async function refreshRepository({ preserveFolder = false } = {}) {
  ui.refresh.disabled = true;
  ui.emptyMessage.textContent = "Loading documents...";
  try {
    const response = await apiRequest("/api/docs");
    state.docsPath = response.docsPath;
    state.items = response.items;
    renderFileFilters();
    if (!preserveFolder) state.currentFolder = "";
    state.selected.clear();
    render();
    hideToast();
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
    } else if (sortKey === "uploadedOn") {
      result = compareNullable(
        left.uploadedOn ? Date.parse(left.uploadedOn) : null,
        right.uploadedOn ? Date.parse(right.uploadedOn) : null
      );
    } else {
      result = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    }
    if (result && (
      (sortKey === "size" && (left.size == null || right.size == null)) ||
      (sortKey === "uploadedOn" && (!left.uploadedOn || !right.uploadedOn))
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
    const checkboxCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.path = item.relativePath;
    checkbox.checked = state.selected.has(item.relativePath);
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
    const uploadedOnCell = document.createElement("td");
    uploadedOnCell.className = "uploaded-on-cell";
    uploadedOnCell.textContent = formatDate(item.uploadedOn);
    const actionCell = document.createElement("td");
    actionCell.className = "action-cell";
    if (item.kind === "file") {
      const downloadLink = document.createElement("a");
      downloadLink.className = "download-button";
      downloadLink.href = getFileUrl(item.relativePath);
      downloadLink.download = item.name;
      downloadLink.setAttribute("aria-label", `Download ${item.name}`);
      downloadLink.title = `Download ${item.name}`;
      downloadLink.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      actionCell.append(downloadLink);
    }
    row.append(checkboxCell, nameCell, typeCell, sizeCell, uploadedOnCell, actionCell);
    return row;
  });
  ui.rows.append(...rows);
}

function renderSelectionState(items = getVisibleItems()) {
  const selectedCount = items.filter((item) => state.selected.has(item.relativePath)).length;
  ui.selectAll.checked = items.length > 0 && selectedCount === items.length;
  ui.selectAll.indeterminate = selectedCount > 0 && selectedCount < items.length;
  ui.remove.disabled = state.selected.size === 0;
}

function toggleSelectAll(event) {
  for (const item of getVisibleItems()) {
    if (event.target.checked) state.selected.add(item.relativePath);
    else state.selected.delete(item.relativePath);
  }
  render();
}

async function handleUpload(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  const uploadFolder = state.currentFolder;
  const failures = [];
  state.activity = {
    title: "Uploading files",
    summary: `Preparing ${files.length} file${files.length === 1 ? "" : "s"}...`,
    busy: true,
    items: files.map((file) => ({ name: file.name, status: "Waiting", progress: 0 }))
  };
  renderActivity();
  ui.upload.disabled = true;
  ui.fileInput.value = "";
  try {
    for (const [index, file] of files.entries()) {
      updateActivityItem(index, { status: "Uploading", progress: 0 });
      state.activity.summary = `Uploading ${index + 1} of ${files.length}: ${file.name}`;
      renderActivity();
      const relativePath = [uploadFolder, file.name].filter(Boolean).join("/");
      try {
        await uploadFile(relativePath, file, (progress) => updateActivityItem(index, { progress }));
        updateActivityItem(index, { status: "Uploaded", progress: 100 });
      } catch (error) {
        console.error(error);
        failures.push({ file, error });
        updateActivityItem(index, { status: `Failed: ${error.message}`, progress: 0 });
      }
    }

    state.currentFolder = uploadFolder;
    await refreshRepository({ preserveFolder: true });
    const uploadedCount = files.length - failures.length;
    state.activity.title = failures.length ? "Upload finished with errors" : "Upload complete";
    state.activity.summary = failures.length
      ? `Uploaded ${uploadedCount} of ${files.length} files.`
      : `Uploaded ${uploadedCount} file${uploadedCount === 1 ? "" : "s"}.`;
    state.activity.busy = false;
    renderActivity();
    if (failures.length) {
      const failedNames = failures.map(({ file }) => file.name).join(", ");
      showToast(`Uploaded ${uploadedCount} of ${files.length} files. Failed: ${failedNames}. ${failures[0].error.message}`);
    } else {
      showToast(`Uploaded ${uploadedCount} file${uploadedCount === 1 ? "" : "s"}.`);
    }
  } catch (error) {
    state.activity.title = "Upload could not be completed";
    state.activity.summary = error.message;
    state.activity.busy = false;
    renderActivity();
    showToast(error.message);
  } finally {
    ui.fileInput.value = "";
    ui.upload.disabled = false;
  }
}

function updateActivityItem(index, updates) {
  if (!state.activity) return;
  state.activity.items[index] = { ...state.activity.items[index], ...updates };
  renderActivity();
}

function renderActivity() {
  if (!state.activity) {
    ui.activityPanel.hidden = true;
    ui.activityItems.replaceChildren();
    return;
  }

  ui.activityPanel.hidden = false;
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
    const progress = document.createElement("progress");
    progress.max = 100;
    progress.value = item.progress;
    progress.setAttribute("aria-label", `${item.name}: ${item.progress}% uploaded`);
    row.append(description, progress);
    return row;
  }));
}

function uploadFile(path, file, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", "/api/docs/files");
    request.setRequestHeader("Content-Type", "application/json");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
    });
    request.addEventListener("load", () => {
      let payload = {};
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        reject(new Error("The upload response could not be read."));
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

async function handleCreateFolder() {
  const name = window.prompt("Folder name");
  if (name === null || !name.trim()) return;

  const path = [state.currentFolder, name.trim()].filter(Boolean).join("/");
  try {
    await apiRequest("/api/docs/folders", {
      method: "POST",
      body: JSON.stringify({ path })
    });
    await refreshRepository({ preserveFolder: true });
    showToast(`Created folder ${name.trim()}.`);
  } catch (error) {
    console.error(error);
    showToast(error.message);
  }
}

async function handleRemoveSelected() {
  if (!state.selected.size) return;
  const paths = [...state.selected];
  try {
    const result = await apiRequest("/api/docs/files", {
      method: "DELETE",
      body: JSON.stringify({ paths })
    });
    state.selected.clear();
    await refreshRepository();
    showToast(`Removed ${result.deletedCount} file${result.deletedCount === 1 ? "" : "s"}.`);
  } catch (error) {
    console.error(error);
    showToast(error.message);
  }
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(reader.error || new Error("Unable to read the selected file."));
    reader.readAsDataURL(file);
  });
}

function getFileUrl(relativePath) {
  return `/api/docs/file?path=${encodeURIComponent(relativePath)}`;
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

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
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
