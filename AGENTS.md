# AGENTS.md

## Cursor Cloud specific instructions

### Project Overview

This is a purely client-side React + Vite + TypeScript SPA called "AI 错题分析与知识图谱" (AI Wrong-Question Analysis & Knowledge Graph). It uses the Google Gemini API for AI-powered image analysis of exam questions. There is no backend server, no database, and no Docker dependency.

### Services

| Service | Command | Port | Notes |
|---------|---------|------|-------|
| Vite Dev Server | `npm run dev` | 3000 | Binds to `0.0.0.0:3000` |

### Key Commands

See `package.json` scripts for the canonical list:

- **Dev server**: `npm run dev`
- **Lint (TypeScript check)**: `npm run lint` (runs `tsc --noEmit`)
- **Build**: `npm run build`
- **Preview production build**: `npm run preview`

### Environment Variables

The app requires `GEMINI_API_KEY` to be set in `.env.local` for AI features to work. The Vite config injects this at build time via `process.env.GEMINI_API_KEY`. Without a valid key, the UI loads but AI analysis calls will fail.

### Caveats

- `express` is listed in `package.json` dependencies but is **not used** anywhere in the source code. It is a leftover from AI Studio scaffolding.
- There are no automated test suites (no test script in `package.json`). The only automated check is `npm run lint`.
- The Vite config loads env from the project root (`.`), not from the default `process.cwd()`. The `.env.local` file must be placed at the repo root.
