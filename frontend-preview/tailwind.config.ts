import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // CoESCD design tokens
        "coescd-bg": "#0f1117",
        "coescd-card": "#141820",
        "coescd-sidebar": "#181e28",
        "coescd-border": "#252d3d",
        "coescd-text": "#f0f1f5",
        "coescd-muted": "#9ba3b5",
        "coescd-subtle": "#6b7589",
        "coescd-primary": "#5b8def",
        "coescd-primary-dim": "#3a6bc7",
        // Severity colors
        "severity-1": "#4ead7a",
        "severity-2": "#e6a020",
        "severity-3": "#dd6020",
        "severity-4": "#cc2d1a",
        // Severity backgrounds (very subtle tints)
        "severity-bg-1": "rgba(78,173,122,0.08)",
        "severity-bg-2": "rgba(230,160,32,0.08)",
        "severity-bg-3": "rgba(221,96,32,0.08)",
        "severity-bg-4": "rgba(204,45,26,0.08)",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        DEFAULT: "6px",
        sm: "4px",
        md: "8px",
        lg: "10px",
      },
      spacing: {
        "topbar": "48px",
        "sidebar": "240px",
      },
      animation: {
        "pulse-slow": "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "pulse-fast": "pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
