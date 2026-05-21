# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Target**: High-performance JavaScript rendering engine for constrained embedded browser environments (Chrome 38+).

## Load-Bearing Invariants

- **Dual backend**: WebGL and Canvas2D are first-class. When adding a rendering feature, implement both paths or explicitly document the gap, and add a `shader-*` (or equivalent) example test for the visual regression suite.
- **GL state goes through [WebGlContextWrapper](src/core/lib/WebGlContextWrapper.ts)**: it is the only place that should touch the raw GL context. Bypassing it breaks batching invariants.
- **Language floor is Chrome 38**: anything Babel can't transpile is off the table. Validate with `pnpm start:prod` before claiming a feature works on embedded targets. See [BROWSERS.md](BROWSERS.md).

## Core Philosophy

Optimize for performance.

## Code Writing Rules

- Don’t assume. Don’t hide confusion. Surface tradeoffs.
- Minimum code that solves the problem. Nothing speculative.
- Touch only what you must. Clean up only your own mess.
- Define success criteria. Loop until verified.

### Architecture Principles

- **Class-based design** - Use TypeScript classes for structure and type safety
- **Zero GC pressure** - Minimize object allocation, reuse everything possible
- **Direct memory management** - Pre-allocate buffers, use typed arrays
- **Zero safety checks** - Input validation is caller's responsibility
- **Early returns** - Most common paths first, error checks on top
- **Arrow functions for utilities** - Use arrow functions for libraries/singletons/utilities

## Performance Rules (CRITICAL)

### 1. Loop Performance

```javascript
// ✅ DO: Use for/while loops
for (let i = 0; i < items.length; i++) {
  process(items[i]);
}

// ❌ NEVER: Use array methods in hot paths
items.forEach(process); // NO
items.map(transform); // NO
items.filter(check); // NO
```

### 2. Comparison Operations

```javascript
// ✅ DO: Direct comparisons
if (value === null) return
if (type === 2) continue
if (buffer.length === 0) return

// ❌ NEVER: Truthy/falsy checks
if (value) return      // NO
if (!items.length)     // NO
if (buffer)           // NO
```

### 3. Object Creation & Reuse

```typescript
// ✅ DO: Reuse class instances and buffers
class Element {
  x = 0;
  y = 0;
  w = 0;
  h = 0;
  private _dirty = false;
}

// Reuse buffers
let vertexBuffer = new Float32Array(maxQuads * floatsPerQuad);
let vertexOffset = 0;

// ❌ NEVER: Create objects in loops
for (let i = 0; i < count; i++) {
  const obj = { x: i, y: i }; // NO - creates GC pressure
}
```

### 4. Property Access Optimization

```javascript
// ✅ DO: Extract frequently accessed properties
const texture = element.texture;
const w = texture.width;
const h = texture.height;

// ✅ DO: Use bracket notation for dynamic access
const value = element[propertyName];

// ❌ AVOID: Repeated deep property access
element.texture.width; // OK once
element.texture.width; // Wasteful if repeated
```

### 5. Early Returns & Flat Code

```javascript
// ✅ DO: Error checks first, early returns
function processElement(el) {
  if (el === null) return;
  if (el._destroyed === true) return;
  if (el._isRenderable === false) return;

  // Main logic here - flat, no nesting
  const x = el.x;
  const y = el.y;
  // ...
}

// ❌ NEVER: Deep nesting (max 3 levels)
if (condition) {
  if (other) {
    if (another) {
      if (deep) {
        // NO - too deep
        // ...
      }
    }
  }
}
```

## Data Structures & Memory

### Typed Arrays for Performance

```javascript
// ✅ DO: Use typed arrays for batching
const vertexBuffer = new Float32Array(maxElements * floatsPerElement);
const indexBuffer = new Uint16Array(maxElements * 6);

// ✅ DO: Use numbers for flags/enums
const RENDER_TYPE_RECT = 0;
const RENDER_TYPE_TEXTURE = 1;
const RENDER_TYPE_TEXT = 2;
```

### Bit Operations

