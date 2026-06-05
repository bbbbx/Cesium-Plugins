// import BoundingSphere from "../Core/BoundingSphere.js";
// import Cartesian3 from "../Core/Cartesian3.js";
// import clone from "../Core/clone.js";
// import Color from "../Core/Color.js";
// import ComponentDatatype from "../Core/ComponentDatatype.js";
// import defaultValue from "../Core/defaultValue.js";
// import defer from "../Core/defer.js";
// import defined from "../Core/defined.js";
// import deprecationWarning from "../Core/deprecationWarning.js";
// import destroyObject from "../Core/destroyObject.js";
// import DeveloperError from "../Core/DeveloperError.js";
// import ImageBasedLighting from "./ImageBasedLighting.js";
// import Matrix4 from "../Core/Matrix4.js";
// import PrimitiveType from "../Core/PrimitiveType.js";
// import Resource from "../Core/Resource.js";
// import RuntimeError from "../Core/RuntimeError.js";
// import Transforms from "../Core/Transforms.js";
// import Buffer from "../Renderer/Buffer.js";
// import BufferUsage from "../Renderer/BufferUsage.js";
// import DrawCommand from "../Renderer/DrawCommand.js";
// import Pass from "../Renderer/Pass.js";
// import RenderState from "../Renderer/RenderState.js";
// import ShaderSource from "../Renderer/ShaderSource.js";
// import ForEach from "./GltfPipeline/ForEach.js";
// import Model from "./Model.js";
// import ModelInstance from "./ModelInstance.js";
// import ModelUtility from "./ModelUtility.js";
// import SceneMode from "./SceneMode.js";
// import ShadowMode from "./ShadowMode.js";
// import SplitDirection from "./SplitDirection.js";

import * as Cesium from 'cesium';

const {
  BoundingSphere,
  Cartesian3,
  clone,
  Color,
  ComponentDatatype,
  // defaultValue,
  defer,
  defined,
  deprecationWarning,
  destroyObject,
  DeveloperError,
  ImageBasedLighting,
  Quaternion,
  Matrix3,
  Matrix4,
  PrimitiveType,
  Resource,
  RuntimeError,
  Transforms,
  Buffer,
  BufferUsage,
  DrawCommand,
  Pass,
  RenderState,
  ShaderSource,
  ForEach,
  Model,
  // ModelInstance,
  ModelUtility,
  SceneMode,
  ShadowMode,
  SplitDirection,
} = Cesium;


class ModelInstance {
  get instanceId() { return this._instanceId; }

  get model() { return this.primitive?._model; }

  get modelMatrix() { return Matrix4.clone(this._modelMatrix); }

  set modelMatrix(value) {
    Matrix4.clone(value, this._modelMatrix);
    // this.primitive.expandBoundingSphere(this._modelMatrix);
    this.primitive._dirty = true;
  }

  constructor(collection, modelMatrix, instanceId) {
    /** @type {ModelInstanceCollection} */
    this.primitive = collection;
    this._modelMatrix = Matrix4.clone(modelMatrix);
    this._instanceId = instanceId;
  }
}

const LoadState = {
  NEEDS_LOAD: 0,
  LOADING: 1,
  LOADED: 2,
  FAILED: 3,
};

/**
 * A 3D model instance collection. All instances reference the same underlying model, but have unique
 * per-instance properties like model matrix, pick id, etc.
 *
 * Instances are rendered relative-to-center and for best results instances should be positioned close to one another.
 * Otherwise there may be precision issues if, for example, instances are placed on opposite sides of the globe.
 *
 * @alias ModelInstanceCollection
 * @constructor
 *
 * @param {Object} options Object with the following properties:
 * @param {Object[]} [options.instances] An array of instances, where each instance contains a modelMatrix and optional batchId when options.batchTable is defined.
 * @param {Cesium3DTileBatchTable} [options.batchTable] The batch table of the instanced 3D Tile.
 * @param {Resource|String} [options.url] The url to the .gltf file.
 * @param {Object} [options.requestType] The request type, used for request prioritization
 * @param {Object|ArrayBuffer|Uint8Array} [options.gltf] A glTF JSON object, or a binary glTF buffer.
 * @param {Resource|String} [options.basePath=''] The base path that paths in the glTF JSON are relative to.
 * @param {Boolean} [options.dynamic=false] Hint if instance model matrices will be updated frequently.
 * @param {Boolean} [options.show=true] Determines if the collection will be shown.
 * @param {Boolean} [options.allowPicking=true] When <code>true</code>, each instance is pickable with {@link Scene#pick}.
 * @param {Boolean} [options.asynchronous=true] Determines if model WebGL resource creation will be spread out over several frames or block until completion once all glTF files are loaded.
 * @param {Boolean} [options.incrementallyLoadTextures=true] Determine if textures may continue to stream in after the model is loaded.
 * @param {ShadowMode} [options.shadows=ShadowMode.ENABLED] Determines whether the collection casts or receives shadows from light sources.
 * @param {Cartesian3} [options.lightColor] The light color when shading models. When <code>undefined</code> the scene's light color is used instead.
 * @param {ImageBasedLighting} [options.imageBasedLighting] The properties for managing image-based lighting for this tileset.
 * @param {Boolean} [options.backFaceCulling=true] Whether to cull back-facing geometry. When true, back face culling is determined by the glTF material's doubleSided property; when false, back face culling is disabled.
 * @param {Boolean} [options.showCreditsOnScreen=false] Whether to display the credits of this model on screen.
 * @param {SplitDirection} [options.splitDirection=SplitDirection.NONE] The {@link SplitDirection} split to apply to this collection.
 * @param {Boolean} [options.debugShowBoundingVolume=false] For debugging only. Draws the bounding sphere for the collection.
 * @param {Boolean} [options.debugWireframe=false] For debugging only. Draws the instances in wireframe.
 * @exception {DeveloperError} Must specify either <options.gltf> or <options.url>, but not both.
 * @exception {DeveloperError} Shader program cannot be optimized for instancing. Parameters cannot have any of the following semantics: MODEL, MODELINVERSE, MODELVIEWINVERSE, MODELVIEWPROJECTIONINVERSE, MODELINVERSETRANSPOSE.
 *
 * @private
 */
function ModelInstanceCollection(options) {
  options = options ?? {};

  //>>includeStart('debug', pragmas.debug);
  if (!defined(options.gltf) && !defined(options.url)) {
    throw new DeveloperError("Either options.gltf or options.url is required.");
  }

  if (defined(options.gltf) && defined(options.url)) {
    throw new DeveloperError(
      "Cannot pass in both options.gltf and options.url."
    );
  }
  //>>includeEnd('debug');

  this._buffers = [];

  this.show = options.show ?? true;

  this._instancingSupported = false;
  this._dynamic = options.dynamic ?? false;
  this._allowPicking = options.allowPicking ?? true;
  this._ready = false;
  this._readyPromise = defer();
  this._state = LoadState.NEEDS_LOAD;
  this._dirty = true; // false;

  // Undocumented options
  this._cull = options.cull ?? true;
  this._opaquePass = options.opaquePass ?? Pass.OPAQUE;

  /** @type {ModelInstance[]} */
  this._instances = createInstances(this, options.instances);
  /** @type {number} 这个属性是为了用户修改 instances 的长度时，标记为 _dirty */
  this._instanceLength = this._instances.length;

  // When the model instance collection is backed by an i3dm tile,
  // use its batch table resources to modify the shaders, attributes, and uniform maps.
  this._batchTable = options.batchTable;

  this._model = undefined;
  /** @type {Float32Array} */
  this._vertexBufferTypedArray = undefined; // Hold onto the vertex buffer contents when dynamic is true
  /** @type {Cesium.Buffer} */
  this._vertexBuffer = undefined;
  this._batchIdBuffer = undefined;
  this._instancedUniformsByProgram = undefined;

  this._drawCommands = [];
  this._modelCommands = undefined;

  this._renderStates = undefined;
  this._disableCullingRenderStates = undefined;

  /** @type {Cesium.BoundingSphere} new 的时候根据 instance matrices 设置，所以需要动态更新时不准确 */
  // this._boundingSphere = createBoundingSphere(this);
  /** @type {Cesium.Cartesian3} new 的时候根据 instance matrices 设置，所以需要动态更新时不准确 */
  // this._center = Cartesian3.clone(this._boundingSphere.center);
  this._rtcTransform = new Matrix4();
  this._rtcModelView = new Matrix4(); // Holds onto uniform

  this._mode = undefined;

  this.modelMatrix = Matrix4.clone(Matrix4.IDENTITY);
  this._modelMatrix = Matrix4.clone(this.modelMatrix);

  // Passed on to Model
  this._url = Resource.createIfNeeded(options.url);
  this._requestType = options.requestType;
  this._gltf = options.gltf;
  this._basePath = Resource.createIfNeeded(options.basePath);
  this._asynchronous = options.asynchronous;
  this._incrementallyLoadTextures = options.incrementallyLoadTextures;
  this._upAxis = options.upAxis; // Undocumented option
  this._forwardAxis = options.forwardAxis; // Undocumented option

  this.shadows = options.shadows ?? ShadowMode.ENABLED;
  this._shadows = this.shadows;

  this._pickIdLoaded = options.pickIdLoaded;

  /**
   * The {@link SplitDirection} to apply to this collection.
   *
   * @type {SplitDirection}
   * @default {@link SplitDirection.NONE}
   */
  this.splitDirection = options.splitDirection ?? SplitDirection.NONE;

  this.debugShowBoundingVolume = options.debugShowBoundingVolume ?? false;
  this._debugShowBoundingVolume = false;

  this.debugWireframe = options.debugWireframe ?? false;
  this._debugWireframe = false;

  if (defined(options.imageBasedLighting)) {
    this._imageBasedLighting = options.imageBasedLighting;
    this._shouldDestroyImageBasedLighting = false;
  } else {
    this._imageBasedLighting = new ImageBasedLighting();
    this._shouldDestroyImageBasedLighting = true;
  }

  this.backFaceCulling = options.backFaceCulling ?? true;
  this._backFaceCulling = this.backFaceCulling;
  this.showCreditsOnScreen = options.showCreditsOnScreen ?? false;
}

