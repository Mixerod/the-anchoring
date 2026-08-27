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
  EVIDENCE_CLASSES,
  UPSTREAM_GATES,
  UPSTREAM_VERDICTS,
  SHIPPED_INVARIANTS,
  UPSTREAM_OPEN_DAYS,
  UPSTREAM_CEILING,
  kindOf,
  type EntityKind,
  type LinkField,
  type EvidenceClass,
  type UpstreamGate,
  type UpstreamVerdict,
} from './model.js'

// Configuration
export {
  parseConfig,
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
  ARCHITECTURE_START_MARKER,
  ARCHITECTURE_END_MARKER,
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
  LEGACY_OWNERS_START_MARKER,
  LEGACY_OWNERS_END_MARKER,
  type OwnershipMapping,
  type OwnersReport,
} from './owners.js'

// Repository root & Config loading
export { findRepoRoot, loadConfig, realPath } from './root.js'

// Store & Loading
export { parseEntity, buildStore, type Entity, type Store, type LoadProblem } from './store.js'
export { loadStore, readEntity, listMarkdown, readFrontmatter } from './loader.js'

// Anchors & Resolving
export {
  parseAnchor,
  parseProbeOutput,
  checkAnchors,
  type Anchor,
  type AnchorResult,
  type AnchorResolution,
  type Resolver,
  type SymbolProbe,
} from './anchors.js'
export { createResolver, hasCodegraphIndex, codegraphProbe } from './resolver.js'

// Session
export { rememberWork, recallWork } from './session.js'

// Verification
export { verify, type VerifyReport, type Finding, type Severity } from './verify.js'
export { checkHazard, checkHazardCeiling } from './verify-hazard.js'
export { checkUpstream, checkUpstreamCeiling, isEscalated } from './verify-upstream.js'

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
export {
  gitChangedFiles,
  parseChangedFiles,
  gitIsDirty,
  parseDirty,
  type ChangedFiles,
  type IsDirty,
} from './git.js'

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

// Upstream loop (Layer 3.1)
export {
  planUpstream,
  upstreamHash,
  listUpstream,
  openLoopNotices,
  UPSTREAM_BANNER,
  // Named `checkUpstreamReports` here only to avoid colliding with `checkUpstream` from
  // verify-upstream.js, which validates an incident rather than a generated file.
  checkUpstream as checkUpstreamReports,
  type PackageFacts,
  type UpstreamReport,
  type UpstreamPlan,
  type UpstreamListRow,
  type UpstreamFileState,
  type ExistingReport,
  type FileState,
  planOpenWork,
  addUpstreamWork,
  nextWorkId,
  reportPackage,
  type OpenWorkPlan,
} from './upstream.js'
export { runUpstream, readPackageFacts, readExistingReports } from './cli-upstream.js'

// CLI runner
export { run, isDirectlyInvoked } from './cli.js'
