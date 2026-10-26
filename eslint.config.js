export default [
  {
    files: ['backend/src/**/*.js', 'backend/test/**/*.js', 'frontend/src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z]' }],
      'no-undef': 'off',
      'no-constant-condition': 'warn'
    }
  }
];