```javascript
// ✅ DO: Use bitwise operations where applicable
const type = element._renderType | 0; // Force integer
const z = element.zIndex | 0;
const id = ++counter | 0;

// Use bit flags for state
const DIRTY_TRANSFORM = 1;
const DIRTY_COLOR = 2;
const DIRTY_TEXTURE = 4;
element._dirtyFlags |= DIRTY_TRANSFORM;
```

### Buffer Management

```javascript
// ✅ DO: Pre-allocate, reuse buffers
let buffer = new Float32Array(maxQuads * floatsPerQuad);
let offset = 0;

function addQuad(x, y, w, h) {
  if (offset + floatsPerQuad > buffer.length) {
    flush();
    offset = 0;
  }

  buffer[offset++] = x;
  buffer[offset++] = y;
  // ... continue
}

function flush() {
  if (offset === 0) return;
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, buffer.subarray(0, offset));
  offset = 0;
}
```

## Code Patterns

### Class-Based Pattern

```typescript
// ✅ DO: Use TypeScript classes for structure
class Element {
  id: number;
  x = 0;
  y = 0;
  w = 0;
  h = 0;
  children: Element[] = [];
  private _dirty = false;
  private _destroyed = false;

  constructor() {
    this.id = generateId();
  }

  addChild(child: Element): void {
    this.children.push(child);
    this._dirty = true;
  }

  removeChild(child: Element): void {
    const idx = this.children.indexOf(child);
    if (idx !== -1) {
      this.children.splice(idx, 1);
      this._dirty = true;
    }
  }

  dirty(): void {
    this._dirty = true;
  }
}
```

### Utility/Singleton Pattern

```typescript
// ✅ DO: Use arrow functions for utilities and singletons
export const TextureManager = (() => {
  const cache = new Map<string, Texture>();

  return {
    getTexture: (url: string): Texture | undefined => {
      return cache.get(url);
    },

    addTexture: (url: string, texture: Texture): void => {
      cache.set(url, texture);
    },

    clear: (): void => {
      cache.clear();
    },
  };
})();
```

## Testing Requirements

### Unit Tests (REQUIRED)

All new code MUST include unit tests. Use Vitest as the testing framework.

```typescript
// ✅ DO: Write unit tests for new classes and utilities
describe('Element', () => {
  it('should add child and mark as dirty', () => {
    const parent = new Element();
    const child = new Element();

    parent.addChild(child);

    expect(parent.children.length).toBe(1);
    expect(parent.children[0]).toBe(child);
    expect(parent._dirty).toBe(true);
  });

  it('should remove child correctly', () => {
    const parent = new Element();
    const child = new Element();

    parent.addChild(child);
    parent.removeChild(child);

    expect(parent.children.length).toBe(0);
  });
});
```

**Testing Guidelines:**

- Test public APIs and behavior, not implementation details
- Test edge cases: null, undefined, 0, empty arrays
- Test state changes and side effects
- Keep tests fast - avoid setTimeout, mock expensive operations
- Use explicit comparisons in assertions (toBe, toEqual, not toBeTruthy)
- Run tests with `pnpm test` before committing

### Visual Regression Tests (Rendering Features)

For significant rendering features (shaders, effects, layout changes), add visual regression tests.

```typescript
// ✅ DO: Add visual regression tests for rendering features
// Located in examples/tests/
import type { ExampleSettings } from '../common/ExampleSettings.js';

export async function automation(settings: ExampleSettings) {
  await test(settings);
  await settings.snapshot(); // Captures snapshot for comparison
}

export default async function test({ renderer, testRoot }: ExampleSettings) {
  const node = renderer.createNode({
    x: 20,
    y: 20,
    w: 200,
    h: 200,
    color: 0xff0000ff,
    shader: renderer.createShader('RoundedRectangle'),
    parent: testRoot,
  });
}
```

**When to add visual tests:**

- New shader effects
- Layout algorithm changes
- Clipping or masking features
- Text rendering modifications
- Color space or blending changes
- Any visual feature users will see

**Visual test workflow:**

