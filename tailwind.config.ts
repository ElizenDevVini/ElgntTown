import type { Config } from 'tailwindcss'
const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        card: {
          DEFAULT: "#ffffff",
          muted: "#fafafa",
          border: "#e5e7eb"
        }
      },
      boxShadow: {
        soft: "0 10px 30px rgba(0,0,0,0.08)"
      },
      backdropBlur: {
        xs: "2px"
      }
    },
  },
  plugins: [],
}
export default config
