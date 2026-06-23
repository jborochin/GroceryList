// Jest stub for `react-native-get-random-values`, a native side-effect shim that
// can't be transformed in the node test environment. uuid v5 (deterministic,
// hash-based) doesn't need it, so an empty module is sufficient for tests that
// import deterministic-id helpers.
module.exports = {};
