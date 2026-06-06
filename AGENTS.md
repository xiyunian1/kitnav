# Repository Guidelines

## Project Structure & Module Organization

This is a Next.js 16 App Router application with Prisma and SQLite. Routes live in `src/app`, grouped as `(app)` for authenticated pages, `(auth)` for login/register, `(marketing)` for public pages, `admin` for back office pages, and `api` for route handlers. Shared UI components are in `src/components`; business logic is in `src/lib`; type augmentations are in `src/types`. Prisma files are in `prisma/`, scripts in `scripts/`, and static/uploaded assets in `public/`, especially `public/uploads/materials`.

## Build, Test, and Development Commands

- `npm run dev`: start the local Next.js dev server.
- `npm run build`: run `prisma generate` and create a production build.
- `npm run start`: serve the production build locally.
- `npm run lint`: run ESLint with the Next.js config.
- `npm run db:push`: sync the Prisma schema to the local database.
- `npm run db:seed`: seed initial data with `prisma/seed.ts`.
- `npm run db:reset`: reset the local DB, then seed it again.

If `npm run build` hits a Windows Prisma DLL rename error, stop Node processes and retry. Use `npx next build` to verify Next compilation without regenerating Prisma.

## Coding Style & Naming Conventions

Use TypeScript and React server components by default; add `"use client"` only for stateful or browser-only UI. Use two-space indentation. Prefer named exports for shared components and utilities. Use kebab-case for route folders and component files such as `material-card.tsx`, PascalCase for React components, and camelCase for functions and variables. Keep Zod schemas near related API or form logic.

## Testing Guidelines

No dedicated test runner is configured. Run `npm run lint` and `npx next build` before submitting changes. For schema changes, also run `npm run db:push` locally and manually verify affected flows, especially image generation, materials, credits, auth, and admin pages.

## Commit & Pull Request Guidelines

This checkout does not include Git history, so use clear, imperative commit messages such as `Hide user generation history page` or `Fix material upload preview`. PRs should include a summary, affected routes/APIs, verification commands, migration notes if applicable, and screenshots for UI changes.

## Security & Configuration Tips

Do not commit `.env`, database files, API keys, OAuth secrets, or production credentials. Keep examples in `.env.example` or `.env.production.example`. Uploaded files should stay under `public/uploads/materials`; avoid path traversal when adding file-serving routes. Preserve admin-only protections for `/admin` and keep user-owned data filtered by `userId`.
