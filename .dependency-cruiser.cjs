const anchoring = require('./anchoring.depcruise.cjs')

module.exports = {
  forbidden: [
    ...anchoring.forbidden,
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
      extensions: ['.ts', '.js', '.cjs', '.mjs', '.json'],
    },
  },
}
