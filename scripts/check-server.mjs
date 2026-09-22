import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Backend modules live at the repository root. Check them without importing
// them: imports could start services or require application secrets.
const root = fileURLToPath(new URL("../", import.meta.url));
const files = readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => entry.name)
  .sort();

for (const file of files) {
  console.log(`Checking syntax: ${file}`);
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    console.error(`Server syntax check failed: ${file}`);
    if (result.error) console.error(result.error.message);
    process.exit(result.status || 1);
  }
}
console.log(`Server syntax checks passed (${files.length} files).`);