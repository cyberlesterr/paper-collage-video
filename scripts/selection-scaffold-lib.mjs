import {summarizeConceptDecision} from './creative-plan-lib.mjs';
import {scenarioDecisionFor} from './planning-scenario-lib.mjs';
import {sourcePackageDecisionFor} from './layer-source-plan-lib.mjs';

// Every field the concept gate compares is derived from state the pipeline
// already owns. Only the human's words and their provider pick are genuinely
// unknown, so those are the only placeholders the scaffold leaves behind.
export const SELECTION_NOTE_PLACEHOLDER =
  'TODO(human): 逐字记录人对方案、预算与 provider 的决定';
export const SELECTION_PROVIDER_PLACEHOLDER = 'TODO(human): provider id';

export const buildSelectionScaffold = ({
  project,
  scenarios,
  storyboard,
  capabilities,
}) => {
  const planDecision = summarizeConceptDecision(project.plan);
  const scenarioBinding = project.plan?.scenarioBinding ?? null;
  const scenarioDecision = scenarioBinding
    ? scenarioDecisionFor(scenarios, project.plan.productionProfile)
    : null;
  const imageAttemptLimit =
    scenarioDecision?.proposedImageAttemptLimit ??
    project.plan?.approvedImageBudget?.imageAttemptLimit ??
    null;
  return {
    note: SELECTION_NOTE_PLACEHOLDER,
    scope: 'project',
    planDecision: {
      productionProfile: planDecision.productionProfile,
      durationSeconds: planDecision.durationSeconds,
      sceneCount: planDecision.sceneCount,
      durationAuthority: planDecision.durationAuthority,
    },
    ...(scenarioDecision ? {scenarioDecision} : {}),
    budgetDecision: {imageAttemptLimit},
    sourcePackageDecision: sourcePackageDecisionFor(
      storyboard.directingSummary,
    ),
    selections: capabilities.map((capability) => ({
      capability,
      providerId: SELECTION_PROVIDER_PLACEHOLDER,
    })),
  };
};

export const selectionScaffoldPlaceholders = (scaffold) => {
  const pending = [];
  if (String(scaffold.note ?? '').startsWith('TODO(human)')) {
    pending.push('$.note：人对方案/预算/provider 的原话');
  }
  for (const [index, selection] of (scaffold.selections ?? []).entries()) {
    if (String(selection.providerId ?? '').startsWith('TODO(human)')) {
      pending.push(
        `$.selections[${index}].providerId：${selection.capability} 的 provider（provider:status 可列出已确认候选）`,
      );
    }
  }
  return pending;
};
