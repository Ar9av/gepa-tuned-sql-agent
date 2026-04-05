// Public API for the RL subsystem
export {
  ErrorClass,
  RepairAction,
  ERROR_CLASS_NAMES,
  REPAIR_ACTION_NAMES,
  NUM_ACTIONS,
  NUM_ERROR_CLASSES,
  FEATURE_DIM,
  featurize,
  type RLState,
  type RLMetrics,
  type Episode,
  type Experience,
} from './types'

export {
  classifyError,
  errorSeverity,
  extractOffendingToken,
} from './error-classifier'

export {
  computeReward,
  computeEpisodeReward,
} from './grader'

export { LinUCB } from './linucb'

export {
  recordEpisode,
  getMetrics,
  getEpisodes,
  getRecentEpisodes,
  replayAll,
  resetExperience,
} from './experience'

export {
  reset,
  observeError,
  selectAction,
  getRepairPrompt,
  recordStep,
  endEpisode,
  getRLMetrics,
  getBanditState,
  isEpisodeActive,
  resetRL,
} from './environment'
