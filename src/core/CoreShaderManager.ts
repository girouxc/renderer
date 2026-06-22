import { deepClone } from '../utils.js';
import {
  CoreShaderNode,
  resolveShaderProps,
  type CoreShaderType,
} from './renderers/CoreShaderNode.js';
import type { CoreShaderProgram } from './renderers/CoreShaderProgram.js';
import type { Stage } from './Stage.js';

export type ShaderMap = Record<string, CoreShaderType>;

export type ExtractProps<Props> = {
  [K in keyof Props]: Props[K] extends { default: infer D } ? D : Props[K];
};

export type PartialShaderProps<Props> = Partial<ExtractProps<Props>>;
export type ExtractShaderProps<T extends keyof ShaderMap> = ExtractProps<
  ShaderMap[T]['props']
>;
export type OptionalShaderProps<T extends keyof ShaderMap> = PartialShaderProps<
  ShaderMap[T]['props']
>;

export class CoreShaderManager {
  protected shTypes: ShaderMap = {};
  protected shCache: Map<string, CoreShaderProgram> = new Map();

  /**
   * valuesCache is used to store calculations that can be shared between shader nodes.
   */
  protected valuesCache: Map<string, Record<string, unknown>> = new Map();
  protected valuesCacheUsage: Map<string, number> = new Map();

  protected attachedShader: CoreShaderProgram | null = null;

  constructor(readonly stage: Stage) {}

  registerShaderType(name: string, shType: CoreShaderType): void {
    /**
     * block name duplicates
     */
    if (this.shTypes[name] !== undefined) {
      console.warn(
        `ShaderType already exists with the name: ${name}. Breaking off registration.`,
      );
      return;
    }
    /**
     * Check renderer if shader type is supported.
     */
    if (this.stage.renderer.supportsShaderType(shType) === false) {
      console.warn(
        `The renderer being used does not support this shader type. Breaking off registration.`,
      );
      return;
    }
    this.shTypes[name] = shType;
  }

  /**
   * Loads a shader (if not already loaded) and returns a controller for it.
   *
   * @param shType
   * @param props
   * @returns
   */
  createShader<Name extends keyof ShaderMap>(
    name: Name,
    props?: Record<string, unknown>,
  ): CoreShaderNode | null {
    const shType = this.shTypes[name as string] as ShaderMap[Name];
    if (shType === undefined) {
      console.warn(
        `ShaderType not found falling back on renderer default shader`,
      );
      return this.stage.defShaderNode;
    }
    let shaderKey = name as string;
    if (shType.props !== undefined) {
      /**
       * if props is undefined create empty obj to fill
       */
      props = props || {};
      /**
       * resolve shader values
       */
      resolveShaderProps(props, shType.props);
      if (shType.getCacheMarkers !== undefined) {
        shaderKey += `-${shType.getCacheMarkers(props)}`;
      }
    }

    if (this.stage.renderer.mode === 'canvas') {
      return this.stage.renderer.createShaderNode(shaderKey, shType, props);
    }

    /**
     * get shaderProgram by cacheKey
     */
    let shProgram = this.shCache.get(shaderKey);

    /**
     * if shaderProgram was not found create a new one
     */
    if (shProgram === undefined) {
      try {
        shProgram = this.stage.renderer.createShaderProgram(shType, props)!;
        this.shCache.set(shaderKey, shProgram);
      } catch (e) {
        // The renderer trips `isContextLost` when shader creation fails due to
        // a lost GL context. That is unrecoverable in-place (the consumer
        // reloads on the `contextLost` event), so fall back to the default
        // shader node instead of letting the throw propagate through the app's
        // reactive layer. A genuine GLSL compile error (context not lost) is a
        // real bug and is rethrown so it surfaces loudly.
        if (this.stage.isContextLost === true) {
          return this.stage.defShaderNode;
        }
        throw e;
      }
    }

    return this.stage.renderer.createShaderNode(
      shaderKey,
      shType,
      props,
      shProgram,
    );
  }

  mutateShaderValueUsage(key: string, mutation: number) {
    let usage = this.valuesCacheUsage.get(key) || 0;
    this.valuesCacheUsage.set(key, usage + mutation);
  }

  getShaderValues(key: string) {
    const values = this.valuesCache.get(key);
    if (values === undefined) {
      return undefined;
    }
    this.mutateShaderValueUsage(key, 1);
    return values;
  }

  setShaderValues(key: string, values: Record<string, unknown>) {
    this.valuesCache.set(key, values);
    this.mutateShaderValueUsage(key, 1);
  }

  cleanup() {
    const values = [...this.valuesCacheUsage.entries()].sort(
      (entryA, entryB) => {
        if (entryA[1] < entryB[1]) {
          return -1;
        } else if (entryA[1] > entryB[1]) {
          return 1;
        }
        return 0;
      },
    );

    for (let i = 0; i < values.length; i++) {
      if (values[i]![1] > 0) {
        break;
      }
      this.valuesCacheUsage.delete(values[i]![0]);
      this.valuesCache.delete(values[i]![0]);
    }
  }

  useShader(shader: CoreShaderProgram): void {
    if (this.attachedShader === shader) {
      return;
    }
    if (this.attachedShader && this.attachedShader.detach) {
      this.attachedShader.detach();
    }
    if (shader.attach) {
      shader.attach();
    }
    this.attachedShader = shader;
  }
}
