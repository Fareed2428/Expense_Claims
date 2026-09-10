/** @type {import('next').NextConfig} */
const nextConfig = {
  // This project keeps its own CLAUDE.md as the permanent project
  // instruction file (see CLAUDE.md at the repo root). Next.js's
  // `next dev`/`next build` otherwise auto-generates/appends an
  // "agent rules" block to that same file, which would silently
  // conflict with it — disabled here so CLAUDE.md stays exactly
  // what this project has deliberately written.
  agentRules: false,
};

export default nextConfig;
