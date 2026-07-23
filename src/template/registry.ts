import * as path from 'path';
import * as fs from 'fs';
import { TemplateRegistry, TemplateInfo } from '../types';
import * as logger from '../utils/logger';

/**
 * Bundled registry (ships with the npm package).
 */
function getBundledRegistryPath(): string {
  return path.join(__dirname, '..', '..', 'templates', 'registry.json');
}

/**
 * Bundled template directory path.
 */
export function getBundledTemplatePath(templateName: string): string {
  return path.join(__dirname, '..', '..', 'templates', templateName, 'files');
}

/**
 * Load the bundled registry from the npm package.
 */
export function loadBundledRegistry(): TemplateRegistry {
  const bundledPath = getBundledRegistryPath();
  if (fs.existsSync(bundledPath)) {
    return JSON.parse(fs.readFileSync(bundledPath, 'utf-8')) as TemplateRegistry;
  }
  // Hardcoded fallback
  return {
    version: '1.0.0',
    kuiklyVersions: {
      latest: '2.23.2',
      supported: ['2.16.0', '2.23.2'],
    },
    kotlinVersions: {
      latest: '2.1.21',
      supported: ['1.9.22', '2.1.21'],
    },
    templates: [
      {
        name: 'kuikly',
        displayName: 'Kuikly DSL',
        description: 'Standard Kuikly DSL project with full platform support',
        version: '1.0.0',
        default: true,
      },
      {
        name: 'compose',
        displayName: 'Compose DSL',
        description: 'Kuikly Compose DSL project with Jetpack Compose-style API',
        version: '1.0.0',
      },
    ],
  };
}

/**
 * Fetch the template registry.
 * Uses the bundled registry shipped with the npm package.
 */
export async function fetchRegistry(): Promise<TemplateRegistry> {
  return loadBundledRegistry();
}

/**
 * Resolve the template directory path.
 * Uses bundled templates shipped with the npm package.
 */
export async function resolveTemplatePath(
  registry: TemplateRegistry,
  templateName: string
): Promise<string> {
  const bundledPath = getBundledTemplatePath(templateName);
  if (fs.existsSync(bundledPath)) {
    logger.info(`Using bundled template: ${templateName}`);
    return bundledPath;
  }

  throw new Error(
    `Template "${templateName}" not found. Available templates: ${registry.templates.map((t) => t.name).join(', ')}`
  );
}

/**
 * List available templates from the registry.
 */
export function listTemplates(registry: TemplateRegistry): TemplateInfo[] {
  return registry.templates;
}
