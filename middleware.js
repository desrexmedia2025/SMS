// Vercel Edge Middleware.
//
// The School Management System is a single Express application exported from
// `api/index.js`. On Vercel that file becomes one serverless function served at
// `/api/index`, so every other path (`/`, `/login`, `/dashboard/teacher`, ...)
// has to be routed to it.
//
// Two mechanisms do that, and either one is enough:
//   1. `vercel.json` -> the catch-all rewrite `/(.*)` -> `/api/index.js`
//      (used when the repository is deployed through the Git integration).
//   2. This middleware, which rewrites the request to `/api/index` and passes
//      the real path through the `p` query parameter
//      (used when the project is deployed through the Vercel API/CLI without
//      configuration files).
//
// Vercel evaluates `vercel.json` rewrites before middleware, so when both are
// present the rewrite wins and this middleware never runs. `api/index.js`
// restores the original path from `p` only when the request actually arrived
// through this middleware, which keeps both paths safe.

export default function middleware(request) {
  const incoming = new URL(request.url);
  const originalPath = incoming.pathname + incoming.search;
  const target = new URL('/api/index', request.url);
  target.searchParams.set('p', originalPath);

  return new Response(null, {
    headers: {
      'x-middleware-rewrite': target.toString(),
    },
  });
}

export const config = {
  matcher: '/:path*',
};
