import globals from 'globals';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import js from '@eslint/js';
import {FlatCompat} from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [...compat.extends('strongloop'), {
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
    quotes: ['error', 'single'],
    'object-curly-spacing': ['error', 'never'],
    'quote-props': 'off',
    'block-spacing': 'off',
    'space-before-function-paren': 'off',
    complexity: ['warn', 40],
    'no-unused-vars': ['error', {
      varsIgnorePattern: 'boot',
    }],
    'require-await': 'error',
  },
}];
