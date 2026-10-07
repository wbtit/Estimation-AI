# Steel estimation platform: Claude Code instructions

Read docs/SPEC.md before starting any task. It defines scope, phases, the member data contract, and the rules.

Working rules:
- Work one phase at a time. Don't start a later phase unless I ask.
- Before coding a phase, show me a short plan and wait for approval.
- Core pipeline is deterministic code. No LLM calls in extraction, validation, or pricing.
- Never invent pricing rules, steel catalog data, or ground truth. If missing, ask me.
- Never commit client drawings or real project data. Use only files under /fixtures that I put there.
- If something in the spec is ambiguous or contradicts what you find, stop and ask. Don't guess silently.
- Report what you actually ran and what actually passed. Don't claim a test passed unless you ran it.
- Update the Decision Log at the bottom of docs/SPEC.md when we make a design decision.