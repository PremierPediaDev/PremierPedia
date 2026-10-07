"use strict";

const state = {
  items: [],
  docsPath: "docs",
  currentFolder: "",
  selected: new Set(),
  searchTerm: ""
};

const ui = {
  search: document.getElementById("searchInput"),
  rows: document.getElementById("fileRows"),
  breadcrumbs: document.getElementById("breadcrumbs"),
  itemCount: document.getElementById("itemCount"),
  refresh: document.getElementById("refreshButton"),
  createFolder: document.getElementById("createFolderButton"),
  upload: document.getElementById("uploadButton"),
  remove: document.getElementById("removeButton"),
  fileInput: document.getElementById("fileInput"),
  selectAll: document.getElementById("selectAll"),
  empty: document.getElementById("emptyState"),
  emptyMessage: document.querySelector("#emptyState p"),
  toast: document.getElementById("toast")
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
  ui.refresh.addEventListener("click", refreshRepository);
  ui.createFolder.addEventListener("click", handleCreateFolder);
  ui.upload.addEventListener("click", () => ui.fileInput.click());
  ui.fileInput.addEventListener("change", handleUpload);
  ui.remove.addEventListener("click", handleRemoveSelected);
  ui.selectAll.addEventListener("change", toggleSelectAll);

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

async function refreshRepository({ preserveFolder = false } = {}) {
  ui.refresh.disabled = true;
  ui.emptyMessage.textContent = "Loading documents...";
  try {
    const response = await apiRequest("/api/docs");
    state.docsPath = response.docsPath;
    state.items = response.items;
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
    return state.items.filter((item) =>
      item.kind === "file" && item.name.toLocaleLowerCase().includes(state.searchTerm)
    );
  }

  return state.items.filter((item) => item.parentPath === state.currentFolder);
}

function render() {
  const items = getVisibleItems();
  renderBreadcrumbs();
  renderRows(items);
  renderSelectionState(items);
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
    : "Upload a document to get started.";
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
    if (item.kind === "file") {
      const downloadLink = document.createElement("a");
      downloadLink.className = "file-download";
      downloadLink.href = getFileUrl(item.relativePath);
      downloadLink.download = item.name;
      downloadLink.textContent = "Download";
      downloadLink.setAttribute("aria-label", `Download ${item.name}`);
      nameCell.append(downloadLink);
    }
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
    const modifiedCell = document.createElement("td");
    modifiedCell.className = "modified-cell";
    modifiedCell.textContent = "—";
    row.append(checkboxCell, nameCell, typeCell, sizeCell, modifiedCell);
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
  ui.upload.disabled = true;
  ui.fileInput.value = "";
  try {
    for (const file of files) {
      const relativePath = [uploadFolder, file.name].filter(Boolean).join("/");
      try {
        await apiRequest("/api/docs/files", {
          method: "PUT",
          body: JSON.stringify({ path: relativePath, contentBase64: await fileToBase64(file) })
        });
      } catch (error) {
        console.error(error);
        failures.push({ file, error });
      }
    }

    state.currentFolder = uploadFolder;
    await refreshRepository({ preserveFolder: true });
    const uploadedCount = files.length - failures.length;
    if (failures.length) {
      const failedNames = failures.map(({ file }) => file.name).join(", ");
      showToast(`Uploaded ${uploadedCount} of ${files.length} files. Failed: ${failedNames}. ${failures[0].error.message}`);
    } else {
      showToast(`Uploaded ${uploadedCount} file${uploadedCount === 1 ? "" : "s"}.`);
    }
  } finally {
    ui.fileInput.value = "";
    ui.upload.disabled = false;
  }
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
