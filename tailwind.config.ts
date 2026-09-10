import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Role accent colors, kept minimal here in Phase 0 — real usage
        // (dashboards, badges) arrives in later phases.
        staff: "#2563eb",
        manager: "#7c3aed",
        finance: "#059669",
      },
    },
  },
  plugins: [],
};

export default config;
