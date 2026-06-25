import { copyFile, stat } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.BASE_URL ?? "/";

function normalizeBasePath(value) {
  return value.replace(/^\/+|\/+$/g, "");
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

const basePath = normalizeBasePath(baseUrl);

if (!basePath) {
  process.exit(0);
}

const clientDir = path.resolve("build/client");
const prerenderDir = path.join(clientDir, basePath);
const files = ["index.html", "_.data"];

for (const file of files) {
  const source = path.join(prerenderDir, file);
  const target = path.join(clientDir, file);

  if (await exists(source)) {
    await copyFile(source, target);
    console.log(`Pages build: copied ${path.relative(clientDir, source)} -> ${file}`);
  }
}
