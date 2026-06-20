/**
 * Utility to load ESM-only packages dynamically from a CommonJS context.
 * Bypasses TypeScript compiler's static import-to-require transpilation.
 */
export async function loadESM(moduleSpecifier: string): Promise<any> {
  // Using new Function prevents the TS compiler from rewriting the import statement to require()
  const importFn = new Function('specifier', 'return import(specifier)');
  return importFn(moduleSpecifier);
}
