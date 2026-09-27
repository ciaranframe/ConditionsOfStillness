# COS_<Name> — "<the brief, verbatim>"

Date: <YYYY-MM-DD> · Asked by: <who> · Scene(s): <from patching/context/> · Status: research | written | auditioned | heard by Ciaran
Reusable findings: <none | one line each — a model, a partial table, a mapping that worked>

## 1. Brief

<The brief verbatim, then one paragraph reading it like a composer: the referent (or the 2–3
referents chosen for an abstract brief, and why), the role in the room against piano and bass
drum, which wrist/performer, one hand or 2H, what happens at rest. Mark every decision the brief
did not make as **Assumption:**.>

## 2. Context read

- `patching/profile.md` — <what constrained this patch>
- `patching/context/<file>` — <one line each; every file read in full>
- References consulted: `engine.md` §<…>, `patterns.md` §<…>, `pitfalls.md` §<…>
- Takes consulted: <label — what it showed (ranges, rates), or "none recorded yet">

## 3. Findings

Five to twelve per track, one sentence each with a number or a rule and its source; *(inferred)*
where not read directly. Then disagreements and "so for the patch…".

### A — Physics
### B — Synthesis prior art
### C — Musical world
### D — Gesture and mapping
### E — SuperCollider practice (UGens verified against local help; CPU)
### F — Steph's corpus (`patching/corpus/<branch>/personalities/<file>:<line>`; what is borrowed)

## 4. Design

- **Technique** — <chosen, and why it beats the runner-up here>
- **Idiom** — <patterns.md shape(s)>
- **Parameters** — table:

| parameter | value | from finding |
|---|---|---|

- **Pitch world and time** — <sets, how notes are chosen and moved; relation to the piano>
- **Mapping** — first in performer terms, then model fields:

| gesture (piano / drum terms) | model source | → parameter | in range | out range | curve / smoothing | why |
|---|---|---|---|---|---|---|

- **At rest / stillness** — <what is audible at near-zero motion; the reveal, if any>
- **Two-hand** — <n/a | what each wrist does; partner fields read, smoothed here>
- **Standby and exit** — <what could accumulate while unheard and how it is bounded; release time>
- **Level and CPU** — <expected peaks at rest / sway / hard shake; ceiling; CPU estimate>
- **Samples** — <none | slots → SHOPPING.md>

## 5. Params

| key | type / range | default | what it changes audibly |
|---|---|---|---|

Header line: `params: <key (range, default), …>` or `params: none`.

## 6. Hand-off

- **What it is** — <one sentence for a performer>
- **How to play it** — <in piano and drum terms: a rolled chord, a tremolo, a soft stroke, a
  damped head, a still hand>
- **Listen for** — <at rest; gentle playing; hard playing; the reveal>
- **Scene params worth trying** — <key=value → expected change>
- **Checks** — lint <result>; compile <result>; audition table <paste>; samples <status>
- **Open questions** — <for Ciaran>

## 7. Sources

<URL or file:line — what it gave — licence of any code or audio taken>

## 8. Iteration log

<YYYY-MM-DD — what Ciaran said — what changed>
