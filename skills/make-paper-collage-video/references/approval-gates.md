# Approval Gates

Read this reference before any creative generation, speech generation, final delivery, or external action.

## Human Decisions

Require an explicit human decision for:

1. The narration position, storyboard, and factual assumptions.
2. The representative visual sample and fictional voice identity.
3. The rendered preview and requested creative changes.
4. Publication readiness, including facts, rights, branding, and platform suitability.

Treat comments such as “继续”, “这个方向可以”, or “预览通过” as approval only when the immediately preceding request clearly names the gate. Preserve the human's wording in the `--note` value. If the reference is ambiguous, ask one concise question instead of guessing.

## Cost Boundary

- Do not make bulk image, speech, music, or video-generation calls before the concept is approved.
- After concept approval, generate at most one representative style sample and one short fictional-voice audition for the style gate.
- Before generation, disclose a known material cost or quota impact when the tool exposes it.
- After style and voice approval, autonomously generate the agreed production set unless a provider asks for new authorization.
- Reuse approved assets and deterministic local processing whenever possible.

## Voice Boundary

Default to a fictional catalog voice. Prefer `儒雅逸辰 (ruyayichen)` when the provider offers it.

Do not clone, imitate, or imply the identity of a real person unless the human explicitly opts into that separate enhancement and confirms authorization for both the reference recording and its transcript. A clean reference clip and corresponding text are inputs supplied or licensed by the human; they are not prerequisites for the fictional-voice P0 path.

## Rights and Accuracy

Stop when a requested visual depends on an unlicensed logo, likeness, private media, or unclear third-party copyrighted asset. Offer a fictional or public-domain alternative without silently changing the brief.

For historical, medical, legal, financial, political, or otherwise consequential factual claims, verify with appropriate current sources before locking narration. Record material uncertainty in the concept proposal.

## Publication Boundary

Technical validation proves that files, streams, timing, and basic audio constraints are correct. It does not prove factual, legal, brand, or editorial readiness.

Never:

- infer publication approval from preview approval;
- upload or publish merely because `final.mp4` exists;
- send the file to a third party without a separate request;
- call `approve-publish` on the human's behalf.

After explicit publication approval, record the decision if useful, but still require a separate instruction before any external upload or send action.