Object.defineProperties(ModelInstanceCollection.prototype, {
  allowPicking: {
    get: function () {
      return this._allowPicking;
    },
  },
  instances: {
    get: function() {
      return this._instances;
    }
  },
  length: {
    get: function () {
      return this._instances.length;
    },
  },
  activeAnimations: {
    get: function () {
      return this._model.activeAnimations;
    },
  },
  ready: {
    get: function () {
      return this._ready;
    },
  },
  readyPromise: {
    get: function () {
      return this._readyPromise.promise;
    },
  },
  imageBasedLighting: {
    get: function () {
      return this._imageBasedLighting;
    },
    set: function (value) {
      if (value !== this._imageBasedLighting) {
        if (
          this._shouldDestroyImageBasedLighting &&
          !this._imageBasedLighting.isDestroyed()
        ) {
          this._imageBasedLighting.destroy();
        }
        this._imageBasedLighting = value;
        this._shouldDestroyImageBasedLighting = false;
      }
    },
  },
});

function createInstances(collection, instancesOptions) {
  instancesOptions = instancesOptions ?? [];
  const length = instancesOptions.length;
  const instances = new Array(length);
  for (let i = 0; i < length; ++i) {
    const instanceOptions = instancesOptions[i];
    const modelMatrix = instanceOptions.modelMatrix;
    const instanceId = instanceOptions.batchId ?? i;
    instances[i] = new ModelInstance(collection, modelMatrix, instanceId);
  }
  return instances;
}

function createBoundingSphere(collection) {
  const instancesLength = collection.length;
  const points = new Array(instancesLength);
  for (let i = 0; i < instancesLength; ++i) {
    points[i] = Matrix4.getTranslation(
      collection._instances[i]._modelMatrix,
      new Cartesian3()
    );
  }

  return BoundingSphere.fromPoints(points);
}

const scratchCartesian = new Cartesian3();
const scratchMatrix = new Matrix4();

// ModelInstanceCollection.prototype.expandBoundingSphere = function (instanceModelMatrix) {
//   const translation = Matrix4.getTranslation(instanceModelMatrix, scratchCartesian);
//   BoundingSphere.expand(this._boundingSphere, translation, this._boundingSphere);
// };

function getCheckUniformSemanticFunction(
  modelSemantics,
  supportedSemantics,
  programId,
  uniformMap
) {
  return function (uniform, uniformName) {
    const semantic = uniform.semantic;
    if (defined(semantic) && modelSemantics.indexOf(semantic) > -1) {
      if (supportedSemantics.indexOf(semantic) > -1) {
        uniformMap[uniformName] = semantic;
      } else {
        throw new RuntimeError(
          `${
            "Shader program cannot be optimized for instancing. " + 'Uniform "'
          }${uniformName}" in program "${programId}" uses unsupported semantic "${semantic}"`
        );
      }
    }
  };
}

function getInstancedUniforms(collection, programId) {
  if (defined(collection._instancedUniformsByProgram)) {
    return collection._instancedUniformsByProgram[programId];
  }

  const instancedUniformsByProgram = {};
  collection._instancedUniformsByProgram = instancedUniformsByProgram;

  // When using CESIUM_RTC_MODELVIEW the CESIUM_RTC center is ignored. Instances are always rendered relative-to-center.
  const modelSemantics = [
    "MODEL",
    "MODELVIEW",
    "CESIUM_RTC_MODELVIEW",
    "MODELVIEWPROJECTION",
    "MODELINVERSE",
    "MODELVIEWINVERSE",
    "MODELVIEWPROJECTIONINVERSE",
    "MODELINVERSETRANSPOSE",
    "MODELVIEWINVERSETRANSPOSE",
  ];
  const supportedSemantics = [
    "MODELVIEW",
    "CESIUM_RTC_MODELVIEW",
    "MODELVIEWPROJECTION",
    "MODELVIEWINVERSETRANSPOSE",
  ];

  const techniques = collection._model._sourceTechniques;
  for (const techniqueId in techniques) {
    if (techniques.hasOwnProperty(techniqueId)) {
      const technique = techniques[techniqueId];
      const program = technique.program;

      // Different techniques may share the same program, skip if already processed.
      // This assumes techniques that share a program do not declare different semantics for the same uniforms.
      if (!defined(instancedUniformsByProgram[program])) {
        const uniformMap = {};
        instancedUniformsByProgram[program] = uniformMap;
        ForEach.techniqueUniform(
          technique,
          getCheckUniformSemanticFunction(
            modelSemantics,
            supportedSemantics,
            programId,
            uniformMap
          )
        );
      }
    }
  }

  return instancedUniformsByProgram[programId];
}

