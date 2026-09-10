import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/app/**/*.{ts,tsx}", "./src/components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Named "canvas", not "base" — Tailwind's default theme has a
        // fontSize key "base" (1rem); a color sharing that name silently
        // makes `text-base` also set this color.
        canvas: "#0A0A0F",
        surface: { from: "#12141A", to: "#0C0D11" }, // card gradient stops
        ink: {
          heading: "#F2F3F5", // off-white — not pure white (avoids halation on near-black)
          body: "#9BA1AC",
          label: "#7E8592",
        },
        accent: {
          light: "#2DD4BF", // teal-400
          DEFAULT: "#14B8A6", // teal-500
          dark: "#0F9488", // teal-600
        },
        // Reserved ONLY for "real / settled / on-chain confirmed" — kept
        // visually distinct from the teal accent on purpose.
        success: "#4ADE80",
        // Dark ink for use ON the teal demo section (the one inverted block).
        "on-accent": {
          heading: "#06120F",
          body: "rgba(6,18,15,0.72)",
          label: "#06231F",
        },
      },
      fontFamily: {
        display: ["var(--font-space-grotesk)", "sans-serif"],
        body: ["var(--font-inter)", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      borderColor: {
        subtle: "rgba(20,184,166,0.15)",
        strong: "rgba(20,184,166,0.32)",
        hair: "rgba(255,255,255,0.06)", // neutral divider (nav/footer/section)
      },
      backgroundImage: {
        "accent-gradient": "linear-gradient(135deg, #2DD4BF 0%, #14B8A6 55%, #0F9488 100%)",
        "surface-gradient": "linear-gradient(160deg, #12141A 0%, #0C0D11 100%)",
        "demo-gradient": "linear-gradient(160deg, #14B8A6 0%, #0C8A7D 100%)",
      },
      boxShadow: {
        // The signature "glow" — a 1px solid ring PLUS a soft diffuse shadow.
        glow: "0 0 0 1px rgba(20,184,166,0.15), 0 8px 40px -12px rgba(20,184,166,0.35)",
      },
      maxWidth: {
        content: "1140px",
      },
    },
  },
  plugins: [],
};

export default config;
