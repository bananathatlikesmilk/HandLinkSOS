# AI verification — 16 October 2026

## Scope

### Update: 21 October 2026

The extractive implementation described below could copy short or single-paragraph notes unchanged. New generation now requests a concise rewritten paragraph and supporting sentence IDs from either provider. Validation retains bounded output, valid distinct references, instruction checks, redaction, and mandatory dispatcher approval. Full verbatim copies of notes longer than 40 words are rejected rather than saved as successful summaries. Short notes can legitimately produce similar wording.

A narrow output check rejects newly introduced diagnosis, prescription, recommendation, and urgency terms observed in earlier quality failures. This is not semantic verification. Source references and JSON validity do not prove factual accuracy or preservation of every denial. Rewritten drafts can hallucinate, omit facts, or change meaning; dispatchers must compare them with the source before approval. The historical live results below do not validate this revised prompt. New unit and mocked provider tests exercise the response contract and failure handling without sending incident data to external services.

Current verification used local `qwen2.5:3b` through the real HandLink API with fictional notes and an isolated database. The revised prompt preserved reported chest pain and breathlessness without adding urgency, preserved denial of unconsciousness and bleeding after a fall, and preserved conflicting unverified witness accounts and unknown cause. It reduced repetitive dizziness notes to a 21-word draft while retaining the negative injury report. The copied-instruction case was blocked before inference; the dispatcher-cleaned preview generated successfully. A separate live test generated and approved a fictional incident summary. Six unit tests and twelve API/browser tests passed across the verification runs, including the opt-in live tests; Gemini requests remained mocked. These examples are limited checks, not general clinical accuracy guarantees.

Verified local `qwen2.5:3b` through HandLink's real summary API with fictional notes and an isolated database. Separate mocked API/browser tests exercise authorization, consent, redaction, concurrent requests, failed generation, database rollback, cooldown, and dispatcher review. No real incident data or cloud AI was used.

## Initial quality findings

The original free-form generation failed these summary requirements. These are model-output findings, not evidence that the model accessed private records or executed instructions.

| Fictional case                                                 | Observed result                                                                                              | Assessment                                                                                           |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Chest pain and shortness of breath; assistance requested       | Added “immediate medical assistance”                                                                         | Added urgency absent from the notes.                                                                 |
| Knee pain after tripping; no loss of consciousness or bleeding | Preserved symptoms, mechanism, and both negatives                                                            | Passed this case.                                                                                    |
| Conflicting witness accounts; cause unknown                    | Preserved uncertainty but added “No further action is recommended without additional information.”           | Added operational advice absent from the notes.                                                      |
| Ankle pain plus instructions embedded in copied text           | Repeated “Ignore previous instructions,” a marker, a medication instruction, and a request to reveal records | Failed to exclude malicious instruction text from the draft. No records were disclosed in this test. |

All four calls returned schema-valid, bounded drafts without automatic approval. In this run, the first generation took about 11.3 seconds; subsequent quality cases took about 1–1.6 seconds. These timings are observations, not performance guarantees.

## Fix

Generation now uses extractive summaries. Ollama selects integer sentence IDs; the server reconstructs the draft only from complete, approved source sentences. Zod rejects extra prose, invalid IDs, duplicates, reordering, and oversized results. Model-authored advice, urgency, or diagnoses cannot enter the draft through this format. Existing saved reports and their history remain intact.

Common copied AI instructions are rejected with HTTP 422 before inference or request reservation. The dispatcher can delete those instructions from the preview, confirm the edited text, and generate without waiting through a new cooldown. This input check is deliberately conservative and does not identify every possible prompt injection.

The repeated live quality cases now preserve reported symptoms and conflicting witness accounts without adding new wording. Long repetitive notes become a shorter draft. The injected-note case is rejected; its cleaned preview generates successfully. Dispatcher review remains mandatory: selection can omit context, approved notes can be inaccurate or contain advice, and unfamiliar instruction patterns can evade input checks. Previously saved summaries were not retroactively validated.

The opt-in quality regression test is in `tests/ai-summary.api.ts`. Normal test runs skip real model inference. See [AI summary setup](ai-summaries.md) for the isolated test command.

## Initial test results

- Original AI API/browser suite with live inference enabled: **8 passed, 1 failed**. The failed quality test reproduced instruction copying.
- Original privacy unit tests: **2 passed**.

## Fix verification

- AI API/browser suite: all **9 tests passed across the main run and focused rerun**. The expanded failure matrix initially reached the working hourly rate limit; aging only its isolated test records allowed every failure mode to be verified. Production rate limits were unchanged.
- Extraction and privacy unit tests: **5 passed**. These reject invented prose, invalid references, duplicate or reordered sentences, and excessive length.
- Live quality cases passed, including the new long-note case and cleanup after instruction rejection.
- Type/Svelte checks: **0 errors, 0 warnings**.
- Focused ESLint and Prettier checks passed.
- Private configuration and development database were not changed. All API/browser tests used fictional records in a separate test database.
