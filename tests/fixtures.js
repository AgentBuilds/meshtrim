export function glbFixture(extra = '') {
  const geometry = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 0].forEach((value, index) => geometry.writeFloatLE(value, index * 4));
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=', 'base64');
  const content = Buffer.concat([geometry, image]);
  const document = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ name: 'Triangle', primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    buffers: [{ byteLength: content.length }], bufferViews: [{ buffer: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: image.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] }],
    images: [{ bufferView: 1, mimeType: 'image/png' }], textures: [{ name: 'Pixel', source: 0 }],
    ...(extra ? { extras: { note: extra } } : {}) };
  return encodeGlb(document, content);
}

export function encodeGlb(document, binary) {
  const json = Buffer.from(JSON.stringify(document));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const binaryLength = binary ? Math.ceil(binary.length / 4) * 4 : 0;
  const bytes = Buffer.alloc(20 + jsonLength + (binary ? 8 + binaryLength : 0));
  bytes.writeUInt32LE(0x46546c67, 0);
  bytes.writeUInt32LE(2, 4);
  bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(jsonLength, 12);
  bytes.writeUInt32LE(0x4e4f534a, 16);
  bytes.fill(0x20, 20, 20 + jsonLength);
  json.copy(bytes, 20);
  if (binary) {
    bytes.writeUInt32LE(binaryLength, 20 + jsonLength);
    bytes.writeUInt32LE(0x004e4942, 24 + jsonLength);
    binary.copy(bytes, 28 + jsonLength);
  }
  return bytes;
}
