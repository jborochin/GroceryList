module.exports = function (api) {
  const isWeb = api.caller((c) => c?.platform === 'web');
  api.cache.using(() => isWeb);
  return {
    presets: [
      ['babel-preset-expo', isWeb ? { unstable_transformImportMeta: true } : {}],
    ],
  };
};
