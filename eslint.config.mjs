import {FlatCompat} from '@eslint/eslintrc';
import js from '@eslint/js';
import globals from 'globals';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [...compat.extends('strongloop'), {
  // Bundled third-party libraries (minified) — not our code
  ignores: ['src/packages/base/$BaseMarkdownPlugin.js'],
}, {
  languageOptions: {
    globals: {
      dp: 'readonly',
      tw: 'readonly',
      ...globals.browser,
    },
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  rules: {
    'no-eval': 'off',
    'max-len': 'off',
    'no-with': 'off',
    // avoidEscape keeps ESLint from fighting Prettier on apostrophe strings:
    // Prettier keeps "it's" double-quoted to avoid an escape, so ESLint must too
    // (without this it rewrites to 'it\'s' and the two oscillate on save).
    quotes: ['error', 'single', {avoidEscape: true}],
    'object-curly-spacing': ['error', 'never'],
    'quote-props': 'off',
    'block-spacing': 'off',
    'space-before-function-paren': 'off',
    complexity: ['warn', 40],
    'no-unused-vars': ['error', {
      varsIgnorePattern: 'boot',
    }],
    'require-await': 'error',
    semi: ['error', 'always'],
  },
}, {
  // Storage layering (see plans/platform-rework.md): localStorage is touched
  // ONLY by the platform (tw.storage) and core.store (tw.store). Everything
  // else goes through tw.store. Modules are eval'd strings sharing one global,
  // so this is convention + lint — nothing can structurally prevent it.
  files: ['src/modules/**/*.js', 'src/packages/**/*.js'],
  ignores: ['src/modules/core.store.js'],
  rules: {
    'no-restricted-globals': ['error', {
      name: 'localStorage',
      message: 'Use tw.store (core.store) — only the platform and core.store may touch localStorage directly.',
    }],
  },
}];
