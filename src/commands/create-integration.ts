import * as path from 'path';
import * as fs from 'fs';
import { CommandResult } from '../types';
import { exists, isEmptyDir, makeExecutable, mkdirp } from '../utils/fs';
import { resolveAndroidSdk } from '../utils/exec';
import * as logger from '../utils/logger';

export interface CreateIntegrationOptions {
  /** Package name (e.g. com.example.myapp) */
  package?: string;
  /** DSL type: kuikly or compose */
  dsl?: string;
  /** Force creation even if directory exists */
  force?: boolean;
}

/** Default package name embedded in each template. */
const TEMPLATE_PACKAGE_NAMES: Record<string, string> = {
  kuikly: 'com.example.kuiklydsl',
  compose: 'com.example.composedsl',
};

/** Default rootProject.name embedded in each template. */
const TEMPLATE_PROJECT_NAMES: Record<string, string> = {
  kuikly: 'kuikly',
  compose: 'compose',
};

/** Binary file extensions — copied verbatim, no text substitution. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp',
  '.jar', '.zip', '.gz', '.tar',
  '.ttf', '.otf', '.woff', '.woff2',
  '.so', '.dylib', '.dll',
  '.pbxproj',
]);

/**
 * Create a Kuikly integration project by copying a pre-built reference template
 * and performing simple string substitution for package name and project name.
 *
 * This command generates the same project structure that the kuikly-integration
 * skill uses from its reference/ directory, but via the CLI with parameterization.
 */
