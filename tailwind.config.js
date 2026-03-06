import plugin from 'tailwindcss/plugin';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          50: '#f0f7fb',
          100: '#dceef8',
          200: '#bfe0f2',
          300: '#90cbee',
          400: '#6ba9dc', // brand-sky
          500: '#468cc6',
          600: '#2a70ab', // brand-blue
          700: '#255989',
          800: '#214c72',
          900: '#1f415f',
          950: '#14293f',
        },
        surface: {
          50: '#f9fafa',
          100: '#f2f2f2', // brand-offwhite
          200: '#dce1e6', // brand-offwhite-dark
          300: '#b0bcc2',
          400: '#78a0a5', // brand-slate-lighter
          500: '#5d7b80',
          600: '#42565a', // brand-slate-light
          700: '#2d3d41',
          800: '#1f2e3c', // brand-slate
          900: '#16212b',
          950: '#0f0f0f', // brand-black
        },
        brand: {
          black: '#0f0f0f',
          slate: '#1f2e3c',
          'slate-light': '#42565a',
          'slate-lighter': '#78a0a5',
          sky: '#6ba9dc',
          blue: '#2a70ab',
          offwhite: '#f2f2f2',
          'offwhite-dark': '#dce1e6',
        }
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.5s ease-out',
        'slide-in-right': 'slideInRight 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fadeInUp': 'fadeInUp 0.4s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        fadeInUp: {
          '0%': { transform: 'translateY(12px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        }
      }
    },
  },
  plugins: [
    plugin(function ({ addUtilities }) {
      addUtilities({
        '.scrollbar-hide': {
          /* IE and Edge */
          '-ms-overflow-style': 'none',
          /* Firefox */
          'scrollbar-width': 'none',
          /* Safari and Chrome */
          '&::-webkit-scrollbar': {
            display: 'none'
          }
        }
      })
    })
  ],
}
