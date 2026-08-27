/**
 * the-anchoring — programmatic API for the intent graph.
 *
 * See docs/THE_ANCHORING.md for the architectural pattern.
 */

// Model & Schema
export {
  ENTITY_KINDS,
  LINK_FIELDS,
  SCALAR_FIELDS,
  EDGE_PHRASE,
  HAZARD_RESOLUTIONS,
  kindOf,
  type EntityKind,
  type LinkField,
} from './model.js'

// Configuration
export {
  parseConfig,
  loadConfig,
  defaultConfig,
  DEFAULT_KB_ROOT,
  DEFAULT_KINDS,
  DEFAULT_GOVERNED_PATHS,
  DEFAULT_HAZARD,
  DEFAULT_SYMBOL_INDEX,
  type AnchoringConfig,
  type KindSpec,
  type ConfigResult,
  type Layer,
  type Architecture,
} from './config.js'

// Guards (Layer 3)
export {
  planGuards,
  guardsHash,
  checkGuards,
  type GeneratedFile,
  type GuardsPlan,
  type GuardFileState,
  type GuardCheckResult,
} from './guards.js'

// Agents brief (Layer 3)
export {
  generateArchitectureSection,
  renderAgentsMd,
  updateAgentsMd,
  ARCH_START_MARKER,
  ARCH_END_MARKER,
  type UpdateAgentsResult,
} from './agents.js'

// Owners (Layer 3)
export {
  resolveOwners,
  resolveOwnerForPath,
  renderCodeowners,
  planOwners,
  OWNERS_START_MARKER,
  OWNERS_END_MARKER,
  type OwnershipMapping,
  type OwnersReport,
} from './owners.js'

// Repository root
export { findRepoRoot } from './root.js'

// Store
export { loadStore, readEntity, type Entity, type Store } from './store.js'

// Anchors
export {
  createResolver,
  parseAnchor,
  hasCodegraphIndex,
  type Anchor,
  type AnchorResolution,
  type SymbolProbe,
} from './anchors.js'

// Session
export { rememberWork, recallWork } from './session.js'

// Verification
export { verify, type VerifyReport, type Finding, type Severity } from './verify.js'

// Why (Reverse walk)
export { why, type WhyReport, type CodeMention, type EntityEdge } from './why.js'

// Context (Tier 2 disclosure)
export { ctx, type CtxReport, type CtxSection, type CtxEntry } from './ctx.js'

// Done & Stop hook
export {
  done,
  unclaimedWork,
  type DoneReport,
  type Gap,
  type GapKind,
  type UnclaimedWorkReport,
} from './done.js'

// Git I/O
export { gitChangedFiles, type ChangedFiles } from './git.js'

// Init
export {
  planInit,
  applyInit,
  defaultFsProbe,
  defaultInitIo,
  findGitRoot,
  loadTemplate,
  type InitPlan,
  type InitOptions,
  type FsProbe,
  type InitIo,
} from './init.js'

// Render
export {
  renderVerify,
  renderWhy,
  renderCtx,
  renderDone,
  renderUnclaimed,
  COLOUR,
  PLAIN,
  USAGE,
  type Palette,
} from './render.js'

// CLI runner
export { run } from './cli.js'
