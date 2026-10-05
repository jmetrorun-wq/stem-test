// Le code de séparation (separator.js, fft.js) est partagé avec le
// prototype web, un dossier au-dessus : Metro doit pouvoir le lire.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '..')];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];

module.exports = config;
