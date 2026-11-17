import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        cairo: ['Cairo', 'Arial', 'sans-serif'],
      },
      colors: {
        rawad: {
          50: '#eef4ff',
          100: '#dce7ff',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#0022b8',
          800: '#00188a',
          900: '#0b1536',
        },
      },
    },
  },
  plugins: [],
};

export default config;