function getVertexShaderCallback(collection) {
  return function (vs, programId) {
    const instancedUniforms = getInstancedUniforms(collection, programId);
    const usesBatchTable = defined(collection._batchTable);

    let renamedSource = ShaderSource.replaceMain(vs, "czm_instancing_main");

    let globalVarsHeader = "";
    let globalVarsMain = "";
    for (const uniform in instancedUniforms) {
      if (instancedUniforms.hasOwnProperty(uniform)) {
        const semantic = instancedUniforms[uniform];
        let varName;
        if (semantic === "MODELVIEW" || semantic === "CESIUM_RTC_MODELVIEW") {
          varName = "czm_instanced_modelView";
        } else if (semantic === "MODELVIEWPROJECTION") {
          varName = "czm_instanced_modelViewProjection";
          globalVarsHeader += "mat4 czm_instanced_modelViewProjection;\n";
          globalVarsMain +=
            "czm_instanced_modelViewProjection = czm_projection * czm_instanced_modelView;\n";
        } else if (semantic === "MODELVIEWINVERSETRANSPOSE") {
          varName = "czm_instanced_modelViewInverseTranspose";
          globalVarsHeader += "mat3 czm_instanced_modelViewInverseTranspose;\n";
          globalVarsMain +=
            "czm_instanced_modelViewInverseTranspose = mat3(czm_instanced_modelView);\n";
        }

        // Remove the uniform declaration
        let regex = new RegExp(`uniform.*${uniform}.*`);
        renamedSource = renamedSource.replace(regex, "");

        // Replace all occurrences of the uniform with the global variable
        regex = new RegExp(`${uniform}\\b`, "g");
        renamedSource = renamedSource.replace(regex, varName);
      }
    }

    // czm_instanced_model is the model matrix of the instance relative to center
    // czm_instanced_modifiedModelView is the transform from the center to view
    // czm_instanced_nodeTransform is the local offset of the node within the model
    const uniforms =
      "uniform mat4 czm_instanced_modifiedModelView;\n" +
      "uniform mat4 czm_instanced_nodeTransform;\n";

    let batchIdAttribute;
    let pickAttribute;
    let pickVarying;

    if (usesBatchTable) {
      batchIdAttribute = "attribute float a_batchId;\n";
      pickAttribute = "";
      pickVarying = "";
    } else {
      batchIdAttribute = "";
      pickAttribute =
        "attribute vec4 pickColor;\n" + "varying vec4 v_pickColor;\n";
      pickVarying = "    v_pickColor = pickColor;\n";
    }

    let instancedSource =
      `${uniforms + globalVarsHeader}mat4 czm_instanced_modelView;\n` +
      `attribute vec4 czm_modelMatrixRow0;\n` +
      `attribute vec4 czm_modelMatrixRow1;\n` +
      `attribute vec4 czm_modelMatrixRow2;\n${batchIdAttribute}${pickAttribute}${renamedSource}void main()\n` +
      `{\n` +
      `    mat4 czm_instanced_model = mat4(czm_modelMatrixRow0.x, czm_modelMatrixRow1.x, czm_modelMatrixRow2.x, 0.0, czm_modelMatrixRow0.y, czm_modelMatrixRow1.y, czm_modelMatrixRow2.y, 0.0, czm_modelMatrixRow0.z, czm_modelMatrixRow1.z, czm_modelMatrixRow2.z, 0.0, czm_modelMatrixRow0.w, czm_modelMatrixRow1.w, czm_modelMatrixRow2.w, 1.0);\n` +
      `    czm_instanced_modelView = czm_instanced_modifiedModelView * czm_instanced_model * czm_instanced_nodeTransform;\n${globalVarsMain}    czm_instancing_main();\n${pickVarying}}\n`;

    if (usesBatchTable) {
      const gltf = collection._model.gltfInternal;
      const diffuseAttributeOrUniformName = ModelUtility.getDiffuseAttributeOrUniform(
        gltf,
        programId
      );
      instancedSource = collection._batchTable.getVertexShaderCallback(
        true,
        "a_batchId",
        diffuseAttributeOrUniformName
      )(instancedSource);
    }

    return instancedSource;
  };
}

function getFragmentShaderCallback(collection) {
  return function (fs, programId) {
    const batchTable = collection._batchTable;
    if (defined(batchTable)) {
      const gltf = collection._model.gltfInternal;
      const diffuseAttributeOrUniformName = ModelUtility.getDiffuseAttributeOrUniform(
        gltf,
        programId
      );
      fs = batchTable.getFragmentShaderCallback(
        true,
        diffuseAttributeOrUniformName,
        false
      )(fs);
    } else {
      fs = `varying vec4 v_pickColor;\n${fs}`;
    }
    return fs;
  };
}

function createModifiedModelView(collection, context) {
  return function () {
    return Matrix4.multiply(
      context.uniformState.view,
      collection._rtcTransform,
      collection._rtcModelView
    );
  };
}

function createNodeTransformFunction(node) {
  return function () {
    return node.computedMatrix;
  };
}

function getUniformMapCallback(collection, context) {
  return function (uniformMap, programId, node) {
    uniformMap = clone(uniformMap);
    uniformMap.czm_instanced_modifiedModelView = createModifiedModelView(
      collection,
      context
    );
    uniformMap.czm_instanced_nodeTransform = createNodeTransformFunction(node);

    // Remove instanced uniforms from the uniform map
    const instancedUniforms = getInstancedUniforms(collection, programId);
    for (const uniform in instancedUniforms) {
      if (instancedUniforms.hasOwnProperty(uniform)) {
        delete uniformMap[uniform];
      }
    }

    if (defined(collection._batchTable)) {
      uniformMap = collection._batchTable.getUniformMapCallback()(uniformMap);
    }

    return uniformMap;
  };
}

function getVertexShaderNonInstancedCallback(collection) {
  return function (vs, programId) {
    if (defined(collection._batchTable)) {
      const gltf = collection._model.gltfInternal;
      const diffuseAttributeOrUniformName = ModelUtility.getDiffuseAttributeOrUniform(
        gltf,
        programId
      );
      vs = collection._batchTable.getVertexShaderCallback(
        true,
        "a_batchId",
        diffuseAttributeOrUniformName
      )(vs);
      // Treat a_batchId as a uniform rather than a vertex attribute
      vs = `uniform float a_batchId\n;${vs}`;
    }
    return vs;
  };
}

function getFragmentShaderNonInstancedCallback(collection) {
  return function (fs, programId) {
    const batchTable = collection._batchTable;
    if (defined(batchTable)) {
      const gltf = collection._model.gltfInternal;
      const diffuseAttributeOrUniformName = ModelUtility.getDiffuseAttributeOrUniform(
        gltf,
        programId
      );
      fs = batchTable.getFragmentShaderCallback(
        true,
        diffuseAttributeOrUniformName,
        false
      )(fs);
    } else {
      fs = `uniform vec4 czm_pickColor;\n${fs}`;
    }
    return fs;
  };
}

function getUniformMapNonInstancedCallback(collection) {
  return function (uniformMap) {
    if (defined(collection._batchTable)) {
      uniformMap = collection._batchTable.getUniformMapCallback()(uniformMap);
    }

    return uniformMap;
  };
}

function getVertexBufferTypedArray(collection) {
  const instances = collection._instances;
  const instancesLength = collection.length;
  const collectionCenter = collection._center;
  const vertexSizeInFloats = 12;

  let bufferData = collection._vertexBufferTypedArray;
  if (!defined(bufferData)) {
    bufferData = new Float32Array(instancesLength * vertexSizeInFloats);
  }
  if (collection._dynamic) {
    // Hold onto the buffer data so we don't have to allocate new memory every frame.
    collection._vertexBufferTypedArray = bufferData;
  }

  for (let i = 0; i < instancesLength; ++i) {
    const modelMatrix = instances[i]._modelMatrix;

    // Instance matrix is relative to center
    const instanceMatrix = Matrix4.clone(modelMatrix, scratchMatrix);
    instanceMatrix[12] -= collectionCenter.x;
    instanceMatrix[13] -= collectionCenter.y;
    instanceMatrix[14] -= collectionCenter.z;

    const offset = i * vertexSizeInFloats;

    // First three rows of the model matrix
    bufferData[offset + 0] = instanceMatrix[0];
    bufferData[offset + 1] = instanceMatrix[4];
    bufferData[offset + 2] = instanceMatrix[8];
    bufferData[offset + 3] = instanceMatrix[12];
    bufferData[offset + 4] = instanceMatrix[1];
    bufferData[offset + 5] = instanceMatrix[5];
    bufferData[offset + 6] = instanceMatrix[9];
    bufferData[offset + 7] = instanceMatrix[13];
    bufferData[offset + 8] = instanceMatrix[2];
    bufferData[offset + 9] = instanceMatrix[6];
    bufferData[offset + 10] = instanceMatrix[10];
    bufferData[offset + 11] = instanceMatrix[14];
  }

  return bufferData;
}

function createVertexBuffer(collection, context) {
  let i;
  const instances = collection._instances;
  const instancesLength = collection.length;
  const dynamic = collection._dynamic;
  const usesBatchTable = defined(collection._batchTable);

  if (usesBatchTable) {
    const batchIdBufferData = new Uint16Array(instancesLength);
    for (i = 0; i < instancesLength; ++i) {
      batchIdBufferData[i] = instances[i]._instanceId;
    }
    collection._batchIdBuffer = Buffer.createVertexBuffer({
      context: context,
      typedArray: batchIdBufferData,
      usage: BufferUsage.STATIC_DRAW,
    });
  }

  if (!usesBatchTable) {
    const pickIdBuffer = new Uint8Array(instancesLength * 4);
    for (i = 0; i < instancesLength; ++i) {
      const pickId = collection._pickIds[i];
      const pickColor = pickId.color;
      const offset = i * 4;
      pickIdBuffer[offset] = Color.floatToByte(pickColor.red);
      pickIdBuffer[offset + 1] = Color.floatToByte(pickColor.green);
      pickIdBuffer[offset + 2] = Color.floatToByte(pickColor.blue);
      pickIdBuffer[offset + 3] = Color.floatToByte(pickColor.alpha);
    }
    collection._pickIdBuffer = Buffer.createVertexBuffer({
      context: context,
      typedArray: pickIdBuffer,
      usage: BufferUsage.STATIC_DRAW,
    });
  }

  const vertexBufferTypedArray = getVertexBufferTypedArray(collection);
  collection._vertexBuffer = Buffer.createVertexBuffer({
    context: context,
    typedArray: vertexBufferTypedArray,
    usage: dynamic ? BufferUsage.STREAM_DRAW : BufferUsage.STATIC_DRAW,
  });
}