1. Add test file in `examples/tests/` (e.g., `shader-my-feature.ts`)
2. Export `automation` function that calls `settings.snapshot()`
3. Run `pnpm test:visual --capture` to generate snapshot
4. Manually verify output in `visual-regression/certified-snapshots/`
5. Commit certified snapshot with your code
6. CI will fail if future changes break rendering

## What to NEVER Do

1. **Never use map/filter/forEach in hot paths** - Use for/while loops
2. **Never do truthy/falsy checks** - Use explicit comparisons
3. **Never nest more than 3 levels deep** - Use early returns
4. **Never create objects in render loops** - Pre-allocate and reuse
5. **Never use function.bind() in hot paths** - Use arrow functions or class methods
6. **Never use spread operators in performance code** - Use Object.assign or direct assignment
7. **Never validate inputs** - Caller's responsibility
8. **Never use try/catch in hot paths** - Check conditions first
9. **Never use delete operator** - Set to null/undefined instead
10. **Never use JSDoc** - Use TypeScript types instead

## Code Review Checklist

Before submitting code, verify:

- [ ] TypeScript types properly defined
- [ ] Classes used for structured components
- [ ] Arrow functions used for utilities/singletons
- [ ] No map/filter/forEach in performance paths
- [ ] All comparisons are explicit (===, !==)
- [ ] Early returns implemented
- [ ] No nesting beyond 3 levels
- [ ] Objects reused, not recreated
- [ ] Typed arrays used for numeric data
- [ ] Buffers pre-allocated and reused
- [ ] No safety checks or validation
- [ ] Property access optimized
- [ ] Bit operations used where applicable
- [ ] Unit tests added for new code
- [ ] Visual regression tests added for rendering features
- [ ] All tests passing (`pnpm test`)

## Common Patterns to Follow

Look at these files for reference patterns:

- Core classes - Class-based component structure
- Shader modules - Utility/singleton pattern
- Texture management - Resource pooling and caching

Remember: This is a rendering engine for constrained environments. Every microsecond counts. When in doubt, optimize for performance over everything else.

---

## Project Layout (SolidTV Renderer specifics)

Package: `@solidtv/renderer` (see [package.json](package.json)). Package manager is **pnpm 10+** (Node 18+). Backend targets: WebGL and Canvas2D. Subpath exports are wired through [exports/](exports/) (`./webgl`, `./canvas`, `./webgl/shaders`, `./canvas/shaders`, `./utils`, `./inspector`).

### Source tree

- [src/main-api/](src/main-api/) — public surface
  - [Renderer.ts](src/main-api/Renderer.ts) — entry point used by consumers
  - [INode.ts](src/main-api/INode.ts) — public node interface
  - [Inspector.ts](src/main-api/Inspector.ts) — debug overlay
- [src/core/](src/core/) — engine internals (hot paths live here)
  - [CoreNode.ts](src/core/CoreNode.ts) — scene graph node (class-based, dirty-flag driven). Reference for the **class pattern**.
  - [CoreTextNode.ts](src/core/CoreTextNode.ts), [Stage.ts](src/core/Stage.ts)
  - [CoreShaderManager.ts](src/core/CoreShaderManager.ts), [CoreTextureManager.ts](src/core/CoreTextureManager.ts), [TextureMemoryManager.ts](src/core/TextureMemoryManager.ts) — reference for the **manager/singleton pattern** and resource pooling
  - [renderers/webgl/](src/core/renderers/webgl/) and [renderers/canvas/](src/core/renderers/canvas/) — backend-specific renderers; shared base in [CoreRenderer.ts](src/core/renderers/CoreRenderer.ts)
  - [shaders/webgl/](src/core/shaders/webgl/), [shaders/canvas/](src/core/shaders/canvas/), [shaders/templates/](src/core/shaders/templates/) — shader implementations
  - [textures/](src/core/textures/) — `Texture` base + `ImageTexture`, `ColorTexture`, `NoiseTexture`, `RenderTexture`, `SubTexture`
  - [text-rendering/](src/core/text-rendering/) — Canvas + SDF text renderers and [TextLayoutEngine.ts](src/core/text-rendering/TextLayoutEngine.ts)
  - [lib/](src/core/lib/) — low-level helpers ([Matrix3d.ts](src/core/lib/Matrix3d.ts), [WebGlContextWrapper.ts](src/core/lib/WebGlContextWrapper.ts), [ImageWorker.ts](src/core/lib/ImageWorker.ts), [colorCache.ts](src/core/lib/colorCache.ts), [colorParser.ts](src/core/lib/colorParser.ts), [textureCompression.ts](src/core/lib/textureCompression.ts))
  - [platforms/](src/core/platforms/) — platform abstraction ([Platform.ts](src/core/platforms/Platform.ts), [platforms/web/](src/core/platforms/web/))
  - [animations/](src/core/animations/)
