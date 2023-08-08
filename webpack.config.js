const path = require('path');
const CopyPlugin = require("copy-webpack-plugin");

module.exports = {
  entry: './bootstrap.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'bootstrap.js',
  },
  mode: 'development',
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'index.html' },
        { from: 'pkg/', to: 'pkg/' },
      ],
    }),
  ],
  // FIXME: this is required to show which library causes
  // "Module not found: Error: Can't resolve 'env'"
  resolve: {
    fallback: {
      "env": false
    },
  },
};