// API pública de src/git (F4). rewrite/mirror/sync/exportPatches llegan en F5.
export { ensureAiDevBranch, protectedBranchRe, aiBranch, currentBranch, isDirty, behindCount, remoteHeads, isLocalRepoPath, DEFAULT_PROTECTED } from './branch.mjs';
export { cloneAi, restrictRefspec, aiRefspec } from './clone-ai.mjs';
export { verify, applyFixes } from './verify.mjs';
export { installHooks } from './hooks.mjs';
