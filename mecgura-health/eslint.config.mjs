import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    ".next-prod/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // These components load data on mount / when a filter changes (fetch -> setState). That is the intended pattern here;
    // the rule would force a data-fetching library we deliberately don't use.
    files: ["src/components/scheduling/**", "src/website/templates/modern-medical/booking-flow.tsx"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
]);

export default eslintConfig;
