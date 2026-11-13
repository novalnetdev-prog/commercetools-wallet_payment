// Jest-only stand-in for Vite's CSS module class mappings.
module.exports = {
  __esModule: true,
  default: new Proxy({}, { get: (_target, property) => `nn-${String(property)}` }),
};
