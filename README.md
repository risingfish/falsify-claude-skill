# falsify — a Claude Code skill for attacking your own changes

`falsify` is a [Claude Code skill](https://docs.claude.com/en/docs/claude-code/skills) that changes how Claude decides a code change is done. Instead of writing an edit, adding tests that show it working, and stopping when they go green, Claude is told to **try to break its own edit** and to report only once the edit has survived that.

## Why

The usual workflow confirms: write the fix, write a test for the scenario you had in mind, watch it pass. Psychologists call this the *positive test strategy*, meaning you check a hypothesis by looking for cases that agree with it. It's how a fix that handles the scenario you pictured, but breaks the one next to it, gets to production.

AI coding agents lean hard on this habit. They're good at producing tests that pass and less good at asking whether those tests could ever have failed. `falsify` turns the habit around and treats every change as a hypothesis to refute, not a result to defend.

## What the skill does

The skill runs a fixed loop (full text in [`SKILL.md`](.claude/skills/falsify/SKILL.md)):

1. **Evaluate**: read the affected code from disk before forming any opinion.
2. **State the problem** in one sentence.
3. **Squeeze** (only if the cause is unknown): shrink a failing high-level test down to the defect.
4. **State the change and its done-metrics**, plus a pre-registered list of disproof attacks with predicted outcomes, all **before writing code**.
5. **Implement.**
6. **Prove the happy path** against the metrics.
7. **Try to disprove the change** by running an attack down every exit from the modified code.
8. **Report** if it held, or **re-hypothesize** if it broke. After three disproven cycles, Claude stops and asks you how to proceed.

### Applies to

- Fixing bugs, investigating failures, responding to review comments, handling bug reports.
- Refactors and config changes.
- Feature work, but only when aimed at **one refutable statement** ("turning on X never changes Y"), not at "the feature works." If no outcome could prove the statement false, it isn't a claim and the skill doesn't apply.

## Core ideas

### Disproof outweighs proof

Surviving one real attempt to break the change counts **five times** as much as one more passing proof. A single successful disproof kills the hypothesis as stated. The broad approach can be reused, but the revised hypothesis starts with **no evidence carried forward** and has to pass every earlier attack again.

### Every exit, executed

The change is accepted only when every exit from the modified code is proven:

- every branch and early return, including ones that already existed
- every caller, including tests and call sites that omit optional arguments
- every response from what the change calls: success, failure, exception, timeout, empty result, lost race
- retries, duplicate delivery, concurrent workers, the next scheduled run
- every downstream reader of state the change writes

An exit counts as proven if an executed test covers it, or if it's unreachable and a test pins the invariant that keeps it unreachable. **Code you only read proves nothing.** Reports keep *executed* and *read* separate. "Works except when X" is a reproducible bug, not a finished change.

### Guarding against disproof theater

You can satisfy "try to break it" on paper by running attacks that could never have succeeded. The skill uses four guards, ordered from hardest to fake to easiest:

1. **Mutation gate.** Every attack also runs against the **pre-change** code. An attack that passes on both versions scores zero.
2. **Pre-registration.** Attacks are written down before implementation. Attacks added later are allowed but flagged *post-hoc*.
3. **Predict first.** Each outcome is predicted before the run. If every prediction was right, no experiment happened, so the report names the nearest miss.
4. **Describe, don't tally.** "Survived 5 attacks" is gameable. The report describes each attack, what it could have caught, and how it did on the old code, and it lists the exits that were **never run**.

### Framing beats rigor

None of the guards help when the question is wrong. Getting the right answer to the wrong question is a *Type III error*. After each disproof, Claude first checks whether the problem framing failed along with the hypothesis, and a challenge to the question from outside counts for more than one more attack on the answer.

### Hit 'em high, hit 'em low

When the cause is unknown, Claude uses the **Saff Squeeze**: inline the code under a failing high-level test and cut whatever can be removed while it still fails, until the bug is obvious. Both tests are kept. The high-level test shows the bug matters and serves as acceptance evidence. The squeezed test pins down where the bug is. Squeezed tests plant state rather than run the code that writes it, so they never count toward exit coverage or as disproof attempts.

### A bounded loop with a paper trail

Each claim gets one **audit doc** at `tmp/falsify/<ID-or-slug>.md` (git-ignored). Every cycle appends a section (Problem, Investigation, Hypothesis, Test plan, Results, Verdict), and each part is filled in as its step happens, never reconstructed afterward. Earlier cycles are never edited, so you can put cycle 3 next to cycles 1 and 2 and see what changed and what kept breaking.

After **three** disproven cycles, Claude stops, summarizes what the failures have in common, and asks you to choose: stop, try once more, try three more, or a custom count. Three failures usually mean the problem is under-specified or the constraints conflict, and that's a decision for a person.

### Side findings are recorded, not chased

Other bugs found along the way go in the report's "Other bugs" section and are not fixed. The scope stays on the stated problem.

## The final report

When a change holds, Claude reports in five parts:

1. **The requested work**
2. **The hypothesis and plan**
3. **The testing plan**: which exits were tested, and the outcomes
4. **Gains and gaps**: what the change does, and plainly what it leaves undone
5. **Other bugs** found along the way

The report includes the path to the audit doc.

## Installation

Copy the skill folder into either your personal skills directory or a project's skills directory:

```bash
# Available in every project
cp -r .claude/skills/falsify ~/.claude/skills/

# Or only in one project
cp -r .claude/skills/falsify /path/to/project/.claude/skills/
```

Claude Code picks up the skill from its description when you're fixing a bug, investigating a failure, or responding to a review. You can also invoke it directly with `/falsify`.

If you use it in a project, add `tmp/` to that project's `.gitignore` so audit docs aren't committed.

## Repository layout

```
.claude/skills/falsify/
├── SKILL.md                 # The loop: steps 1–8, audit doc format, scope, sources
└── references/falsify.md    # Step 6 expanded: exits, fixtures, bite checks,
                             # failure injection, the four guards, honest reporting
```

## Where the ideas come from

The skill combines established ideas; [`SKILL.md`](.claude/skills/falsify/SKILL.md#where-these-ideas-come-from) has the details.

- **Scientific Debugging**: Andreas Zeller, *Why Programs Fail* (2005). Hypothesize, predict, test, refine, keep a log.
- **The Saff Squeeze**: David Saff, popularized by Kent Beck in *"Hit 'em High, Hit 'em Low"* (~2007).
- **Delta Debugging**: Zeller & Hildebrandt (2002), the automated, input-side counterpart to the squeeze.
- **Mutation testing**: DeMillo, Lipton & Sayward (1978), applied here to the disproof attempts, with the original bug as the mutant.
- **Severe testing**: Deborah Mayo (1996, 2018). A passed test is evidence only if it would have caught the error.
- **Pre-registration and HARKing**: clinical-trial methodology; Kerr (1998).
- **Type III errors**: Kimball (1957).
- **Positive test strategy**: Wason's 2-4-6 task (1960); Klayman & Ha (1987).

The combination doesn't seem to have an established name: holding the debugging loop itself to a severity standard, by asking whether the proof of a fix could ever have come out the other way.

## License

[GNU GPL v3](LICENSE).
