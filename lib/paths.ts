import path from "node:path";

/** External data root from LATTICE_DATA_DIR; null keeps legacy in-repo paths. */
export function latticeDataRoot(): string | null {
  const value = process.env.LATTICE_DATA_DIR?.trim();
  return value || null;
}

export function generatedDir(): string {
  const root = latticeDataRoot();
  return root
    ? path.join(root, "generated")
    : path.join(process.cwd(), "data", "generated");
}

export function artifactsDir(): string {
  const root = latticeDataRoot();
  return root
    ? path.join(root, "artifacts")
    : path.join(process.cwd(), "generator", "artifacts");
}

export function generatedTopicPath(slug: string): string {
  return path.join(generatedDir(), `${slug}.json`);
}

export function artifactRunDir(slug: string): string {
  return path.join(artifactsDir(), slug);
}
