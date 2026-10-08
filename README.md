# PremierPedia

PremierPedia's main website is a static GitHub Pages site. The browser reads the public `PremierPedia/` folder in this repository through GitHub's public REST API and fetches documents directly from `raw.githubusercontent.com`. It works on GitHub Pages and does not depend on `localhost:3000`, a running Node.js server, or a browser-side GitHub token.

The site supports recursive search, file-type filters, sorting, creation dates, and downloads. The Created On column shows each file and folder's latest commit timestamp (`MM/DD/YYYY HH:MM:SS`) and relative age. Selections persist while browsing folders; with the optional write API, selected files/folders can be moved to the open folder, individual files or whole directory trees can be uploaded, and selected paths can be deleted. Upload, move, and delete operations show progress and a minimized completion message. The hosted static site is read-only. Its **Demo Admin Sign In** button only previews the admin controls; changes require the optional write-enabled Node API and are intentionally unavailable from GitHub Pages.

## GitHub Pages

In the repository's **Settings → Pages**, publish the `main` branch from the repository root. `index.html`, `index.css`, and `index.js` are relative-path assets so they load under the project-site URL (`/PremierPedia/`). No build step is required.

The static browser reads from `PremierPedia/` on the `main` branch of `PremierPediaDev/PremierPedia`. To change that source, update the constants at the top of `index.js`.

## Local preview

Node.js is not required to preview the static site. From the repository root, run:

```sh
python3 -m http.server 8000
```

Then open <http://localhost:8000>. The same GitHub API and raw file URLs are used locally and on Pages.

## Optional Node API

`server.js` remains available as an optional API for deployments that need server-side GitHub write operations. It is not used by or required for the static Pages website. To run the API, use Node.js 20 or newer:

```sh
npm install
cp .env.example .env
npm start
```

Set a private `GITHUB_TOKEN` in `.env` to enable API write operations. Never put this token in static-site JavaScript or publish it through GitHub Pages.

The API provides:

- `GET /api/health` — server health
- `GET /api/docs` — recursively lists files, derives nested folders from the Git tree, and includes each file and folder's latest commit date; an absent or empty `PremierPedia/` tree returns `{ "items": [] }`
- `GET /api/docs/file?path=relative/path` — serves browser-supported file types inline and downloads other types
- `POST /api/docs/folders` — creates a folder. JSON body: `{ "path": "optional/parent/new-folder" }`
- `PUT /api/docs/files` — creates or replaces a file. JSON body: `{ "path": "optional/subfolder/name.ext", "contentBase64": "..." }`
- `POST /api/docs/move` — atomically moves selected files or folders. JSON body: `{ "paths": ["folder/file.txt", "another.txt"], "destination": "target/folder" }`; use an empty destination for the `PremierPedia/` root.
- `DELETE /api/docs/files` — removes selected files or every file below selected folders. JSON body: `{ "paths": ["name.ext", "folder"] }`

## Tests

```sh
npm test
```
