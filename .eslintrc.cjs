module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'import', 'react-hooks'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',
  ],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    "@typescript-eslint/no-unused-vars": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "no-empty": "off",
    "import/no-unresolved": "off",
    // Add any project‑specific overrides here
  },
overrides: [
    {
      files: ['lib/db/dist/**/*.d.ts'],
      rules: {
        '@typescript-eslint/no-empty-object-type': 'off',
      },
    },
  ],
};