// function updateVertexBuffer(collection) {
//   const vertexBufferTypedArray = getVertexBufferTypedArray(collection);
//   collection._vertexBuffer.copyFromArrayView(vertexBufferTypedArray);
// }

function createPickIds(collection, context) {
  // PERFORMANCE_IDEA: we could skip the pick buffer completely by allocating
  // a continuous range of pickIds and then converting the base pickId + batchId
  // to RGBA in the shader.  The only consider is precision issues, which might
  // not be an issue in WebGL 2.
  const instances = collection._instances;
  const instancesLength = instances.length;
  const pickIds = new Array(instancesLength);
  for (let i = 0; i < instancesLength; ++i) {
    pickIds[i] = context.createPickId(instances[i]);
  }
  return pickIds;
}

function createModel(collection, context) {
  const instancingSupported = collection._instancingSupported;
  if (!instancingSupported) {
    deprecationWarning(
      "cpuModelInstancing",
      "Support for rendering instanced models on the CPU has been deprecated and will be removed in CesiumJS 1.97."
    );
  }

  const usesBatchTable = defined(collection._batchTable);
  const allowPicking = collection._allowPicking;

  const modelOptions = {
    url: collection._url,
    // requestType: collection._requestType,
    gltf: collection._gltf,
    basePath: collection._basePath,
    shadows: collection._shadows,
    // cacheKey: undefined,
    asynchronous: collection._asynchronous,
    allowPicking: allowPicking,
    incrementallyLoadTextures: collection._incrementallyLoadTextures,
    upAxis: collection._upAxis,
    forwardAxis: collection._forwardAxis,
    // precreatedAttributes: undefined,
    // vertexShaderLoaded: undefined,
    // fragmentShaderLoaded: undefined,
    // uniformMapLoaded: undefined,
    // pickIdLoaded: collection._pickIdLoaded,
    ignoreCommands: true,
    opaquePass: collection._opaquePass,
    imageBasedLighting: collection._imageBasedLighting,
    showOutline: collection.showOutline,
    showCreditsOnScreen: collection.showCreditsOnScreen,
  };

  if (!usesBatchTable) {
    collection._pickIds = createPickIds(collection, context);
  }

  if (instancingSupported) {
    // createVertexBuffer(collection, context);

    // const vertexSizeInFloats = 12;
    // const componentSizeInBytes = ComponentDatatype.getSizeInBytes(
    //   ComponentDatatype.FLOAT
    // );

    // const instancedAttributes = {
    //   czm_modelMatrixRow0: {
    //     index: 0, // updated in Model
    //     vertexBuffer: collection._vertexBuffer,
    //     componentsPerAttribute: 4,
    //     componentDatatype: ComponentDatatype.FLOAT,
    //     normalize: false,
    //     offsetInBytes: 0,
    //     strideInBytes: componentSizeInBytes * vertexSizeInFloats,
    //     instanceDivisor: 1,
    //   },
    //   czm_modelMatrixRow1: {
    //     index: 0, // updated in Model
    //     vertexBuffer: collection._vertexBuffer,
    //     componentsPerAttribute: 4,
    //     componentDatatype: ComponentDatatype.FLOAT,
    //     normalize: false,
    //     offsetInBytes: componentSizeInBytes * 4,
    //     strideInBytes: componentSizeInBytes * vertexSizeInFloats,
    //     instanceDivisor: 1,
    //   },
    //   czm_modelMatrixRow2: {
    //     index: 0, // updated in Model
    //     vertexBuffer: collection._vertexBuffer,
    //     componentsPerAttribute: 4,
    //     componentDatatype: ComponentDatatype.FLOAT,
    //     normalize: false,
    //     offsetInBytes: componentSizeInBytes * 8,
    //     strideInBytes: componentSizeInBytes * vertexSizeInFloats,
    //     instanceDivisor: 1,
    //   },
    // };

    // When using a batch table, add a batch id attribute
    // if (usesBatchTable) {
    //   instancedAttributes.a_batchId = {
    //     index: 0, // updated in Model
    //     vertexBuffer: collection._batchIdBuffer,
    //     componentsPerAttribute: 1,
    //     componentDatatype: ComponentDatatype.UNSIGNED_SHORT,
    //     normalize: false,
    //     offsetInBytes: 0,
    //     strideInBytes: 0,
    //     instanceDivisor: 1,
    //   };
    // }

    // if (!usesBatchTable) {
    //   instancedAttributes.pickColor = {
    //     index: 0, // updated in Model
    //     vertexBuffer: collection._pickIdBuffer,
    //     componentsPerAttribute: 4,
    //     componentDatatype: ComponentDatatype.UNSIGNED_BYTE,
    //     normalize: true,
    //     offsetInBytes: 0,
    //     strideInBytes: 0,
    //     instanceDivisor: 1,
    //   };
    // }

    // FIXME: 没有了！
    // 用 InstancingPipelineStage？
    // InstancingPipelineStage.process 只会调用一次！
    // DrawCommand 只会构建一次，然后 instanceCount 就定下来了
    // 需要每一帧动态更新 attribute 和 instanceCount
    // 需要更新的 3 个 attribute：
    //   a_instancingTransformRow0
    //   a_instancingTransformRow1
    //   a_instancingTransformRow2
    // modelOptions.precreatedAttributes = instancedAttributes;
    // modelOptions.vertexShaderLoaded = getVertexShaderCallback(collection);
    // modelOptions.fragmentShaderLoaded = getFragmentShaderCallback(collection);
    // modelOptions.uniformMapLoaded = getUniformMapCallback(collection, context);

    // 用 GltfLoader 自己创建 new Model() ？

    if (defined(collection._url)) {
      // modelOptions.cacheKey = `${collection._url.getUrlComponent()}#instanced`;
    }
  } else {
    debugger;
    modelOptions.vertexShaderLoaded = getVertexShaderNonInstancedCallback(
      collection
    );
    modelOptions.fragmentShaderLoaded = getFragmentShaderNonInstancedCallback(
      collection
    );
    modelOptions.uniformMapLoaded = getUniformMapNonInstancedCallback(
      collection,
      context
    );
  }

  if (defined(collection._url)) {
    fromGltfAsync(modelOptions).then(model => {
      collection._model = model;
      collection._model.errorEvent.addEventListener(function (error) {
        collection._state = LoadState.FAILED;
        collection._readyPromise.reject(error);
      });
    });
  } else {
    debugger;
    collection._model = new Model(modelOptions);
  }
}