- [src/common/](src/common/) — shared types ([CommonTypes.ts](src/common/CommonTypes.ts), [EventEmitter.ts](src/common/EventEmitter.ts))
- [examples/](examples/) — manual + snapshot examples
  - [examples/tests/](examples/tests/) — one file per example/visual test
  - [examples/common/ExampleSettings.ts](examples/common/ExampleSettings.ts) — `ExampleSettings` type used by every test
- [visual-regression/](visual-regression/) — snapshot runner; certified images in [visual-regression/certified-snapshots/](visual-regression/certified-snapshots/)
- [test/mockdata/](test/mockdata/) — fixtures for unit tests
- Browser support matrix: see [BROWSERS.md](BROWSERS.md) (target floor is Chrome 38)

### Commands

```
pnpm install            # install renderer + examples deps
pnpm build              # tsc --build
pnpm watch              # tsc --build --watch
pnpm test               # vitest (unit)
pnpm coverage           # vitest run --coverage
pnpm start              # examples dev server (includes watch build)
pnpm start:prod         # examples in prod transpile mode — required to validate on older browsers
pnpm test:visual        # run visual regression against certified snapshots
pnpm test:visual:update # regenerate snapshots locally (review diffs before committing!)
pnpm lint               # prettier + eslint
pnpm lint:fix
pnpm typedoc            # API docs into ./typedocs
```

Vitest config: [vitest.config.ts](vitest.config.ts) using [tsconfig.vitest.json](tsconfig.vitest.json).

### Where existing unit tests live

Co-located next to the source file (preferred):

- [src/core/CoreNode.test.ts](src/core/CoreNode.test.ts)
- [src/core/text-rendering/tests/TextLayoutEngine.test.ts](src/core/text-rendering/tests/TextLayoutEngine.test.ts)

Follow this co-location convention when adding new tests.

### Visual regression test workflow (project-accurate)

1. Add a file under [examples/tests/](examples/tests/) — e.g. `shader-my-feature.ts`. Export a default `test({ renderer, testRoot }: ExampleSettings)` and an `automation(settings)` that awaits `settings.snapshot()`. See existing examples like [examples/tests/shader-rounded.ts](examples/tests/shader-rounded.ts) and [examples/tests/clipping.ts](examples/tests/clipping.ts) for the exact shape.
2. Generate the snapshot with `pnpm test:visual:update` (the script lives in [visual-regression/](visual-regression/); flags vary — see [visual-regression/README.md](visual-regression/README.md) and [visual-regression/DOCKER.md](visual-regression/DOCKER.md) for Docker-based determinism).
3. Inspect the produced PNG under [visual-regression/certified-snapshots/](visual-regression/certified-snapshots/) before committing.
4. Commit the certified snapshot alongside the code change.
5. CI runs `pnpm test:visual` and fails on diffs.

### Backend & shader notes

- WebGL and Canvas2D paths are kept separate under `src/core/renderers/{webgl,canvas}` and `src/core/shaders/{webgl,canvas}`. When adding a shader effect, implement both backends (or document the gap) and add a `shader-*` example test for the visual regression suite.
- `WebGlContextWrapper` is the only place that should talk to the raw GL context — go through it for state changes to keep batching invariants intact.
