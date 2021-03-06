/* eslint-disable multiline-ternary, no-void */
import { transform } from 'babel-core';
import babelPresetMinify from 'babel-preset-minify';
import { SourceMapSource, RawSource } from 'webpack-sources';
import ModuleFilenameHelpers from 'webpack/lib/ModuleFilenameHelpers';

function getDefault(actualValue, defaultValue) {
  return actualValue !== void 0 ? actualValue : defaultValue;
}

function optimizeChunkAssets(compilation, options, chunks) {
  chunks.reduce((acc, chunk) => acc.concat(chunk.files || []), [])
    .concat(compilation.additionalChunkAssets || [])
    .filter(ModuleFilenameHelpers.matchObject.bind(null, options))
    .forEach((file) => {
      try {
        const asset = compilation.assets[file];

        if (asset.__babelminified) {
          compilation.assets[file] = asset.__babelminified;
          return;
        }

        let input;
        let inputSourceMap;

        if (options.sourceMap) {
          if (asset.sourceAndMap) {
            const sourceAndMap = asset.sourceAndMap();
            inputSourceMap = sourceAndMap.map;
            input = sourceAndMap.source;
          } else {
            inputSourceMap = asset.map();
            input = asset.source();
          }
        } else {
          input = asset.source();
        }

        // do the transformation
        const result = options.babel.transform(input, {
          parserOpts: options.parserOpts,
          presets: [[options.minifyPreset, options.minifyOpts]],
          sourceMaps: options.sourceMap,
          babelrc: false,
          inputSourceMap,
          shouldPrintComment(contents) {
            return shouldPrintComment(contents, options.comments);
          },
        });

        asset.__babelminified = compilation.assets[file] = result.map
          ? new SourceMapSource(result.code, file, result.map, input, inputSourceMap)
          : new RawSource(result.code);
      } catch (e) {
        compilation.errors.push(e);
      }
    });
}

function compilationFn(compilation) {
  const { options, plugin } = this;

  if (compilation.hooks) {
    if (options.sourceMap) {
      compilation.hooks
        .buildModule
        .tap(plugin, (module) => { module.useSourceMap = true; });
    }

    compilation.hooks
      .optimizeChunkAssets
      .tapAsync(plugin, (chunks, callback) => {
        optimizeChunkAssets(compilation, options, chunks);
        callback();
      });
  } else {
    if (options.sourceMap) {
      compilation.plugin('build-module', (module) => {
        module.useSourceMap = true;
      });
    }

    compilation.plugin('optimize-chunk-assets', (chunks, callback) => {
      optimizeChunkAssets(compilation, options, chunks);
      callback();
    });
  }
}

export default class BabelMinifyPlugin {
  constructor(minifyOpts = {}, pluginOpts = {}) {
    this.plugin = { name: 'BabelMinifyPlugin' };

    this.options = {
      parserOpts: pluginOpts.parserOpts || {},
      minifyPreset: pluginOpts.minifyPreset || babelPresetMinify,
      minifyOpts,
      babel: pluginOpts.babel || { transform },
      comments: getDefault(pluginOpts.comments, /^\**!|@preserve|@license|@cc_on/),
      // compiler.options.devtool overrides options.sourceMap if NOT set
      // so we set it to void 0 as the default value
      sourceMap: getDefault(pluginOpts.sourceMap, void 0),
      test: pluginOpts.test || /\.js($|\?)/i,
      include: pluginOpts.include || void 0,
      exclude: pluginOpts.exclude || void 0,
    };
  }

  apply(compiler) {
    const { options } = this;
    // if sourcemap is not set
    options.sourceMap = getDefault(options.sourceMap, !!compiler.options.devtool);

    if (compiler.hooks) {
      const { compilation } = compiler.hooks;

      compilation.tap(this.plugin, compilationFn.bind(this));
    } else {
      compiler.plugin('compilation', compilationFn.bind(this));
    }
  }
}

function shouldPrintComment(contents, checker) {
  switch (typeof checker) {
    case 'function':
      return checker(contents);
    case 'object':
      return checker.test(contents);
    default:
      return !!checker;
  }
}