function makeModelOptions(loader, modelType, options) {
  return {
    loader: loader,
    type: modelType,
    resource: options.resource,
    show: options.show,
    modelMatrix: options.modelMatrix,
    scale: options.scale,
    enableVerticalExaggeration: options.enableVerticalExaggeration,
    minimumPixelSize: options.minimumPixelSize,
    maximumScale: options.maximumScale,
    id: options.id,
    allowPicking: options.allowPicking,
    clampAnimations: options.clampAnimations,
    shadows: options.shadows,
    debugShowBoundingVolume: options.debugShowBoundingVolume,
    enableDebugWireframe: options.enableDebugWireframe,
    debugWireframe: options.debugWireframe,
    cull: options.cull,
    opaquePass: options.opaquePass,
    customShader: options.customShader,
    content: options.content,
    heightReference: options.heightReference,
    scene: options.scene,
    distanceDisplayCondition: options.distanceDisplayCondition,
    color: options.color,
    colorBlendAmount: options.colorBlendAmount,
    colorBlendMode: options.colorBlendMode,
    edgeDisplayMode: options.edgeDisplayMode,
    silhouetteColor: options.silhouetteColor,
    silhouetteSize: options.silhouetteSize,
    enableShowOutline: options.enableShowOutline,
    showOutline: options.showOutline,
    outlineColor: options.outlineColor,
    clippingPlanes: options.clippingPlanes,
    clippingPolygons: options.clippingPolygons,
    lightColor: options.lightColor,
    imageBasedLighting: options.imageBasedLighting,
    backFaceCulling: options.backFaceCulling,
    credit: options.credit,
    showCreditsOnScreen: options.showCreditsOnScreen,
    splitDirection: options.splitDirection,
    projectTo2D: options.projectTo2D,
    enablePick: options.enablePick,
    featureIdLabel: options.featureIdLabel,
    instanceFeatureIdLabel: options.instanceFeatureIdLabel,
    pointCloudShading: options.pointCloudShading,
    classificationType: options.classificationType,
    pickObject: options.pickObject,
  };
}

async function fromGltfAsync(options) {
  options = options ?? Cesium.Frozen.EMPTY_OBJECT;

  // options.gltf is used internally for 3D Tiles. It can be a Resource, a URL
  // to a glTF/glb file, a binary glTF buffer, or a JSON object containing the
  // glTF contents.
  const gltf = options.url ?? options.gltf;

  const loaderOptions = {
    releaseGltfJson: options.releaseGltfJson,
    asynchronous: options.asynchronous,
    incrementallyLoadTextures: options.incrementallyLoadTextures,
    upAxis: options.upAxis,
    forwardAxis: options.forwardAxis,
    loadAttributesFor2D: options.projectTo2D,
    enablePick: options.enablePick,
    loadIndicesForWireframe: options.enableDebugWireframe,
    loadPrimitiveOutline: options.enableShowOutline,
    loadForClassification: defined(options.classificationType),
  };

  const basePath = options.basePath ?? "";
  const baseResource = Resource.createIfNeeded(basePath);

  if (defined(gltf.asset)) {
    loaderOptions.gltfJson = gltf;
    loaderOptions.baseResource = baseResource;
    loaderOptions.gltfResource = baseResource;
  } else if (gltf instanceof Uint8Array) {
    loaderOptions.typedArray = gltf;
    loaderOptions.baseResource = baseResource;
    loaderOptions.gltfResource = baseResource;
  } else {
    loaderOptions.gltfResource = Resource.createIfNeeded(gltf);
  }

  const loader = new Cesium.GltfLoader(loaderOptions);

  const is3DTiles = false; // defined(options.content);
  const type = is3DTiles ? Cesium.ModelType.TILE_GLTF : Cesium.ModelType.GLTF;

  const resource = loaderOptions.gltfResource;

  const modelOptions = makeModelOptions(loader, type, options);
  modelOptions.resource = resource;
  modelOptions.environmentMapOptions = options.environmentMapOptions;

  try {
    // This load the gltf JSON and ensures the gltf is valid
    // Further resource loading is handled synchronously in loader.process(), and requires
    // hooking into model's update() as the frameState is needed
    await loader.load();
  } catch (error) {
    loader.destroy();
    throw ModelUtility.getError("model", resource, error);
  }

  const gltfCallback = options.gltfCallback;
  if (defined(gltfCallback)) {
    //>>includeStart('debug', pragmas.debug);
    Check.typeOf.func("options.gltfCallback", gltfCallback);
    //>>includeEnd('debug');

    gltfCallback(loader.gltfJson);
  }

  const model = new Model(modelOptions);

  const resourceCredits = model._resource.credits;
  if (defined(resourceCredits)) {
    const length = resourceCredits.length;
    for (let i = 0; i < length; i++) {
      model._resourceCredits.push(Credit.clone(resourceCredits[i]));
    }
  }

  return model;
}

function updateWireframe(collection, force) {
  if (collection._debugWireframe !== collection.debugWireframe || force) {
    collection._debugWireframe = collection.debugWireframe;

    // This assumes the original primitive was TRIANGLES and that the triangles
    // are connected for the wireframe to look perfect.
    const primitiveType = collection.debugWireframe
      ? PrimitiveType.LINES
      : PrimitiveType.TRIANGLES;
    const commands = collection._drawCommands;
    const length = commands.length;
    for (let i = 0; i < length; ++i) {
      commands[i].primitiveType = primitiveType;
    }
  }
}

function getDisableCullingRenderState(renderState) {
  const rs = clone(renderState, true);
  rs.cull.enabled = false;
  return RenderState.fromCache(rs);
}

function updateBackFaceCulling(collection, force) {
  if (collection._backFaceCulling !== collection.backFaceCulling || force) {
    collection._backFaceCulling = collection.backFaceCulling;

    const commands = collection._drawCommands;
    const length = commands.length;
    let i;

    if (!defined(collection._disableCullingRenderStates)) {
      collection._disableCullingRenderStates = new Array(length);
      collection._renderStates = new Array(length);
      for (i = 0; i < length; ++i) {
        const renderState = commands[i].renderState;
        const derivedRenderState = getDisableCullingRenderState(renderState);
        collection._disableCullingRenderStates[i] = derivedRenderState;
        collection._renderStates[i] = renderState;
      }
    }

    for (i = 0; i < length; ++i) {
      commands[i].renderState = collection._backFaceCulling
        ? collection._renderStates[i]
        : collection._disableCullingRenderStates[i];
    }
  }
}

function updateShowBoundingVolume(collection, force) {
  if (
    collection.debugShowBoundingVolume !==
      collection._debugShowBoundingVolume ||
    force
  ) {
    collection._debugShowBoundingVolume = collection.debugShowBoundingVolume;

    const commands = collection._drawCommands;
    const length = commands.length;
    for (let i = 0; i < length; ++i) {
      commands[i].debugShowBoundingVolume = collection.debugShowBoundingVolume;
    }
  }
}

// function createCommands(collection, drawCommands) {
//   const commandsLength = drawCommands.length;
//   const instancesLength = collection.length;
//   const boundingSphere = collection._boundingSphere;
//   const cull = collection._cull;

//   for (let i = 0; i < commandsLength; ++i) {
//     const drawCommand = DrawCommand.shallowClone(drawCommands[i]);
//     drawCommand.instanceCount = instancesLength;
//     drawCommand.boundingVolume = boundingSphere;
//     drawCommand.cull = cull;
//     if (defined(collection._batchTable)) {
//       drawCommand.pickId = collection._batchTable.getPickId();
//     } else {
//       drawCommand.pickId = "v_pickColor";
//     }
//     collection._drawCommands.push(drawCommand);
//   }
// }

function createBatchIdFunction(batchId) {
  return function () {
    return batchId;
  };
}

function createPickColorFunction(color) {
  return function () {
    return color;
  };
}

function createCommandsNonInstanced(collection, drawCommands) {
  // When instancing is disabled, create commands for every instance.
  const instances = collection._instances;
  const commandsLength = drawCommands.length;
  const instancesLength = collection.length;
  const batchTable = collection._batchTable;
  const usesBatchTable = defined(batchTable);
  const cull = collection._cull;

  for (let i = 0; i < commandsLength; ++i) {
    for (let j = 0; j < instancesLength; ++j) {
      const drawCommand = DrawCommand.shallowClone(drawCommands[i]);
      drawCommand.modelMatrix = new Matrix4(); // Updated in updateCommandsNonInstanced
      drawCommand.boundingVolume = new BoundingSphere(); // Updated in updateCommandsNonInstanced
      drawCommand.cull = cull;
      drawCommand.uniformMap = clone(drawCommand.uniformMap);
      if (usesBatchTable) {
        drawCommand.uniformMap.a_batchId = createBatchIdFunction(
          instances[j]._instanceId
        );
      } else {
        const pickId = collection._pickIds[j];
        drawCommand.uniformMap.czm_pickColor = createPickColorFunction(
          pickId.color
        );
      }
      collection._drawCommands.push(drawCommand);
    }
  }
}

