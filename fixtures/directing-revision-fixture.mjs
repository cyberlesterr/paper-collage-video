import {
  createMotionDirectionFixture,
  FIXTURE_STYLE_PROFILE,
} from './motion-contract-fixture.mjs';

export const directingRevisionPlan = {
  schemaVersion: 4,
  slug: 'directing-revision-fixture',
  status: 'resolved',
  productionProfile: 'draft',
  motionBudget: {maxPoseSheetCalls: 1, maxStatesPerSheet: 4, maxContinuousTargets: 2},
  approvedImageBudget: null,
  resolved: {durationSeconds: 6, sceneCount: 1},
};

export const directingRevisionAuthoring = {
  $schema: '../../schemas/storyboard.schema.json',
  schemaVersion: 12,
  slug: 'directing-revision-fixture',
  status: 'ready',
  arc: '一张纸面从建立空间到主体出现并稳定落版。',
  style: {
    visualThesis: '克制的纸片分层。',
    layerStrategy: '背景与主体分层。',
    compositionRules: ['主体保持在安全区内。'],
  },
  motionDirection: createMotionDirectionFixture({
    summary: '先建立纸面空间，让主体完成清晰入场，再稳定落版。',
  }),
  scenes: [{
    id: 'scene-01',
    title: '纸面出现',
    narrativeRole: '建立与落版',
    message: '主体在纸面中清楚出现。',
    blueprint: 'layered-reveal',
    estimatedDurationSeconds: 6,
    beats: [
      {
        id: 'establish', at: 0, performanceRole: 'establish', purpose: '建立纸面', visual: '背景稳定出现', soundCue: null,
        proofTimeId: 'proof-establish',
        treatments: [{
          id: 'hold-background', targetId: 'background', importance: 'supporting', necessity: 'required',
          changeClass: 'static-hold', motion: {kind: 'static'}, composition: {pattern: 'free'}, graphic: null,
          semanticRisk: 'decorative', proofTimeId: 'proof-establish', rationale: '先建立稳定空间。',
        }, {
          id: 'narrator-waiting', targetId: 'narrator', importance: 'supporting', necessity: 'required',
          changeClass: 'pose-change',
          motion: {
            kind: 'state-sequence', poseFamilyId: 'narrator-actions', stateId: 'waiting',
            visualChange: '讲述者以等待姿态站定。', facing: 'front', playback: 'once', cycles: 1, transition: 'cut',
          },
          composition: {pattern: 'free'}, graphic: null, semanticRisk: 'identity',
          proofTimeId: 'proof-establish', rationale: '讲述者先建立身份。',
        }],
      },
      {
        id: 'reveal', at: 0.45, performanceRole: 'action', purpose: '显示主体', visual: '人物纸片进入画面', soundCue: null,
        proofTimeId: 'proof-action',
        treatments: [{
          id: 'show-subject', targetId: 'subject', importance: 'hero', necessity: 'required',
          changeClass: 'visibility-change',
          motion: {kind: 'visibility-transition', action: 'show', transition: 'fade-rise', durationSeconds: 0.5},
          composition: {pattern: 'free'}, graphic: null, semanticRisk: 'decorative',
          proofTimeId: 'proof-action', rationale: '主体持续出现并保持可见。',
        }, {
          id: 'narrator-pointing', targetId: 'narrator', importance: 'supporting', necessity: 'required',
          changeClass: 'pose-change',
          motion: {
            kind: 'state-sequence', poseFamilyId: 'narrator-actions', stateId: 'pointing',
            visualChange: '讲述者抬手指向主体。', facing: 'front', playback: 'once', cycles: 1, transition: 'cut',
          },
          composition: {pattern: 'free'}, graphic: null, semanticRisk: 'identity',
          proofTimeId: 'proof-action', rationale: '讲述者把注意力引向主体。',
        }],
      },
      {
        id: 'final', at: 0.85, performanceRole: 'settle', purpose: '稳定落版', visual: '主体保持清楚', soundCue: null,
        proofTimeId: 'proof-final',
        treatments: [{
          id: 'hold-subject', targetId: 'subject', importance: 'supporting', necessity: 'required',
          changeClass: 'static-hold', motion: {kind: 'static'}, composition: {pattern: 'free'}, graphic: null,
          semanticRisk: 'decorative', proofTimeId: 'proof-final', rationale: '结尾保持构图。',
        }],
      },
    ],
    proofTimes: [
      {id: 'proof-establish', at: 0.1, label: '纸面建立', kind: 'establish', assertions: ['背景完整'], stateAssertions: [{nodeId: 'narrator', stateId: 'waiting'}]},
      {id: 'proof-action', at: 0.55, label: '主体出现', kind: 'action', assertions: ['主体可见'], stateAssertions: [{nodeId: 'narrator', stateId: 'pointing'}]},
      {id: 'proof-final', at: 0.9, label: '构图稳定', kind: 'final', assertions: ['主体保持完整'], stateAssertions: []},
    ],
  }],
  editorial: createEditorialFixture({
    sceneIds: ['scene-01'],
    durationSeconds: 6,
  }),
  sceneTransitions: [],
  updatedAt: '2026-07-23T00:00:00.000Z',
};

export const directingRevisionStyleProfile = FIXTURE_STYLE_PROFILE;

export const directingRevisionProduction = {
  $schema: '../../schemas/production.schema.json',
  schemaVersion: 1,
  slug: 'directing-revision-fixture',
  stage: 'asset-production',
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
  approvals: {
    concept: {status: 'approved', decidedAt: '2026-07-23T00:00:00.000Z', note: '概念通过'},
    styleAndVoice: {status: 'approved', decidedAt: '2026-07-23T00:00:00.000Z', note: '风格通过'},
    preview: {status: 'changes-requested', decidedAt: '2026-07-23T00:00:00.000Z', note: '调整节奏'},
    publish: {status: 'pending', decidedAt: null, note: ''},
  },
  workItems: [],
  artifacts: {
    brief: 'projects/directing-revision-fixture/brief.md',
    project: 'projects/directing-revision-fixture/project.json',
    storyboard: 'projects/directing-revision-fixture/storyboard.json',
    prompts: 'projects/directing-revision-fixture/prompts.json',
    review: 'projects/directing-revision-fixture/review.md',
    validationReport: 'dist/directing-revision-fixture/validation-report.json',
    preview: 'dist/directing-revision-fixture/preview.mp4',
    final: 'dist/directing-revision-fixture/final.mp4',
    report: 'dist/directing-revision-fixture/report.json',
    contactSheet: 'dist/directing-revision-fixture/contact-sheet.jpg',
  },
  history: [{
    at: '2026-07-23T00:00:00.000Z',
    action: 'request-preview-revision',
    stage: 'asset-production',
    note: '调整节奏',
  }],
};
import {createEditorialFixture} from './editorial-fixture.mjs';
