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
    files: ["src/components/scheduling/**", "src/components/patients/**", "src/components/consultation/**", "src/components/lab/**", "src/components/followups/**", "src/components/billing/**", "src/components/pharmacy/**", "src/components/portal/**", "src/components/notifications/**", "src/components/communications/**", "src/website/templates/modern-medical/booking-flow.tsx"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
  {
    // Pharmacy services work on the `Client = any` tenant-scoped Prisma client (same pattern as every other service); result rows are typed at the boundary.
    files: ["src/lib/services/pharmacy-*.ts", "src/lib/services/portal-*.ts", "src/lib/services/comms-*.ts", "src/lib/services/notifications*.ts", "src/lib/communications/**/*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
]);

export default eslintConfig;