// function updateCommandsNonInstanced(collection) {
//   const modelCommands = collection._modelCommands;
//   const commandsLength = modelCommands.length;
//   const instancesLength = collection.length;
//   const collectionTransform = collection._rtcTransform;
//   const collectionCenter = collection._center;

//   for (let i = 0; i < commandsLength; ++i) {
//     const modelCommand = modelCommands[i];
//     for (let j = 0; j < instancesLength; ++j) {
//       const commandIndex = i * instancesLength + j;
//       const drawCommand = collection._drawCommands[commandIndex];
//       let instanceMatrix = Matrix4.clone(
//         collection._instances[j]._modelMatrix,
//         scratchMatrix
//       );
//       instanceMatrix[12] -= collectionCenter.x;
//       instanceMatrix[13] -= collectionCenter.y;
//       instanceMatrix[14] -= collectionCenter.z;
//       instanceMatrix = Matrix4.multiply(
//         collectionTransform,
//         instanceMatrix,
//         scratchMatrix
//       );
//       const nodeMatrix = modelCommand.modelMatrix;
//       const modelMatrix = drawCommand.modelMatrix;
//       Matrix4.multiply(instanceMatrix, nodeMatrix, modelMatrix);

//       const nodeBoundingSphere = modelCommand.boundingVolume;
//       const boundingSphere = drawCommand.boundingVolume;
//       BoundingSphere.transform(
//         nodeBoundingSphere,
//         instanceMatrix,
//         boundingSphere
//       );
//     }
//   }
// }

function traverseSceneGraph(
  sceneGraph,
  runtimeNode,
  visibleNodesOnly,
  callback,
  callbackOptions,
) {
  if (visibleNodesOnly && !runtimeNode.show) {
    return;
  }

  const childrenLength = runtimeNode.children.length;
  for (let i = 0; i < childrenLength; i++) {
    const childRuntimeNode = runtimeNode.getChild(i);
    traverseSceneGraph(
      sceneGraph,
      childRuntimeNode,
      visibleNodesOnly,
      callback,
      callbackOptions,
    );
  }

  const runtimePrimitives = runtimeNode.runtimePrimitives;
  const runtimePrimitivesLength = runtimePrimitives.length;
  for (let j = 0; j < runtimePrimitivesLength; j++) {
    const runtimePrimitive = runtimePrimitives[j];
    callback(runtimePrimitive, callbackOptions);
  }
}

function forEachRuntimePrimitive(
  sceneGraph,
  visibleNodesOnly,
  callback,
  callbackOptions,
) {
  const rootNodes = sceneGraph._rootNodes;
  const rootNodesLength = rootNodes.length;
  for (let i = 0; i < rootNodesLength; i++) {
    const rootNodeIndex = rootNodes[i];
    const runtimeNode = sceneGraph._runtimeNodes[rootNodeIndex];
    traverseSceneGraph(
      sceneGraph,
      runtimeNode,
      visibleNodesOnly,
      callback,
      callbackOptions,
    );
  }
}

function pushPrimitiveDrawCommands(runtimePrimitive, options) {
  const frameState = options.frameState;
  // const hasSilhouette = options.hasSilhouette;
  const drawCommands = options.drawCommands;

  // const passes = frameState.passes;
  // const silhouetteCommands = scratchSilhouetteCommands;
  // const edgeCommands = scratchEdgeCommands;
  const primitiveDrawCommand = runtimePrimitive.drawCommand;
  primitiveDrawCommand.pushCommands(frameState, /*frameState.commandList*/drawCommands);

  // If a model has silhouettes, the commands that draw the silhouettes for
  // each primitive can only be invoked after the entire model has drawn.
  // Otherwise, the silhouette may draw on top of the model. This requires
  // gathering the original commands and the silhouette commands separately.
  // if (hasSilhouette && !passes.pick) {
  //   primitiveDrawCommand.pushSilhouetteCommands(frameState, silhouetteCommands);
  // }

  // Add edge commands to the edge pass
  // if (defined(primitiveDrawCommand.pushEdgeCommands)) {
  //   primitiveDrawCommand.pushEdgeCommands(frameState, edgeCommands);
  // }
}

const scratchPushDrawCommandOptions = {};

function getModelCommands(model, frameState) {
  const drawCommands = [];

  const pushDrawCommandOptions = scratchPushDrawCommandOptions;
  // pushDrawCommandOptions.hasSilhouette = model.hasSilhouette(frameState);
  pushDrawCommandOptions.frameState = frameState;
  pushDrawCommandOptions.drawCommands = drawCommands;
  forEachRuntimePrimitive(model.sceneGraph, true, pushPrimitiveDrawCommands, pushDrawCommandOptions);

  // const nodeCommands = model._nodeCommands;
  // const length = nodeCommands.length;

  // const drawCommands = [];

  // for (let i = 0; i < length; ++i) {
  //   const nc = nodeCommands[i];
  //   if (nc.show) {
  //     drawCommands.push(nc.command);
  //   }
  // }

  return drawCommands;
}

function commandsDirty(collection) {
  const commands = collection._drawCommands; // model._nodeCommands;
  const length = commands.length;

  let commandsDirty = false;

  for (let i = 0; i < length; i++) {
    const command = commands[i];
    if (command.dirty) {
      command.dirty = false;
      commandsDirty = true;
    }
  }
  return commandsDirty;
}

function generateModelCommands(modelInstanceCollection, instancingSupported, frameState) {
  modelInstanceCollection._drawCommands = [];

  const modelCommands = getModelCommands(modelInstanceCollection._model, frameState);
  if (instancingSupported) {
    createCommands(modelInstanceCollection, modelCommands);
  } else {
    debugger;
    createCommandsNonInstanced(modelInstanceCollection, modelCommands);
    updateCommandsNonInstanced(modelInstanceCollection);
  }
}

function updateShadows(collection, force) {
  if (collection.shadows !== collection._shadows || force) {
    collection._shadows = collection.shadows;

    const castShadows = ShadowMode.castShadows(collection.shadows);
    const receiveShadows = ShadowMode.receiveShadows(collection.shadows);

    const drawCommands = collection._drawCommands;
    const length = drawCommands.length;
    for (let i = 0; i < length; ++i) {
      const drawCommand = drawCommands[i];
      drawCommand.castShadows = castShadows;
      drawCommand.receiveShadows = receiveShadows;
    }
  }
}

ModelInstanceCollection.prototype.pushInstance = function (modelMatrix, batchId) {
  this.instances.push(new ModelInstance(this, modelMatrix, batchId));
  this._dirty = true;
};