export async function createIntegration(
  projectName: string,
  options: CreateIntegrationOptions
): Promise<CommandResult> {
  const startTime = Date.now();

  // ─── 1. Validate project name ────────────────────────
  if (!projectName || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(projectName)) {
    return {
      success: false,
      command: 'create-integration',
      error: {
        code: 'INVALID_PROJECT_NAME',
        message: `Invalid project name: "${projectName}"`,
        details: 'Project name must start with a letter, and contain only letters, digits, hyphens, or underscores.',
      },
    };
  }

  // ─── 2. Resolve DSL type ─────────────────────────────
  const dsl = (options.dsl === 'compose' ? 'compose' : 'kuikly') as 'kuikly' | 'compose';

  // ─── 3. Resolve output directory ─────────────────────
  const outputDir = path.resolve(process.cwd(), projectName);
  if (exists(outputDir) && !isEmptyDir(outputDir) && !options.force) {
    return {
      success: false,
      command: 'create-integration',
      error: {
        code: 'DIR_NOT_EMPTY',
        message: `Directory "${projectName}" already exists and is not empty.`,
        details: 'Use --force to overwrite, or choose a different name.',
      },
    };
  }

  // ─── 4. Resolve template path ────────────────────────
  const templateDir = path.resolve(__dirname, '..', '..', 'templates', 'integration', dsl);
  if (!fs.existsSync(templateDir)) {
    return {
      success: false,
      command: 'create-integration',
      error: {
        code: 'TEMPLATE_NOT_FOUND',
        message: `Integration template "${dsl}" not found`,
        details: `Expected at: ${templateDir}`,
      },
    };
  }

  // ─── 5. Resolve package name ─────────────────────────
  const packageName = options.package || `com.example.${projectName.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  const templatePackageName = TEMPLATE_PACKAGE_NAMES[dsl];
  const templateProjectName = TEMPLATE_PROJECT_NAMES[dsl];

  logger.section('Integration Project Configuration');
  logger.kv('Name', projectName);
  logger.kv('Package', packageName);
  logger.kv('DSL', dsl);
  logger.kv('Template', `integration/${dsl}`);

  // ─── 6. Copy template with substitution ──────────────
  logger.step(1, 4, 'Copying template files...');
  let generatedFiles: string[];
  try {
    generatedFiles = copyTemplateWithSubstitution(templateDir, outputDir, {
      templatePackageName,
      packageName,
      templateProjectName,
      projectName,
    });
  } catch (err) {
    return {
      success: false,
      command: 'create-integration',
      error: {
        code: 'GENERATION_ERROR',
        message: 'Failed to copy template files',
        details: String(err),
      },
    };
  }

  // ─── 7. Generate local.properties ────────────────────
  logger.step(2, 4, 'Generating local.properties...');
  generateLocalProperties(outputDir);

  // ─── 8. Generate ohosApp/local.properties ────────────
  logger.step(3, 4, 'Generating ohosApp/local.properties...');
  generateOhosLocalProperties(outputDir);

  // ─── 9. Make gradlew executable ──────────────────────
  logger.step(4, 4, 'Finalizing...');
  const gradlewPath = path.join(outputDir, 'gradlew');
  if (fs.existsSync(gradlewPath)) {
    makeExecutable(gradlewPath);
  }
  const runOhosPath = path.join(outputDir, 'ohosApp', 'runOhosApp.sh');
  if (fs.existsSync(runOhosPath)) {
    makeExecutable(runOhosPath);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Success summary
  logger.success(`Integration project "${projectName}" created successfully in ${elapsed}s!`);
  logger.section('Generated Modules');
  logger.tree('shared', 'KMP shared module (business logic + UI)');
  logger.tree('androidApp', 'Android host app (KuiklyRenderActivity + Adapters)');
  logger.tree('iosApp', 'iOS host app (KuiklyRenderViewController + Handlers)');
  logger.tree('ohosApp', 'HarmonyOS host app (Kuikly component + Adapters)');
  logger.tree('static_server', 'Static resource server for development');
  logger.treeEnd('buildSrc', 'Version management');

  const nextSteps: string[] = [];
  nextSteps.push(`cd ${projectName}`);

  if (process.platform === 'darwin') {
    nextSteps.push('# iOS: cd iosApp && pod install --repo-update');
    nextSteps.push('#       Open iosApp.xcworkspace in Xcode');
  }
  nextSteps.push('# Android: ./gradlew :androidApp:assembleDebug');
  nextSteps.push('# HarmonyOS: Open ohosApp in DevEco Studio');

  return {
    success: true,
    command: 'create-integration',
    data: {
      message: `Integration project "${projectName}" created successfully`,
      projectDir: outputDir,
      config: {
        projectName,
        packageName,
        dsl,
        template: `integration/${dsl}`,
      },
      elapsed: `${elapsed}s`,
    },
    files: generatedFiles,
    nextSteps,
  };
}

// ────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────

interface SubstitutionContext {
  templatePackageName: string;
  packageName: string;
  templateProjectName: string;
  projectName: string;
}

/**
 * Copy a template directory recursively, performing string substitution on
 * text files and renaming package-path directories.
 *
 * - Text files: replace template package name → user package name,
 *   template project name → user project name.
 * - Binary files: copied verbatim.
 * - Directory names containing the template package path (e.g. `com/example/kuiklydsl`)
 *   are renamed to the user's package path.
 */
function copyTemplateWithSubstitution(
  templateDir: string,
  outputDir: string,
  ctx: SubstitutionContext
): string[] {
  const generatedFiles: string[] = [];

  // Pre-compute package path replacements
  const templatePackagePath = ctx.templatePackageName.replace(/\./g, '/');
  const userPackagePath = ctx.packageName.replace(/\./g, '/');

  // Text file extensions eligible for substitution
  const textExtensions = new Set([
    '.kt', '.kts', '.java', '.xml', '.json', '.json5', '.properties',
    '.gradle', '.toml', '.ts', '.ets', '.js', '.swift', '.h', '.m',
    '.mm', '.podspec', '.pbxproj', '.plist', '.yaml', '.yml',
    '.gitignore', '.whistle', '.sh', '.md', '.txt', '.conf', '.css', '.html',
  ]);

  // Files with no extension that should still be treated as text
  const textFilenames = new Set([
    '.gitignore', '.whistle.js', 'gradlew', 'Podfile', 'Podfile.lock',
  ]);

  function isTextFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    if (textExtensions.has(ext)) return true;
    if (textFilenames.has(filename)) return true;
    // Files like "build.ohos.gradle.kts" have ext ".kts" which is already covered
    // Files like "contents.xcworkspacedata" — treat as text
    if (filename.endsWith('.xcworkspacedata') || filename.endsWith('.xcfilelist')) return true;
    return false;
  }

  /**
   * Resolve a relative path by replacing the template package path segments
   * with the user's package path segments.
   *
   * e.g. "shared/src/.../com/example/kuiklydsl/RouterPage.kt"
   *   → "shared/src/.../com/test/myapp/RouterPage.kt"
   */
  function resolveRelPath(relPath: string): string {
    // Normalize to forward slashes for matching
    const normalized = relPath.split(path.sep).join('/');
    if (templatePackagePath === userPackagePath) return relPath;
    const replaced = normalized.split(templatePackagePath).join(userPackagePath);
    return replaced;
  }

  /** Directories to skip during copy (build caches, IDE files, etc.). */
  const skipDirs = new Set([
    '.gradle', '.kotlin', '.run', '.idea', 'build', 'node_modules',
    'Pods', 'xcuserdata', '.cxx', '.externalNativeBuild', 'captures',
    'Kotlin-js-store',
  ]);

  function walk(srcDir: string, relBase: string): void {
    if (!fs.existsSync(srcDir)) return;

    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip build caches and IDE directories
      if (entry.isDirectory() && skipDirs.has(entry.name)) {
        continue;
      }

      const srcPath = path.join(srcDir, entry.name);
      // Build the raw relative path, then resolve package path substitutions
      const rawRelPath = path.join(relBase, entry.name);
      const resolvedRelPath = resolveRelPath(rawRelPath);

      if (entry.isDirectory()) {
        walk(srcPath, rawRelPath);
      } else {
        const outputPath = path.join(outputDir, resolvedRelPath);
        const ext = path.extname(entry.name).toLowerCase();

        if (BINARY_EXTENSIONS.has(ext)) {
          // Binary file — copy verbatim
          mkdirp(path.dirname(outputPath));
          fs.copyFileSync(srcPath, outputPath);
        } else if (isTextFile(entry.name)) {
          // Text file — read, substitute, write
          let content = fs.readFileSync(srcPath, 'utf-8');
          content = substituteText(content, ctx);
          mkdirp(path.dirname(outputPath));
          fs.writeFileSync(outputPath, content, 'utf-8');
        } else {
          // Unknown file type — copy verbatim
          mkdirp(path.dirname(outputPath));
          fs.copyFileSync(srcPath, outputPath);
        }

        generatedFiles.push(resolvedRelPath);
      }
    }
  }

  walk(templateDir, '');
  return generatedFiles;
}

/**
 * Perform string substitution on file content.
 */
function substituteText(content: string, ctx: SubstitutionContext): string {
  let result = content;

  // Replace package name (dot-separated)
  result = result.split(ctx.templatePackageName).join(ctx.packageName);

  // Replace package path (slash-separated)
  const templatePackagePath = ctx.templatePackageName.replace(/\./g, '/');
  const userPackagePath = ctx.packageName.replace(/\./g, '/');
  result = result.split(templatePackagePath).join(userPackagePath);

  // Replace rootProject.name = "templateName" → rootProject.name = "projectName"
  // Use regex to handle both single and double quotes
  const projectNameRegex = new RegExp(
    `rootProject\\.name\\s*=\\s*["']${escapeRegex(ctx.templateProjectName)}["']`,
    'g'
  );
  result = result.replace(projectNameRegex, `rootProject.name = "${ctx.projectName}"`);

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Generate root local.properties with Android SDK path.
 */
function generateLocalProperties(outputDir: string): void {
  const sdkPath = resolveAndroidSdk();
  let content: string;
  if (sdkPath) {
    content = `sdk.dir=${sdkPath}\n`;
  } else {
    content = `# sdk.dir=/path/to/Android/Sdk\n`;
    logger.warn('Android SDK not found. Please edit local.properties to set sdk.dir manually.');
  }
  const localPropsPath = path.join(outputDir, 'local.properties');
  mkdirp(path.dirname(localPropsPath));
  fs.writeFileSync(localPropsPath, content, 'utf-8');
}

/**
 * Generate ohosApp/local.properties with Kuikly project path.
 */
function generateOhosLocalProperties(outputDir: string): void {
  const content = [
    'kuikly.projectPath=../',
    'kuikly.moduleName=shared',
    '',
    'kuikly.ohosGradleSettings=settings.ohos.gradle.kts',
  ].join('\n') + '\n';

  const ohosLocalPropsPath = path.join(outputDir, 'ohosApp', 'local.properties');
  mkdirp(path.dirname(ohosLocalPropsPath));
  fs.writeFileSync(ohosLocalPropsPath, content, 'utf-8');
}
