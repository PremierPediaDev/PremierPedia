# PremierPedia

PremierPedia is a small GitHub-backed document browser. Its server reads the configured repository's `PremierPedia/` tree through the GitHub REST API and performs uploads, replacements, removals, and file viewing through that same API. The browser never receives the GitHub token.

The GitHub repository is the source of truth. Git does not store empty directories, so newly created empty folders are represented by a hidden `.gitkeep` marker. Uploading the first document creates the path through the normal GitHub contents API.

## Requirements

- Node.js 20 or newer
- A GitHub token with repository **Contents: Read and write** permission to upload, replace, or delete files. Reading public repository contents does not require a token.

## Configure

```sh
npm install
cp .env.example .env
```

Set `GITHUB_TOKEN` in `.env` for write operations. The default repository settings are `PremierPediaDev/PremierPedia` and `PremierPedia/`; they can be overridden with `GITHUB_OWNER`, `GITHUB_REPO_NAME`, and `GITHUB_DOCS_PATH`. `GITHUB_BRANCH` is optional and defaults to the repository's default branch. Keep `.env` private; it is ignored by Git.

## Start

```sh
npm start
```

Open <http://localhost:3000>. Use `PORT` in `.env` to select another port. For development with automatic server restarts:

```sh
npm run dev
```

## API

- `GET /api/health` — server health
- `GET /api/docs` — recursively lists files and derives nested folders from the Git tree; an absent or empty `PremierPedia/` tree returns `{ "items": [] }`
- `GET /api/docs/file?path=relative/path` — serves browser-supported file types inline and downloads other types
- `POST /api/docs/folders` — creates a folder. JSON body: `{ "path": "optional/parent/new-folder" }`
- `PUT /api/docs/files` — creates or replaces a file. JSON body: `{ "path": "optional/subfolder/name.ext", "contentBase64": "..." }`
- `DELETE /api/docs/files` — removes selected files or every file below selected folders. JSON body: `{ "paths": ["name.ext", "folder"] }`

The browser searches file names across the full recursive listing, regardless of the folder currently being browsed. To keep the server-side write token private, run this no-login POC only in an environment whose network access is appropriate for the repository write permissions it exposes.

## Tests

```sh
npm test
```