ModelInstanceCollection.prototype.update = function (frameState) {
  if (frameState.mode === SceneMode.MORPHING) {
    return;
  }

  if (!this.show) {
    return;
  }

  if (this.length === 0) {
    return;
  }

  const context = frameState.context;
  if (!context.instancedArrays) {
    Cesium.oneTimeWarning('ModelInstanceCollection context.instancedArrays', 'ModelInstanceCollection: 你的环境不支持 GPU 实例化，请直接使用 Model。');
    return;
  }

  if (this._state === LoadState.NEEDS_LOAD) {
    this._state = LoadState.LOADING;
    this._instancingSupported = context.instancedArrays;
    createModel(this, context);
  }

  const instancingSupported = this._instancingSupported;
  const model = this._model;
  if (!defined(model)) {
    return;
  }

  model.imageBasedLighting = this._imageBasedLighting;
  model.showCreditsOnScreen = this.showCreditsOnScreen;
  model.splitDirection = this.splitDirection;

  // update 就 push 了 drawcommand。
  // 或者把 update 创建 ModelSceneGraph 的部分搬过来，然后修改，这样就可以在 Cesium push command 前更新 vertex buffer 和 model matrix，但现在先这样吧
  model.update(frameState);

  if (model.ready && this._state === LoadState.LOADING) {
    this._state = LoadState.LOADED;
    this._ready = true;

    // Expand bounding volume to fit the radius of the loaded model including the model's offset from the center
    // const modelRadius =
    //   model._boundingSphere/*Internal*/.radius +
    //   Cartesian3.magnitude(model._boundingSphere/*Internal*/.center);
    // this._boundingSphere.radius += modelRadius;
    // this._modelCommands = getModelCommands(model, frameState);

    // generateModelCommands(this, instancingSupported, frameState);

    this._readyPromise.resolve(this);
    return;
  }

  if (this._state !== LoadState.LOADED) {
    return;
  }

  // console.log(model.sceneGraph.components);
  if (this._instanceLength !== this._instances.length) {
    this._instanceLength = this._instances.length;
    this._dirty = true;
  }
  if (this._dirty) {
    this._dirty = false;

    // 每次都重建？会不会很卡？创建资源？
    // configurePipeline
    model.resetDrawCommands();

    const sceneGraph = model.sceneGraph;
    const runtimeNodes = sceneGraph._runtimeNodes;
    const components = sceneGraph.components;
    if (!defined(this._originComponentsTransform)) {
      this._originComponentsTransform = Matrix4.clone(components.transform);
    }

    const gltfLoader = model._loader;
    // node.instances = loadInstances(gltfLoader, nodeExtensions, frameState);
    const instanceCount = this._instances.length;

    const translation = new Cartesian3();
    const rotation = new Matrix3();
    const quaternion = new Quaternion();
    const scale = new Cartesian3();

    const translationTypedArray = new Float32Array(instanceCount * 3);
    const rotationTypedArray = new Float32Array(instanceCount * 4);
    const scaleTypedArray = new Float32Array(instanceCount * 3);
    const featureIdArray = new Float32Array(instanceCount);

    // this._instances.forEach((modelInstance, i) => {
    //   Matrix4.getTranslation(modelInstance.modelMatrix, translation);
    //   Cartesian3.pack(translation, translationTypedArray, i * 3);

    //   Matrix4.getRotation(modelInstance.modelMatrix, rotation);
    //   Quaternion.fromRotationMatrix(rotation, quaternion);
    //   Quaternion.pack(quaternion, rotationTypedArray, i * 4);

    //   Matrix4.getScale(modelInstance.modelMatrix, scale);
    //   Cartesian3.pack(scale, scaleTypedArray, i * 3);
    // });

    const instancePositions = this._instances.map(instance => Matrix4.getTranslation(instance.modelMatrix, new Cartesian3()));
    // const instancePosition = new Cartesian3();

    const instanceNormalRight = new Cartesian3();
    const instanceNormalUp = new Cartesian3();
    const instanceNormalForward = new Cartesian3();
    const instanceRotation = new Matrix3();
    const instanceQuaternion = new Quaternion();
    const instanceQuaternionArray = new Array(4);

    const instanceScale = new Cartesian3();
    const instanceScaleArray = new Array(3);

    const instanceTransform = new Matrix4();

    const positionBoundingSphere = BoundingSphere.fromPoints(instancePositions);

    const positionScratch = new Cartesian3();
    const transformScratch = new Matrix4();

    for (let i = 0; i < instancePositions.length; i++) {
      Cartesian3.subtract(instancePositions[i], positionBoundingSphere.center, positionScratch);

      translationTypedArray[3 * i + 0] = positionScratch.x;
      translationTypedArray[3 * i + 1] = positionScratch.y;
      translationTypedArray[3 * i + 2] = positionScratch.z;
    }

    // Set the center of the bounding sphere as the RTC center transform.
    const centerTransform = Matrix4.fromTranslation(
      positionBoundingSphere.center,
      transformScratch,
    );

    // Combine the center transform and the CESIUM_RTC transform from the glTF.
    // In practice CESIUM_RTC is not set for instanced models but multiply the
    // transforms just in case.
    // instanced vertex buffer 下一帧才更新，model matrix 更新也要慢一帧，和 buffer 同步
    frameState.afterRender.push(() => {
      components.transform = Matrix4.multiplyTransformation(
        centerTransform,
        this._originComponentsTransform, // components.transform,
        components.transform,
      );
      // model._updateModelMatrix = true;
      const modelMatrix = defined(model._clampedModelMatrix) ? model._clampedModelMatrix : model.modelMatrix;
      sceneGraph.updateModelMatrix(modelMatrix, frameState);
    });

    for (let i = 0; i < instanceCount; i++) {
      const instanceModelMatrix = this._instances[i]._modelMatrix;
      const instancePosition = instancePositions[i]; // Cartesian3.clone(instancePositions[i], instancePosition);

      // processRotation(
      //   featureTable,
      //   eastNorthUp,
      //   i,
      //  out instanceQuaternion,
      //   instancePosition,
      //  out instanceNormalUp,
      //  out instanceNormalRight,
      //  out instanceNormalForward,
      //  out instanceRotation,
      //  out instanceTransform,
      // );
      // Transforms.eastNorthUpToFixedFrame(
      //   instancePosition,
      //   Cesium.Ellipsoid.WGS84,
      //   instanceTransform,
      // );
      // Matrix4.getMatrix3(instanceTransform, instanceRotation);

      Matrix4.getRotation(this._instances[i]._modelMatrix, instanceRotation);
      Quaternion.fromRotationMatrix(instanceRotation, instanceQuaternion);

      Quaternion.pack(instanceQuaternion, instanceQuaternionArray, 0);
      rotationTypedArray[4 * i + 0] = instanceQuaternionArray[0];
      rotationTypedArray[4 * i + 1] = instanceQuaternionArray[1];
      rotationTypedArray[4 * i + 2] = instanceQuaternionArray[2];
      rotationTypedArray[4 * i + 3] = instanceQuaternionArray[3];

      // processScale(featureTable, i, instanceScale);
      // instanceScale.x = 1;
      // instanceScale.y = 1;
      // instanceScale.z = 1;
      Matrix4.getScale(this._instances[i]._modelMatrix, instanceScale);
      Cartesian3.pack(instanceScale, instanceScaleArray, 0);
      scaleTypedArray[3 * i + 0] = instanceScaleArray[0];
      scaleTypedArray[3 * i + 1] = instanceScaleArray[1];
      scaleTypedArray[3 * i + 2] = instanceScaleArray[2];

      let batchId; // = ?
      if (!defined(batchId)) {
        batchId = i;
      }
      featureIdArray[i] = batchId;
    }

    const instances = new Cesium.ModelComponents.Instances();
    instances.transformInWorldSpace = true;
    const buffers = /*loader*/this._buffers;

    const translationAttribute = new Cesium.ModelComponents.Attribute();
    translationAttribute.name = 'Instance Translation';
    translationAttribute.semantic = Cesium.InstanceAttributeSemantic.TRANSLATION;
    translationAttribute.componentDatatype = ComponentDatatype.FLOAT;
    translationAttribute.type = Cesium.AttributeType.VEC3;
    translationAttribute.count = instanceCount;
    translationAttribute.typedArray = translationTypedArray;
    // 用 buffer?
    // Cesium 不用
    // FIXME: 需要更新 runtimeNode.instancingTransformsBuffer
    // const buffer = Cesium.Buffer.createVertexBuffer({
    //   context: frameState.context,
    //   typedArray: translationTypedArray,
    //   usage: Cesium.BufferUsage.STREAM_DRAW,
    // });
    // // Destruction of resources is handled by I3dmLoader.unload().
    // buffer.vertexArrayDestroyable = false;
    // buffers.push(buffer);
    // translationAttribute.buffer = buffer;
    // translationAttribute.byteOffset = ;
    // translationAttribute.byteStride = ;
    // translationAttribute.min = ;
    // translationAttribute.max = ;
    instances.attributes.push(translationAttribute);

    const rotationAttribute = new Cesium.ModelComponents.Attribute();
    rotationAttribute.name = 'Instance Rotation';
    rotationAttribute.semantic = Cesium.InstanceAttributeSemantic.ROTATION;
    rotationAttribute.componentDatatype = ComponentDatatype.FLOAT;
    rotationAttribute.type = Cesium.AttributeType.VEC4;
    rotationAttribute.typedArray = rotationTypedArray;
    rotationAttribute.count = instanceCount;
    instances.attributes.push(rotationAttribute);

    const scaleAttribute = new Cesium.ModelComponents.Attribute();
    scaleAttribute.name = 'Instance Scale';
    scaleAttribute.semantic = Cesium.InstanceAttributeSemantic.SCALE;
    scaleAttribute.componentDatatype = ComponentDatatype.FLOAT;
    scaleAttribute.type = Cesium.AttributeType.VEC3;
    scaleAttribute.typedArray = scaleTypedArray;
    scaleAttribute.count = instanceCount;
    instances.attributes.push(scaleAttribute);

    // // Create feature ID vertex attribute.
    // const featureIdAttribute = new Cesium.ModelComponents.Attribute();
    // featureIdAttribute.name = "Instance Feature ID";
    // featureIdAttribute.setIndex = 0;
    // featureIdAttribute.semantic = Cesium.InstanceAttributeSemantic.FEATURE_ID;
    // featureIdAttribute.componentDatatype = ComponentDatatype.FLOAT;
    // featureIdAttribute.type = Cesium.AttributeType.SCALAR;
    // featureIdAttribute.count = instanceCount;
    // const buffer = Cesium.Buffer.createVertexBuffer({
    //   context: frameState.context,
    //   typedArray: featureIdArray,
    //   usage: Cesium.BufferUsage.STATIC_DRAW,
    // });
    // // Destruction of resources is handled by I3dmLoader.unload().
    // buffer.vertexArrayDestroyable = false;
    // buffers.push(buffer);
    // featureIdAttribute.buffer = buffer;
    // instances.attributes.push(featureIdAttribute);

    // Create feature ID attribute.
    // const featureIdInstanceAttribute = new Cesium.ModelComponents.FeatureIdAttribute();
    // featureIdInstanceAttribute.propertyTableId = 0;
    // featureIdInstanceAttribute.setIndex = 0;
    // featureIdInstanceAttribute.positionalLabel = "instanceFeatureId_0";
    // instances.featureIds.push(featureIdInstanceAttribute);

    // const transformsTypedArray = transformsToTypedArray(transforms);
    // // buffer = createVertexBuffer(transformsTypedArray, frameState);
    // const buffer = Buffer.createVertexBuffer({
    //   context: frameState.context,
    //   typedArray: typedArray,
    //   usage: BufferUsage.DYNAMIC_DRAW,
    // });

    // // Destruction of resources allocated by the Model
    // // is handled by Model.destroy().
    // buffer.vertexArrayDestroyable = false;

    // 下一帧 Model.update 时才会创建
    // 这些 buffer 会 push 进 model._modelResources，model.destroy 时会销毁
    // 提前销毁，避免太多
    for (let i = 0; i < runtimeNodes.length; i++) {
      const runtimeNode = runtimeNodes[i];
      if (defined(runtimeNode.instancingTransformsBuffer)) {
        const index = model._modelResources.findIndex(r => r === runtimeNode.instancingTransformsBuffer);
        if (index >= 0) {
          // 移除，避免 Cesium 也销毁导致报错
          model._modelResources.splice(index, 1);
        }

        runtimeNode.instancingTransformsBuffer.destroy();
        runtimeNode.instancingTransformsBuffer = undefined;
      }
    }

    // Apply instancing to every node that has at least one primitive.
    const nodes = components.nodes;
    const nodesLength = nodes.length;
    let makeInstancesCopy = false;
    for (let i = 0; i < nodesLength; i++) {
      const node = nodes[i];
      if (node.primitives.length > 0) {
        // If the instances have not been assigned to a node already, assign
        // it to the first node encountered. Otherwise, make a copy of them
        // for each subsequent node.
        node.instances = makeInstancesCopy
          ? createInstancesCopy(instances)
          : instances;

        makeInstancesCopy = true;
      }
    }
  }

  // const modeChanged = frameState.mode !== this._mode;
  // const modelMatrix = this.modelMatrix;
  // const modelMatrixChanged = !Matrix4.equals(this._modelMatrix, modelMatrix);

  // if (modeChanged || modelMatrixChanged) {
  //   this._mode = frameState.mode;
  //   Matrix4.clone(modelMatrix, this._modelMatrix);
  //   let rtcTransform = Matrix4.multiplyByTranslation(
  //     this._modelMatrix,
  //     this._center,
  //     this._rtcTransform
  //   );
  //   if (this._mode !== SceneMode.SCENE3D) {
  //     rtcTransform = Transforms.basisTo2D(
  //       frameState.mapProjection,
  //       rtcTransform,
  //       rtcTransform
  //     );
  //   }
  //   Matrix4.getTranslation(rtcTransform, this._boundingSphere.center);
  // }

  // if (instancingSupported && this._dirty) {
  //   // If at least one instance has moved assume the collection is now dynamic
  //   this._dynamic = true;
  //   this._dirty = false;

  //   // PERFORMANCE_IDEA: only update dirty sub-sections instead of the whole collection
  //   updateVertexBuffer(this);
  // }

  // If the model was set to rebuild shaders during update, rebuild instanced commands.
  // const modelCommandsDirty = commandsDirty(this);
  // if (modelCommandsDirty) {
  //   generateModelCommands(this, instancingSupported, frameState);
  // }

  // If any node changes due to an animation, update the commands. This could be inefficient if the model is
  // composed of many nodes and only one changes, however it is probably fine in the general use case.
  // Only applies when instancing is disabled. The instanced shader automatically handles node transformations.
  // if (
  //   !instancingSupported &&
  //   (model.dirty || this._dirty || modeChanged || modelMatrixChanged)
  // ) {
  //   updateCommandsNonInstanced(this);
  // }

  // updateShadows(this, modelCommandsDirty);
  // updateWireframe(this, modelCommandsDirty);
  // updateBackFaceCulling(this, modelCommandsDirty);
  // updateShowBoundingVolume(this, modelCommandsDirty);

  // const passes = frameState.passes;
  // if (!passes.render && !passes.pick) {
  //   return;
  // }

  // const commandList = frameState.commandList;
  // const commands = this._drawCommands;
  // const commandsLength = commands.length;

  // for (let i = 0; i < commandsLength; ++i) {
  //   commandList.push(commands[i]);
  // }
};

