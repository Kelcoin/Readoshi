module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  plugins: ['react', 'react-hooks', 'react-refresh'],
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:react-hooks/recommended'],
  settings: { react: { version: 'detect' } },
  rules: {
    'no-empty': ['error', { allowEmptyCatch: true }],
    'no-constant-condition': ['error', { checkLoops: false }],
    'no-unused-vars': 'off',
    'react/display-name': 'off',
    'react/prop-types': 'off',
    'react/react-in-jsx-scope': 'off',
    'react-hooks/exhaustive-deps': 'off',
    'react-refresh/only-export-components': 'off',
  },
  overrides: [
    {
      files: ['src/**/*.{js,jsx}'],
      globals: {
        __APP_BUILD_ID__: 'readonly',
        __APP_VERSION__: 'readonly',
      },
    },
    {
      files: ['worker.js', 'public/sw.js'],
      env: { browser: false, worker: true, serviceworker: true, es2022: true },
      globals: {
        DecompressionStream: 'readonly',
        HISTORY_KV: 'readonly',
        APP_VERSION: 'readonly',
        WORKER_UPDATE_BRANCH: 'readonly',
        clients: 'readonly',
      },
    },
    {
      files: ['scripts/**/*.js', 'scripts/**/*.mjs', 'tests/**/*.mjs', 'vite.config.js'],
      env: { browser: false, node: true, es2022: true },
    },
  ],
};
