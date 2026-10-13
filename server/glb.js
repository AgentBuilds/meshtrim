import { ApiError } from './errors.js';

export const MAX_GLB_BYTES = 50 * 1024 * 1024;
const invalid = message => { throw new ApiError(422, 'INVALID_GLB', message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;

// Container and inspection validation, not a replacement for the full glTF validator.
// External resource references are rejected: uploads must be self-contained.
export function inspectGlb(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 20) invalid('GLB header is missing');
  if (bytes.length > MAX_GLB_BYTES) throw new ApiError(413, 'PAYLOAD_TOO_LARGE', 'GLB exceeds 50 MiB');
  if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(4) !== 2) invalid('Expected a GLB version 2 file');
  if (bytes.readUInt32LE(8) !== bytes.length) invalid('GLB declared length does not match the upload');
  let document;
  let binaryLength = 0;
  let binarySeen = false;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) invalid('Truncated GLB chunk header');
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const end = offset + 8 + length;
    if (length % 4 || end > bytes.length) invalid('GLB chunk has invalid bounds or alignment');
    if (offset === 12 && type !== 0x4e4f534a) invalid('First GLB chunk must contain JSON');
    if (type === 0x4e4f534a) {
      if (document || length > 4 * 1024 * 1024) invalid('GLB must contain one JSON chunk of at most 4 MiB');
      try {
        document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset + 8, end)));
      } catch { invalid('GLB JSON is invalid'); }
      if (!object(document)) invalid('GLB JSON must be an object');
    } else if (type === 0x004e4942) {
      if (binarySeen) invalid('Duplicate GLB binary chunk');
      binarySeen = true;
      binaryLength = length;
    }
    offset = end;
  }
  if (document?.asset?.version !== '2.0') invalid('glTF asset.version must be 2.0');
  for (const key of ['meshes', 'accessors', 'textures', 'images', 'buffers', 'bufferViews', 'materials', 'nodes']) {
    if (document[key] !== undefined && (!Array.isArray(document[key]) || document[key].some(item => !object(item)))) {
      invalid(`glTF ${key} must be an array of objects`);
    }
  }
  for (const key of ['extensionsUsed', 'extensionsRequired']) {
    if (document[key] !== undefined && (!Array.isArray(document[key]) || document[key].some(item => typeof item !== 'string'))) {
      invalid(`glTF ${key} must be an array of strings`);
    }
  }
  const buffers = document.buffers ?? [];
  const views = document.bufferViews ?? [];
  const accessors = document.accessors ?? [];
  const images = document.images ?? [];
  const ref = (items, index, label) => {
    if (!integer(index) || index >= items.length) invalid(`Invalid ${label} reference`);
    return items[index];
  };
  const embeddedUri = uri => typeof uri === 'string' && /^data:[^,]+;base64,[A-Za-z0-9+/]*={0,2}$/.test(uri);
  buffers.forEach((buffer, index) => {
    if (!integer(buffer.byteLength) || buffer.byteLength === 0) invalid('Invalid buffer byteLength');
    if (buffer.uri !== undefined) {
      if (!embeddedUri(buffer.uri)) invalid('External buffer URIs are not supported');
    } else if (index !== 0 || !binarySeen || buffer.byteLength > binaryLength || binaryLength - buffer.byteLength > 3) {
      invalid('GLB binary buffer length is invalid');
    }
  });
  views.forEach(view => {
    const buffer = ref(buffers, view.buffer, 'buffer');
    if (!integer(view.byteLength) || view.byteLength === 0 || !integer(view.byteOffset ?? 0)
      || (view.byteOffset ?? 0) + view.byteLength > buffer.byteLength) invalid('Invalid bufferView bounds');
  });
  accessors.forEach(accessor => {
    if (!integer(accessor.count) || accessor.count === 0) invalid('Invalid accessor count');
    if (![5120, 5121, 5122, 5123, 5125, 5126].includes(accessor.componentType)
      || !['SCALAR', 'VEC2', 'VEC3', 'VEC4', 'MAT2', 'MAT3', 'MAT4'].includes(accessor.type)) invalid('Invalid accessor format');
    const offset = accessor.byteOffset ?? 0;
    if (!integer(offset)) invalid('Invalid accessor byteOffset');
    if (accessor.bufferView !== undefined) {
      const view = ref(views, accessor.bufferView, 'accessor bufferView');
      const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[accessor.componentType];
      const dimensions = { SCALAR: [1, 1], VEC2: [2, 1], VEC3: [3, 1], VEC4: [4, 1], MAT2: [2, 2], MAT3: [3, 3], MAT4: [4, 4] }[accessor.type];
      const [rows, columns] = dimensions;
      const columnBytes = columns === 1 ? rows * componentBytes : Math.ceil(rows * componentBytes / 4) * 4;
      const elementBytes = columnBytes * columns;
      const elementSpan = columnBytes * (columns - 1) + rows * componentBytes;
      const stride = view.byteStride ?? elementBytes;
      if (!integer(stride) || stride < elementBytes || stride % componentBytes
        || (view.byteStride !== undefined && (stride < 4 || stride > 252 || stride % 4))
        || offset % componentBytes || offset + (accessor.count - 1) * stride + elementSpan > view.byteLength) {
        invalid('Accessor exceeds its bufferView or has invalid alignment');
      }
    }
  });
  images.forEach(image => {
    if (image.uri !== undefined) {
      if (!embeddedUri(image.uri) || image.bufferView !== undefined) invalid('Images must have one embedded source');
    } else {
      ref(views, image.bufferView, 'image bufferView');
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/ktx2'].includes(image.mimeType)) invalid('Unsupported embedded image mimeType');
    }
  });
  let vertexCount = 0;
  let triangleCount = 0;
  let primitiveCount = 0;
  const meshes = (document.meshes ?? []).map((mesh, index) => {
    if (!Array.isArray(mesh.primitives) || !mesh.primitives.length) invalid('Mesh primitives are missing');
    let vertices = 0;
    let triangles = 0;
    mesh.primitives.forEach(primitive => {
      if (!object(primitive) || !object(primitive.attributes) || primitive.attributes.POSITION === undefined) invalid('Primitive POSITION is missing');
      for (const accessor of Object.values(primitive.attributes)) ref(accessors, accessor, 'attribute accessor');
      const position = ref(accessors, primitive.attributes.POSITION, 'POSITION');
      if (position.type !== 'VEC3') invalid('POSITION accessor must be VEC3');
      const indices = primitive.indices === undefined ? null : ref(accessors, primitive.indices, 'indices');
      if (indices && (indices.type !== 'SCALAR' || ![5121, 5123, 5125].includes(indices.componentType))) invalid('Invalid indices accessor format');
      const count = indices?.count ?? position.count;
      const mode = primitive.mode ?? 4;
      if (!integer(mode) || mode > 6) invalid('Invalid primitive mode');
      if (primitive.material !== undefined) ref(document.materials ?? [], primitive.material, 'material');
      vertices += position.count;
      triangles += mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
    });
    vertexCount += vertices;
    triangleCount += triangles;
    primitiveCount += mesh.primitives.length;
    return { index, name: typeof mesh.name === 'string' ? mesh.name : `Mesh ${index + 1}`, primitiveCount: mesh.primitives.length, vertexCount: vertices, triangleCount: triangles };
  });
  const textures = (document.textures ?? []).map((texture, index) => {
    const source = texture.extensions?.KHR_texture_basisu?.source ?? texture.extensions?.EXT_texture_webp?.source ?? texture.source;
    const image = ref(images, source, 'texture image');
    return { index, name: typeof texture.name === 'string' ? texture.name : `Texture ${index + 1}`, imageIndex: source,
      mimeType: image.mimeType ?? image.uri?.split(';')[0].slice(5),
      sizeBytes: image.bufferView === undefined ? null : views[image.bufferView].byteLength };
  });
  return { meshCount: meshes.length, primitiveCount, vertexCount, triangleCount, textureCount: textures.length,
    imageCount: images.length, materialCount: (document.materials ?? []).length, nodeCount: (document.nodes ?? []).length,
    meshes, textures, extensionsUsed: document.extensionsUsed ?? [], extensionsRequired: document.extensionsRequired ?? [] };
}