function transformsToTypedArray(transforms) {
  const elements = 12;
  const count = transforms.length;
  const transformsTypedArray = new Float32Array(count * elements);

  for (let i = 0; i < count; i++) {
    const transform = transforms[i];
    const offset = elements * i;

    transformsTypedArray[offset + 0] = transform[0];
    transformsTypedArray[offset + 1] = transform[4];
    transformsTypedArray[offset + 2] = transform[8];
    transformsTypedArray[offset + 3] = transform[12];
    transformsTypedArray[offset + 4] = transform[1];
    transformsTypedArray[offset + 5] = transform[5];
    transformsTypedArray[offset + 6] = transform[9];
    transformsTypedArray[offset + 7] = transform[13];
    transformsTypedArray[offset + 8] = transform[2];
    transformsTypedArray[offset + 9] = transform[6];
    transformsTypedArray[offset + 10] = transform[10];
    transformsTypedArray[offset + 11] = transform[14];
  }

  return transformsTypedArray;
}

// function createVertexBuffer(typedArray, frameState) {
//   const buffer = Buffer.createVertexBuffer({
//     context: frameState.context,
//     typedArray: typedArray,
//     usage: BufferUsage.DYNAMIC_DRAW,
//   });

//   // Destruction of resources allocated by the Model
//   // is handled by Model.destroy().
//   buffer.vertexArrayDestroyable = false;

//   return buffer;
// }


function createInstancesCopy(instances) {
  const instancesCopy = new Cesium.ModelComponents.Instances();
  instancesCopy.transformInWorldSpace = instances.transformInWorldSpace;

  const attributes = instances.attributes;
  const attributesLength = attributes.length;

  for (let i = 0; i < attributesLength; i++) {
    const attributeCopy = clone(attributes[i], false);
    instancesCopy.attributes.push(attributeCopy);
  }

  instancesCopy.featureIds = instances.featureIds;

  return instancesCopy;
}

ModelInstanceCollection.prototype.isDestroyed = function () {
  return false;
};

ModelInstanceCollection.prototype.destroy = function () {
  this._model = this._model && this._model.destroy();

  const pickIds = this._pickIds;
  if (defined(pickIds)) {
    const length = pickIds.length;
    for (let i = 0; i < length; ++i) {
      pickIds[i].destroy();
    }
  }

  if (
    this._shouldDestroyImageBasedLighting &&
    !this._imageBasedLighting.isDestroyed()
  ) {
    this._imageBasedLighting.destroy();
  }
  this._imageBasedLighting = undefined;

  return destroyObject(this);
};

export { ModelInstanceCollection, ModelInstance };