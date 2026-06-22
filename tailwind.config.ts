import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // ─── Design system OLDA ───
        ink: "#202930", // texte principal (encre froide)
        muted: "#5B6B78", // texte secondaire
        muted2: "#7A8893", // texte tertiaire / micro-labels
        sage: "#8BA0AF",
        duck: {
          DEFAULT: "#4A6274", // accent principal (action active)
          hover: "#42596A",
          focus: "#6B8191", // anneau de focus
        },
        accent: "#4A6274", // alias historique → duck
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Display"',
          '"Segoe UI"',
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        // ombre froide teintée canard (jamais noire pure)
        olda: "0 1px 3px rgba(32,41,48,.06),0 14px 36px rgba(74,98,116,.12)",
      },
    },
  },
  plugins: [],
} satisfies Config;
