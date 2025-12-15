# Navis AI — Plugin System Specification

Version: v0.1  
Scope: Design for future, influence current architecture

---

## 1. Goals

- Allow third-party and premium extensions without modifying core.
- Support **discovery**, **import**, and **automation** plugins.
- Keep plugin system safe, sandboxed, and explicit.
- Make core APIs stable enough for plugin authors.

---

## 2. Plugin Types (Conceptual)

1. **Discovery Enhancers**
   - Add custom signals for new tech stacks.
   - Example: detect Docker Compose apps, Tauri projects, custom monorepos.

2. **Importers**
   - Understand how to “import/attach” an existing tool into Navis.
   - Example: ServBay import, Docker environment import, LocalWP import.

3. **Automation / Actions**
   - Add new actions that can be triggered from the PWA.
   - Example: “run tests”, “build project”, “restart dev server”.

---

## 3. Plugin Package Structure

Plugins are regular npm packages with a specific export shape.

Proposed package naming:

- OSS: `@navisai/plugin-<name>`
- Premium: `@navisai/pro-<name>`

Each plugin exports a **plugin manifest**:

```ts
export const navisPlugin = {
  id: "servbay-import",
  version: "0.1.0",
  kind: ["importer", "discovery"],
  activate,
};
```

Where `activate` is:

```ts
function activate(api: NavisPluginAPI): void;
```

---

## 4. NavisPluginAPI (Conceptual)

Core provides a restricted API to plugins, e.g.:

```ts
interface NavisPluginAPI {
  registerDiscoveryProvider(provider: DiscoveryProvider): void;
  registerImporter(importer: Importer): void;
  registerAction(action: ActionDescriptor): void;

  log: (level: "debug" | "info" | "warn" | "error", msg: string, meta?: any) => void;

  // Limited, safe DB access:
  db: {
    getProjects(): Promise<Project[]>;
    getProjectById(id: string): Promise<Project | null>;
    setProjectMetadata(id: string, metadata: any): Promise<void>;
  };

  // Hooks for approvals:
  requestApproval(payload: ApprovalPayload): Promise<ApprovalResult>;
}
```

Plugins never get raw access to filesystem or OS; they must call core-provided abstractions.

---

## 5. DiscoveryProvider Interface

Example:

```ts
interface DiscoveryProvider {
  id: string;
  description?: string;
  discover(context: DiscoveryContext): Promise<DiscoverySignal[]>;
}

interface DiscoveryContext {
  rootPaths: string[];
  fs: {
    exists(path: string): Promise<boolean>;
    readFile(path: string): Promise<string | Buffer>;
    stat(path: string): Promise<StatLike>;
  };
}
```

This allows new detection patterns to be added without changing core.

---

## 6. Importer Interface

Example:

```ts
interface Importer {
  id: string;
  label: string;
  supports(project: Project): Promise<boolean>;
  getSuggestedActions(project: Project): Promise<ImportSuggestion[]>;
  runImport(project: Project, options?: any): Promise<ImportResult>;
}
```

In MVP, importers may be **read-only suggestion providers**, with actual execution deferred.

---

## 7. Action Interface

Example:

```ts
interface ActionDescriptor {
  id: string;
  label: string;
  description?: string;
  projectScoped: boolean;
  run(context: ActionContext): Promise<ActionResult>;
}

interface ActionContext {
  project: Project | null;
  log: NavisPluginAPI["log"];
  requestApproval: NavisPluginAPI["requestApproval"];
}
```

Actions must always go through the **approval system** before mutating state.

---

## 8. Plugin Loading

For security and stability:

- Plugins are **opt-in**, configured via:
  - `~/.navis/config.json`  
  - or CLI commands: `navisai plugins add <name>`
- Core loads plugins from:
  - workspace `node_modules`
  - `NAVIS_PLUGINS_PATH` (optional override)

Loading rules:

- Resolve package
- Verify it exports `navisPlugin`
- Validate manifest structure
- Call `activate(api)`

---

## 9. Versioning & Compatibility

- Plugins must declare:

  ```json
  {
    "peerDependencies": {
      "@navisai/core": "^0.1.0"
    }
  }
  ```

- Navis core checks compatibility at runtime and warns about mismatches.

---

## 10. MVP Implementation Plan

For MVP v0.1:

- Implement **internal plugin architecture** only.
- Treat premium modules as “plugins” using the same interfaces.
- Public, third-party plugin support can be turned on in later versions.

---
