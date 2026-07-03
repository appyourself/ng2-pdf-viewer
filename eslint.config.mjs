// @ts-check
import tseslint from "typescript-eslint";
import angular from "angular-eslint";
import prettier from "eslint-config-prettier";
import rxjs from "eslint-plugin-rxjs-x";

export default tseslint.config(
  {
    ignores: ["dist/", "docs/", "node_modules/", "**/*.d.ts"],
  },
  {
    files: ["**/*.ts"],
    extends: [
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@angular-eslint/component-selector": [
        "error",
        { type: "element", prefix: ["app", "pdf"], style: "kebab-case" },
      ],
      "@angular-eslint/directive-selector": [
        "error",
        { type: "attribute", prefix: ["app", "pdf"], style: "camelCase" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // TODO: change to "error" once existing code is fixed
      "@typescript-eslint/no-unused-expressions": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "@angular-eslint/no-output-native": "warn",
      "@angular-eslint/no-output-on-prefix": "warn",
      "@angular-eslint/no-output-rename": "warn",
      "@angular-eslint/no-input-rename": "warn",
      "@angular-eslint/prefer-inject": "warn",
      "@angular-eslint/component-class-suffix": "warn",
    },
  },
  {
    files: ["**/*.ts"],
    ...rxjs.configs.recommended,
    rules: {
      ...rxjs.configs.recommended.rules,
      "rxjs-x/no-implicit-any-catch": "warn",
      "rxjs-x/prefer-root-operators": "warn",
      "rxjs-x/no-async-subscribe": "warn",
    },
  },
  {
    files: ["**/*.html"],
    extends: [
      ...angular.configs.templateRecommended,
      ...angular.configs.templateAccessibility,
    ],
    rules: {
      "@angular-eslint/template/prefer-control-flow": "warn",
      "@angular-eslint/template/click-events-have-key-events": "warn",
      "@angular-eslint/template/interactive-supports-focus": "warn",
    },
  },
  prettier,
);
