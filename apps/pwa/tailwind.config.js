/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      colors: {
        // Navis Brand Colors
        navy: '#0E2A47',
        white: '#FFFFFF',
        slate: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
        },
        divider: '#E6E8EB',
        teal: '#14B8A6',

        // Semantic colors with brand application
        status: {
          ready: '#14B8A6',
          running: '#14B8A6',
          paused: '#F59E0B',
          stopped: '#64748B',
          degraded: '#F59E0B',
          error: '#EF4444',
        },
      },
      fontFamily: {
        sans: ['Source Sans 3', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      fontWeight: {
        regular: '400',
        medium: '500',
        semibold: '600',
      },
      spacing: {
        // Base 8px system
        0.5: '4px',
        1: '8px',
        1.5: '12px',
        2: '16px',
        2.5: '20px',
        3: '24px',
        3.5: '28px',
        4: '32px',
        5: '40px',
        6: '48px',
      },
      borderRadius: {
        none: '0',
        sm: '2px',
        DEFAULT: '4px',
        md: '6px',
        lg: '8px',
      },
      animation: {
        // Brand-approved motion timings
        'micro-in': 'fadeIn 120ms ease-in-out',
        'micro-out': 'fadeOut 120ms ease-in-out',
        'state-in': 'slideUp 240ms ease-in-out',
        'state-out': 'slideDown 240ms ease-in-out',
        'panel-in': 'slideIn 320ms ease-in-out',
        'panel-out': 'slideOut 320ms ease-in-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideDown: {
          '0%': { opacity: '1', transform: 'translateY(0)' },
          '100%': { opacity: '0', transform: 'translateY(8px)' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-16px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        slideOut: {
          '0%': { opacity: '1', transform: 'translateX(0)' },
          '100%': { opacity: '0', transform: 'translateX(-16px)' },
        },
      },
      boxShadow: {
        subtle: '0 1px 3px 0 rgba(15, 42, 71, 0.1)',
        card: '0 2px 8px 0 rgba(15, 42, 71, 0.08)',
      },
    },
  },
  plugins: [],
}
