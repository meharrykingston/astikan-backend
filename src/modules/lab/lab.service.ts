export function createLab(name: string) {
  return {
    id: crypto.randomUUID(),
    name,
  };
}