# 001 — Project plan and architecture

## Goal
Write down the plan, architecture and working rules before any code.

## Changes
- Added `PLAN.md`: flow, architecture diagram, reasoning, components, free tool stack, project structure, data model, phases, risks.
- Added `CLAUDE.md`: mandatory docs-per-change workflow and conventions.
- Stack set by owner: **React + TypeScript** (client), **Node.js + Express** (server).
- Phases set by owner:
  1. Setup + profile + capture
  2. Understand + filter + score
  3. Draft + review + send
  4. (Optional) Friendlier, modular UI for beginners
- Database: SQLite through Node's built-in `node:sqlite` instead of `better-sqlite3`, because Node 25 is installed and the built-in module needs no native compile.

## Status
Done.
